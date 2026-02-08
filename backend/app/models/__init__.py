from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime

class Repository(Base):
    __tablename__ = "repositories"
    
    id = Column(Integer, primary_key=True, index=True)
    github_id = Column(Integer, unique=True, index=True)
    name = Column(String)
    full_name = Column(String, unique=True, index=True)
    owner = Column(String)
    url = Column(String)
    description = Column(String, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    
    # Trusted totals from GitHub (for large repos)
    open_issues_count = Column(Integer, default=0)
    open_prs_count = Column(Integer, default=0)
    
    # Sync Status
    sync_status = Column(String, default="completed") # queued, syncing, completed, failed
    sync_item_count = Column(Integer, default=0)
    sync_total_items = Column(Integer, default=0)
    
    # Relationships
    pull_requests = relationship("PullRequest", back_populates="repository")
    issues = relationship("Issue", back_populates="repository")
    historical_stats = relationship("RepositoryStats", back_populates="repository")

class Contributor(Base):
    __tablename__ = "contributors"
    
    id = Column(Integer, primary_key=True, index=True)
    github_id = Column(Integer, unique=True, index=True)
    login = Column(String, unique=True, index=True)
    avatar_url = Column(String)
    html_url = Column(String)
    first_contribution_date = Column(DateTime, nullable=True)
    last_contribution_date = Column(DateTime, nullable=True)
    
    # Relationships
    pull_requests = relationship("PullRequest", back_populates="author")
    issues = relationship("Issue", back_populates="author")

class PullRequest(Base):
    __tablename__ = "pull_requests"
    
    id = Column(Integer, primary_key=True, index=True)
    github_id = Column(Integer, unique=True, index=True)
    number = Column(Integer)
    title = Column(String)
    state = Column(String) # open, closed, merged
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    closed_at = Column(DateTime, nullable=True)
    merged_at = Column(DateTime, nullable=True)
    
    repository_id = Column(Integer, ForeignKey("repositories.id"))
    author_id = Column(Integer, ForeignKey("contributors.id"))
    
    # Analysis fields
    reviews_count = Column(Integer, default=0)
    has_review = Column(Boolean, default=False)
    time_to_first_review = Column(Float, nullable=True) # in hours
    review_wait_time = Column(Float, nullable=True) # current wait time in hours
    
    repository = relationship("Repository", back_populates="pull_requests")
    author = relationship("Contributor", back_populates="pull_requests")

class Issue(Base):
    __tablename__ = "issues"
    
    id = Column(Integer, primary_key=True, index=True)
    github_id = Column(Integer, unique=True, index=True)
    number = Column(Integer)
    title = Column(String)
    state = Column(String) # open, closed
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    closed_at = Column(DateTime, nullable=True)
    
    repository_id = Column(Integer, ForeignKey("repositories.id"))
    author_id = Column(Integer, ForeignKey("contributors.id"))
    
    # Analysis fields
    comments_count = Column(Integer, default=0)
    has_maintainer_response = Column(Boolean, default=False)
    time_to_first_response = Column(Float, nullable=True) # in hours
    
    repository = relationship("Repository", back_populates="issues")
    author = relationship("Contributor", back_populates="issues")

class RepositoryStats(Base):
    __tablename__ = "repository_stats"
    
    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"))
    date = Column(DateTime, default=datetime.utcnow)
    
    active_prs = Column(Integer, default=0)
    active_issues = Column(Integer, default=0)
    active_contributors = Column(Integer, default=0)
    
    repository = relationship("Repository", back_populates="historical_stats")
