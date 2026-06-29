from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import endpoints
from app.database import engine, Base
from app.migrations import run_additive_migrations
from sqlalchemy import text
from app.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle.

    Runs once before the app begins serving requests:
    - create_all: add any brand-new tables (does NOT alter existing ones).
    - run_additive_migrations: ALTER existing tables to add missing columns.
    - PRAGMA journal_mode=WAL: enable WAL for better read/write concurrency.
    """
    # Create tables (new tables only; existing tables are not ALTERed here).
    Base.metadata.create_all(bind=engine)

    # Additive column migration: ensure model columns added after a table
    # already existed are present in the live database (create_all will not
    # ALTER existing tables). Idempotent.
    run_additive_migrations()

    # Enable WAL Mode for concurrency.
    with engine.connect() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL;"))
        connection.commit()
    print("[OK] Database configured with WAL Mode")

    print("\n" + "=" * 50)
    print("REGISTERED ROUTES:")
    for route in app.routes:
        if hasattr(route, "path"):
            print(f"  {route.methods} {route.path}")
    print("=" * 50 + "\n")

    yield

    # (No explicit shutdown work needed.)


app = FastAPI(
    title=settings.APP_NAME,
    description="Signal-driven dashboard for open source maintainers",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For dev, should be restrictive in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(endpoints.router, prefix="/api")


@app.get("/")
def read_root():
    return {"message": "Contributor Health Dashboard API is running"}
