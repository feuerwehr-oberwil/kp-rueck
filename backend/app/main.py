"""FastAPI application entry point."""

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio

from .logging_config import setup_logging, get_logger

# Setup logging early
setup_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    json_format=os.getenv("LOG_FORMAT", "").lower() == "json",
)

logger = get_logger(__name__)

from .api import routes
from .websocket_manager import sio as socket_server
from .api.admin import router as admin_router
from .api.assignments import router as assignments_router, bulk_router as assignments_bulk_router
from .api.auth import router as auth_router
from .api.audit import router as audit_router
from .api.divera import router as divera_router
from .api.events import router as events_router
from .api.exports import router as exports_router
from .api.health import router as health_router
from .api.help import router as help_router
from .api.incidents import router as incidents_router
from .api.materials import router as materials_router
from .api.notifications import router as notifications_router
from .api.personnel import router as personnel_router
from .api.personnel_checkin import router as personnel_checkin_router
from .api.reko import router as reko_router, photos_router
from .api.settings import router as settings_router
from .api.special_functions import router as special_functions_router
from .api.stats import router as stats_router
from .api.sync import router as sync_router
from .api.training import router as training_router
from .api.vehicles import router as vehicles_router
from .background import start_sync_scheduler, stop_sync_scheduler
from .config import settings
from .database import Base, engine, get_db
from .middleware.audit import AuditMiddleware
from .seed import seed_database
from .services.settings import initialize_default_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan events."""
    logger.info("Starting application...")

    # Startup: Create tables
    logger.info("Creating database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created")

    # Initialize default settings
    logger.info("Initializing default settings...")
    async for db in get_db():
        try:
            await initialize_default_settings(db)
            logger.info("Default settings initialized")
        except Exception as e:
            logger.warning(f"Default settings initialization failed: {e}")
        finally:
            break  # Only need one session

    # Seed database if requested
    if os.getenv("SEED_DATABASE", "").lower() == "true":
        logger.info("Seeding database...")
        try:
            await seed_database()
        except Exception as e:
            logger.warning(f"Database seeding failed: {e}")

    # Start background sync scheduler
    logger.info("Starting background sync scheduler...")
    try:
        start_sync_scheduler()
    except Exception as e:
        logger.warning(f"Sync scheduler failed to start: {e}")

    logger.info("Application startup complete")
    yield

    # Shutdown: Stop sync scheduler
    logger.info("Stopping sync scheduler...")
    try:
        stop_sync_scheduler()
    except Exception as e:
        logger.warning(f"Sync scheduler shutdown failed: {e}")

    # Shutdown: Dispose engine
    logger.info("Shutting down...")
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

# NOTE: CORS middleware must be added BEFORE wrapping with Socket.IO
# This ensures it applies to both WebSocket and regular HTTP requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_origin_regex=r"https://.*\.(railway\.app|up\.railway\.app)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Debug: Log all incoming requests
@app.middleware("http")
async def log_requests(request, call_next):
    print(f"[Request Debug] {request.method} {request.url.path} - Cookie: {request.headers.get('cookie', 'none')[:50] if request.headers.get('cookie') else 'none'}...")
    response = await call_next(request)
    print(f"[Request Debug] {request.method} {request.url.path} -> {response.status_code}")
    return response

# Add audit middleware
app.add_middleware(AuditMiddleware)

# Include routers
app.include_router(health_router)  # No prefix - available at /health
app.include_router(admin_router, prefix=settings.api_v1_prefix)
app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(audit_router, prefix=settings.api_v1_prefix)
app.include_router(divera_router, prefix=settings.api_v1_prefix)
app.include_router(events_router, prefix=settings.api_v1_prefix)
app.include_router(exports_router, prefix=settings.api_v1_prefix)
app.include_router(help_router, prefix=settings.api_v1_prefix)
app.include_router(incidents_router, prefix=settings.api_v1_prefix)
app.include_router(assignments_router, prefix=settings.api_v1_prefix)
app.include_router(assignments_bulk_router, prefix=settings.api_v1_prefix)  # Bulk assignments endpoint
app.include_router(personnel_router, prefix=settings.api_v1_prefix)
app.include_router(personnel_checkin_router, prefix=settings.api_v1_prefix)
app.include_router(vehicles_router, prefix=settings.api_v1_prefix)
app.include_router(materials_router, prefix=settings.api_v1_prefix)
app.include_router(reko_router, prefix=settings.api_v1_prefix)
app.include_router(photos_router, prefix=settings.api_v1_prefix)
app.include_router(settings_router, prefix=settings.api_v1_prefix)
app.include_router(special_functions_router, prefix=settings.api_v1_prefix)
app.include_router(stats_router, prefix=settings.api_v1_prefix)
app.include_router(sync_router, prefix=settings.api_v1_prefix)
app.include_router(notifications_router, prefix=settings.api_v1_prefix)
app.include_router(training_router, prefix=settings.api_v1_prefix)
app.include_router(routes.router, prefix=settings.api_v1_prefix, tags=["api"])


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"message": f"{settings.project_name} - FastAPI Backend"}

# Mount Socket.IO at /socket.io/ path
# This preserves the FastAPI app and its middleware for regular HTTP requests
app.mount("/socket.io", socketio.ASGIApp(socket_server, other_asgi_app=None))


