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

    async def sync_repository(self, owner: str, repo_name: str):
        repo_data = await self.client.get_repository(owner, repo_name)
        repo = self._get_or_create_repo(repo_data)
        
        try:
            pr_search = await self.client.search_issues(f"repo:{owner}/{repo_name} is:pr is:open")
            repo.open_prs_count = pr_search.get("total_count", 0)
            
            issue_search = await self.client.search_issues(f"repo:{owner}/{repo_name} is:issue is:open")
            repo.open_issues_count = issue_search.get("total_count", 0)
        except Exception as e:
            logger.error(f"Failed to fetch search counts: {e}")
            repo.open_issues_count = repo_data.get("open_issues_count", 0)

        # Semaphore for concurrency
        sem = asyncio.Semaphore(10)

        async def _process_pr(pr_data):
            async with sem:
                await self._sync_pr(repo.id, pr_data, owner, repo_name)

        async def _process_issue(issue_data):
            async with sem:
                await self._sync_issue(repo.id, issue_data, owner, repo_name)

        # Sync PRs (Recent 100)
        prs_data = await self.client.get_pull_requests(owner, repo_name, state="open")
        if prs_data:
            await asyncio.gather(*[_process_pr(pr) for pr in prs_data])
            
        # Sync Issues (Recent 100)
        issues_data = await self.client.get_issues(owner, repo_name, state="open")
        if issues_data:
            await asyncio.gather(*[_process_issue(issue) for issue in issues_data])
            
        self._update_stats(repo.id, repo.open_prs_count, repo.open_issues_count)
        
        repo.last_synced_at = datetime.utcnow()
        self.db.commit()
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
            self.db.commit()
            self.db.refresh(repo)
        return repo

    def _sync_contributor(self, data: dict) -> Contributor:
        contributor = self.db.query(Contributor).filter(Contributor.github_id == data["id"]).first()
        if not contributor:
            contributor = Contributor(
                github_id=data["id"],
                login=data["login"],
                avatar_url=data["avatar_url"],
                html_url=data["html_url"]
            )
            self.db.add(contributor)
            self.db.commit()
            self.db.refresh(contributor)
        return contributor

    async def _sync_pr(self, repo_id: int, data: dict, owner: str, repo_name: str):
        # Always ensure author exists
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
            
        self.db.commit()

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
            
        self.db.commit()
    
    def _update_stats(self, repo_id: int, open_prs: int, open_issues: int):
        stats = RepositoryStats(
            repository_id=repo_id,
            active_prs=open_prs,
            active_issues=open_issues
        )
        self.db.add(stats)
