"""FastAPI application entry point."""

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from .logging_config import get_logger, setup_logging

# Setup logging early
setup_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    json_format=os.getenv("LOG_FORMAT", "").lower() == "json",
)

logger = get_logger(__name__)

from .api.admin import router as admin_router
from .api.alarms import router as alarms_router
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
from .api.intake import router as intake_router
from .api.materials import groups_router as material_groups_router
from .api.materials import router as materials_router
from .api.notifications import router as notifications_router
from .api.personnel import router as personnel_router
from .api.personnel_checkin import router as personnel_checkin_router
from .api.print import router as print_router
from .api.reko import photos_router
from .api.reko import router as reko_router
from .api.reko_dashboard import router as reko_dashboard_router
from .api.settings import router as settings_router
from .api.special_functions import router as special_functions_router
from .api.stats import router as stats_router
from .api.sync import router as sync_router
from .api.traccar import router as traccar_router
from .api.training import router as training_router
from .api.users import router as users_router
from .api.vehicles import router as vehicles_router
from .api.viewer import router as viewer_router
from .auth.token_blocklist import token_blocklist
from .background import (
    start_audit_cleanup_scheduler,
    start_demo_reset_scheduler,
    start_sync_scheduler,
    stop_audit_cleanup_scheduler,
    stop_demo_reset_scheduler,
    stop_sync_scheduler,
)
from .config import settings
from .database import engine, get_db
from .middleware.audit import AuditMiddleware
from .middleware.rate_limit import limiter, rate_limit_exceeded_handler
from .middleware.request_id import RequestIDMiddleware, get_request_id, request_id_var
from .middleware.security_headers import SecurityHeadersMiddleware
from .seed import seed_database
from .services.settings import initialize_default_settings
from .websocket_manager import set_divera_poll_callback, ws_manager
from .websocket_manager import sio as socket_server


