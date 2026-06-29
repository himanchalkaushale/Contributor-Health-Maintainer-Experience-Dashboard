import requests
import asyncio
import logging
import time
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Hard cap on pages per list call to bound work on very large repos.
MAX_PAGES = 50


class GitHubClient:
    def __init__(self):
        self.base_url = "https://api.github.com"
        self.headers = {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"Bearer {settings.GITHUB_TOKEN}" if settings.GITHUB_TOKEN else ""
        }
        if not settings.GITHUB_TOKEN:
            logger.warning("No GitHub token provided. Rate limits will be restricted.")

    def _raw_request(self, method: str, url: str, params: Dict = None) -> requests.Response:
        """Blocking request with rate-limit aware retry. Returns the Response."""
        attempts = 0
        with requests.Session() as session:
            while True:
                attempts += 1
                response = session.request(
                    method, url, headers=self.headers, params=params, timeout=30
                )

                # Primary rate limit: 403/429 with remaining == 0
                remaining = response.headers.get("X-RateLimit-Remaining")
                if response.status_code in (403, 429):
                    retry_after = response.headers.get("Retry-After")
                    reset = response.headers.get("X-RateLimit-Reset")
                    wait = None
                    if retry_after:
                        wait = int(retry_after)
                    elif remaining == "0" and reset:
                        wait = max(0, int(reset) - int(time.time())) + 1
                    if wait is not None and attempts <= 5:
                        wait = min(wait, 60)
                        logger.warning(
                            f"Rate limited (status={response.status_code}). "
                            f"Backing off {wait}s (attempt {attempts})."
                        )
                        time.sleep(wait)
                        continue

                # Proactively slow down when nearly exhausted
                if remaining is not None and remaining.isdigit() and int(remaining) <= 2:
                    reset = response.headers.get("X-RateLimit-Reset")
                    if reset:
                        wait = max(0, int(reset) - int(time.time())) + 1
                        logger.warning(f"Rate limit nearly exhausted. Sleeping {min(wait,60)}s.")
                        time.sleep(min(wait, 60))

                response.raise_for_status()
                return response

    async def _request(self, method: str, endpoint: str, params: Dict = None) -> Any:
        def sync_request():
            resp = self._raw_request(method, f"{self.base_url}{endpoint}", params)
            return resp.json()

        try:
            return await asyncio.to_thread(sync_request)
        except requests.RequestException as e:
            logger.error(f"GitHub API error: {e}")
            raise Exception(f"GitHub API error: {e}")

    async def _paginate(
        self,
        endpoint: str,
        params: Dict = None,
        since: Optional[datetime] = None,
        date_key: str = "updated_at",
        max_pages: int = MAX_PAGES,
    ) -> List[Dict]:
        """
        Follow Link headers and accumulate results.
        If `since` is provided, stops paginating once items predate the window.
        Assumes the caller sorts by `updated`/`created` descending so older items
        appear on later pages.
        """
        params = dict(params or {})
        params.setdefault("per_page", 100)

        def sync_paginate():
            results: List[Dict] = []
            url = f"{self.base_url}{endpoint}"
            page_params = params
            pages = 0
            while url and pages < max_pages:
                resp = self._raw_request("GET", url, page_params)
                batch = resp.json()
                if not isinstance(batch, list):
                    return batch
                pages += 1

                stop = False
                for item in batch:
                    if since is not None and date_key:
                        raw = item.get(date_key)
                        if raw:
                            try:
                                dt = datetime.fromisoformat(
                                    raw.replace("Z", "+00:00")
                                ).replace(tzinfo=None)
                                if dt < since:
                                    stop = True
                                    continue
                            except (ValueError, AttributeError):
                                pass
                    results.append(item)

                if stop:
                    break

                # Follow Link header for next page
                next_url = None
                link = resp.headers.get("Link")
                if link:
                    for part in link.split(","):
                        segs = part.split(";")
                        if len(segs) >= 2 and 'rel="next"' in segs[1]:
                            next_url = segs[0].strip().strip("<>")
                            break
                url = next_url
                page_params = None  # next_url already carries query params
            return results

        try:
            return await asyncio.to_thread(sync_paginate)
        except requests.RequestException as e:
            logger.error(f"GitHub API pagination error: {e}")
            raise Exception(f"GitHub API error: {e}")

    async def get_repository(self, owner: str, repo: str) -> Dict:
        return await self._request("GET", f"/repos/{owner}/{repo}")

    async def get_pull_requests(
        self, owner: str, repo: str, state: str = "all", since: Optional[datetime] = None
    ) -> List[Dict]:
        params = {"state": state, "per_page": 100, "sort": "updated", "direction": "desc"}
        return await self._paginate(
            f"/repos/{owner}/{repo}/pulls", params=params, since=since, date_key="updated_at"
        )

    async def get_issues(
        self, owner: str, repo: str, state: str = "all", since: Optional[datetime] = None
    ) -> List[Dict]:
        # Excludes PRs (GitHub API returns PRs as issues)
        params = {"state": state, "per_page": 100, "sort": "updated", "direction": "desc"}
        if since is not None:
            params["since"] = since.replace(microsecond=0).isoformat() + "Z"
        issues = await self._paginate(
            f"/repos/{owner}/{repo}/issues", params=params, since=since, date_key="updated_at"
        )
        return [i for i in issues if "pull_request" not in i]

    async def get_pr_reviews(self, owner: str, repo: str, pr_number: int) -> List[Dict]:
        return await self._paginate(f"/repos/{owner}/{repo}/pulls/{pr_number}/reviews")

    async def get_issue_comments(self, owner: str, repo: str, issue_number: int) -> List[Dict]:
        return await self._paginate(f"/repos/{owner}/{repo}/issues/{issue_number}/comments")

    async def get_issue_labels(self, owner: str, repo: str, issue_number: int) -> List[Dict]:
        """Fetch labels for a specific issue."""
        return await self._paginate(f"/repos/{owner}/{repo}/issues/{issue_number}/labels")

    async def get_issue_events(self, owner: str, repo: str, issue_number: int) -> List[Dict]:
        """Fetch timeline events (assigned, labeled, etc.) for an issue."""
        return await self._paginate(f"/repos/{owner}/{repo}/issues/{issue_number}/events")

    async def get_contributors(self, owner: str, repo: str) -> List[Dict]:
        return await self._paginate(f"/repos/{owner}/{repo}/contributors", params={"per_page": 100})

    async def get_commits(
        self, owner: str, repo: str, since: Optional[datetime] = None
    ) -> List[Dict]:
        params = {"per_page": 100}
        if since is not None:
            params["since"] = since.replace(microsecond=0).isoformat() + "Z"
        return await self._paginate(
            f"/repos/{owner}/{repo}/commits", params=params, since=since, date_key=None
        )

    async def search_issues(self, query: str) -> Dict:
        """Use Search API to get counts and items"""
        return await self._request("GET", "/search/issues", params={"q": query})
