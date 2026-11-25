"""FastAPI application entry point."""

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import socketio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, Request
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
from .api.auftrag_templates import router as auftrag_templates_router
from .api.auth import router as auth_router
from .api.diag import router as diag_router
from .api.divera import router as divera_router
from .api.events import router as events_router
from .api.exports import router as exports_router
from .api.feld import router as feld_router
from .api.firehub import router as firehub_router
from .api.geocoding import router as geocoding_router
from .api.groups import router as groups_router
from .api.health import router as health_router
from .api.incidents import router as incidents_router
from .api.intake import router as intake_router
from .api.integrations import router as integrations_router
from .api.journal import router as journal_router
from .api.materials import groups_router as material_groups_router
from .api.materials import router as materials_router
from .api.notifications import router as notifications_router
from .api.personnel import router as personnel_router
from .api.personnel_checkin import router as personnel_checkin_router
from .api.planned_assignments import router as planned_assignments_router
from .api.print import router as print_router
from .api.reko import photos_router
from .api.reko import router as reko_router
from .api.settings import router as settings_router
from .api.setup import announce_setup_token_if_unclaimed
from .api.setup import router as setup_router
from .api.special_functions import router as special_functions_router
from .api.standby import router as standby_router
from .api.stats import router as stats_router
from .api.traccar import router as traccar_router
from .api.training import router as training_router
from .api.training_gps_sim import router as training_gps_sim_router
from .api.training_regie import router as training_regie_router
from .api.training_simulate import router as training_simulate_router
from .api.users import router as users_router
from .api.vehicles import router as vehicles_router
from .api.viewer import router as viewer_router
from .api.weather import router as weather_router
from .auth.config import auth_settings
from .auth.local_autologin import verify_account_on_boot as verify_local_autologin_account
from .background.jobs import lifespan_jobs, start_jobs, stop_jobs
from .config import settings
from .database import async_session_maker, commit_request, engine
from .ensure_accounts import ensure_dev_bypass_user
from .environment import ROLE_STANDBY, blocked_domains, deployment_role
from .middleware.audit import AuditMiddleware
from .middleware.body_limit import BodyLimitMiddleware
from .middleware.rate_limit import limiter, rate_limit_exceeded_handler
from .middleware.request_id import RequestIDMiddleware, get_request_id, request_id_var
from .middleware.security_headers import SecurityHeadersMiddleware
from .middleware.standby_readonly import StandbyReadOnlyMiddleware
from .services.alerting import AlarmBlockedError
from .services.journal_backfill import backfill_on_boot
from .services.settings import initialize_default_settings
from .utils.error_codes import CodedHTTPException, coded_http_exception_handler
from .websocket_manager import sio as socket_server

