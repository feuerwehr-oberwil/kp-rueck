"""Audit log query endpoints."""
from datetime import datetime
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..database import get_db
from ..models import AuditLog

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/", response_model=list[schemas.AuditLogEntry])
async def query_audit_log(
    current_user: CurrentEditor,  # Editor-only
    db: AsyncSession = Depends(get_db),
    resource_type: Optional[str] = None,
    resource_id: Optional[uuid.UUID] = None,
    user_id: Optional[uuid.UUID] = None,
    action_type: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: int = Query(default=100, le=1000),
    offset: int = 0,
):
    """
    Query audit log with filters.

    Available filters:
        - resource_type: Filter by resource type (incident, vehicle, etc.)
        - resource_id: Filter by specific resource UUID
        - user_id: Filter by user who performed action
        - action_type: Filter by action type (create, update, etc.)
        - start_date: Filter by timestamp >= start_date
        - end_date: Filter by timestamp <= end_date

    Returns up to 1000 entries (paginated). Returns empty array if no entries found.
    """
    query = select(AuditLog).order_by(AuditLog.timestamp.desc())

    # Apply filters
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)

    if resource_id:
        query = query.where(AuditLog.resource_id == resource_id)

    if user_id:
        query = query.where(AuditLog.user_id == user_id)

    if action_type:
        query = query.where(AuditLog.action_type == action_type)

    if start_date:
        query = query.where(AuditLog.timestamp >= start_date)

    if end_date:
        query = query.where(AuditLog.timestamp <= end_date)

    # Pagination
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    entries = result.scalars().all()

    # Always return a list, even if empty
    return list(entries) if entries else []


@router.get("/resource/{resource_type}/{resource_id}", response_model=list[schemas.AuditLogEntry])
async def get_resource_history(
    resource_type: str,
    resource_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """
    Get complete history for a specific resource.

    Example: Get all changes to incident XYZ
        GET /api/audit/resource/incident/{incident_id}
    """
    result = await db.execute(
        select(AuditLog)
        .where(
            AuditLog.resource_type == resource_type,
            AuditLog.resource_id == resource_id
        )
        .order_by(AuditLog.timestamp.desc())
    )

    return result.scalars().all()
