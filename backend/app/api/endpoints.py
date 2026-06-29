from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.models import Repository
from app.schemas.base import RepositoryCreate, RepositoryResponse, SignalResponse, OverviewResponse, ContributorsHealthResponse
from app.services.data_collector import DataCollector
from app.services.signal_engine import SignalEngine
from typing import List

import logging

router = APIRouter()
logger = logging.getLogger(__name__)


def clamp_days(days: int, default: int = 90, lo: int = 1, hi: int = 365) -> int:
    """Clamp an inbound `days` query param to a safe window to prevent unbounded
    full-history scans via the public API."""
    try:
        d = int(days)
    except (TypeError, ValueError):
        return default
    if d < lo:
        return lo
    if d > hi:
        return hi
    return d


@router.post("/repositories/sync", response_model=RepositoryResponse)
async def sync_repository(
    repo_in: RepositoryCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Trigger a sync for a repository"""
    collector = DataCollector(db)
    
    # For MVP we sync immediately to show results
    try:
        # Phase 1: Init Sync (Fast)
        repo = await collector.init_sync(repo_in.owner, repo_in.name)
        
        # Phase 2: Background Processing (Slow)
        # We need to pass a new instance of Collector or a static method to avoid DB session issues
        # But for simplicity, we rely on execute_sync creating its own session.
        # We pass the method from the current instance, but the method implementation 
        # creates a NEW session, so it's safe.
        background_tasks.add_task(collector.execute_sync, repo.id, repo_in.owner, repo_in.name)
        
        return repo
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/repositories/{repo_id}/overview", response_model=OverviewResponse)
def get_repo_overview(repo_id: int, db: Session = Depends(get_db)):
    """Get high-level health overview for a repository"""
    engine = SignalEngine(db)
    overview = engine.compute_overview(repo_id)
    if not overview:
        raise HTTPException(status_code=404, detail="Repository not found")
    return overview

@router.get("/repositories/{repo_id}/signals", response_model=List[SignalResponse])
def get_repo_signals(repo_id: int, db: Session = Depends(get_db)):
    """Get computed health signals for a repository"""
    engine = SignalEngine(db)
    return engine.compute_repo_signals(repo_id)

@router.delete("/repositories/{repo_id}", status_code=204)
def delete_repository(repo_id: int, db: Session = Depends(get_db)):
    """Stop tracking a repository and delete its data"""
    repo = db.query(Repository).get(repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
        
    db.delete(repo)
    db.commit()
    return None

@router.get("/repositories/{repo_id}/contributors-health", response_model=ContributorsHealthResponse)
def get_contributors_health(repo_id: int, db: Session = Depends(get_db)):
    """Get detailed contributor health metrics"""
    print(f"DEBUG: get_contributors_health called with repo_id={repo_id} type={type(repo_id)}")
    engine = SignalEngine(db)
    # User feedback: Ensure we are passing an INT, not a string
    data = engine.compute_contributors_health(int(repo_id))
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/activity-timeline")
def get_activity_timeline(repo_id: int, days: int = 365, db: Session = Depends(get_db)):
    """Activity event counts bucketed by week/month and event type."""
    days = clamp_days(days, default=365)
    engine = SignalEngine(db)
    data = engine.compute_activity_timeline(int(repo_id), days=days)
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/leaderboard")
def get_leaderboard(repo_id: int, days: int = 365, db: Session = Depends(get_db)):
    """Per-contributor leaderboard (PRs, reviews, comments, commits, tenure)."""
    days = clamp_days(days, default=365)
    engine = SignalEngine(db)
    data = engine.compute_leaderboard(int(repo_id), days=days)
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/reviewer-load")
def get_reviewer_load(repo_id: int, days: int = 365, db: Session = Depends(get_db)):
    """Per-reviewer load and responsiveness."""
    days = clamp_days(days, default=365)
    engine = SignalEngine(db)
    data = engine.compute_reviewer_load(int(repo_id), days=days)
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/newcomer-funnel")
def get_newcomer_funnel(repo_id: int, days: int = 365, db: Session = Depends(get_db)):
    """First-time contributor experience and retention funnel."""
    days = clamp_days(days, default=365)
    engine = SignalEngine(db)
    data = engine.compute_newcomer_funnel(int(repo_id), days=days)
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories", response_model=List[RepositoryResponse])
def get_repositories(db: Session = Depends(get_db)):
    """List all tracked repositories"""
    return db.query(Repository).all()

@router.get("/health/contributors", response_model=ContributorsHealthResponse)
def get_contributors_health_by_query(repo: str, db: Session = Depends(get_db)):
    """
    Get detailed contributor health metrics by repo name (owner/name).
    Manual test route: /api/health/contributors?repo=owner/repo
    """
    if "/" not in repo:
        raise HTTPException(status_code=400, detail="Repository must be in format 'owner/name'")
    
    owner, name = repo.split("/", 1)
    
    repo_obj = db.query(Repository).filter(
        Repository.owner == owner, 
        Repository.name == name
    ).first()
    
    if not repo_obj:
        raise HTTPException(status_code=404, detail=f"Repository '{repo}' not found. Please sync it first.")

    engine = SignalEngine(db)
    # User feedback: Ensure we are passing an INT
    data = engine.compute_contributors_health(int(repo_obj.id))
    
    if not data:
        raise HTTPException(status_code=404, detail="Data unavailable")
        
    return data

@router.get("/repositories/{repo_id}/pr-bottlenecks")
def get_pr_bottlenecks(repo_id: int, db: Session = Depends(get_db)):
    engine = SignalEngine(db)
    # User feedback: Ensure we are passing an INT
    data = engine.compute_pr_bottlenecks(int(repo_id))
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found or data unavailable")
    return data

@router.get("/repositories/{repo_id}/issues-health")
def get_issues_health(repo_id: int, db: Session = Depends(get_db)):
    engine = SignalEngine(db)
    data = engine.compute_issues_health(int(repo_id))
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found or data unavailable")
    return data

@router.get("/health/pr-review")
def get_pr_review_health_by_query(repo: str, days: int = 90, db: Session = Depends(get_db)):
    """
    Get PR Review Health metrics by repo name.
    Query: /api/health/pr-review?repo=owner/repo&days=90
    days: one of {30, 90, 180, 365}, defaults to 90.
    """
    if "/" not in repo:
        raise HTTPException(status_code=400, detail="Repository must be in format 'owner/name'")

    # Validate days — fall back to 90 for invalid values
    if days not in {30, 90, 180, 365}:
        days = 90

    owner, name = repo.split("/", 1)
    
    repo_obj = db.query(Repository).filter(
        Repository.owner == owner, 
        Repository.name == name
    ).first()
    
    if not repo_obj:
        raise HTTPException(status_code=404, detail=f"Repository '{repo}' not found")

    engine = SignalEngine(db)
    data = engine.compute_pr_review_health(int(repo_obj.id), days=days)
    
    if not data:
        raise HTTPException(status_code=404, detail="Data unavailable")
        
    return data

# Issues Analytics Endpoints (6 new endpoints + bulk stubs)

@router.get("/repositories/{repo_id}/issue-triage-load")
def get_issue_triage_load(repo_id: int, days: int = 90, db: Session = Depends(get_db)):
    days = clamp_days(days, default=90)
    engine = SignalEngine(db)
    data = engine.compute_issue_triage_load(int(repo_id), days=days)
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/issue-workload-balance")
def get_issue_workload_balance(repo_id: int, db: Session = Depends(get_db)):
    engine = SignalEngine(db)
    data = engine.compute_issue_workload_balance(int(repo_id))
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/issue-trends")
def get_issue_trends(repo_id: int, days: int = 90, db: Session = Depends(get_db)):
    days = clamp_days(days, default=90)
    engine = SignalEngine(db)
    data = engine.compute_issue_trends(int(repo_id), days=days)
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/first-timer-issue-queue")
def get_first_timer_issue_queue(repo_id: int, db: Session = Depends(get_db)):
    engine = SignalEngine(db)
    data = engine.compute_first_timer_issue_queue(int(repo_id))
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/zombie-issues")
def get_zombie_issues(repo_id: int, db: Session = Depends(get_db)):
    engine = SignalEngine(db)
    data = engine.compute_zombie_issues(int(repo_id))
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data

@router.get("/repositories/{repo_id}/issue-category-breakdown")
def get_issue_category_breakdown(repo_id: int, db: Session = Depends(get_db)):
    engine = SignalEngine(db)
    data = engine.compute_issue_category_breakdown(int(repo_id))
    if not data:
        raise HTTPException(status_code=404, detail="Repository not found")
    return data


# Bulk operations stubs (Phase 7 - requires GitHub App OAuth)

class BulkIssueRequest(BaseModel):
    issue_numbers: List[int]
    reason: str = ""

@router.post("/repositories/{repo_id}/issues/bulk-mark-stale")
def bulk_mark_stale(repo_id: int, request: BulkIssueRequest, db: Session = Depends(get_db)):
    """Stub: Mark multiple issues as stale. Full implementation requires GitHub App OAuth."""
    return {"status": "not_implemented", "message": "Bulk operations require GitHub App OAuth with issue_write permission", "count": len(request.issue_numbers)}

@router.post("/repositories/{repo_id}/issues/bulk-close")
def bulk_close(repo_id: int, request: BulkIssueRequest, db: Session = Depends(get_db)):
    """Stub: Close multiple issues. Full implementation requires GitHub App OAuth."""
    return {"status": "not_implemented", "message": "Bulk operations require GitHub App OAuth with issue_write permission", "count": len(request.issue_numbers)}


class NudgeRequest(BaseModel):
    pr_title: str
    author_name: str
    days_waiting: int

@router.post("/nudge/generate")
async def generate_nudge(request: NudgeRequest):
    """Generate a polite nudge message using Gemini"""
    from app.services.gemini_service import GeminiService
    service = GeminiService()
    message = await service.generate_nudge(request.pr_title, request.author_name, request.days_waiting)
    return {"message": message}