# Read the deployment role once, here, at import – the same place and the same moment a missing
# or weak SECRET_KEY aborts (`config.py`). A DEPLOYMENT_ROLE the build cannot read raises here
# and the process never starts, so no request can ever be served by an instance whose idea of
# what it may do to the outside world is a guess. Unset is fine and silent: that is production.
deployment_role()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan events."""
    logger.info("Starting application...")

    # Say out loud what this instance is allowed to do to the outside world. An unreadable role
    # never gets this far – it is refused at import, below.
    blocked = blocked_domains()
    if blocked:
        logger.warning("Deployment role %r blocks: %s", deployment_role(), ", ".join(blocked))
    else:
        logger.info("Deployment role: %s", deployment_role())
    # A standby box mirrors the hosted board (app/standby.py): nothing here may WRITE into the
    # mirrored tables – the boot steps below check it, the jobs carry it per row (background/jobs.py).
    standby = deployment_role() == ROLE_STANDBY

    # Schema is managed by Alembic ONLY (start.sh / start-dev.sh run
    # `alembic upgrade head` before boot). A create_all here would silently
    # materialize tables for models that lack a migration – the later real
    # migration then fails with DuplicateTable and the boot crash-loops.

    # Initialize default settings
    logger.info("Initializing default settings...")
    async with async_session_maker() as db:
        try:
            await initialize_default_settings(db)
            await db.commit()
            logger.info("Default settings initialized")
        except Exception as e:
            logger.warning(f"Default settings initialization failed: {e}")

    # Einsatztagebuch: fill in what the log does not hold yet — on the first boot of this
    # version the whole history, afterwards whatever an old instance wrote during a cutover
    # or the flush hook had to skip. Idempotent; never stops the boot.
    if not standby:
        await backfill_on_boot(engine)

    # Development auth bypass fabricates its "dev-user" in memory, with a fixed
    # id and no row behind it. Anything that records WHO did something –
    # assignments (`assigned_by`), dismissals (`dismissed_by`), the audit log –
    # foreign-keys to users.id, so without a matching row every such write dies
    # with a ForeignKeyViolation and a 500 that says nothing useful. The normal
    # seed happens to create a `dev-user`; the demo seed does not, so a locally
    # demo-seeded database used to break the moment anyone touched the board.
    # `is_auth_bypassed` is force-disabled in production, so this cannot run there.
    if auth_settings.is_auth_bypassed:
        async with async_session_maker() as db:
            try:
                await ensure_dev_bypass_user(db)
            except Exception as e:
                logger.warning(f"Could not ensure dev bypass user: {e}")

    # Passwordless local login: a misconfigured LOCAL_AUTOLOGIN_USER stops the boot. No
    # try/except on purpose – the three ways to get it wrong (no such account, a deactivated
    # one, or an admin) are all things the operator has to see now, in the terminal they just
    # started the stack from, rather than discover as a login form the station shortcut never
    # gets past. After start.sh's seed, which is what decides whether the account exists at all.
    async with async_session_maker() as db:
        await verify_local_autologin_account(db)

    # An unclaimed, internet-facing board prints its Einrichtungscode now – the operator reads
    # the boot log right after starting the stack (auth/setup_token.py). After start.sh's seed,
    # which is what decides whether any account exists. A failure here must not stop the boot: the
    # code is then created and printed on the first claim attempt instead.
    async with async_session_maker() as db:
        try:
            await announce_setup_token_if_unclaimed(db)
        except Exception as e:
            logger.warning(f"Could not check for an unclaimed board: {e}")

    if settings.is_production and not settings.print_agent_token:
        logger.warning(
            "PRINT_AGENT_TOKEN is not set - printing is disabled: the four /api/print/* "
            "endpoints (config/, jobs/pending/, claim/, complete/) answer 403. Set it in .env "
            "if this station uses the thermal printer."
        )

    # Read the cookie decision once, here, so it lands in the BOOT log. It is a property
    # evaluated lazily, and its only other readers are the four places a cookie is actually
    # set – so the "serving cookies without Secure" warning used to appear on the first login
    # and on every login after it, never at startup. The docs point the operator at the boot
    # log to confirm the inference ran, and this is what makes that true. Logging the secure
    # case too, because "which did it pick?" is the actual question being asked.
    logger.info(
        "Login cookies: Secure=%s (from %s)",
        auth_settings.cookie_secure,
        "AUTH_COOKIE_SECURE" if auth_settings.COOKIE_SECURE is not None else "CORS_ORIGINS",
    )

    # Every background job, gated per row on standby / demo (background/jobs.py).
    jobs = await start_jobs(lifespan_jobs(AsyncIOScheduler()), standby=standby, demo=settings.demo_mode)

    logger.info("Application startup complete")
    yield

    await stop_jobs(jobs)

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
    # The request commits – before the response is sent (see the rule above `get_db`).
    dependencies=[Depends(commit_request, scope="function")],
)

# Add rate limiter state and exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


async def alarm_blocked_handler(request: Request, exc: Exception) -> JSONResponse:
    """A deployment role refused to alert. 403, with the German reason, in ONE place.

    Registered here rather than caught per route so that every present and future caller of
    the AlarmProvider seam is covered without growing its own check.
    """
    logger.warning("Outbound alerting refused on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=403, content={"detail": str(exc)})


app.add_exception_handler(AlarmBlockedError, alarm_blocked_handler)
# `/feld` errors carry a stable code beside the German detail (`utils/error_codes.py`).
# Looked up by class, so it wins over FastAPI's HTTPException handler for this subclass.
app.add_exception_handler(CodedHTTPException, coded_http_exception_handler)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log unhandled exceptions with traceback + request ID, return a generic 500.

    Note: this response is produced by ServerErrorMiddleware, outside the CORS
    middleware, so it lacks CORS headers – browsers surface it as a network
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


# NOTE: CORS middleware must be added BEFORE wrapping with Socket.IO
# This ensures it applies to both WebSocket and regular HTTP requests
# Security: explicit origins only, the same list Socket.IO accepts (`Settings.allowed_origins`)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Response headers the BROWSER is allowed to hand to JavaScript. Without this a
    # cross-origin `headers.get('X-Total-Count')` returns null even though the server sent it
    # – CORS hides every non-safelisted response header by default. The reference deployment
    # is same-origin (Caddy fronts both), so this only bites a split-origin setup, which is
    # exactly what a developer runs locally: the board silently stopped being able to tell a
    # truncated incident list from a complete one, with no error anywhere.
    expose_headers=["X-Total-Count"],
)

# Add audit middleware
app.add_middleware(AuditMiddleware)

# A standby mirror is look-only until an Ereignis is taken offline (app/standby.py). Added
# after the audit middleware, so it runs BEFORE it: a refused write is not audited as one.
app.add_middleware(StandbyReadOnlyMiddleware)

# Add security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

# The backend's own body ceiling: on Railway it is a public origin of its own, with neither
# Caddy nor the Next proxy in front (app/middleware/body_limit.py).
app.add_middleware(BodyLimitMiddleware)

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
app.include_router(auftrag_templates_router, prefix=settings.api_v1_prefix)
app.include_router(diag_router, prefix=settings.api_v1_prefix)
app.include_router(divera_router, prefix=settings.api_v1_prefix)
app.include_router(events_router, prefix=settings.api_v1_prefix)
app.include_router(journal_router, prefix=settings.api_v1_prefix)
app.include_router(firehub_router, prefix=settings.api_v1_prefix)
app.include_router(geocoding_router, prefix=settings.api_v1_prefix)
app.include_router(exports_router, prefix=settings.api_v1_prefix)
app.include_router(incidents_router, prefix=settings.api_v1_prefix)
app.include_router(groups_router, prefix=settings.api_v1_prefix)
app.include_router(integrations_router, prefix=settings.api_v1_prefix)
app.include_router(assignments_router, prefix=settings.api_v1_prefix)
app.include_router(assignments_bulk_router, prefix=settings.api_v1_prefix)  # Bulk assignments endpoint
app.include_router(planned_assignments_router, prefix=settings.api_v1_prefix)
app.include_router(personnel_router, prefix=settings.api_v1_prefix)
app.include_router(personnel_checkin_router, prefix=settings.api_v1_prefix)
app.include_router(print_router, prefix=settings.api_v1_prefix)
app.include_router(vehicles_router, prefix=settings.api_v1_prefix)
app.include_router(materials_router, prefix=settings.api_v1_prefix)
app.include_router(material_groups_router, prefix=settings.api_v1_prefix)
app.include_router(reko_router, prefix=settings.api_v1_prefix)
app.include_router(feld_router, prefix=settings.api_v1_prefix)
app.include_router(photos_router, prefix=settings.api_v1_prefix)
app.include_router(settings_router, prefix=settings.api_v1_prefix)
app.include_router(setup_router, prefix=settings.api_v1_prefix)  # Unauthenticated by design: first-run claim
app.include_router(special_functions_router, prefix=settings.api_v1_prefix)
app.include_router(standby_router, prefix=settings.api_v1_prefix)
app.include_router(stats_router, prefix=settings.api_v1_prefix)
app.include_router(traccar_router, prefix=settings.api_v1_prefix)
app.include_router(notifications_router, prefix=settings.api_v1_prefix)
app.include_router(training_router, prefix=settings.api_v1_prefix)
app.include_router(training_simulate_router, prefix=settings.api_v1_prefix)
app.include_router(training_gps_sim_router, prefix=settings.api_v1_prefix)
app.include_router(training_regie_router, prefix=settings.api_v1_prefix)
app.include_router(users_router, prefix=settings.api_v1_prefix)
app.include_router(viewer_router, prefix=settings.api_v1_prefix)
app.include_router(weather_router, prefix=settings.api_v1_prefix)
app.include_router(intake_router, prefix=settings.api_v1_prefix)


@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint."""
    return {"message": f"{settings.project_name} - FastAPI Backend"}


# Mount Socket.IO at /socket.io/ path
# This preserves the FastAPI app and its middleware for regular HTTP requests
app.mount("/socket.io", socketio.ASGIApp(socket_server, other_asgi_app=None))
