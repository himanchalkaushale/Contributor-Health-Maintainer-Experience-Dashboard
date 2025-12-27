import httpx
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import asyncio
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

class GitHubClient:
    def __init__(self):
        self.base_url = "https://api.github.com"
        self.headers = {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"token {settings.GITHUB_TOKEN}" if settings.GITHUB_TOKEN else ""
        }
        if not settings.GITHUB_TOKEN:
            logger.warning("No GitHub token provided. Rate limits will be restricted.")
            
    async def _request(self, method: str, endpoint: str, params: Dict = None) -> Any:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.request(
                    method, 
                    f"{self.base_url}{endpoint}", 
                    headers=self.headers,
                    params=params
                )
                
                # Handle rate limits
                if response.status_code == 403 and "rate limit" in response.text.lower():
                    reset_time = int(response.headers.get("X-RateLimit-Reset", 0))
                    wait_seconds = max(0, reset_time - datetime.now().timestamp())
                    logger.error(f"Rate limit exceeded. Reset in {wait_seconds} seconds")
                    raise Exception(f"GitHub API rate limit exceeded. Reset in {wait_seconds} seconds")
                
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                logger.error(f"GitHub API error: {str(e)}")
                raise

    async def get_repository(self, owner: str, repo: str) -> Dict:
        return await self._request("GET", f"/repos/{owner}/{repo}")

    async def get_pull_requests(self, owner: str, repo: str, state: str = "all") -> List[Dict]:
        # Simple pagination for MVP - fetches last 100 PRs
        # In production this should be more robust
        params = {"state": state, "per_page": 100, "sort": "updated", "direction": "desc"}
        return await self._request("GET", f"/repos/{owner}/{repo}/pulls", params=params)

    async def get_issues(self, owner: str, repo: str, state: str = "all") -> List[Dict]:
        # Excludes PRs (GitHub API returns PRs as issues)
        params = {"state": state, "per_page": 100, "sort": "updated", "direction": "desc"}
        issues = await self._request("GET", f"/repos/{owner}/{repo}/issues", params=params)
        return [i for i in issues if "pull_request" not in i]

    async def get_pr_reviews(self, owner: str, repo: str, pr_number: int) -> List[Dict]:
        return await self._request("GET", f"/repos/{owner}/{repo}/pulls/{pr_number}/reviews")

    async def get_issue_comments(self, owner: str, repo: str, issue_number: int) -> List[Dict]:
        return await self._request("GET", f"/repos/{owner}/{repo}/issues/{issue_number}/comments")

    async def get_contributors(self, owner: str, repo: str) -> List[Dict]:
        return await self._request("GET", f"/repos/{owner}/{repo}/contributors")

    async def search_issues(self, query: str) -> Dict:
        """Use Search API to get counts and items"""
        return await self._request("GET", "/search/issues", params={"q": query})
