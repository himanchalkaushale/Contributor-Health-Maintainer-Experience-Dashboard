from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache

class Settings(BaseSettings):
    APP_NAME: str = "Contributor Analytics Dashboard"
    API_V1_STR: str = "/api"
    
    # GitHub Config
    GITHUB_TOKEN: str
    
    # Database
    DATABASE_URL: str = "sqlite:///./sql_app.db"
    
    # Signal Thresholds
    STALE_PR_WARNING_DAYS: int = 7
    STALE_PR_CRITICAL_DAYS: int = 14
    UNANSWERED_ISSUE_DAYS: int = 7
    
    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()
