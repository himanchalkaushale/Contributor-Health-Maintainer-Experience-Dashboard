from sqlalchemy.orm import Session
from sqlalchemy import func, distinct
from app.models import Repository, PullRequest, Issue, Contributor
from app.config import get_settings
from datetime import datetime, timedelta
import statistics
from typing import Dict, List, Any

settings = get_settings()

class SignalEngine:
    def __init__(self, db: Session):
        self.db = db

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

    def compute_pr_review_health(self, repo_id: int) -> Dict[str, Any]:
        """
        Calculates PR Review Health metrics:
        1. Open PRs
        2. Unreviewed PRs (Open & has_review=False)
        3. PRs Waiting > 7 Days
        4. Median Review Time
        5. Attention Queue (Table of critical PRs)
        6. Review Flow Insight
        """
        now = datetime.utcnow()
        repo = self.db.query(Repository).get(repo_id)
        if not repo:
            return None

        try:
            # --- 1. Basic Counts ---
            open_prs = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.state == 'open'
            ).all()
            open_prs_count = len(open_prs)

            # --- 2. Unreviewed PRs (The Risk Metric) ---
            # Proxy: Open AND has_review is False
            unreviewed_prs = [pr for pr in open_prs if not pr.has_review]
            unreviewed_count = len(unreviewed_prs)

            # --- 3. Waiting > 7 Days ---
            seven_days_ago = now - timedelta(days=7)
            waiting_over_7d = [pr for pr in open_prs if pr.created_at < seven_days_ago]
            waiting_over_7d_count = len(waiting_over_7d)

            # --- 4. Median Review Time ---
            ninety_days_ago = now - timedelta(days=90)
            reviewed_prs_90d = self.db.query(PullRequest).filter(
                PullRequest.repository_id == repo_id,
                PullRequest.time_to_first_review != None,
                PullRequest.created_at >= ninety_days_ago
            ).all()
            
            review_times = [pr.time_to_first_review for pr in reviewed_prs_90d]
            median_review_hours = statistics.median(review_times) if review_times else None

            # --- 5. Attention Queue (The Action Table) ---
            # Unified list: Unreviewed first, then by age.
            attention_queue = []
            
            for pr in open_prs:
                age_days = (now - pr.created_at).days
                is_unreviewed = not pr.has_review
                
                # Status Logic
                status = 'healthy'
                if is_unreviewed:
                    if age_days > 7: status = 'critical'
                    else: status = 'warning' # Unreviewed is always at least a warning in this view? Or just heavily weighted.
                    # Let's stick to Age-based status for consistency, but Unreviewed is the sort key.
                else:
                    if age_days > 14: status = 'critical'
                    elif age_days > 7: status = 'warning'

                # Last Activity Proxy
                last_activity = 'None' if is_unreviewed else 'Maintainer' # Simplification based on has_review

                attention_queue.append({
                    "number": pr.number,
                    "title": pr.title,
                    "author": pr.author.login if pr.author else "unknown",
                    "age_days": age_days,
                    "last_activity": last_activity,
                    "status": status,
                    "is_unreviewed": is_unreviewed,
                    "html_url": f"https://github.com/{repo.owner}/{repo.name}/pull/{pr.number}"
                })

            # Sort: Unreviewed First (True > False), then Age Descending
            attention_queue.sort(key=lambda x: (not x['is_unreviewed'], -x['age_days'])) # False < True, so not True (False) comes first? 
            # Wait, True > False is 1 > 0. Descending sort puts True first. 
            # Start with explicit tuple sort:
            # Primary: is_unreviewed (True first) -> Reverse
            # Secondary: age_days (High first) -> Reverse
            attention_queue.sort(key=lambda x: (x['is_unreviewed'], x['age_days']), reverse=True)
            
            # --- 6. Review Flow Insight ---
            # Simple breakdown
            waiting_for_first_review = unreviewed_count # Roughly same concept for this page
            # "Near Merge" is hard to guess without CI status. 
            # Let's use: Reviewed but not merged
            reviewed_open = open_prs_count - unreviewed_count
            
            return {
                "summary": {
                    "open_prs": open_prs_count,
                    "unreviewed_prs": unreviewed_count,
                    "waiting_over_7d": waiting_over_7d_count,
                    "median_review_hours": round(median_review_hours, 1) if median_review_hours is not None else None
                },
                "attention_queue": attention_queue,
                "review_flow": {
                    "waiting_for_first_review": waiting_for_first_review,
                    "in_review_process": reviewed_open
                }
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

    def _compute_stale_prs_signal(self, repo_id: int) -> Dict[str, Any]:
        return {} 
    def _compute_unanswered_issues(self, repo_id: int) -> Dict[str, Any]:
        return {}
