"""Health check and demo status endpoints."""

import logging
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentAdmin, CurrentEditor
from ..config import settings
from ..database import audit_engine, engine, get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Event
from ..websocket_manager import ws_manager

DEMO_SANDBOX_PREFIX = "Demo-Lage #"
DEMO_SANDBOX_MAX = 30

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


def _get_pool_stats(eng) -> dict:
    """Get connection pool statistics for an engine."""
    try:
        pool = eng.pool
        return {
            "size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception:
        return {"error": "unable to retrieve pool stats"}


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """
    Simple health check endpoint for load balancers.

    Returns:
        - status: "healthy" if database is reachable

    Raises:
        503: If database is unreachable
    """
    try:
        # Test database connection
        await db.execute(text("SELECT 1"))
        return {"status": "healthy"}
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection failed",
        )


@router.get("/health/detailed")
async def detailed_health_check(db: AsyncSession = Depends(get_db)):
    """
    Detailed health check with component status.

    Returns comprehensive health information for monitoring.
    Only available in non-production environments.
    """
    if settings.is_production:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    health_status = {
        "status": "healthy",
        "components": {},
    }

    # Check database
    try:
        await db.execute(text("SELECT 1"))
        health_status["components"]["database"] = {
            "status": "healthy",
            "pool": _get_pool_stats(engine),
        }
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["components"]["database"] = {
            "status": "unhealthy",
            "error": str(e),
        }

    # Check audit database pool
    health_status["components"]["audit_pool"] = {
        "status": "healthy",
        "pool": _get_pool_stats(audit_engine),
    }

    # Check WebSocket manager
    try:
        ws_status = {
            "status": "healthy",
            "connections": ws_manager.get_connection_count(),
            "rooms": {room: ws_manager.get_room_count(room) for room in ws_manager.active_connections.keys()},
        }
        health_status["components"]["websocket"] = ws_status
    except Exception as e:
        health_status["components"]["websocket"] = {
            "status": "unhealthy",
            "error": str(e),
        }

    # Check sync scheduler
    try:
        from ..background.sync_scheduler import _shutting_down, scheduler

        if scheduler:
            health_status["components"]["sync_scheduler"] = {
                "status": "healthy" if scheduler.running else "stopped",
                "running": scheduler.running,
                "shutting_down": _shutting_down,
                "jobs": len(scheduler.get_jobs()),
            }
        else:
            health_status["components"]["sync_scheduler"] = {
                "status": "not_initialized",
            }
    except Exception as e:
        health_status["components"]["sync_scheduler"] = {
            "status": "unknown",
            "error": str(e),
        }

    # Check audit cleanup scheduler
    try:
        from ..background.audit_cleanup import get_effective_retention_days
        from ..background.audit_cleanup import scheduler as audit_scheduler

        if audit_scheduler:
            health_status["components"]["audit_cleanup"] = {
                "status": "healthy" if audit_scheduler.running else "stopped",
                "running": audit_scheduler.running,
                "retention_days": get_effective_retention_days(),
            }
        else:
            health_status["components"]["audit_cleanup"] = {
                "status": "not_initialized",
                "running": False,
                "retention_days": get_effective_retention_days(),
            }
    except Exception as e:
        health_status["components"]["audit_cleanup"] = {
            "status": "unknown",
            "error": str(e),
        }

    return health_status


@router.get("/api/demo/status")
async def demo_status():
    """
    Get demo mode status and next reset time.

    Returns demo: false if not in demo mode.
    """
    if not settings.demo_mode:
        return {"demo": False}

    from ..background.demo_reset import get_next_reset_time

    next_reset = get_next_reset_time()
    now = datetime.now()

    seconds_until_reset = max(0, int((next_reset - now).total_seconds())) if next_reset else 0

    return {
        "demo": True,
        "next_reset": next_reset.isoformat() if next_reset else None,
        "seconds_until_reset": seconds_until_reset,
        "reset_interval_hours": settings.demo_reset_hours,
    }


@router.post("/api/demo/sandbox")
@limiter.limit(RateLimits.DEMO_SANDBOX)
async def create_demo_sandbox(
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Create a fresh per-visitor sandbox event with the demo scenario.

    Each demo visitor gets their own board so simultaneous visitors don't
    fight over the same cards. Master resources (personnel/vehicles/materials)
    stay shared. At the cap, returns the oldest sandbox instead (graceful
    degradation back to shared-board behavior — never an error). Sandboxes
    are garbage-collected by the periodic demo reset.
    """
    if not settings.demo_mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    sandbox_filter = Event.name.startswith(DEMO_SANDBOX_PREFIX) & Event.archived_at.is_(None)

    result = await db.execute(select(func.count(Event.id)).where(sandbox_filter))
    sandbox_count = result.scalar() or 0

    if sandbox_count >= DEMO_SANDBOX_MAX:
        result = await db.execute(select(Event).where(sandbox_filter).order_by(Event.created_at).limit(1))
        oldest = result.scalar_one()
        return {"event_id": str(oldest.id), "name": oldest.name, "reused": True}

    from ..seed_demo import seed_demo_event_content

    event = Event(name=f"{DEMO_SANDBOX_PREFIX}{secrets.token_hex(2)}", training_flag=False)
    db.add(event)
    await db.flush()
    await seed_demo_event_content(db, event)
    await db.commit()

    logger.info(f"Created demo sandbox event {event.id} ({event.name})")
    return {"event_id": str(event.id), "name": event.name, "reused": False}


@router.post("/api/demo/reset")
@limiter.limit(RateLimits.DEMO_RESET)
async def demo_reset(request: Request, current_user: CurrentAdmin):
    """Manually trigger a demo reset. Only available in demo mode, admin only.

    Requires admin auth: every demo visitor shares the demo-editor account, so
    editor access would let any visitor wipe and reseed every table for
    everyone. Ops access remains possible via the master token.
    """
    if not settings.demo_mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    from ..background.demo_reset import _clear_photos, _truncate_all_tables

    try:
        await _truncate_all_tables()
        _clear_photos()

        from ..seed_demo import seed_demo_database

        await seed_demo_database()

        return {"status": "reset_complete"}
    except Exception as e:
        logger.error(f"Demo reset failed: {e}")
        raise HTTPException(status_code=500, detail="Reset failed")
