from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import endpoints
from app.database import engine, Base
from sqlalchemy import text
from app.config import get_settings

settings = get_settings()

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    description="Signal-driven dashboard for open source maintainers",
    version="0.1.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # For dev, should be restrictive in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(endpoints.router, prefix="/api")

@app.on_event("startup")
async def startup_event():
    # Enable WAL Mode for concurrency
    with engine.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL;"))
        print("✅ Database configured with WAL Mode")
    print("\n" + "="*50)
    print("📍 REGISTERED ROUTES:")
    for route in app.routes:
        if hasattr(route, "path"):
            print(f"  {route.methods} {route.path}")
    print("="*50 + "\n")

@app.get("/")
def read_root():
    return {"message": "Contributor Health Dashboard API is running"}
