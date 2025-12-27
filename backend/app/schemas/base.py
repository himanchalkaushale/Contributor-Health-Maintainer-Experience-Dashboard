from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

class RepositoryCreate(BaseModel):
    owner: str
    name: str

class RepositoryResponse(BaseModel):
    id: int
    name: str
    owner: str
    full_name: str
    url: str
    last_synced_at: Optional[datetime]
    
    class Config:
        from_attributes = True

class SignalResponse(BaseModel):
    id: str
    name: str
    description: str
    severity: str
    metadata: Dict[str, Any]

class ContributorResponse(BaseModel):
    login: str
    avatar_url: str
    html_url: str
    
    class Config:
        from_attributes = True

class ActivityTrend(BaseModel):
    weeks: List[str]
    prs: List[int]
    issues: List[int]

class OverviewResponse(BaseModel):
    active_contributors: int
    open_prs: int
    stale_prs: int
    avg_review_time_hours: Optional[float]
    avg_review_time_label: str
    unanswered_issues: int
    issue_age_buckets: List[Dict[str, Any]] # e.g. [{"label": "<7d", "count": 12}, ...]
    activity_trend: ActivityTrend
class ContributorActivity(BaseModel):
    login: str
    avatar_url: str
    last_activity_date: datetime
    activity_type: str # 'pr_open', 'pr_review', 'issue_open', 'issue_comment'
    status: str # 'healthy', 'warning', 'critical' (based on recency)

class FirstTimeExperience(BaseModel):
    median_hours: float
    worst_case_hours: float
    severity: str # 'healthy', 'warning', 'critical'

class ContributorSummary(BaseModel):
    new: int
    returning: int
    churned: int
    active: int

class ContributorsHealthResponse(BaseModel):
    summary: ContributorSummary
    first_time_experience: FirstTimeExperience
    active_contributors: List[ContributorActivity]
    last_updated: datetime
