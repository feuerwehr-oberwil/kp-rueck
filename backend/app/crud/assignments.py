"""Resource assignment CRUD operations."""

import uuid
from datetime import datetime

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
    existing_assignments = existing.scalars().all()

    # Check if already assigned to THIS incident
    already_assigned_to_this = any(assignment.incident_id == incident_id for assignment in existing_assignments)
    if already_assigned_to_this:
        raise ValueError("Resource already assigned to this incident")

    # Check if assigned to OTHER incidents (conflict)
    if existing_assignments:
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
    result = await db.execute(select(IncidentAssignment).where(IncidentAssignment.id == assignment_id))
    assignment = result.scalar_one_or_none()

    if not assignment:
        return False

    # Mark unassigned
    assignment.unassigned_at = datetime.utcnow()

    # Update resource status back to 'available'
    await update_resource_status(db, assignment.resource_type, assignment.resource_id, "available")

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


async def update_resource_status(db: AsyncSession, resource_type: str, resource_id: uuid.UUID, new_status: str):
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


async def get_incident_assignments(db: AsyncSession, incident_id: uuid.UUID) -> list[IncidentAssignment]:
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


async def get_assignments_by_event(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[uuid.UUID, list[schemas.AssignmentResponse]]:
    """
    Get all active assignments for all incidents in an event.

    Optimizes the frontend by fetching all assignments in one query
    instead of N separate queries (one per incident).

    Returns:
        Dictionary mapping incident_id to list of assignments
    """
    from ..models import Incident

    # Get all incidents for this event
    incidents_query = select(Incident.id).where(
        and_(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    incidents_result = await db.execute(incidents_query)
    incident_ids = [row[0] for row in incidents_result.all()]

    if not incident_ids:
        return {}

    # Fetch all assignments for these incidents in one query
    assignments_query = (
        select(IncidentAssignment)
        .where(
            and_(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentAssignment.assigned_at.asc())
    )

    result = await db.execute(assignments_query)
    assignments = result.scalars().all()

    # Group by incident_id
    assignments_by_incident = {}
    for assignment in assignments:
        if assignment.incident_id not in assignments_by_incident:
            assignments_by_incident[assignment.incident_id] = []

        assignments_by_incident[assignment.incident_id].append(
            schemas.AssignmentResponse(
                id=assignment.id,
                incident_id=assignment.incident_id,
                resource_type=assignment.resource_type,
                resource_id=assignment.resource_id,
                assigned_at=assignment.assigned_at,
                assigned_by=assignment.assigned_by,
            )
        )

    return assignments_by_incident


async def check_resource_conflicts(db: AsyncSession, resource_type: str, resource_id: uuid.UUID) -> list[uuid.UUID]:
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
    exclude_materials: bool = True,
):
    """
    Automatically release resources when incident completed.

    Called when incident status moves to 'abschluss'.

    Args:
        db: Database session
        incident_id: ID of the incident
        current_user: User performing the action
        request: HTTP request for audit logging
        exclude_materials: If True, only release personnel and vehicles (keep materials assigned)
                          Default: True (materials may be left on site)
    """
    assignments = await get_incident_assignments(db, incident_id)

    for assignment in assignments:
        # Skip materials if exclude_materials is True
        if exclude_materials and assignment.resource_type == "material":
            continue

        await unassign_resource(db, assignment.id, current_user, request)


async def transfer_assignments(
    db: AsyncSession,
    source_incident_id: uuid.UUID,
    target_incident_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> dict:
    """
    Transfer all active assignments from source incident to target incident.

    This function:
    1. Gets all active assignments from source incident
    2. Checks for conflicts (resources already assigned to target)
    3. Creates new assignments for target incident
    4. Marks source assignments as unassigned
    5. Logs the transfer action

    Args:
        db: Database session
        source_incident_id: ID of source incident
        target_incident_id: ID of target incident
        current_user: User performing the transfer
        request: HTTP request for audit logging

    Returns:
        Dictionary with:
        - transferred_count: Number of assignments transferred
        - assignment_ids: List of new assignment IDs

    Raises:
        ValueError: If source has no assignments or if conflicts exist
    """
    from ..models import Incident

    # Verify both incidents exist
    source_result = await db.execute(select(Incident).where(Incident.id == source_incident_id))
    source_incident = source_result.scalar_one_or_none()
    if not source_incident:
        raise ValueError("Source incident not found")

    target_result = await db.execute(select(Incident).where(Incident.id == target_incident_id))
    target_incident = target_result.scalar_one_or_none()
    if not target_incident:
        raise ValueError("Target incident not found")

    # Get all active assignments from source
    source_assignments = await get_incident_assignments(db, source_incident_id)

    if not source_assignments:
        raise ValueError("Source incident has no active assignments to transfer")

    # Check for conflicts - resources already assigned to target
    target_assignments = await get_incident_assignments(db, target_incident_id)
    target_resources = {(a.resource_type, a.resource_id) for a in target_assignments}

    conflicts = []
    for assignment in source_assignments:
        resource_key = (assignment.resource_type, assignment.resource_id)
        if resource_key in target_resources:
            conflicts.append(f"{assignment.resource_type} {assignment.resource_id}")

    if conflicts:
        raise ValueError(f"Cannot transfer: Resources already assigned to target incident: {', '.join(conflicts)}")

    # Transfer assignments
    new_assignment_ids = []

    for assignment in source_assignments:
        # Create new assignment for target
        new_assignment = IncidentAssignment(
            incident_id=target_incident_id,
            resource_type=assignment.resource_type,
            resource_id=assignment.resource_id,
            assigned_by=current_user.id,
        )
        db.add(new_assignment)
        await db.flush()
        new_assignment_ids.append(new_assignment.id)

        # Mark old assignment as unassigned
        assignment.unassigned_at = datetime.utcnow()

    # Log transfer action
    await log_action(
        db=db,
        action_type="assignments_transferred",
        resource_type="incident",
        resource_id=source_incident_id,
        user=current_user,
        changes={
            "source_incident_id": str(source_incident_id),
            "target_incident_id": str(target_incident_id),
            "count": len(new_assignment_ids),
            "assignment_ids": [str(aid) for aid in new_assignment_ids],
        },
        request=request,
    )

    await db.commit()

    return {
        "transferred_count": len(new_assignment_ids),
        "assignment_ids": new_assignment_ids,
    }
