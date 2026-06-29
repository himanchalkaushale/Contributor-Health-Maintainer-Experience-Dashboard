from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import func, distinct
from app.models import (
    Repository, PullRequest, Issue, Contributor, ContributionEvent, Review, Comment, Label,
)
from app.config import get_settings
from datetime import datetime, timedelta
import statistics
import json
from typing import Dict, List, Any, Optional

settings = get_settings()


def _is_bot(login: str) -> bool:
    if not login:
        return True
    low = login.lower()
    return low.endswith("[bot]") or low == "github-actions"

class SignalEngine:
    def __init__(self, db: Session):
        self.db = db

    def _earliest_review_at_by_pr(self, pr_ids: List[int]) -> Dict[int, Any]:
        """Batch-fetch the earliest review submission_at per pull_request_id.
        Replaces a per-PR `ORDER BY submitted_at LIMIT 1` query (N+1) with one
        grouped query. Returns {pr_id: submitted_at}."""
        if not pr_ids:
            return {}
        rows = self.db.query(
            Review.pull_request_id,
            func.min(Review.submitted_at),
        ).filter(
            Review.pull_request_id.in_(pr_ids),
            Review.submitted_at != None,
        ).group_by(Review.pull_request_id).all()
        return {pid: ts for pid, ts in rows if ts is not None}

    def _latest_review_state_by_pr(self, pr_ids: List[int]) -> Dict[int, str]:
        """Batch-fetch the latest review state per pull_request_id. Loads all
        reviews for the given PRs in one query and picks the latest per PR in
        memory, avoiding a per-PR ORDER BY query (N+1)."""
        if not pr_ids:
            return {}
        reviews = self.db.query(Review).filter(
            Review.pull_request_id.in_(pr_ids),
            Review.submitted_at != None,
        ).all()
        latest: Dict[int, Any] = {}  # pr_id -> (submitted_at, state)
        for rv in reviews:
            ts = rv.submitted_at
            cur = latest.get(rv.pull_request_id)
            if cur is None or (ts is not None and cur[0] is not None and ts > cur[0]):
                latest[rv.pull_request_id] = (ts, rv.state)
        return {pid: state for pid, (_ts, state) in latest.items()}

    def compute_activity_timeline(self, repo_id: int, days: int = 365) -> Dict[str, Any]:
        """Event counts bucketed by week/month and event_type over the window."""
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        now = datetime.utcnow()
        window_start = now - timedelta(days=days)
        # Weekly buckets for <=180d, monthly otherwise
        granularity = "week" if days <= 180 else "month"

        events = self.db.query(ContributionEvent).filter(
            ContributionEvent.repository_id == repo_id,
            ContributionEvent.event_at >= window_start,
        ).all()

        event_types = ["pr_opened", "pr_merged", "pr_closed", "review_submitted",
                       "issue_opened", "issue_closed", "issue_comment", "commit"]

        def bucket_key(dt):
            if granularity == "week":
                monday = dt - timedelta(days=dt.weekday())
                return monday.strftime("%Y-%m-%d")
            return dt.strftime("%Y-%m")

        buckets = {}
        for ev in events:
            if not ev.event_at or ev.event_type not in event_types:
                continue
            if ev.contributor and _is_bot(ev.contributor.login):
                continue
            key = bucket_key(ev.event_at.replace(tzinfo=None))
            row = buckets.setdefault(key, {et: 0 for et in event_types})
            row[ev.event_type] += 1

        timeline = []
        for key in sorted(buckets.keys()):
            entry = {"period": key}
            entry.update(buckets[key])
            timeline.append(entry)

        return {
            "granularity": granularity,
            "event_types": event_types,
            "timeline": timeline,
            "last_updated": repo.last_synced_at or now,
        }

    def compute_leaderboard(self, repo_id: int, days: int = 365) -> Dict[str, Any]:
        """Per-contributor PRs merged, reviews given, comments, commits, tenure."""
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        now = datetime.utcnow()
        window_start = now - timedelta(days=days)

        events = self.db.query(ContributionEvent).options(
            selectinload(ContributionEvent.contributor)
        ).filter(
            ContributionEvent.repository_id == repo_id,
            ContributionEvent.event_at >= window_start,
        ).all()

        agg = {}  # cid -> stats
        for ev in events:
            c = ev.contributor
            if not c or _is_bot(c.login) or not ev.event_at:
                continue
            row = agg.setdefault(c.id, {
                "login": c.login, "avatar_url": c.avatar_url, "html_url": c.html_url,
                "prs_opened": 0, "prs_merged": 0, "reviews": 0, "comments": 0,
                "commits": 0, "first": ev.event_at, "last": ev.event_at,
            })
            dt = ev.event_at.replace(tzinfo=None)
            if dt < row["first"]:
                row["first"] = dt
            if dt > row["last"]:
                row["last"] = dt
            if ev.event_type == "pr_opened":
                row["prs_opened"] += 1
            elif ev.event_type == "pr_merged":
                row["prs_merged"] += 1
            elif ev.event_type == "review_submitted":
                row["reviews"] += 1
            elif ev.event_type == "issue_comment":
                row["comments"] += 1
            elif ev.event_type == "commit":
                row["commits"] += 1

        leaderboard = []
        for cid, r in agg.items():
            first = r["first"].replace(tzinfo=None) if hasattr(r["first"], "replace") else r["first"]
            last = r["last"].replace(tzinfo=None) if hasattr(r["last"], "replace") else r["last"]
            tenure_days = max(0, (last - first).days)
            total = r["prs_opened"] + r["prs_merged"] + r["reviews"] + r["comments"] + r["commits"]
            leaderboard.append({
                "login": r["login"], "avatar_url": r["avatar_url"], "html_url": r["html_url"],
                "prs_opened": r["prs_opened"], "prs_merged": r["prs_merged"],
                "reviews": r["reviews"], "comments": r["comments"], "commits": r["commits"],
                "tenure_days": tenure_days, "total_contributions": total,
            })

        leaderboard.sort(key=lambda x: x["total_contributions"], reverse=True)
        return {"leaderboard": leaderboard, "last_updated": repo.last_synced_at or now}

    def compute_reviewer_load(self, repo_id: int, days: int = 365) -> Dict[str, Any]:
        """Per reviewer: review count, median latency, share of total reviews."""
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        now = datetime.utcnow()
        window_start = now - timedelta(days=days)

        reviews = self.db.query(Review).options(
            joinedload(Review.reviewer)
        ).filter(
            Review.repository_id == repo_id,
            Review.submitted_at >= window_start,
        ).all()

        agg = {}
        total_reviews = 0
        for rv in reviews:
            reviewer = rv.reviewer
            if not reviewer or _is_bot(reviewer.login):
                continue
            total_reviews += 1
            row = agg.setdefault(reviewer.id, {
                "login": reviewer.login, "avatar_url": reviewer.avatar_url,
                "count": 0, "latencies": [],
            })
            row["count"] += 1
            if rv.latency_hours is not None and rv.latency_hours >= 0:
                row["latencies"].append(rv.latency_hours)

        reviewers = []
        for cid, r in agg.items():
            median_latency = statistics.median(r["latencies"]) if r["latencies"] else None
            reviewers.append({
                "login": r["login"], "avatar_url": r["avatar_url"],
                "reviews": r["count"],
                "median_latency_hours": round(median_latency, 1) if median_latency is not None else None,
                "share_percent": round(r["count"] / total_reviews * 100, 1) if total_reviews else 0,
            })

        reviewers.sort(key=lambda x: x["reviews"], reverse=True)
        return {
            "total_reviews": total_reviews,
            "reviewers": reviewers,
            "last_updated": repo.last_synced_at or now,
        }

    def compute_newcomer_funnel(self, repo_id: int, days: int = 365) -> Dict[str, Any]:
        """First-PR response time, time-to-merge, and whether newcomers returned."""
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        now = datetime.utcnow()
        window_start = now - timedelta(days=days)

        prs = self.db.query(PullRequest).options(
            selectinload(PullRequest.author)
        ).filter(
            PullRequest.repository_id == repo_id
        ).all()

        # First PR per author
        first_pr = {}  # cid -> PullRequest
        for pr in prs:
            if not pr.author or _is_bot(pr.author.login) or not pr.created_at:
                continue
            cid = pr.author.id
            created = pr.created_at.replace(tzinfo=None)
            if cid not in first_pr or created < first_pr[cid].created_at.replace(tzinfo=None):
                first_pr[cid] = pr

        # Pre-fetch the latest event timestamp per newcomer contributor so we can
        # determine "returned" without an N+1 query per newcomer.
        newcomer_cids = []
        for cid, pr in first_pr.items():
            if pr.created_at and pr.created_at.replace(tzinfo=None) >= window_start:
                newcomer_cids.append(cid)
        last_event_at = {}
        if newcomer_cids:
            rows = self.db.query(
                ContributionEvent.contributor_id,
                func.max(ContributionEvent.event_at),
            ).filter(
                ContributionEvent.repository_id == repo_id,
                ContributionEvent.contributor_id.in_(newcomer_cids),
            ).group_by(ContributionEvent.contributor_id).all()
            last_event_at = {cid: mx for cid, mx in rows if mx is not None}

        response_times = []
        merge_times = []
        newcomers = 0
        returned = 0
        merged_first = 0

        for cid, pr in first_pr.items():
            created = pr.created_at.replace(tzinfo=None)
            if created < window_start:
                continue
            newcomers += 1

            if pr.time_to_first_review is not None:
                response_times.append(pr.time_to_first_review)
            if pr.merged_at:
                merged_first += 1
                merge_times.append((pr.merged_at.replace(tzinfo=None) - created).total_seconds() / 3600.0)

            # Returned? Any contribution event after their first PR creation.
            latest = last_event_at.get(cid)
            if latest is not None and latest > pr.created_at:
                returned += 1

        def med(lst):
            return round(statistics.median(lst), 1) if lst else None

        retention_rate = round(returned / newcomers * 100, 1) if newcomers else 0
        merge_rate = round(merged_first / newcomers * 100, 1) if newcomers else 0

        median_resp = med(response_times) or 0.0
        severity = 'healthy'
        if median_resp > 72:
            severity = 'critical'
        elif median_resp > 24:
            severity = 'warning'

        return {
            "newcomers": newcomers,
            "returned": returned,
            "retention_rate": retention_rate,
            "first_pr_merged": merged_first,
            "merge_rate": merge_rate,
            "median_first_response_hours": median_resp,
            "worst_first_response_hours": round(max(response_times), 1) if response_times else 0.0,
            "median_time_to_merge_hours": med(merge_times),
            "severity": severity,
            "last_updated": repo.last_synced_at or now,
        }

    def compute_contributors_health(self, repo_id: int) -> Dict[str, Any]:
        """
        Computes contributor health metrics based on STRICT "Real Contributor Logic":
        - Ignore bots (actor_login suffix '[bot]')
        - Activity = PR Open or Issue Open (simplification as we don't have separate event table yet)
        - Windows relative to NOW()
        """
        try:
            repo = self.db.query(Repository).get(repo_id)
            if not repo:
                return None
                
            now = datetime.utcnow()
            thirty_days_ago = now - timedelta(days=30)
            forty_five_days_ago = now - timedelta(days=45)
            
            # 1. Gather all events (PRs + Issues) mapped by Author
            # Filter out bots in Python loop for flexibility (or SQL 'NOT LIKE')
            contributor_stats = {} # {cid: {first, last, type, login, avatar}}

            def is_bot(login: str) -> bool:
                if not login: return True
                return login.lower().endswith("[bot]") or login.lower() == "github-actions"

            # Scan PRs
            prs = self.db.query(PullRequest).filter(PullRequest.repository_id == repo_id).all()
            for pr in prs:
                if not pr.author or is_bot(pr.author.login): continue
                cid = pr.author.id
                if not pr.created_at: continue
                # Fix Timezone Mismatch
                date = pr.created_at.replace(tzinfo=None)
                
                if cid not in contributor_stats:
                    contributor_stats[cid] = {'first': date, 'last': date, 'type': 'pr_open', 'login': pr.author.login, 'avatar': pr.author.avatar_url}
                else:
                    if date < contributor_stats[cid]['first']: contributor_stats[cid]['first'] = date
                    if date > contributor_stats[cid]['last']: 
                        contributor_stats[cid]['last'] = date
                        contributor_stats[cid]['type'] = 'pr_open'

            # Scan Issues
            issues = self.db.query(Issue).filter(Issue.repository_id == repo_id).all()
            for issue in issues:
                if not issue.author or is_bot(issue.author.login): continue
                cid = issue.author.id
                if not issue.created_at: continue
                # Fix Timezone Mismatch
                date = issue.created_at.replace(tzinfo=None)
                
                if cid not in contributor_stats:
                    contributor_stats[cid] = {'first': date, 'last': date, 'type': 'issue_open', 'login': issue.author.login, 'avatar': issue.author.avatar_url}
                else:
                    if date < contributor_stats[cid]['first']: contributor_stats[cid]['first'] = date
                    if date > contributor_stats[cid]['last']: 
                        contributor_stats[cid]['last'] = date
                        contributor_stats[cid]['type'] = 'issue_open'

            # 2. Bucket Contributors
            new_count = 0
            returning_count = 0
            churned_count = 0
            active_list = []
            
            for cid, stats in contributor_stats.items():
                first = stats['first']
                last = stats['last']
                
                # Active Window Check
                is_active_now = last >= thirty_days_ago
                
                if is_active_now:
                    # NEW: First ever activity was recent
                    if first >= thirty_days_ago:
                        new_count += 1
                    else:
                        # RETURNING: Active before, and Active again now
                        returning_count += 1
                    
                    # Active Table Logic
                    days_ago = (now - last).days
                    status = 'healthy' # Default healthy if active recently
                    # Refined status based on recency within the 30d window
                    if days_ago > 14: status = 'warning' 
                    if days_ago > 21: status = 'critical'
                    
                    active_list.append({
                        "login": stats['login'],
                        "avatar_url": stats['avatar'],
                        "last_activity_date": last,
                        "activity_type": stats['type'],
                        "status": status
                    })
                else:
                    # Inactive / Churned Logic
                    # Churned if last activity > 45 days ago
                    if last < forty_five_days_ago:
                        churned_count += 1

            active_list.sort(key=lambda x: x['last_activity_date'], reverse=True)
            
            # 3. First Time Response Time (Median)
            # Definition: Time between First PR creation and First Response
            # Filter: Only consider users whose FIRST activity was a PR
            response_times = []
            
            for cid, stats in contributor_stats.items():
                # Get all PRs for this user
                user_prs = [p for p in prs if p.author_id == cid]
                if not user_prs: continue
                
                # Find their first PR ever
                # Fix Timezone Mismatch for sort and compare
                user_prs.sort(key=lambda x: x.created_at.replace(tzinfo=None) if x.created_at else datetime.min)
                first_pr = user_prs[0]
                
                # Check if this PR was actually their first activity
                first_pr_date = first_pr.created_at.replace(tzinfo=None) if first_pr.created_at else datetime.min
                if first_pr_date > stats['first']:
                    # They opened an issue before their first PR? 
                    # Strict definition says "Contributor's FIRST PR". So we ignore prior issues.
                    pass
                    
                # Basic validation: ignore if it has no review/response data
                # We use `time_to_first_review` stored in DB.
                if first_pr.time_to_first_review is not None:
                    response_times.append(first_pr.time_to_first_review)

            median_hours = statistics.median(response_times) if response_times else 0.0
            worst_case = max(response_times) if response_times else 0.0
            
            severity = 'healthy'
            if median_hours > 72: severity = 'critical'
            elif median_hours > 24: severity = 'warning'
            
            return {
                "summary": {
                    "new": new_count,
                    "returning": returning_count,
                    "churned": churned_count,
                    "active": len(active_list)
                },
                "first_time_experience": {
                    "median_hours": round(median_hours, 1),
                    "worst_case_hours": round(worst_case, 1),
                    "severity": severity
                },
                "active_contributors": active_list,
                "last_updated": repo.last_synced_at.replace(tzinfo=None) if repo.last_synced_at else now
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"ERROR calculating contributors: {e}")
            return None

    def compute_pr_bottlenecks(self, repo_id: int) -> Dict[str, Any]:
        """
        Computes data for the PR Bottlenecks page.
        Focuses on review flow health, stuck PRs, and first-time contributor experience.
        """
        try:
            repo = self.db.query(Repository).get(repo_id)
            if not repo:
                return None
            
            now = datetime.utcnow()
            
            # --- 1. OPEN PR COUNT ---
            open_prs = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.state == 'open'
            ).all()
            open_prs_count = len(open_prs)
            
            # --- 2. PRs WAITING MORE THAN 7 DAYS (NO MAINTAINER REVIEW) ---
            seven_days_ago = now - timedelta(days=7)
            waiting_over_7d_count = sum(1 for pr in open_prs if pr.created_at < seven_days_ago and not pr.has_review)
            
            # --- 3. PRs WITHOUT ANY REVIEW (CRITICAL SIGNAL) ---
            unreviewed_prs_count = sum(1 for pr in open_prs if not pr.has_review)
            
            # --- 4. MEDIAN TIME TO FIRST REVIEW (LAST 90 DAYS) ---
            ninety_days_ago = now - timedelta(days=90)
            reviewed_prs_90d = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.time_to_first_review != None,
                PullRequest.created_at >= ninety_days_ago
            ).all()
            
            review_times = [pr.time_to_first_review for pr in reviewed_prs_90d]
            median_review_hours = statistics.median(review_times) if review_times else 0.0
            
            # --- 5. STUCK PRs — ACTIONABLE LIST (CORE TABLE) ---
            stuck_prs = []
            for pr in open_prs:
                age_days = (now - pr.created_at).days
                
                status = 'healthy'
                if age_days > 14:
                    status = 'critical'
                elif age_days > 7:
                    status = 'warning'
                    
                # Determining last activity roughly (since we don't have separate event table easily accessible here)
                # Logic: If has_review is True, last act is likely maintainer (simplification)
                # Real implementation would query comments/events. 
                # Adhering to prompt simplification:
                last_activity = 'maintainer' if pr.has_review else 'contributor'
                
                stuck_prs.append({
                    "number": pr.number,
                    "title": pr.title,
                    "author": pr.author.login if pr.author else "unknown",
                    "age_days": age_days,
                    "last_activity": last_activity,
                    "status": status,
                    "html_url": f"https://github.com/{repo.owner}/{repo.name}/pull/{pr.number}" # Construct URL
                })
            
            # Sort by age descending (oldest first)
            stuck_prs.sort(key=lambda x: x['age_days'], reverse=True)
            stuck_prs = stuck_prs[:50] # Limit 50
            
            # --- 6. REVIEW FLOW BREAKDOWN ---
            # Re-query for flow breakdown to ensure we capture merged ones too
            recent_90d_prs = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.created_at >= ninety_days_ago
            ).all()
            
            waiting_for_first_review = sum(1 for pr in recent_90d_prs if pr.time_to_first_review is None)
            # Waiting for merge: Reviewed but not merged and not closed (open)
            # Simplification: If it has a review time and is still open.
            waiting_for_merge = sum(1 for pr in recent_90d_prs if pr.time_to_first_review is not None and pr.merged_at is None and pr.state == 'open')
            merged_prs_count = sum(1 for pr in recent_90d_prs if pr.merged_at is not None)
            
            # --- 7. FIRST-TIME CONTRIBUTOR PRs (EXPERIENCE METRIC) ---
            # Identify first-time authors
            # Get all contributors for this repo
            all_prs = self.db.query(PullRequest).filter(PullRequest.repository_id == repo_id).all()
            author_first_pr_date = {} # {login: datetime}
            
            for pr in all_prs:
                if not pr.author or not pr.created_at: continue
                login = pr.author.login
                date = pr.created_at
                if login not in author_first_pr_date:
                    author_first_pr_date[login] = date
                else:
                    if date < author_first_pr_date[login]:
                        author_first_pr_date[login] = date
                        
            # Filter PRs where it was the author's first PR
            first_time_pr_review_times = []
            first_time_waiting_count = 0
            
            for pr in all_prs: # Iterate all PRs or just open? Prompt implies "impact on new contributors", usually historical metric + current
                # Let's stick to recent window or all? Prompt SQL uses "first_prs" JOIN.
                # Let's use the ones that have review times for median.
                 if not pr.author: continue
                 login = pr.author.login
                 
                 # Is this their first PR?
                 if pr.created_at == author_first_pr_date.get(login):
                     # Yes, first PR
                     if pr.time_to_first_review is not None:
                         first_time_pr_review_times.append(pr.time_to_first_review)
                     
                     # Check if currently waiting > 7d (Open & Unreviewed & >7d age)
                     if pr.state == 'open' and not pr.has_review:
                         age = (now - pr.created_at).days
                         if age > 7:
                             first_time_waiting_count += 1

            median_first_time_review = statistics.median(first_time_pr_review_times) if first_time_pr_review_times else 0.0

            return {
                "summary": {
                    "open_prs": open_prs_count,
                    "waiting_over_7d": waiting_over_7d_count,
                    "median_review_hours": round(median_review_hours, 1),
                    "unreviewed_prs": unreviewed_prs_count
                },
                "stuck_prs": stuck_prs,
                "first_time_prs": {
                    "count": first_time_waiting_count, # Interpret "number of first-time PRs waiting more than 7 days"
                    "median_review_hours": round(median_first_time_review, 1)
                },
                "review_flow": {
                    "waiting_for_review": waiting_for_first_review,
                    "waiting_for_merge": waiting_for_merge,
                    "merged": merged_prs_count
                }
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"ERROR calculating PR bottlenecks: {e}")
            return None

    @staticmethod
    def _parse_labels(labels_snapshot: Optional[str]) -> List[str]:
        """Safely parse the JSON labels snapshot into a list of label names."""
        if not labels_snapshot:
            return []
        try:
            labels = json.loads(labels_snapshot)
        except (ValueError, TypeError):
            return []
        if not isinstance(labels, list):
            return []
        return [str(l) for l in labels]

    def compute_issues_health(self, repo_id: int) -> Dict[str, Any]:
        """
        Computes data for the Issues Page.
        Focuses on maintainer responsiveness, backlog health, and triage quality.
        """
        try:
            repo = self.db.query(Repository).get(repo_id)
            if not repo:
                return None
            
            now = datetime.utcnow()
            
            # --- 1. Issue Health Summary ---
            open_issues = self.db.query(Issue).filter(
                Issue.repository_id == repo_id,
                Issue.state == 'open'
            ).all()
            open_issues_count = len(open_issues)
            
            # Unanswered: No maintainer response
            unanswered_issues = [i for i in open_issues if not i.has_maintainer_response]
            unanswered_count = len(unanswered_issues)
            
            # Issues Older Than 30 Days
            thirty_days_ago = now - timedelta(days=30)
            older_than_30d_count = sum(1 for i in open_issues if i.created_at < thirty_days_ago)
            
            # Median Time to First Response (Last 90 Days)
            ninety_days_ago = now - timedelta(days=90)
            responded_issues_90d = self.db.query(Issue).filter(
                Issue.repository_id == repo_id,
                Issue.time_to_first_response != None,
                Issue.created_at >= ninety_days_ago
            ).all()
            
            response_times = [i.time_to_first_response for i in responded_issues_90d]
            median_response_hours = statistics.median(response_times) if response_times else None
            
            # --- 2. Unanswered Issues — Actionable List ---
            unanswered_list = []
            for issue in unanswered_issues:
                age_days = (now - issue.created_at).days
                
                status = 'healthy'
                if age_days > 14:
                    status = 'critical'
                elif age_days > 7:
                    status = 'warning'
                
                unanswered_list.append({
                    "number": issue.number,
                    "title": issue.title,
                    "author": issue.author.login if issue.author else "unknown",
                    "age_days": age_days,
                    "labels": [], # Schema limitation: labels not stored
                    "status": status,
                    "html_url": f"https://github.com/{repo.owner}/{repo.name}/issues/{issue.number}"
                })
            
            # Sort by age descending
            unanswered_list.sort(key=lambda x: x['age_days'], reverse=True)
            unanswered_list = unanswered_list[:50]
            
            # --- 3. Issue Aging Breakdown ---
            seven_days_ago = now - timedelta(days=7)
            
            buckets = {
                "<7d": sum(1 for i in open_issues if i.created_at >= seven_days_ago),
                "7-30d": sum(1 for i in open_issues if i.created_at < seven_days_ago and i.created_at >= thirty_days_ago),
                ">30d": older_than_30d_count
            }
            
            # --- 4. Issue Triage Quality ---
            # % with labels -> Mocked 0% for now
            percent_labelled = 0 
            
            # % < 48h response (of those responded to in last 90d)
            under_48h = sum(1 for t in response_times if t < 48)
            percent_fast_response = (under_48h / len(response_times) * 100) if response_times else None
            
            # % First-Time Contributors
            # Need to identify first-time contributors again. 
            # Reusing lightweight logic: Check if issue author has prior activity
            # For strictness: Calculate based on ALL issues/PRs. Expensive?
            # Optimization: Use existing author data we might have or do a quick query.
            # Simplified: Just check if this is their first issue in THIS repo?
            # Let's count how many issues 90d ago were by new contributors.
            
            all_issues = self.db.query(Issue).filter(Issue.repository_id == repo_id).all()
            author_first_issue = {}
            for i in all_issues:
                if not i.author or not i.created_at: continue
                login = i.author.login
                if login not in author_first_issue or i.created_at < author_first_issue[login]:
                    author_first_issue[login] = i.created_at
            
            recent_issues_90d = [i for i in all_issues if i.created_at >= ninety_days_ago]
            first_time_issue_count_90d = 0
            for i in recent_issues_90d:
                if not i.author: continue
                if i.created_at == author_first_issue.get(i.author.login):
                    first_time_issue_count_90d += 1
            
            percent_first_time = (first_time_issue_count_90d / len(recent_issues_90d) * 100) if recent_issues_90d else 0
            
            # --- 5. First-Time Issue Experience ---
            first_time_unanswered = 0
            first_time_response_times = []
            
            for i in all_issues:
                 if not i.author: continue
                 # Is first issue?
                 if i.created_at == author_first_issue.get(i.author.login):
                     if i.state == 'open' and not i.has_maintainer_response:
                         first_time_unanswered += 1
                     if i.time_to_first_response is not None:
                         first_time_response_times.append(i.time_to_first_response)
                         
            median_first_time_response = statistics.median(first_time_response_times) if first_time_response_times else None

            return {
                "summary": {
                    "open_issues": open_issues_count,
                    "unanswered": unanswered_count,
                    "median_first_response_hours": round(median_response_hours, 1) if median_response_hours is not None else None,
                    "older_than_30d": older_than_30d_count
                },
                "unanswered_issues": unanswered_list,
                "age_buckets": buckets,
                "triage_quality": {
                    "percent_labelled": round(percent_labelled, 1),
                    "percent_fast_response": round(percent_fast_response, 1) if percent_fast_response is not None else None,
                    "percent_first_time": round(percent_first_time, 1)
                },
                "first_time_issues": {
                    "count": first_time_unanswered,
                    "median_response_hours": round(median_first_time_response, 1) if median_first_time_response is not None else None
                }
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"ERROR calculating Issues health: {e}")
            print(f"ERROR calculating Issues health: {e}")
            return None

    def compute_pr_review_health(self, repo_id: int, days: int = 90) -> Dict[str, Any]:
        """
        Calculates PR Review Health metrics with enhanced KPIs, trends, funnel, and alerts.
        Backward-compatible: preserves existing `summary`, `attention_queue`, `review_flow` keys.
        New keys: `kpis`, `trends`, `wait_distribution`, `funnel`, `alerts`.
        """
        now = datetime.utcnow()
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        try:
            # --- Window definitions ---
            window_start = now - timedelta(days=days)
            prior_start = now - timedelta(days=days * 2)
            seven_days_ago = now - timedelta(days=7)
            fourteen_days_ago = now - timedelta(days=14)

            # --- 1. Basic Counts (existing, null-safe) ---
            open_prs = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.state == 'open'
            ).all()
            open_prs_count = len(open_prs)

            unreviewed_prs = [pr for pr in open_prs if not pr.has_review]
            unreviewed_count = len(unreviewed_prs)

            waiting_over_7d = [pr for pr in open_prs if pr.created_at and pr.created_at < seven_days_ago]
            waiting_over_7d_count = len(waiting_over_7d)

            # --- 2. Median Review Time (within window) ---
            reviewed_prs_window = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.time_to_first_review != None,
                PullRequest.created_at >= window_start
            ).all()
            review_times = [pr.time_to_first_review for pr in reviewed_prs_window if pr.time_to_first_review is not None]
            median_review_hours = round(statistics.median(review_times), 1) if review_times else None

            # --- 3. NEW: Time-to-Merge ---
            merged_prs_window = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.merged_at != None,
                PullRequest.merged_at >= window_start,
                PullRequest.created_at != None
            ).all()

            ttm_hours_current = []
            for pr in merged_prs_window:
                if pr.merged_at and pr.created_at:
                    h = (pr.merged_at - pr.created_at).total_seconds() / 3600.0
                    if h >= 0:
                        ttm_hours_current.append(h)

            time_to_merge_median = round(statistics.median(ttm_hours_current), 1) if ttm_hours_current else None
            time_to_merge_mean = round(statistics.mean(ttm_hours_current), 1) if ttm_hours_current else None

            merged_prs_prior = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.merged_at != None,
                PullRequest.merged_at >= prior_start,
                PullRequest.merged_at < window_start,
                PullRequest.created_at != None
            ).all()
            ttm_hours_prior = []
            for pr in merged_prs_prior:
                if pr.merged_at and pr.created_at:
                    h = (pr.merged_at - pr.created_at).total_seconds() / 3600.0
                    if h >= 0:
                        ttm_hours_prior.append(h)
            time_to_merge_median_prior = statistics.median(ttm_hours_prior) if ttm_hours_prior else None
            time_to_merge_delta = None
            if time_to_merge_median is not None and time_to_merge_median_prior is not None and time_to_merge_median_prior != 0:
                time_to_merge_delta = round(((time_to_merge_median - time_to_merge_median_prior) / time_to_merge_median_prior) * 100, 1)

            # --- 4. NEW: Review Cycle Time ---
            closed_prs_window = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.state != 'open',
                PullRequest.closed_at != None,
                PullRequest.closed_at >= window_start
            ).all()

            rct_hours_current = []
            earliest_review_current = self._earliest_review_at_by_pr([pr.id for pr in closed_prs_window])
            for pr in closed_prs_window:
                end_dt = pr.merged_at or pr.closed_at
                if not end_dt:
                    continue
                first_review_dt = earliest_review_current.get(pr.id)
                if first_review_dt is None and pr.time_to_first_review is not None:
                    first_review_dt = pr.created_at + timedelta(hours=pr.time_to_first_review)
                elif first_review_dt is None:
                    continue
                h = (end_dt - first_review_dt).total_seconds() / 3600.0
                if h >= 0:
                    rct_hours_current.append(h)

            review_cycle_time_median = round(statistics.median(rct_hours_current), 1) if rct_hours_current else None

            closed_prs_prior = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.state != 'open',
                PullRequest.closed_at != None,
                PullRequest.closed_at >= prior_start,
                PullRequest.closed_at < window_start
            ).all()

            rct_hours_prior = []
            earliest_review_prior = self._earliest_review_at_by_pr([pr.id for pr in closed_prs_prior])
            for pr in closed_prs_prior:
                end_dt = pr.merged_at or pr.closed_at
                if not end_dt:
                    continue
                first_review_dt = earliest_review_prior.get(pr.id)
                if first_review_dt is None and pr.time_to_first_review is not None:
                    first_review_dt = pr.created_at + timedelta(hours=pr.time_to_first_review)
                elif first_review_dt is None:
                    continue
                h = (end_dt - first_review_dt).total_seconds() / 3600.0
                if h >= 0:
                    rct_hours_prior.append(h)

            review_cycle_time_median_prior = statistics.median(rct_hours_prior) if rct_hours_prior else None
            review_cycle_time_delta = None
            if review_cycle_time_median is not None and review_cycle_time_median_prior is not None and review_cycle_time_median_prior != 0:
                review_cycle_time_delta = round(((review_cycle_time_median - review_cycle_time_median_prior) / review_cycle_time_median_prior) * 100, 1)

            # --- 5. NEW: Comment Density ---
            prs_in_window = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.created_at >= window_start
            ).all()

            comment_density = None
            comment_density_source = "reviews_count"
            if prs_in_window:
                pr_numbers_in_window = [pr.number for pr in prs_in_window if pr.number is not None]
                if pr_numbers_in_window:
                    comment_counts = {pr.id: 0 for pr in prs_in_window}
                    num_to_prid = {pr.number: pr.id for pr in prs_in_window if pr.number is not None}
                    rows = self.db.query(
                        Comment.issue_number,
                        func.count(Comment.id),
                    ).filter(
                        Comment.repository_id == repo_id,
                        Comment.issue_number.in_(pr_numbers_in_window),
                        Comment.created_at >= window_start,
                    ).group_by(Comment.issue_number).all()
                    for issue_number, cnt in rows:
                        prid = num_to_prid.get(issue_number)
                        if prid is not None:
                            comment_counts[prid] = cnt

                    if any(v > 0 for v in comment_counts.values()):
                        comment_density_source = "comment_table"
                        comment_density = round(sum(comment_counts.values()) / len(prs_in_window), 2)
                    else:
                        rc_values = [pr.reviews_count for pr in prs_in_window if pr.reviews_count is not None]
                        if rc_values:
                            comment_density = round(statistics.mean(rc_values), 2)

            prs_in_prior = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.created_at >= prior_start,
                PullRequest.created_at < window_start
            ).all()
            comment_density_prior = None
            if prs_in_prior:
                if comment_density_source == "comment_table":
                    prior_pr_numbers = [pr.number for pr in prs_in_prior if pr.number is not None]
                    prior_comment_counts = []
                    if prior_pr_numbers:
                        rows = self.db.query(
                            Comment.issue_number,
                            func.count(Comment.id),
                        ).filter(
                            Comment.repository_id == repo_id,
                            Comment.issue_number.in_(prior_pr_numbers),
                            Comment.created_at >= prior_start,
                            Comment.created_at < window_start,
                        ).group_by(Comment.issue_number).all()
                        counts_by_number = {n: c for n, c in rows}
                        for pr in prs_in_prior:
                            if pr.number is not None:
                                prior_comment_counts.append(counts_by_number.get(pr.number, 0))
                    if prior_comment_counts:
                        comment_density_prior = sum(prior_comment_counts) / len(prs_in_prior)
                else:
                    rc_vals = [pr.reviews_count for pr in prs_in_prior if pr.reviews_count is not None]
                    if rc_vals:
                        comment_density_prior = statistics.mean(rc_vals)

            comment_density_delta = None
            if comment_density is not None and comment_density_prior is not None and comment_density_prior != 0:
                comment_density_delta = round(((comment_density - comment_density_prior) / comment_density_prior) * 100, 1)

            # --- 6. NEW: Trend Series (weekly buckets within window) ---
            trend_series = []
            import math
            bucket_weeks = max(1, math.ceil(days / 7))
            for i in range(bucket_weeks):
                bucket_start = window_start + timedelta(weeks=i)
                bucket_end = bucket_start + timedelta(weeks=1)
                if bucket_start > now:
                    break

                bucket_merged = [pr for pr in merged_prs_window
                                 if pr.merged_at and bucket_start <= pr.merged_at < bucket_end]
                merged_count = len(bucket_merged)

                bucket_ttm = []
                for pr in bucket_merged:
                    if pr.created_at:
                        h = (pr.merged_at - pr.created_at).total_seconds() / 3600.0
                        if h >= 0:
                            bucket_ttm.append(h)

                bucket_closed = [pr for pr in closed_prs_window
                                 if pr.closed_at and bucket_start <= pr.closed_at < bucket_end]
                bucket_rct = []
                for pr in bucket_closed:
                    end_dt = pr.merged_at or pr.closed_at
                    if not end_dt:
                        continue
                    first_review_dt = earliest_review_current.get(pr.id)
                    if first_review_dt is None and pr.time_to_first_review is not None:
                        first_review_dt = pr.created_at + timedelta(hours=pr.time_to_first_review)
                    elif first_review_dt is None:
                        continue
                    h = (end_dt - first_review_dt).total_seconds() / 3600.0
                    if h >= 0:
                        bucket_rct.append(h)

                trend_series.append({
                    "week_start": bucket_start.strftime("%Y-%m-%d"),
                    "time_to_merge_hours": round(statistics.median(bucket_ttm), 1) if bucket_ttm else None,
                    "review_cycle_hours": round(statistics.median(bucket_rct), 1) if bucket_rct else None,
                    "merged_count": merged_count
                })

            # --- 7. NEW: Wait-time Distribution ---
            wait_times = []
            for pr in open_prs:
                if not pr.has_review and pr.created_at:
                    wait_h = (now - pr.created_at).total_seconds() / 3600.0
                    wait_times.append(wait_h)
            for pr in reviewed_prs_window:
                if pr.time_to_first_review is not None:
                    wait_times.append(pr.time_to_first_review)

            dist = {"0_2d": 0, "gt2_7d": 0, "gt7_14d": 0, "14d_plus": 0}
            for h in wait_times:
                d = h / 24.0
                if d <= 2:
                    dist["0_2d"] += 1
                elif d <= 7:
                    dist["gt2_7d"] += 1
                elif d <= 14:
                    dist["gt7_14d"] += 1
                else:
                    dist["14d_plus"] += 1

            wait_distribution = [
                {"bucket": "0–2d", "count": dist["0_2d"]},
                {"bucket": ">2–7d", "count": dist["gt2_7d"]},
                {"bucket": ">7–14d", "count": dist["gt7_14d"]},
                {"bucket": "14d+", "count": dist["14d_plus"]},
            ]

            # --- 8. NEW: Review-stage Funnel ---
            funnel_unreviewed = unreviewed_count

            approved_states = {'approved', 'APPROVED'}
            in_review_prs = 0
            approved_prs = 0
            reviewed_open_pr_ids = [pr.id for pr in open_prs if pr.has_review]
            latest_review_state = self._latest_review_state_by_pr(reviewed_open_pr_ids)
            for pr in open_prs:
                if pr.has_review:
                    state = latest_review_state.get(pr.id)
                    if state in approved_states:
                        approved_prs += 1
                    else:
                        in_review_prs += 1

            funnel_merged = len(merged_prs_window)

            funnel = [
                {"stage": "Unreviewed", "count": funnel_unreviewed},
                {"stage": "In Review", "count": in_review_prs},
                {"stage": "Approved", "count": approved_prs},
                {"stage": "Merged", "count": funnel_merged},
            ]

            # --- 9. NEW: Stale Alerts ---
            critical_stale = []
            warning_stale = []
            for pr in open_prs:
                if not pr.has_review and pr.created_at:
                    age_d = (now - pr.created_at).days
                    if age_d > 14:
                        critical_stale.append(pr.number)
                    elif age_d > 7:
                        warning_stale.append(pr.number)

            alerts = {
                "critical_count": len(critical_stale),
                "warning_count": len(warning_stale),
                "stale_pr_numbers": critical_stale + warning_stale
            }

            # --- 10. Attention Queue (existing, enhanced with nudge fields and deep-links) ---
            attention_queue = []
            for pr in open_prs:
                age_days = (now - pr.created_at).days if pr.created_at else 0
                is_unreviewed = not pr.has_review

                status = 'healthy'
                if is_unreviewed:
                    if age_days > 7:
                        status = 'critical'
                    else:
                        status = 'warning'
                else:
                    if age_days > 14:
                        status = 'critical'
                    elif age_days > 7:
                        status = 'warning'

                last_activity = 'None' if is_unreviewed else 'Maintainer'
                base_url = f"https://github.com/{repo.owner}/{repo.name}/pull/{pr.number}"

                attention_queue.append({
                    "number": pr.number,
                    "title": pr.title or "",
                    "author": pr.author.login if pr.author else "unknown",
                    "age_days": age_days,
                    "last_activity": last_activity,
                    "status": status,
                    "is_unreviewed": is_unreviewed,
                    "html_url": base_url,
                    "files_url": f"{base_url}/files",
                    "reviews_url": f"{base_url}/files#reviews",
                })

            attention_queue.sort(key=lambda x: (x['is_unreviewed'], x['age_days']), reverse=True)

            # --- 11. Review Flow Insight (existing, backward-compatible) ---
            reviewed_open = open_prs_count - unreviewed_count

            return {
                # --- Existing keys (backward-compatible) ---
                "summary": {
                    "open_prs": open_prs_count,
                    "unreviewed_prs": unreviewed_count,
                    "waiting_over_7d": waiting_over_7d_count,
                    "median_review_hours": median_review_hours
                },
                "attention_queue": attention_queue,
                "review_flow": {
                    "waiting_for_first_review": unreviewed_count,
                    "in_review_process": reviewed_open
                },
                # --- New keys ---
                "kpis": {
                    "time_to_merge_median_hours": time_to_merge_median,
                    "time_to_merge_mean_hours": time_to_merge_mean,
                    "time_to_merge_delta_pct": time_to_merge_delta,
                    "review_cycle_time_median_hours": review_cycle_time_median,
                    "review_cycle_time_delta_pct": review_cycle_time_delta,
                    "comment_density": comment_density,
                    "comment_density_delta_pct": comment_density_delta,
                    "comment_density_source": comment_density_source,
                },
                "trends": trend_series,
                "wait_distribution": wait_distribution,
                "funnel": funnel,
                "alerts": alerts,
            }

        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"ERROR calculating PR Review Health: {e}")
            return None

    def compute_repo_signals(self, repo_id: int) -> List[Dict[str, Any]]:
        signals = []
        signals.append(self._compute_stale_prs_signal(repo_id))
        signals.append(self._compute_unanswered_issues(repo_id))
        return signals

    def compute_overview(self, repo_id: int) -> Dict[str, Any]:
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        # 1. Active Contributors (Last 30 days)
        # Corrected Logic: PullRequest.author_id IS populated now.
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        
        active_pr_authors = self.db.query(PullRequest.author_id).filter(
            PullRequest.repository_id == repo_id,
            PullRequest.created_at >= thirty_days_ago
        )
        active_issue_authors = self.db.query(Issue.author_id).filter(
            Issue.repository_id == repo_id,
            Issue.created_at >= thirty_days_ago
        )
        
        active_ids = set()
        for r in active_pr_authors: active_ids.add(r[0])
        for r in active_issue_authors: active_ids.add(r[0])
        
        active_contributors_count = len(active_ids)

        # 2. Open PRs & Stale PRs
        open_prs_count = repo.open_prs_count
        
        stale_threshold = 14 * 24 # hours
        stale_prs_count = self.db.query(PullRequest).filter(
            PullRequest.repository_id == repo_id,
            PullRequest.state == 'open',
            PullRequest.review_wait_time > stale_threshold
        ).count()
        
        # 3. Median Review Time (Time to First Review)
        ninety_days_ago = datetime.utcnow() - timedelta(days=90)
        reviewed_prs = self.db.query(PullRequest).filter(
            PullRequest.repository_id == repo_id,
            PullRequest.time_to_first_review != None,
            PullRequest.created_at >= ninety_days_ago
        ).all()
        
        times = [pr.time_to_first_review for pr in reviewed_prs]
        if times:
            median_hours = statistics.median(times)
        else:
            median_hours = 0.0
            
        if median_hours == 0:
            review_label = "N/A"
        elif median_hours < 24:
            review_label = f"< 24h"
        elif median_hours < 48:
            review_label = f"{round(median_hours/24.0, 1)} days"
        else:
            review_label = f"{round(median_hours/168.0, 1)} weeks"

        # 4. Unanswered Issues & Buckets
        unanswered_issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.state == 'open',
            Issue.has_maintainer_response == False
        ).all()
        
        unanswered_count = len(unanswered_issues)
        
        # Buckets
        now = datetime.utcnow()
        b_7d = 0
        b_30d = 0
        b_old = 0
        
        for issue in unanswered_issues:
            age_days = (now - issue.created_at).days
            if age_days < 7: b_7d += 1
            elif age_days < 30: b_30d += 1
            else: b_old += 1
            
        buckets = [
            {"label": "< 7d", "count": b_7d, "color": "text-emerald-600"},
            {"label": "7-30d", "count": b_30d, "color": "text-yellow-600"},
            {"label": "> 30d", "count": b_old, "color": "text-red-500"}
        ]

        # 5. Activity Trend
        history_start = datetime.utcnow() - timedelta(weeks=5)
        
        recent_prs = self.db.query(PullRequest).filter(
            PullRequest.repository_id == repo_id,
            PullRequest.created_at >= history_start
        ).all()
        
        recent_issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.created_at >= history_start
        ).all()

        weeks = []
        pr_counts = []
        issue_counts = []

        now = datetime.utcnow()
        for i in range(4, -1, -1):
            week_start = now - timedelta(weeks=i+1)
            week_end = now - timedelta(weeks=i)
            week_label = f"W{5-i}"
            
            p_count = sum(1 for p in recent_prs if week_start <= p.created_at < week_end)
            i_count = sum(1 for issue in recent_issues if week_start <= issue.created_at < week_end)
            
            weeks.append(week_label)
            pr_counts.append(p_count)
            issue_counts.append(i_count)

        # 6. Trend Insight
        recent_prs_count = pr_counts[3] + pr_counts[4]
        prev_prs_count = pr_counts[1] + pr_counts[2]
        
        recent_issues_count = issue_counts[3] + issue_counts[4]
        prev_issues_count = issue_counts[1] + issue_counts[2]
        
        pr_velocity = recent_prs_count / max(1, prev_prs_count)
        issue_velocity = recent_issues_count / max(1, prev_issues_count)
        
        trend_title = "Activity is stable check."
        trend_desc = "Contributor demand and maintainer throughput are balanced."
        
        if issue_velocity > (pr_velocity * 1.5):
            trend_title = "In the last 2 weeks, issues increased faster than PRs."
            trend_desc = "If this trend continues, response times may increase and satisfaction may decline."
        elif pr_velocity > (issue_velocity * 1.2):
            trend_title = "Maintainer throughput is keeping up with demand."
            trend_desc = "PR closures/updates are trending positively compared to incoming issues."
        elif recent_prs_count == 0 and prev_prs_count > 0:
            trend_title = "Maintainer activity has stalled in the last 2 weeks."
            trend_desc = "No PR activity recorded recently despite previous engagement."
            
        return {
            "active_contributors": active_contributors_count,
            "open_prs": open_prs_count,
            "stale_prs": stale_prs_count,
            "avg_review_time_hours": median_hours,
            "avg_review_time_label": review_label,
            "unanswered_issues": unanswered_count,
            "issue_age_buckets": buckets,
            "activity_trend": {
                "weeks": weeks,
                "prs": pr_counts,
                "issues": issue_counts
            },
            "trend_title": trend_title,
            "trend_description": trend_desc,
            "last_updated": repo.last_synced_at or datetime.utcnow()
        }

    # ------------------------------------------------------------------
    # Issues Analytics Phase (6 new functions)
    # ------------------------------------------------------------------

    def compute_issue_triage_load(self, repo_id: int, days: int = 90) -> Dict[str, Any]:
        """Who responds to issues fastest/most - for team coordination."""
        from sqlalchemy import func
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        window_start = datetime.utcnow() - timedelta(days=days)

        issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.has_maintainer_response == True,
            Issue.first_responder_id != None,
            Issue.created_at >= window_start
        ).all()

        responder_stats = {}
        for issue in issues:
            responder_id = issue.first_responder_id
            if not responder_id:
                continue
            if responder_id not in responder_stats:
                responder_stats[responder_id] = {
                    "count": 0, "response_times": [], "unassigned": 0
                }
            responder_stats[responder_id]["count"] += 1
            if issue.time_to_first_response:
                responder_stats[responder_id]["response_times"].append(issue.time_to_first_response)

        open_unassigned = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.state == "open",
            Issue.assignee_id == None
        ).all()

        for issue in open_unassigned:
            if issue.first_responder_id and issue.first_responder_id in responder_stats:
                responder_stats[issue.first_responder_id]["unassigned"] += 1

        maintainers = []
        for cid, stats in responder_stats.items():
            maintainer = self.db.query(Contributor).get(cid)
            if not maintainer or _is_bot(maintainer.login):
                continue
            avg_time = statistics.median(stats["response_times"]) if stats["response_times"] else None
            maintainers.append({
                "login": maintainer.login,
                "avatar_url": maintainer.avatar_url,
                "triage_count": stats["count"],
                "avg_response_hours": round(avg_time, 1) if avg_time else None,
                "unassigned_queue": stats["unassigned"],
                "status": "critical" if stats["unassigned"] > 10 else ("warning" if stats["unassigned"] > 5 else "healthy")
            })

        maintainers.sort(key=lambda x: x["triage_count"], reverse=True)
        return {"maintainers": maintainers, "last_updated": repo.last_synced_at or datetime.utcnow()}

    def compute_issue_workload_balance(self, repo_id: int) -> Dict[str, Any]:
        """Assigned workload distribution - for team coordination."""
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        assignee_counts = self.db.query(Issue.assignee_id, func.count(Issue.id)).filter(
            Issue.repository_id == repo_id,
            Issue.state == "open",
            Issue.assignee_id != None
        ).group_by(Issue.assignee_id).all()

        unassigned_count = self.db.query(func.count(Issue.id)).filter(
            Issue.repository_id == repo_id,
            Issue.state == "open",
            Issue.assignee_id == None
        ).scalar() or 0

        maintainers = []
        for assignee_id, count in assignee_counts:
            maintainer = self.db.query(Contributor).get(assignee_id)
            if not maintainer or _is_bot(maintainer.login):
                continue

            avg_age = self.db.query(func.avg(
                func.julianday(datetime.utcnow()) - func.julianday(Issue.created_at)
            )).filter(
                Issue.repository_id == repo_id,
                Issue.state == "open",
                Issue.assignee_id == assignee_id
            ).scalar() or 0

            maintainers.append({
                "login": maintainer.login,
                "avatar_url": maintainer.avatar_url,
                "assigned_count": count,
                "avg_age_days": round(avg_age),
                "capacity": "overloaded" if count > 20 else ("busy" if count > 10 else "available")
            })

        maintainers.sort(key=lambda x: x["assigned_count"], reverse=True)

        return {
            "maintainers": maintainers,
            "unassigned_count": unassigned_count,
            "rebalance_suggested": len([m for m in maintainers if m["capacity"] == "overloaded"]) > 0 and unassigned_count > 0,
            "last_updated": repo.last_synced_at or datetime.utcnow()
        }

    def compute_issue_trends(self, repo_id: int, days: int = 90) -> Dict[str, Any]:
        """Weekly response time trends with category breakdown - for quality metrics."""
        from sqlalchemy import func
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        now = datetime.utcnow()
        window_start = now - timedelta(days=days)

        issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.has_maintainer_response == True,
            Issue.time_to_first_response != None,
            Issue.created_at >= window_start
        ).all()

        weeks = []
        for i in range(12, -1, -1):
            week_end = now - timedelta(weeks=i)
            week_start = week_end - timedelta(weeks=1)
            weeks.append((week_start, week_end, f"W{12-i}"))

        def get_category(issue):
            if not issue.labels_snapshot:
                return "other"
            labels = json.loads(issue.labels_snapshot)
            labels_lower = [l.lower() for l in labels]
            if "bug" in labels_lower or "type: bug" in labels_lower:
                return "bug"
            if "enhancement" in labels_lower or "feature" in labels_lower or "type: feature" in labels_lower:
                return "enhancement"
            if "question" in labels_lower or "help wanted" in labels_lower:
                return "question"
            return "other"

        timeline = []
        for week_start, week_end, label in weeks:
            week_issues = [i for i in issues if week_start <= i.created_at < week_end]
            response_times = [i.time_to_first_response for i in week_issues if i.time_to_first_response]
            median_resp = statistics.median(response_times) if response_times else None

            categories = {"bug": 0, "enhancement": 0, "question": 0, "other": 0}
            for i in week_issues:
                categories[get_category(i)] += 1

            timeline.append({
                "week": label,
                "median_response_hours": round(median_resp, 1) if median_resp else None,
                "total_responded": len(week_issues),
                "categories": categories
            })

        last_month = [t for t in timeline if t["week"].startswith("W")][-4:] if len(timeline) >= 4 else timeline
        prev_month = timeline[-8:-4] if len(timeline) >= 8 else timeline[:4]

        last_avg = statistics.median([t["median_response_hours"] for t in last_month if t["median_response_hours"]]) if last_month else 0
        prev_avg = statistics.median([t["median_response_hours"] for t in prev_month if t["median_response_hours"]]) if prev_month else 0

        trend_direction = "stable"
        if last_avg and prev_avg:
            if last_avg > prev_avg * 1.2:
                trend_direction = "slower"
            elif last_avg < prev_avg * 0.8:
                trend_direction = "faster"

        return {
            "timeline": timeline,
            "trend_direction": trend_direction,
            "target_sla_hours": 48,
            "last_updated": repo.last_synced_at or now
        }

    def compute_issue_category_breakdown(self, repo_id: int) -> Dict[str, Any]:
        """Open issues grouped by label category - for buried in issues scenario."""
        from sqlalchemy import func
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        open_issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.state == "open"
        ).all()

        categories = {
            "bug": {"issues": [], "count": 0, "median_age_days": 0},
            "enhancement": {"issues": [], "count": 0, "median_age_days": 0},
            "question": {"issues": [], "count": 0, "median_age_days": 0},
            "other": {"issues": [], "count": 0, "median_age_days": 0},
            "unlabeled": {"issues": [], "count": 0, "median_age_days": 0}
        }

        now = datetime.utcnow()

        for issue in open_issues:
            labels = self._parse_labels(issue.labels_snapshot)
            if not labels:
                categories["unlabeled"]["issues"].append(issue)
                continue

            labels_lower = [l.lower() for l in labels]

            if "bug" in labels_lower or "type: bug" in labels_lower:
                categories["bug"]["issues"].append(issue)
            elif "enhancement" in labels_lower or "feature" in labels_lower:
                categories["enhancement"]["issues"].append(issue)
            elif "question" in labels_lower or "help wanted" in labels_lower:
                categories["question"]["issues"].append(issue)
            else:
                categories["other"]["issues"].append(issue)

        result = {}
        for cat_name, cat_data in categories.items():
            issues = cat_data["issues"]
            ages = [(now - i.created_at).days for i in issues]
            result[cat_name] = {
                "count": len(issues),
                "median_age_days": int(statistics.median(ages)) if ages else 0,
                "unanswered_count": len([i for i in issues if not i.has_maintainer_response]),
                "percent_of_total": round(len(issues) / len(open_issues) * 100, 1) if open_issues else 0
            }

        result["total_open"] = len(open_issues)
        result["last_updated"] = repo.last_synced_at or now

        return result

    def compute_first_timer_issue_queue(self, repo_id: int, max_items: int = 20) -> Dict[str, Any]:
        """Priority queue of first-timer issues needing response - for first-timer outreach."""
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        now = datetime.utcnow()
        twenty_four_hours_ago = now - timedelta(hours=24)
        seven_days_ago = now - timedelta(days=7)

        first_timers = self.db.query(Contributor).filter(
            Contributor.first_contribution_date >= now - timedelta(days=30)
        ).all()
        first_timer_ids = {c.id for c in first_timers}

        issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.state == "open",
            Issue.has_maintainer_response == False,
            Issue.author_id.in_(first_timer_ids),
            Issue.created_at <= twenty_four_hours_ago
        ).order_by(Issue.created_at).all()

        scored_issues = []
        for issue in issues:
            age_hours = (now - issue.created_at).total_seconds() / 3600
            labels = self._parse_labels(issue.labels_snapshot)

            age_component = min(age_hours, 72)
            first_timer_bonus = 100
            bug_bonus = 50 if any("bug" in l.lower() for l in labels) else 0
            score = age_component + first_timer_bonus + bug_bonus

            author = issue.author
            scored_issues.append({
                "number": issue.number,
                "title": issue.title,
                "author_login": author.login if author else "unknown",
                "author_avatar": author.avatar_url if author else None,
                "age_hours": round(age_hours, 1),
                "age_days": int(age_hours / 24),
                "labels": labels,
                "priority_score": round(score, 1),
                "html_url": f"https://github.com/{repo.owner}/{repo.name}/issues/{issue.number}",
                "critical": age_hours > 72
            })

        scored_issues.sort(key=lambda x: x["priority_score"], reverse=True)

        return {
            "queue": scored_issues[:max_items],
            "total_count": len(scored_issues),
            "critical_count": len([i for i in scored_issues if i["critical"]]),
            "last_updated": repo.last_synced_at or now
        }

    def compute_zombie_issues(self, repo_id: int) -> Dict[str, Any]:
        """Issues that got a response but were then abandoned - for buried in issues scenario."""
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        now = datetime.utcnow()
        seven_days_ago = now - timedelta(days=7)

        issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.state == "open",
            Issue.has_maintainer_response == True,
            Issue.assignee_id == None,
            Issue.updated_at < seven_days_ago
        ).order_by(Issue.updated_at).all()

        zombie_list = []
        for issue in issues:
            days_since_update = (now - issue.updated_at).days
            zombie_list.append({
                "number": issue.number,
                "title": issue.title,
                "author": issue.author.login if issue.author else "unknown",
                "days_since_response": days_since_update,
                "last_responder": issue.first_responder.login if issue.first_responder else "unknown",
                "labels": self._parse_labels(issue.labels_snapshot),
                "status": "critical" if days_since_update > 30 else ("warning" if days_since_update > 14 else "stale"),
                "html_url": f"https://github.com/{repo.owner}/{repo.name}/issues/{issue.number}"
            })

        return {
            "zombie_issues": zombie_list[:50],
            "total_count": len(zombie_list),
            "last_updated": repo.last_synced_at or now
        }

    def _compute_stale_prs_signal(self, repo_id: int) -> Dict[str, Any]:
        """Health signal: open PRs that have been waiting too long without a review."""
        now = datetime.utcnow()
        stale_threshold = now - timedelta(days=14)

        stale_prs = self.db.query(PullRequest).filter(
            PullRequest.repository_id == repo_id,
            PullRequest.state == 'open',
            PullRequest.has_review == False,
            PullRequest.created_at < stale_threshold,
        ).count()

        open_prs = self.db.query(PullRequest).filter(
            PullRequest.repository_id == repo_id,
            PullRequest.state == 'open',
        ).count()

        if stale_prs == 0:
            severity = 'healthy'
        elif stale_prs >= 10:
            severity = 'critical'
        else:
            severity = 'warning'

        return {
            "id": "stale_prs",
            "name": "Stale Pull Requests",
            "description": (
                f"{stale_prs} open PR(s) have been waiting over 14 days without a review."
                if stale_prs else "No PRs are waiting longer than 14 days for a review."
            ),
            "severity": severity,
            "metadata": {
                "stale_count": stale_prs,
                "open_count": open_prs,
                "threshold_days": 14,
            },
        }

    def _compute_unanswered_issues(self, repo_id: int) -> Dict[str, Any]:
        """Health signal: open issues without any maintainer response."""
        now = datetime.utcnow()

        open_issues = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.state == 'open',
        ).count()

        unanswered = self.db.query(Issue).filter(
            Issue.repository_id == repo_id,
            Issue.state == 'open',
            Issue.has_maintainer_response == False,
        ).count()

        if unanswered == 0:
            severity = 'healthy'
        elif unanswered >= 20:
            severity = 'critical'
        else:
            severity = 'warning'

        return {
            "id": "unanswered_issues",
            "name": "Unanswered Issues",
            "description": (
                f"{unanswered} open issue(s) have not received a maintainer response."
                if unanswered else "All open issues have received a maintainer response."
            ),
            "severity": severity,
            "metadata": {
                "unanswered_count": unanswered,
                "open_count": open_issues,
            },
        }
