"""Health check endpoint."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import audit_engine, engine, get_db
from ..websocket_manager import ws_manager

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
    """
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

    return health_status
