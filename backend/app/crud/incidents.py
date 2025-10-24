"""Incident CRUD operations."""
from datetime import datetime
from typing import Optional
import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Incident, StatusTransition, User
from ..services.audit import calculate_changes, log_action


async def get_incidents(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    training_only: Optional[bool] = None,
    status: Optional[str] = None,
) -> list[Incident]:
    """
    Get incidents with optional filters.

    Args:
        db: Database session
        skip: Pagination offset
        limit: Max results
        training_only: If True, only training; if False, only live; if None, all
        status: Filter by status

    Returns:
        List of incidents
    """
    query = select(Incident).order_by(Incident.created_at.desc())

    if training_only is not None:
        query = query.where(Incident.training_flag == training_only)

    if status:
        query = query.where(Incident.status == status)

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_incident(db: AsyncSession, incident_id: uuid.UUID) -> Incident | None:
    """Get incident by ID."""
    result = await db.execute(select(Incident).where(Incident.id == incident_id))
    return result.scalar_one_or_none()


async def create_incident(
    db: AsyncSession,
    incident: schemas.IncidentCreate,
    current_user: User,
    request: Request,
) -> Incident:
    """Create new incident with audit logging."""
    db_incident = Incident(
        **incident.model_dump(),
        created_by=current_user.id,
    )

    db.add(db_incident)
    await db.flush()

    # Log creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="incident",
        resource_id=db_incident.id,
        user=current_user,
        changes={"created": incident.model_dump()},
        request=request,
    )

    await db.commit()
    await db.refresh(db_incident)

    return db_incident


async def update_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
    incident_update: schemas.IncidentUpdate,
    current_user: User,
    request: Request,
    expected_updated_at: Optional[datetime] = None,  # For optimistic locking
) -> Incident | None:
    """
    Update incident with optimistic locking and audit logging.

    Args:
        expected_updated_at: Client's last known updated_at (for conflict detection)

    Raises:
        ValueError: If concurrent modification detected
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return None

    # Optimistic locking check
    if expected_updated_at and incident.updated_at != expected_updated_at:
        raise ValueError(
            f"Concurrent modification detected. "
            f"Expected {expected_updated_at}, got {incident.updated_at}"
        )

    # Capture before state
    before_state = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "status": incident.status,
        "location_address": incident.location_address,
        "description": incident.description,
    }

    # Apply updates
    for field, value in incident_update.model_dump(exclude_unset=True).items():
        setattr(incident, field, value)

    incident.updated_at = datetime.utcnow()

    # Capture after state
    after_state = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "status": incident.status,
        "location_address": incident.location_address,
        "description": incident.description,
    }

    # Calculate changes
    changes = calculate_changes(before_state, after_state)

    # Log if changed
    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="incident",
            resource_id=incident.id,
            user=current_user,
            changes=changes,
            request=request,
        )

    await db.commit()
    await db.refresh(incident)

    return incident


async def update_incident_status(
    db: AsyncSession,
    incident_id: uuid.UUID,
    new_status: str,
    current_user: User,
    request: Request,
    notes: Optional[str] = None,
) -> Incident | None:
    """
    Update incident status and create status transition record.

    Used for Kanban drag-and-drop.
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return None

    old_status = incident.status

    # Update status
    incident.status = new_status
    incident.updated_at = datetime.utcnow()

    # Mark completed if moved to abschluss
    if new_status == "abschluss" and not incident.completed_at:
        incident.completed_at = datetime.utcnow()

    # Create status transition record
    transition = StatusTransition(
        incident_id=incident.id,
        from_status=old_status,
        to_status=new_status,
        user_id=current_user.id,
        notes=notes,
    )
    db.add(transition)

    # Log to audit
    await log_action(
        db=db,
        action_type="status_change",
        resource_type="incident",
        resource_id=incident.id,
        user=current_user,
        changes={
            "status": {"before": old_status, "after": new_status},
            "notes": notes,
        },
        request=request,
    )

    await db.commit()
    await db.refresh(incident)

    return incident


async def delete_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """
    Soft delete incident (move to archive).

    Note: For training incidents, this is a hard delete.
    For live incidents, we just mark completed_at.
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return False

    if incident.training_flag:
        # Hard delete training incidents
        await db.delete(incident)
        action = "delete"
    else:
        # Soft delete live incidents (mark archived)
        incident.status = "abschluss"
        incident.completed_at = datetime.utcnow()
        action = "archive"

    await log_action(
        db=db,
        action_type=action,
        resource_type="incident",
        resource_id=incident.id,
        user=current_user,
        request=request,
    )

    await db.commit()
    return True


async def get_incident_status_history(
    db: AsyncSession, incident_id: uuid.UUID
) -> list[StatusTransition]:
    """Get all status transitions for an incident."""
    result = await db.execute(
        select(StatusTransition)
        .where(StatusTransition.incident_id == incident_id)
        .order_by(StatusTransition.timestamp.asc())
    )
    return list(result.scalars().all())
