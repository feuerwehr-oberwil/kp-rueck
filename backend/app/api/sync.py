"""Sync API endpoints for Railway ↔ Local bidirectional sync."""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.models import SyncLog
from app.schemas import SyncDirection, SyncLogResponse, SyncStatus, SyncStatusResponse
from app.services.sync_service import SyncService, create_sync_service

router = APIRouter(prefix="/sync", tags=["sync"])


# Global state for sync operations (in-memory, could be Redis in production)
_is_syncing = False
_last_sync_result: Optional[dict] = None


@router.get("/status", response_model=SyncStatusResponse)
async def get_sync_status(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Get current sync status.

    Returns:
        Current sync status including last sync time, direction, Railway health, and sync state.
    """
    sync_service = await create_sync_service(db)

    # Get last successful sync
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.status == SyncStatus.SUCCESS.value)
        .order_by(SyncLog.completed_at.desc())
        .limit(1)
    )
    last_sync = result.scalar_one_or_none()

    # Check Railway health
    railway_healthy = await sync_service.check_railway_health()

    # Calculate pending records (simplified - could be more sophisticated)
    records_pending = 0
    if last_sync and last_sync.records_synced:
        records_pending = sum(last_sync.records_synced.values())

    # Get last error if any
    last_error = None
    if _last_sync_result and not _last_sync_result.get("success"):
        errors = _last_sync_result.get("errors", [])
        last_error = errors[0] if errors else None

    return SyncStatusResponse(
        last_sync=last_sync.completed_at if last_sync else None,
        direction=SyncDirection(last_sync.sync_direction) if last_sync else None,
        railway_healthy=railway_healthy,
        is_syncing=_is_syncing,
        records_pending=records_pending,
        last_error=last_error
    )


@router.post("/from-railway", response_model=dict)
async def sync_from_railway_endpoint(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger manual sync FROM Railway to Local.

    This pulls the latest changes from Railway production to the local instance.

    Returns:
        Sync result with record counts and any errors.
    """
    global _is_syncing, _last_sync_result

    if _is_syncing:
        raise HTTPException(
            status_code=409,
            detail="Sync operation already in progress"
        )

    _is_syncing = True
    try:
        sync_service = await create_sync_service(db)
        result = await sync_service.sync_from_railway()

        _last_sync_result = {
            "success": result.success,
            "direction": result.direction.value,
            "records_synced": result.records_synced,
            "errors": result.errors,
            "completed_at": result.completed_at.isoformat() if result.completed_at else None
        }

        return _last_sync_result

    finally:
        _is_syncing = False


@router.post("/to-railway", response_model=dict)
async def sync_to_railway_endpoint(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger manual sync TO Railway (recovery mode).

    This pushes local changes to Railway after a Railway outage.
    User must confirm this action in the UI.
    Requires authentication.

    Returns:
        Sync result with record counts and any errors.
    """
    global _is_syncing, _last_sync_result

    if _is_syncing:
        raise HTTPException(
            status_code=409,
            detail="Sync operation already in progress"
        )

    _is_syncing = True
    try:
        sync_service = await create_sync_service(db)
        result = await sync_service.sync_to_railway()

        _last_sync_result = {
            "success": result.success,
            "direction": result.direction.value,
            "records_synced": result.records_synced,
            "errors": result.errors,
            "completed_at": result.completed_at.isoformat() if result.completed_at else None
        }

        return _last_sync_result

    finally:
        _is_syncing = False


@router.post("/trigger-immediate", response_model=dict)
async def trigger_immediate_sync(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger immediate bidirectional sync.

    Called automatically when incidents or events are created,
    even if the time interval hasn't been reached.
    Pulls from Railway and pushes local changes to Railway.
    Requires authentication.

    Returns:
        Sync result with record counts and any errors.
    """
    global _is_syncing, _last_sync_result

    # Don't block if sync is already running - just return current status
    if _is_syncing:
        return {
            "success": False,
            "message": "Sync already in progress",
            "is_syncing": True
        }

    _is_syncing = True
    try:
        sync_service = await create_sync_service(db)

        # Check Railway health
        railway_healthy = await sync_service.check_railway_health()
        if not railway_healthy:
            return {
                "success": False,
                "message": "Railway unavailable, sync skipped",
                "railway_healthy": False
            }

        # Perform bidirectional sync
        results = await sync_service.sync_bidirectional()
        from_railway = results["from_railway"]
        to_railway = results["to_railway"]

        _last_sync_result = {
            "success": from_railway.success and to_railway.success,
            "from_railway": {
                "success": from_railway.success,
                "records_synced": from_railway.records_synced,
                "errors": from_railway.errors,
            },
            "to_railway": {
                "success": to_railway.success,
                "records_synced": to_railway.records_synced,
                "errors": to_railway.errors,
            },
            "completed_at": to_railway.completed_at.isoformat() if to_railway.completed_at else None
        }

        return _last_sync_result

    finally:
        _is_syncing = False


@router.get("/logs", response_model=list[SyncLogResponse])
@router.get("/history", response_model=list[SyncLogResponse])  # Alias for frontend compatibility
async def get_sync_logs(
    current_user: CurrentUser,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """
    Get recent sync operation logs.
    Requires authentication.

    Args:
        limit: Maximum number of logs to return (default 20).

    Returns:
        List of sync log entries, most recent first.
    """
    result = await db.execute(
        select(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()

    return [
        SyncLogResponse(
            id=log.id,
            sync_direction=SyncDirection(log.sync_direction),
            started_at=log.started_at,
            completed_at=log.completed_at,
            status=SyncStatus(log.status),
            records_synced=log.records_synced,
            errors=log.errors
        )
        for log in logs
    ]


@router.get("/config", response_model=dict)
async def get_sync_config(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Get sync configuration.
    Requires authentication.

    Returns:
        Current sync configuration including interval, auto-sync settings, connection details, and production flag.
    """
    from app.config import settings
    from app.services.settings import get_setting_value

    sync_interval_minutes = await get_setting_value(db, "sync_interval_minutes", "2")
    auto_sync_on_create = await get_setting_value(db, "auto_sync_on_create", "true")
    railway_database_url = await get_setting_value(db, "railway_database_url", "")
    sync_conflict_buffer_seconds = await get_setting_value(db, "sync_conflict_buffer_seconds", "5")

    return {
        "sync_interval_minutes": int(sync_interval_minutes),
        "auto_sync_on_create": auto_sync_on_create.lower() == "true",
        "railway_database_url": railway_database_url,
        "sync_conflict_buffer_seconds": int(sync_conflict_buffer_seconds),
        "is_production": settings.is_production  # True if running on Railway
    }


@router.post("/bidirectional", response_model=dict)
async def sync_bidirectional_endpoint(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger manual bidirectional sync: Railway ↔ Local.

    This pulls changes from Railway to Local, then pushes Local changes to Railway.
    Ensures both databases are fully synchronized.

    Returns:
        Sync results for both directions with record counts and any errors.
    """
    global _is_syncing, _last_sync_result

    if _is_syncing:
        raise HTTPException(
            status_code=409,
            detail="Sync operation already in progress"
        )

    _is_syncing = True
    try:
        sync_service = await create_sync_service(db)

        # Check Railway health
        if not await sync_service.check_railway_health():
            raise HTTPException(
                status_code=503,
                detail="Railway database is unreachable"
            )

        # Perform bidirectional sync
        results = await sync_service.sync_bidirectional()
        from_railway = results["from_railway"]
        to_railway = results["to_railway"]

        response = {
            "success": from_railway.success and to_railway.success,
            "from_railway": {
                "success": from_railway.success,
                "records_synced": from_railway.records_synced,
                "errors": from_railway.errors,
                "completed_at": from_railway.completed_at.isoformat() if from_railway.completed_at else None
            },
            "to_railway": {
                "success": to_railway.success,
                "records_synced": to_railway.records_synced,
                "errors": to_railway.errors,
                "completed_at": to_railway.completed_at.isoformat() if to_railway.completed_at else None
            }
        }

        _last_sync_result = response
        return response

    finally:
        _is_syncing = False


@router.put("/config", response_model=dict)
async def update_sync_config(
    config: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Update sync configuration.

    Args:
        config: New configuration with sync settings (interval, auto-sync, Railway URL, timeouts).

    Returns:
        Updated configuration.
    """
    from app.services.settings import update_setting

    if "sync_interval_minutes" in config:
        await update_setting(
            db,
            key="sync_interval_minutes",
            value=str(config["sync_interval_minutes"]),
            user_id=current_user.id
        )

    if "auto_sync_on_create" in config:
        await update_setting(
            db,
            key="auto_sync_on_create",
            value="true" if config["auto_sync_on_create"] else "false",
            user_id=current_user.id
        )

    if "railway_database_url" in config:
        await update_setting(
            db,
            key="railway_database_url",
            value=config["railway_database_url"],
            user_id=current_user.id
        )

    if "sync_conflict_buffer_seconds" in config:
        await update_setting(
            db,
            key="sync_conflict_buffer_seconds",
            value=str(config["sync_conflict_buffer_seconds"]),
            user_id=current_user.id
        )

    await db.commit()

    return await get_sync_config(current_user, db)


# Helper endpoints for delta sync (used by sync_service.py)
@router.get("/delta/{table_name}")
async def get_delta_for_table(
    table_name: str,
    current_user: CurrentUser,
    updated_since: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get delta (changed records) for a specific table.

    Args:
        table_name: Name of the table (incidents, personnel, vehicles, materials, settings).
        updated_since: ISO timestamp to filter records updated after this time.

    Returns:
        List of records changed since the given timestamp.
    """
    from app.services.sync_service import SyncService

    if table_name not in SyncService.SYNCABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid table name: {table_name}")

    model_class = SyncService.SYNCABLE_MODELS[table_name]

    # Build query
    query = select(model_class)
    if updated_since:
        try:
            since_dt = datetime.fromisoformat(updated_since)
            query = query.where(model_class.updated_at > since_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid timestamp format")

    # Execute query
    result = await db.execute(query)
    records = result.scalars().all()

    # Convert to dict
    records_data = [
        {
            column.name: (
                getattr(record, column.name).isoformat()
                if isinstance(getattr(record, column.name), datetime)
                else str(getattr(record, column.name))
                if isinstance(getattr(record, column.name), UUID)
                else getattr(record, column.name)
            )
            for column in model_class.__table__.columns
        }
        for record in records
    ]

    return records_data


@router.post("/apply/{table_name}")
async def apply_delta_for_table(
    table_name: str,
    records: list[dict],
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Apply delta (changed records) to a specific table.

    Used by Local when pushing changes to Railway.

    Args:
        table_name: Name of the table.
        records: List of records to apply.

    Returns:
        Count of records applied.
    """
    from app.schemas import Delta
    from app.services.sync_service import SyncService

    if table_name not in SyncService.SYNCABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid table name: {table_name}")

    # Create delta with just this table's records
    delta = Delta()
    setattr(delta, table_name, records)

    # Apply delta
    sync_service = await create_sync_service(db)
    applied_counts = await sync_service.apply_delta(delta)

    return {"count": applied_counts.get(table_name, 0)}
