from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Repository
from app.services.signal_engine import SignalEngine
from app.schemas.base import ContributorsHealthResponse

router = APIRouter(
    prefix="/api/health",
    tags=["contributors"]
)

@router.get("/contributors", response_model=ContributorsHealthResponse)
def get_contributors_health(repo: str, db: Session = Depends(get_db)):
    """
    Get detailed contributor health metrics by repo name (owner/name).
    This matches the GSoC API contract: /api/health/contributors?repo=owner/repo
    """
    if "/" not in repo:
        raise HTTPException(status_code=400, detail="Repository must be in format 'owner/name'")
    
    owner, name = repo.split("/", 1)
    
    # helper lookup
    repo_obj = db.query(Repository).filter(
        Repository.owner == owner, 
        Repository.name == name
    ).first()
    
    if not repo_obj:
        raise HTTPException(status_code=404, detail=f"Repository '{repo}' not found. Please sync it first.")

    engine = SignalEngine(db)
    data = engine.compute_contributors_health(repo_obj.id)
    
    if not data:
        raise HTTPException(status_code=404, detail="Data unavailable")
        
    return data
