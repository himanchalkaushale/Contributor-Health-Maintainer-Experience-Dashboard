from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import json
import logging
from app.models import (
    Repository, PullRequest, Issue, Contributor, RepositoryStats,
    ContributionEvent, Review, Comment, Label,
)
from app.services.github_client import GitHubClient
import asyncio

logger = logging.getLogger(__name__)

# Rolling collection window
WINDOW_DAYS = 365


def _parse_dt(value):
    """Parse a GitHub ISO timestamp into a naive datetime (UTC)."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, AttributeError):
        return None


def _is_bot(login: str) -> bool:
    if not login:
        return True
    low = login.lower()
    return low.endswith("[bot]") or low == "github-actions"


class DataCollector:
    def __init__(self, db: Session):
        self.db = db
        self.client = GitHubClient()
        self.contributor_cache = {}  # github_id -> Contributor
        # Per-session dedup of contribution-event keys we've already resolved,
        # so overlapping re-sync windows don't re-issue a SELECT per duplicate
        # event. Set of (repo_id, contributor_id, event_type, source_id).
        self._event_seen = set()

    # ------------------------------------------------------------------
    # Stage 1: init
    # ------------------------------------------------------------------
    async def init_sync(self, owner: str, repo_name: str):
        """Fetch metadata/counts, set status to 'syncing'. Returns repo immediately."""
        repo_data = await self.client.get_repository(owner, repo_name)
        repo = self._get_or_create_repo(repo_data)
        self.contributor_cache = {}
        self._event_seen = set()

        since = datetime.utcnow() - timedelta(days=WINDOW_DAYS)
        since_str = since.strftime("%Y-%m-%d")

        # Estimate the combined work across phases for a meaningful progress total.
        try:
            queries = [
                self.client.search_issues(f"repo:{owner}/{repo_name} is:pr created:>={since_str}"),
                self.client.search_issues(f"repo:{owner}/{repo_name} is:issue created:>={since_str}"),
                self.client.search_issues(f"repo:{owner}/{repo_name} is:pr is:open"),
                self.client.search_issues(f"repo:{owner}/{repo_name} is:issue is:open"),
            ]
            pr_win, issue_win, pr_open, issue_open = await asyncio.gather(*queries)
            pr_count = pr_win.get("total_count", 0)
            issue_count = issue_win.get("total_count", 0)
            repo.open_prs_count = pr_open.get("total_count", 0)
            repo.open_issues_count = issue_open.get("total_count", 0)
        except Exception as e:
            logger.error(f"Failed to fetch search counts: {e}")
            pr_count = repo_data.get("open_issues_count", 0)
            issue_count = 0
            repo.open_issues_count = repo_data.get("open_issues_count", 0)

        # Progress total must match what actually ticks in execute_sync:
        # one tick per PR (Phase A/B) + one per issue (Phase C/D) + one for the
        # commit phase (Phase E). Reviews/comments are processed within a PR/issue
        # tick, so they are not counted separately.
        repo.sync_status = "syncing"
        repo.sync_total_items = max(1, pr_count + issue_count + 1)
        repo.sync_item_count = 0
        repo.last_synced_at = datetime.utcnow()

        self.db.commit()
        return repo

    # ------------------------------------------------------------------
    # Stage 2: phased background sync
    # ------------------------------------------------------------------
    async def execute_sync(self, repo_id: int, owner: str, repo_name: str):
        from app.database import SessionLocal
        db = SessionLocal()

        try:
            repo = db.query(Repository).get(repo_id)
            if not repo:
                return

            collector = DataCollector(db)
            since = datetime.utcnow() - timedelta(days=WINDOW_DAYS)
            sem = asyncio.Semaphore(10)

            progress = {"n": 0}
            total_items = repo.sync_total_items or 1
            commit_every = 1 if total_items <= 50 else 5

            def tick():
                progress["n"] += 1
                repo.sync_item_count = progress["n"]
                if progress["n"] % commit_every == 0:
                    db.commit()

            # ---- Phase A + B: PRs and their reviews ----
            try:
                prs_data = await self.client.get_pull_requests(
                    owner, repo_name, state="all", since=since
                )
                async def proc_pr(pr_data):
                    async with sem:
                        await collector._sync_pr(repo.id, pr_data, owner, repo_name, since)
                        tick()
                await asyncio.gather(*[proc_pr(p) for p in prs_data])
                db.commit()
                logger.info(f"Phase A/B done: {len(prs_data)} PRs")
            except Exception as e:
                logger.error(f"PR phase failed: {e}")
                db.rollback()

            # ---- Phase C + D: issues and their comments ----
            try:
                issues_data = await self.client.get_issues(
                    owner, repo_name, state="all", since=since
                )
                async def proc_issue(issue_data):
                    async with sem:
                        await collector._sync_issue(repo.id, issue_data, owner, repo_name)
                        tick()
                await asyncio.gather(*[proc_issue(i) for i in issues_data])
                db.commit()
                logger.info(f"Phase C/D done: {len(issues_data)} issues")
            except Exception as e:
                logger.error(f"Issue phase failed: {e}")
                db.rollback()

            # ---- Phase E: commits / code stats (last; guarded) ----
            try:
                commits = await self.client.get_commits(owner, repo_name, since=since)
                for c in commits:
                    collector._sync_commit(repo.id, c)
                progress["n"] += 1
                repo.sync_item_count = progress["n"]
                db.commit()
                logger.info(f"Phase E done: {len(commits)} commits")
            except Exception as e:
                logger.error(f"Commit phase failed (non-fatal): {e}")
                db.rollback()

            # ---- Finalize: lifecycle dates + stats ----
            try:
                collector._populate_lifecycle_dates(repo.id)
                collector._update_stats(repo.id)
            except Exception as e:
                logger.error(f"Finalize failed: {e}")

            repo.sync_item_count = max(progress["n"], 0)
            repo.sync_status = "completed"
            db.commit()
            logger.info(f"Sync completed for {owner}/{repo_name}")

        except Exception as e:
            logger.error(f"Background Sync failed: {e}")
            import traceback
            traceback.print_exc()
            try:
                repo = db.query(Repository).get(repo_id)
                if repo:
                    repo.sync_status = "failed"
                    db.commit()
            except Exception:
                pass
        finally:
            db.close()

    # ------------------------------------------------------------------
    # Entity helpers
    # ------------------------------------------------------------------
    def _get_or_create_repo(self, data: dict) -> Repository:
        repo = self.db.query(Repository).filter(Repository.github_id == data["id"]).first()
        if not repo:
            repo = Repository(
                github_id=data["id"],
                name=data["name"],
                full_name=data["full_name"],
                owner=data["owner"]["login"],
                url=data["html_url"],
                description=data.get("description"),
            )
            self.db.add(repo)
            self.db.flush()
        return repo

    def _sync_contributor(self, data: dict) -> Contributor:
        if not data:
            return None
        github_id = data.get("id")
        if github_id is None:
            return None
        if github_id in self.contributor_cache:
            return self.contributor_cache[github_id]

        contributor = self.db.query(Contributor).filter(
            Contributor.github_id == github_id
        ).first()
        if not contributor:
            contributor = Contributor(
                github_id=github_id,
                login=data.get("login"),
                avatar_url=data.get("avatar_url"),
                html_url=data.get("html_url"),
            )
            self.db.add(contributor)
            self.db.flush()
        self.contributor_cache[github_id] = contributor
        return contributor

    def _add_event(self, repo_id, contributor_id, event_type, event_at, source_id=None, meta=None):
        if contributor_id is None or event_at is None:
            return
        src = str(source_id) if source_id is not None else None
        key = (repo_id, contributor_id, event_type, src)

        # Short-circuit events already resolved during this sync session.
        if key in self._event_seen:
            return
        self._event_seen.add(key)

        existing = self.db.query(ContributionEvent).filter(
            ContributionEvent.repository_id == repo_id,
            ContributionEvent.contributor_id == contributor_id,
            ContributionEvent.event_type == event_type,
            ContributionEvent.source_id == src,
        ).first()
        if existing:
            existing.event_at = event_at
            if meta is not None:
                existing.meta = json.dumps(meta)
            return
        self.db.add(ContributionEvent(
            repository_id=repo_id,
            contributor_id=contributor_id,
            event_type=event_type,
            event_at=event_at,
            source_id=src,
            meta=json.dumps(meta) if meta is not None else None,
        ))

    async def _sync_pr(self, repo_id, data, owner, repo_name, since):
        author = self._sync_contributor(data.get("user"))
        if not author:
            return

        pr = self.db.query(PullRequest).filter(PullRequest.github_id == data["id"]).first()
        if not pr:
            pr = PullRequest(github_id=data["id"])
            self.db.add(pr)

        created = _parse_dt(data.get("created_at"))
        merged = _parse_dt(data.get("merged_at"))
        closed = _parse_dt(data.get("closed_at"))

        pr.repository_id = repo_id
        pr.number = data["number"]
        pr.title = data.get("title")
        pr.state = "merged" if merged else data.get("state")
        pr.created_at = created
        pr.updated_at = _parse_dt(data.get("updated_at"))
        pr.closed_at = closed
        pr.merged_at = merged
        pr.author_id = author.id
        self.db.flush()

        # Lifecycle events
        self._add_event(repo_id, author.id, "pr_opened", created, source_id=pr.github_id,
                        meta={"number": pr.number})
        if merged:
            self._add_event(repo_id, author.id, "pr_merged", merged, source_id=pr.github_id,
                            meta={"number": pr.number})
        elif closed:
            self._add_event(repo_id, author.id, "pr_closed", closed, source_id=pr.github_id,
                            meta={"number": pr.number})

        # Reviews (Phase B)
        try:
            reviews = await self.client.get_pr_reviews(owner, repo_name, data["number"])
        except Exception as e:
            logger.error(f"Failed to fetch reviews for PR #{data['number']}: {e}")
            reviews = []

        pr.reviews_count = len(reviews)
        pr.has_review = len(reviews) > 0
        first_review_time = None

        for r in reviews:
            r_time = _parse_dt(r.get("submitted_at"))
            reviewer = self._sync_contributor(r.get("user"))
            if r_time and (first_review_time is None or r_time < first_review_time):
                first_review_time = r_time
            if reviewer and r_time:
                latency = ((r_time - created).total_seconds() / 3600.0) if created else None
                self._upsert_review(repo_id, pr.id, reviewer.id, r, r_time, latency)
                self._add_event(repo_id, reviewer.id, "review_submitted", r_time,
                                source_id=r.get("id"),
                                meta={"state": r.get("state"), "pr": pr.number})

        if first_review_time and created:
            pr.time_to_first_review = (first_review_time - created).total_seconds() / 3600.0
            pr.review_wait_time = None
        elif created and pr.state == "open":
            pr.review_wait_time = (datetime.utcnow() - created).total_seconds() / 3600.0
            pr.time_to_first_review = None

    def _upsert_review(self, repo_id, pr_id, reviewer_id, data, submitted_at, latency):
        gh_id = data.get("id")
        review = self.db.query(Review).filter(Review.github_id == gh_id).first() if gh_id else None
        if not review:
            review = Review(github_id=gh_id)
            self.db.add(review)
        review.repository_id = repo_id
        review.pull_request_id = pr_id
        review.reviewer_id = reviewer_id
        review.state = (data.get("state") or "").lower()
        review.submitted_at = submitted_at
        review.latency_hours = latency

    async def _sync_issue(self, repo_id, data, owner, repo_name):
        author = self._sync_contributor(data.get("user"))
        if not author:
            return

        issue = self.db.query(Issue).filter(Issue.github_id == data["id"]).first()
        if not issue:
            issue = Issue(github_id=data["id"])
            self.db.add(issue)

        created = _parse_dt(data.get("created_at"))
        closed = _parse_dt(data.get("closed_at"))

        issue.repository_id = repo_id
        issue.number = data["number"]
        issue.title = data.get("title")
        issue.state = data.get("state")
        issue.created_at = created
        issue.updated_at = _parse_dt(data.get("updated_at"))
        issue.closed_at = closed
        issue.author_id = author.id
        issue.comments_count = data.get("comments", 0)

        # Sync assignee from issue data (Phase 1 Analytics)
        assignee_data = data.get("assignee")
        if assignee_data:
            assignee = self._sync_contributor(assignee_data)
            issue.assignee_id = assignee.id if assignee else None

        self.db.flush()

        self._add_event(repo_id, author.id, "issue_opened", created, source_id=issue.github_id,
                        meta={"number": issue.number})
        if closed:
            self._add_event(repo_id, author.id, "issue_closed", closed, source_id=issue.github_id,
                            meta={"number": issue.number})

        # Sync labels (Phase 1 Analytics) - fetch from API and store
        try:
            labels_data = await self.client.get_issue_labels(owner, repo_name, data["number"])
            self._sync_issue_labels(repo_id, issue, labels_data)
        except Exception as e:
            logger.error(f"Failed to fetch labels for #{data['number']}: {e}")

        # Comments (Phase D) + first responder tracking
        first_responder_id = None
        if data.get("comments", 0) > 0:
            try:
                comments = await self.client.get_issue_comments(owner, repo_name, data["number"])
            except Exception as e:
                logger.error(f"Failed to fetch comments for #{data['number']}: {e}")
                comments = []

            has_response = False
            first_response_at = None
            author_login = (data.get("user") or {}).get("login")
            for c in comments:
                commenter = self._sync_contributor(c.get("user"))
                c_time = _parse_dt(c.get("created_at"))
                if commenter:
                    self._upsert_comment(repo_id, issue.number, commenter.id, c, c_time)
                    if c_time:
                        self._add_event(repo_id, commenter.id, "issue_comment", c_time,
                                        source_id=c.get("id"), meta={"issue": issue.number})
                c_login = (c.get("user") or {}).get("login")
                if c_login and c_login != author_login:
                    has_response = True
                    if c_time and (first_response_at is None or c_time < first_response_at):
                        first_response_at = c_time
                        first_responder_id = commenter.id if commenter else None

            issue.has_maintainer_response = has_response
            issue.first_responder_id = first_responder_id
            if first_response_at and created:
                issue.time_to_first_response = (first_response_at - created).total_seconds() / 3600.0

    def _sync_issue_labels(self, repo_id, issue, labels_data):
        """Sync labels for an issue: create Label records, associate, store JSON snapshot."""
        from app.models import Label
        label_ids = []
        label_names = []
        for lbl in labels_data or []:
            gh_id = lbl.get("id")
            name = lbl.get("name")
            if not gh_id or not name:
                continue
            label_names.append(name)
            # Find or create Label
            label = self.db.query(Label).filter(Label.github_id == gh_id).first()
            if not label:
                label = Label(
                    github_id=gh_id,
                    repository_id=repo_id,
                    name=name,
                    color=lbl.get("color") or "ffffff",
                    description=lbl.get("description") or None,
                )
                self.db.add(label)
                self.db.flush()
            label_ids.append(label.id)
        # Associate labels to issue
        issue.labels = self.db.query(Label).filter(Label.id.in_(label_ids)).all() if label_ids else []
        # Store JSON snapshot for fast queries
        issue.labels_snapshot = json.dumps(label_names) if label_names else None

    def _upsert_comment(self, repo_id, issue_number, commenter_id, data, created_at):
        gh_id = data.get("id")
        comment = self.db.query(Comment).filter(Comment.github_id == gh_id).first() if gh_id else None
        if not comment:
            comment = Comment(github_id=gh_id)
            self.db.add(comment)
        comment.repository_id = repo_id
        comment.issue_number = issue_number
        comment.commenter_id = commenter_id
        comment.created_at = created_at

    def _sync_commit(self, repo_id, data):
        gh_author = data.get("author")  # the GitHub user object (may be None)
        commit = data.get("commit", {})
        commit_author = commit.get("author", {}) if commit else {}
        date = _parse_dt(commit_author.get("date"))

        contributor = self._sync_contributor(gh_author) if gh_author else None
        if not contributor or not date:
            return  # skip commits without a resolvable GitHub user

        if _is_bot(contributor.login):
            return

        stats = data.get("stats") or {}
        self._add_event(
            repo_id, contributor.id, "commit", date, source_id=data.get("sha"),
            meta={"additions": stats.get("additions"), "deletions": stats.get("deletions")},
        )

    # ------------------------------------------------------------------
    # Finalization
    # ------------------------------------------------------------------
    def _populate_lifecycle_dates(self, repo_id):
        """Set first/last contribution dates per contributor from events."""
        from sqlalchemy import func
        rows = self.db.query(
            ContributionEvent.contributor_id,
            func.min(ContributionEvent.event_at),
            func.max(ContributionEvent.event_at),
        ).filter(
            ContributionEvent.repository_id == repo_id
        ).group_by(ContributionEvent.contributor_id).all()

        for cid, first, last in rows:
            contributor = self.db.query(Contributor).get(cid)
            if not contributor:
                continue
            if first and (contributor.first_contribution_date is None or first < contributor.first_contribution_date):
                contributor.first_contribution_date = first
            if last and (contributor.last_contribution_date is None or last > contributor.last_contribution_date):
                contributor.last_contribution_date = last

    def _update_stats(self, repo_id):
        from sqlalchemy import func
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        active = self.db.query(
            func.count(func.distinct(ContributionEvent.contributor_id))
        ).filter(
            ContributionEvent.repository_id == repo_id,
            ContributionEvent.event_at >= thirty_days_ago,
        ).scalar() or 0

        repo = self.db.query(Repository).get(repo_id)
        stats = RepositoryStats(
            repository_id=repo_id,
            active_prs=repo.open_prs_count if repo else 0,
            active_issues=repo.open_issues_count if repo else 0,
            active_contributors=active,
        )
        self.db.add(stats)
