from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Repository
from app.schemas.base import RepositoryCreate, RepositoryResponse, SignalResponse, OverviewResponse, ContributorsHealthResponse
from app.services.data_collector import DataCollector
from app.services.signal_engine import SignalEngine
from typing import List

router = APIRouter()

@router.post("/repositories/sync", response_model=RepositoryResponse)
async def sync_repository(
    repo_in: RepositoryCreate, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Trigger a sync for a repository"""
    collector = DataCollector(db)
    
    # Check if we should sync immediately or background
    # For MVP we sync immediately to show results
    try:
        repo = await collector.sync_repository(repo_in.owner, repo_in.name)
        return repo
    except Exception as e:
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
