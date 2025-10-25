"""FastAPI application entry point."""
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import routes
from .api.assignments import router as assignments_router
from .api.auth import router as auth_router
from .api.audit import router as audit_router
from .api.events import router as events_router
from .api.incidents import router as incidents_router
from .api.materials import router as materials_router
from .api.personnel import router as personnel_router
from .api.personnel_checkin import router as personnel_checkin_router
from .api.reko import router as reko_router
from .api.settings import router as settings_router
from .api.vehicles import router as vehicles_router
from .config import settings
from .database import Base, engine, get_db
from .middleware.audit import AuditMiddleware
from .seed import seed_database
from .services.settings import initialize_default_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan events."""
    print("Starting application...")

    # Startup: Create tables
    print("Creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables created.")

    # Initialize default settings
    print("Initializing default settings...")
    async for db in get_db():
        try:
            await initialize_default_settings(db)
            print("Default settings initialized.")
        except Exception as e:
            print(f"Warning: Default settings initialization failed: {e}")
        finally:
            break  # Only need one session

    # Seed database if requested
    if os.getenv("SEED_DATABASE", "").lower() == "true":
        print("Seeding database...")
        try:
            await seed_database()
        except Exception as e:
            print(f"Warning: Database seeding failed: {e}")

    print("Application startup complete.")
    yield

    # Shutdown: Dispose engine
    print("Shutting down...")
    await engine.dispose()


app = FastAPI(
    title=settings.project_name,
    description=settings.description,
    version=settings.version,
    lifespan=lifespan,
)

# CORS middleware with Railway domain support
def get_cors_origins() -> list[str]:
    """Get CORS origins including automatic Railway domain support."""
    origins = list(settings.cors_origins)

    # Automatically allow all Railway domains in production
    # This allows frontend and backend to communicate without manual configuration
    railway_patterns = [
        "https://*.railway.app",
        "https://*.up.railway.app",
    ]
    origins.extend(railway_patterns)

    return origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_origin_regex=r"https://.*\.(railway\.app|up\.railway\.app)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add audit middleware
app.add_middleware(AuditMiddleware)

# Include routers
app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(audit_router, prefix=settings.api_v1_prefix)
app.include_router(events_router, prefix=settings.api_v1_prefix)
app.include_router(incidents_router, prefix=settings.api_v1_prefix)
app.include_router(assignments_router, prefix=settings.api_v1_prefix)
app.include_router(personnel_router, prefix=settings.api_v1_prefix)
app.include_router(personnel_checkin_router, prefix=settings.api_v1_prefix)
app.include_router(vehicles_router, prefix=settings.api_v1_prefix)
app.include_router(materials_router, prefix=settings.api_v1_prefix)
app.include_router(reko_router, prefix=settings.api_v1_prefix)
app.include_router(settings_router, prefix=settings.api_v1_prefix)
app.include_router(routes.router, prefix=settings.api_v1_prefix, tags=["api"])


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"message": f"{settings.project_name} - FastAPI Backend"}


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}
