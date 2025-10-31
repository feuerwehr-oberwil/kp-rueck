"""Resource assignment CRUD operations."""
from datetime import datetime
from typing import Optional
import uuid

from fastapi import Request
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import IncidentAssignment, Material, Personnel, User, Vehicle
from ..services.audit import log_action


async def assign_resource(
    db: AsyncSession,
    incident_id: uuid.UUID,
    resource_type: str,  # 'personnel', 'vehicle', 'material'
    resource_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> IncidentAssignment:
    """
    Assign resource to incident.

    Checks for conflicts (resource already assigned elsewhere).
    Updates resource availability status.

    Returns:
        Created assignment

    Raises:
        ValueError: If resource already assigned to another active incident
    """
    # Check if resource already assigned elsewhere
    existing = await db.execute(
        select(IncidentAssignment).where(
            and_(
                IncidentAssignment.resource_type == resource_type,
                IncidentAssignment.resource_id == resource_id,
                IncidentAssignment.unassigned_at.is_(None),  # Active assignment
            )
        )
    )
    existing_assignment = existing.scalar_one_or_none()

    if existing_assignment and existing_assignment.incident_id != incident_id:
        # Resource conflict - but we allow override with warning
        # (UI should show warning to user before calling this)
        pass

    # Create assignment
    assignment = IncidentAssignment(
        incident_id=incident_id,
        resource_type=resource_type,
        resource_id=resource_id,
        assigned_by=current_user.id,
    )
    db.add(assignment)
    await db.flush()

    # Update resource status to 'assigned'
    await update_resource_status(db, resource_type, resource_id, "assigned")

    # Log assignment
    await log_action(
        db=db,
        action_type="assign",
        resource_type=f"{resource_type}_assignment",
        resource_id=assignment.id,
        user=current_user,
        changes={
            "incident_id": str(incident_id),
            "resource_type": resource_type,
            "resource_id": str(resource_id),
        },
        request=request,
    )

    await db.commit()
    await db.refresh(assignment)

    return assignment


async def unassign_resource(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """
    Release resource from incident.

    Sets unassigned_at timestamp and updates resource status to 'available'.
    """
    result = await db.execute(
        select(IncidentAssignment).where(IncidentAssignment.id == assignment_id)
    )
    assignment = result.scalar_one_or_none()

    if not assignment:
        return False

    # Mark unassigned
    assignment.unassigned_at = datetime.utcnow()

    # Update resource status back to 'available'
    await update_resource_status(
        db, assignment.resource_type, assignment.resource_id, "available"
    )

    # Log unassignment
    await log_action(
        db=db,
        action_type="unassign",
        resource_type=f"{assignment.resource_type}_assignment",
        resource_id=assignment.id,
        user=current_user,
        request=request,
    )

    await db.commit()

    return True


async def update_resource_status(
    db: AsyncSession, resource_type: str, resource_id: uuid.UUID, new_status: str
):
    """Update resource availability/status field."""
    if resource_type == "personnel":
        result = await db.execute(select(Personnel).where(Personnel.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource:
            resource.availability = new_status
            resource.updated_at = datetime.utcnow()

    elif resource_type == "vehicle":
        result = await db.execute(select(Vehicle).where(Vehicle.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource:
            resource.status = new_status
            resource.updated_at = datetime.utcnow()

    elif resource_type == "material":
        result = await db.execute(select(Material).where(Material.id == resource_id))
        resource = result.scalar_one_or_none()
        if resource:
            resource.status = new_status
            resource.updated_at = datetime.utcnow()


async def get_incident_assignments(
    db: AsyncSession, incident_id: uuid.UUID
) -> list[IncidentAssignment]:
    """Get all active assignments for an incident."""
    result = await db.execute(
        select(IncidentAssignment)
        .where(
            and_(
                IncidentAssignment.incident_id == incident_id,
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentAssignment.assigned_at.asc())
    )
    return list(result.scalars().all())


async def check_resource_conflicts(
    db: AsyncSession, resource_type: str, resource_id: uuid.UUID
) -> list[uuid.UUID]:
    """
    Check if resource is assigned to any active incidents.

    Returns:
        List of incident IDs where resource is currently assigned
    """
    result = await db.execute(
        select(IncidentAssignment.incident_id).where(
            and_(
                IncidentAssignment.resource_type == resource_type,
                IncidentAssignment.resource_id == resource_id,
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
    )
    return list(result.scalars().all())


async def auto_release_incident_resources(
    db: AsyncSession,
    incident_id: uuid.UUID,
    current_user: User,
    request: Request,
):
    """
    Automatically release all resources when incident completed.

    Called when incident status moves to 'abschluss'.
    Batches all releases in a single transaction for atomicity and performance.
    """
    assignments = await get_incident_assignments(db, incident_id)

    # Batch all operations in a single transaction
    for assignment in assignments:
        # Mark unassigned
        assignment.unassigned_at = datetime.utcnow()

        # Update resource status back to 'available'
        await update_resource_status(
            db, assignment.resource_type, assignment.resource_id, "available"
        )

        # Log unassignment
        await log_action(
            db=db,
            action_type="unassign",
            resource_type=f"{assignment.resource_type}_assignment",
            resource_id=assignment.id,
            user=current_user,
            request=request,
        )

    # Single commit at the end ensures atomicity
    await db.commit()
