from sqlalchemy.orm import Session
from datetime import datetime
import logging
from app.models import Repository, PullRequest, Issue, Contributor, RepositoryStats
from app.services.github_client import GitHubClient
import asyncio

logger = logging.getLogger(__name__)

class DataCollector:
    def __init__(self, db: Session):
        self.db = db
        self.client = GitHubClient()
        self.contributor_cache = {} # Cache for sync session

    async def init_sync(self, owner: str, repo_name: str):
        """
        Stage 1: Initialize sync, fetch metadata/counts, set status to 'syncing'.
        Returns the repository object immediately.
        """
        # Fetch metadata
        repo_data = await self.client.get_repository(owner, repo_name)
        repo = self._get_or_create_repo(repo_data)
        
        # Reset cache
        self.contributor_cache = {}

        # Fetch counts to set progress total
        try:
            pr_search_task = self.client.search_issues(f"repo:{owner}/{repo_name} is:pr is:open")
            issue_search_task = self.client.search_issues(f"repo:{owner}/{repo_name} is:issue is:open")
            pr_search, issue_search = await asyncio.gather(pr_search_task, issue_search_task)
            
            repo.open_prs_count = pr_search.get("total_count", 0)
            repo.open_issues_count = issue_search.get("total_count", 0)
        except Exception as e:
            logger.error(f"Failed to fetch search counts: {e}")
            repo.open_issues_count = repo_data.get("open_issues_count", 0)

        # Set Sync Status
        repo.sync_status = "syncing"
        repo.sync_total_items = repo.open_prs_count + repo.open_issues_count
        repo.sync_item_count = 0
        repo.last_synced_at = datetime.utcnow()
        
        self.db.commit()
        return repo

    async def execute_sync(self, repo_id: int, owner: str, repo_name: str):
        """
        Stage 2: Background process. Fetches all items and updates progress.
        """
        from app.database import SessionLocal
        db = SessionLocal()
        
        try:
            repo = db.query(Repository).get(repo_id)
            if not repo:
                return

            # Re-initialize DataCollector with new session
            collector = DataCollector(db)
            # Pre-load cache? optimization for later

            # Semaphore for concurrency
            sem = asyncio.Semaphore(20)
            progress_counter = 0

            async def _process_pr(pr_data):
                nonlocal progress_counter
                async with sem:
                    await collector._sync_pr(repo.id, pr_data, owner, repo_name)
                    progress_counter += 1
                    if progress_counter % 10 == 0:
                        repo.sync_item_count = progress_counter
                        db.commit()

            async def _process_issue(issue_data):
                nonlocal progress_counter
                async with sem:
                    await collector._sync_issue(repo.id, issue_data, owner, repo_name)
                    progress_counter += 1
                    if progress_counter % 10 == 0:
                        repo.sync_item_count = progress_counter
                        db.commit()

            # Fetch Data
            prs_task = self.client.get_pull_requests(owner, repo_name, state="open")
            issues_task = self.client.get_issues(owner, repo_name, state="open")
            
            prs_data, issues_data = await asyncio.gather(prs_task, issues_task)

            # Process
            tasks = []
            if prs_data:
                tasks.extend([_process_pr(pr) for pr in prs_data])
            if issues_data:
                tasks.extend([_process_issue(issue) for issue in issues_data])
                
            if tasks:
                await asyncio.gather(*tasks)
                
            # Finalize
            repo.sync_item_count = progress_counter
            repo.sync_status = "completed"
            collector._update_stats(repo.id, repo.open_prs_count, repo.open_issues_count)
            
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
            except:
                pass
        finally:
            db.close()
            
        return repo

    def _get_or_create_repo(self, data: dict) -> Repository:
        repo = self.db.query(Repository).filter(Repository.github_id == data["id"]).first()
        if not repo:
            repo = Repository(
                github_id=data["id"],
                name=data["name"],
                full_name=data["full_name"],
                owner=data["owner"]["login"],
                url=data["html_url"],
                description=data.get("description")
            )
            self.db.add(repo)
            self.db.flush() # Get ID immediately
        return repo

    def _sync_contributor(self, data: dict) -> Contributor:
        github_id = data["id"]
        
        # Check Cache
        if github_id in self.contributor_cache:
            return self.contributor_cache[github_id]
            
        # Check DB
        contributor = self.db.query(Contributor).filter(Contributor.github_id == github_id).first()
        
        if not contributor:
            contributor = Contributor(
                github_id=github_id,
                login=data["login"],
                avatar_url=data["avatar_url"],
                html_url=data["html_url"]
            )
            self.db.add(contributor)
            self.db.flush() # Get ID immediately
        
        # Add to Cache
        self.contributor_cache[github_id] = contributor
        return contributor

    async def _sync_pr(self, repo_id: int, data: dict, owner: str, repo_name: str):
        author = self._sync_contributor(data["user"])
        
        pr = self.db.query(PullRequest).filter(PullRequest.github_id == data["id"]).first()
        if not pr:
            pr = PullRequest(github_id=data["id"])
            self.db.add(pr)
        
        pr.repository_id = repo_id
        pr.number = data["number"]
        pr.title = data["title"]
        pr.state = data["state"]
        pr.created_at = datetime.fromisoformat(data["created_at"].replace("Z", "+00:00"))
        pr.updated_at = datetime.fromisoformat(data["updated_at"].replace("Z", "+00:00"))
        pr.author_id = author.id
        
        # Check reviews
        reviews = await self.client.get_pr_reviews(owner, repo_name, data["number"])
        pr.reviews_count = len(reviews)
        pr.has_review = len(reviews) > 0
        
        pr_created = pr.created_at.replace(tzinfo=None) # naive
        
        if pr.has_review:
            # Find time to first review
            first_review_time = None
            for r in reviews:
                if "submitted_at" in r and r["submitted_at"]:
                    r_time = datetime.fromisoformat(r["submitted_at"].replace("Z", "+00:00")).replace(tzinfo=None)
                    if first_review_time is None or r_time < first_review_time:
                        first_review_time = r_time
            
            if first_review_time:
                pr.time_to_first_review = (first_review_time - pr_created).total_seconds() / 3600.0
                pr.review_wait_time = None 
        else:
            now = datetime.utcnow()
            pr.review_wait_time = (now - pr_created).total_seconds() / 3600.0
            pr.time_to_first_review = None

    async def _sync_issue(self, repo_id: int, data: dict, owner: str, repo_name: str):
        author = self._sync_contributor(data["user"])
        
        issue = self.db.query(Issue).filter(Issue.github_id == data["id"]).first()
        if not issue:
            issue = Issue(github_id=data["id"])
            self.db.add(issue)
            
        issue.repository_id = repo_id
        issue.number = data["number"]
        issue.title = data["title"]
        issue.state = data["state"]
        issue.created_at = datetime.fromisoformat(data["created_at"].replace("Z", "+00:00"))
        issue.updated_at = datetime.fromisoformat(data["updated_at"].replace("Z", "+00:00"))
        issue.author_id = author.id
        issue.comments_count = data["comments"]
        
        if data["comments"] > 0:
            comments = await self.client.get_issue_comments(owner, repo_name, data["number"])
            has_response = any(c["user"]["login"] != data["user"]["login"] for c in comments)
            issue.has_maintainer_response = has_response
    
    def _update_stats(self, repo_id: int, open_prs: int, open_issues: int):
        stats = RepositoryStats(
            repository_id=repo_id,
            active_prs=open_prs,
            active_issues=open_issues
        )
        self.db.add(stats)