async def _setup_divera_polling():
    """
    Set up the Divera polling callback.

    This callback is called for each alarm fetched via polling.
    It checks for duplicates and saves new alarms to the database.
    """
    from . import schemas
    from .crud import divera as divera_crud
    from .database import async_session_maker
    from .services.divera_intake import broadcast_emergency_received, try_auto_attach

    async def on_polled_alarm(payload: schemas.DiveraWebhookPayload) -> bool:
        """
        Process a polled alarm from Divera.

        Returns True if the alarm was new, False if duplicate.
        """
        async with async_session_maker() as db:
            try:
                # Check for duplicate
                existing = await divera_crud.get_divera_emergency_by_divera_id(db, payload.id)
                if existing:
                    return False  # Duplicate, skip

                # Create new emergency
                emergency = await divera_crud.create_divera_emergency(db, payload)

                logger.info(
                    f"Divera poll: new emergency ID {emergency.id}, "
                    f"Divera ID {emergency.divera_id}, Title: {emergency.title}"
                )

                # Auto-attach to the newest active event with the flag on, then
                # broadcast (pool toast + board update) — same as the webhook path.
                incident = await try_auto_attach(db, emergency)
                await broadcast_emergency_received(
                    schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode="json"),
                    schemas.IncidentResponse.model_validate(incident).model_dump(mode="json") if incident else None,
                    source="poll",  # Indicate this came from polling, not webhook
                )

                return True  # New alarm processed

            except Exception as e:
                logger.error(f"Error processing polled alarm {payload.id}: {e}")
                return False

    # Set the callback
    set_divera_poll_callback(on_polled_alarm)

    # Log configuration status
    if settings.divera_access_key:
        logger.info(
            f"Divera polling configured (interval: {settings.divera_poll_interval_seconds}s, "
            f"will start when users connect)"
        )
    else:
        logger.info("Divera polling disabled (no DIVERA_ACCESS_KEY configured)")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan events."""
    logger.info("Starting application...")

    # Schema is managed by Alembic ONLY (start.sh / start-dev.sh run
    # `alembic upgrade head` before boot). A create_all here would silently
    # materialize tables for models that lack a migration — the later real
    # migration then fails with DuplicateTable and the boot crash-loops.

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

    # Configure Divera polling callback
    logger.info("Configuring Divera polling...")
    try:
        await _setup_divera_polling()
    except Exception as e:
        logger.warning(f"Divera polling setup failed: {e}")

    # Start token blocklist cleanup task
    logger.info("Starting token blocklist cleanup...")
    try:
        await token_blocklist.start_cleanup_task()
    except Exception as e:
        logger.warning(f"Token blocklist cleanup task failed to start: {e}")

    # Start demo reset scheduler if in demo mode
    if settings.demo_mode:
        logger.info("Starting demo reset scheduler...")
        try:
            start_demo_reset_scheduler()
        except Exception as e:
            logger.warning(f"Demo reset scheduler failed to start: {e}")

    # Start audit log cleanup scheduler (demo and production)
    logger.info("Starting audit cleanup scheduler...")
    try:
        start_audit_cleanup_scheduler()
    except Exception as e:
        logger.warning(f"Audit cleanup scheduler failed to start: {e}")

    # Start training auto-generation monitor (idle unless the setting is on;
    # training features are unavailable in demo mode, so skip it there)
    if not settings.demo_mode:
        logger.info("Starting training auto-generation task...")
        try:
            from .services.training_autogen_task import training_autogen_task

            await training_autogen_task.start()
        except Exception as e:
            logger.warning(f"Training auto-generation task failed to start: {e}")

    # Start fallback auto-print monitor (idle unless fallback.auto_print_enabled;
    # pointless in demo mode — there is no printer)
    if not settings.demo_mode:
        logger.info("Starting fallback auto-print task...")
        try:
            from .background.fallback_print import fallback_print_task

            await fallback_print_task.start()
        except Exception as e:
            logger.warning(f"Fallback auto-print task failed to start: {e}")

    if settings.is_production and not settings.print_agent_token:
        logger.warning(
            "PRINT_AGENT_TOKEN is not set in production - print agent endpoints "
            "(/api/print/config/, jobs/pending/, claim/, complete/) are unauthenticated"
        )

    logger.info("Application startup complete")
    yield

    # Shutdown: Stop fallback auto-print task
    if not settings.demo_mode:
        logger.info("Stopping fallback auto-print task...")
        try:
            from .background.fallback_print import fallback_print_task

            await fallback_print_task.stop()
        except Exception as e:
            logger.warning(f"Fallback auto-print task shutdown failed: {e}")

    # Shutdown: Stop training auto-generation task
    if not settings.demo_mode:
        logger.info("Stopping training auto-generation task...")
        try:
            from .services.training_autogen_task import training_autogen_task

            await training_autogen_task.stop()
        except Exception as e:
            logger.warning(f"Training auto-generation task shutdown failed: {e}")

    # Shutdown: Stop audit cleanup scheduler
    logger.info("Stopping audit cleanup scheduler...")
    try:
        stop_audit_cleanup_scheduler()
    except Exception as e:
        logger.warning(f"Audit cleanup scheduler shutdown failed: {e}")

    # Shutdown: Stop demo reset scheduler
    if settings.demo_mode:
        logger.info("Stopping demo reset scheduler...")
        try:
            stop_demo_reset_scheduler()
        except Exception as e:
            logger.warning(f"Demo reset scheduler shutdown failed: {e}")

    # Shutdown: Stop token blocklist cleanup
    logger.info("Stopping token blocklist cleanup...")
    try:
        await token_blocklist.stop_cleanup_task()
    except Exception as e:
        logger.warning(f"Token blocklist cleanup shutdown failed: {e}")

    # Shutdown: Stop Divera polling
    logger.info("Stopping Divera polling...")
    try:
        from .services.divera_poller import divera_poller

        await divera_poller.stop_polling()
    except Exception as e:
        logger.debug(f"Divera polling shutdown: {e}")

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
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Add rate limiter state and exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log unhandled exceptions with traceback + request ID, return a generic 500.

    Note: this response is produced by ServerErrorMiddleware, outside the CORS
    middleware, so it lacks CORS headers — browsers surface it as a network
    error. That's acceptable; the frontend already shows a connection toast.
    """
    request_id = get_request_id() or request.scope.get("state", {}).get("request_id")
    # Re-set the ContextVar (already reset by the middleware's finally) so the
    # ERROR record below carries the request ID via RequestIdFilter
    token = request_id_var.set(request_id)
    try:
        logger.error("Unhandled exception on %s %s", request.method, request.url.path, exc_info=exc)
    finally:
        request_id_var.reset(token)
    return JSONResponse(
        status_code=500,
        content={"detail": "Interner Serverfehler", "request_id": request_id},
    )


app.add_exception_handler(Exception, unhandled_exception_handler)


# CORS middleware with explicit domain whitelist
def get_cors_origins() -> list[str]:
    """
    Get CORS origins using explicit whitelist instead of wildcards.

    Security: Using explicit domains instead of wildcards to prevent
    malicious Railway deployments from accessing the API.
    """
    origins = list(settings.cors_origins)

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

# Add request-ID middleware last so it runs first (outermost) and the
# audit/rate-limit middlewares' logs carry the request ID
app.add_middleware(RequestIDMiddleware)

# Rate limiting is handled by @limiter.limit() decorators on routes
# + rate_limit_exceeded_handler for 429 responses. No middleware needed.

# Include routers
app.include_router(health_router)  # No prefix - available at /health
app.include_router(admin_router, prefix=settings.api_v1_prefix)
app.include_router(alarms_router, prefix=settings.api_v1_prefix)
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
app.include_router(print_router, prefix=settings.api_v1_prefix)
app.include_router(vehicles_router, prefix=settings.api_v1_prefix)
app.include_router(materials_router, prefix=settings.api_v1_prefix)
app.include_router(material_groups_router, prefix=settings.api_v1_prefix)
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
app.include_router(users_router, prefix=settings.api_v1_prefix)
app.include_router(viewer_router, prefix=settings.api_v1_prefix)
app.include_router(intake_router, prefix=settings.api_v1_prefix)


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"message": f"{settings.project_name} - FastAPI Backend"}


# Mount Socket.IO at /socket.io/ path
# This preserves the FastAPI app and its middleware for regular HTTP requests
app.mount("/socket.io", socketio.ASGIApp(socket_server, other_asgi_app=None))
