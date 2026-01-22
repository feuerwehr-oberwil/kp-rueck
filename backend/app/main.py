"""FastAPI application entry point."""

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from .logging_config import get_logger, setup_logging

# Setup logging early
setup_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    json_format=os.getenv("LOG_FORMAT", "").lower() == "json",
)

logger = get_logger(__name__)

from .api import routes
from .api.admin import router as admin_router
from .api.assignments import bulk_router as assignments_bulk_router
from .api.assignments import router as assignments_router
from .api.audit import router as audit_router
from .api.auth import router as auth_router
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
from .api.reko import photos_router
from .api.reko import router as reko_router
from .api.reko_dashboard import router as reko_dashboard_router
from .api.settings import router as settings_router
from .api.special_functions import router as special_functions_router
from .api.stats import router as stats_router
from .api.sync import router as sync_router
from .api.traccar import router as traccar_router
from .api.training import router as training_router
from .api.vehicles import router as vehicles_router
from .background import start_sync_scheduler, stop_sync_scheduler
from .config import settings
from .database import Base, engine, get_db
from .middleware.audit import AuditMiddleware
from .middleware.rate_limit import limiter, rate_limit_exceeded_handler
from .middleware.security_headers import SecurityHeadersMiddleware
from .seed import seed_database
from .services.settings import initialize_default_settings
from .websocket_manager import sio as socket_server
from .websocket_manager import ws_manager


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

    # Start WebSocket stale session cleanup
    logger.info("Starting WebSocket stale session cleanup...")
    try:
        await ws_manager.start_cleanup_task()
    except Exception as e:
        logger.warning(f"WebSocket cleanup task failed to start: {e}")

    logger.info("Application startup complete")
    yield

    # Shutdown: Stop WebSocket cleanup
    logger.info("Stopping WebSocket cleanup task...")
    try:
        await ws_manager.stop_cleanup_task()
    except Exception as e:
        logger.warning(f"WebSocket cleanup shutdown failed: {e}")

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

# Add rate limiter state and exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


# CORS middleware with explicit domain whitelist
def get_cors_origins() -> list[str]:
    """
    Get CORS origins using explicit whitelist instead of wildcards.

    Security: Using explicit domains instead of wildcards to prevent
    malicious Railway deployments from accessing the API.
    """
    origins = list(settings.cors_origins)

    # Add production domains
    origins.extend(
        [
            "https://kp.fwo.li",
            "https://kp-api.fwo.li",
        ]
    )

    # Add Railway-specific domains from environment variables
    # This allows automatic configuration without wildcards
    railway_frontend = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    railway_backend = os.getenv("RAILWAY_STATIC_URL", "")
    frontend_url = os.getenv("FRONTEND_URL", "")

    if railway_frontend:
        origins.append(f"https://{railway_frontend}")
    if railway_backend:
        origins.append(f"https://{railway_backend}")
    if frontend_url:
        origins.append(frontend_url)

    # Remove duplicates while preserving order
    seen = set()
    unique_origins = []
    for origin in origins:
        if origin and origin not in seen:
            seen.add(origin)
            unique_origins.append(origin)

    return unique_origins


# NOTE: CORS middleware must be added BEFORE wrapping with Socket.IO
# This ensures it applies to both WebSocket and regular HTTP requests
# Security: Removed wildcard regex - using explicit origins only
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add audit middleware
app.add_middleware(AuditMiddleware)

# Add security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

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
app.include_router(reko_dashboard_router, prefix=settings.api_v1_prefix)
app.include_router(photos_router, prefix=settings.api_v1_prefix)
app.include_router(settings_router, prefix=settings.api_v1_prefix)
app.include_router(special_functions_router, prefix=settings.api_v1_prefix)
app.include_router(stats_router, prefix=settings.api_v1_prefix)
app.include_router(sync_router, prefix=settings.api_v1_prefix)
app.include_router(traccar_router, prefix=settings.api_v1_prefix)
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
