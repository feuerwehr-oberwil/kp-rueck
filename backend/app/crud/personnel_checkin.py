"""Personnel check-in CRUD operations."""

import uuid
from datetime import datetime

from fastapi import Request
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import EventAttendance, Incident, IncidentAssignment, Personnel, User
from ..services.audit import log_action


async def get_available_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    include_checked_out: bool = True,
) -> list[schemas.PersonnelCheckInResponse]:
    """
    Get personnel eligible for check-in with event-specific attendance status.

    Args:
        db: Database session
        event_id: Event ID to check attendance for
        include_checked_out: If True, returns all available personnel
                           If False, only returns checked-in personnel

    Returns:
        List of personnel with event-specific check-in status
    """
    # Get all available personnel
    query = select(Personnel).where(Personnel.availability != "unavailable").order_by(Personnel.name.asc())

    result = await db.execute(query)
    personnel_list = list(result.scalars().all())

    # Get event-specific attendance records
    attendance_query = select(EventAttendance).where(EventAttendance.event_id == event_id)
    attendance_result = await db.execute(attendance_query)
    attendance_map = {att.personnel_id: att for att in attendance_result.scalars().all()}

    # Get personnel assignment status for this event
    # Check if personnel are assigned to any incident in this event
    assignment_query = (
        select(IncidentAssignment.resource_id)
        .where(
            and_(
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.unassigned_at.is_(None),  # Only active assignments
                IncidentAssignment.incident_id.in_(select(Incident.id).where(Incident.event_id == event_id)),
            )
        )
        .distinct()
    )
    assignment_result = await db.execute(assignment_query)
    assigned_personnel_ids = set(assignment_result.scalars().all())

    # Build response with event-specific check-in status
    response_list = []
    for person in personnel_list:
        attendance = attendance_map.get(person.id)
        checked_in = attendance.checked_in if attendance else False
        is_assigned = person.id in assigned_personnel_ids

        # Filter by checked-in status if requested
        if not include_checked_out and not checked_in:
            continue

        response_list.append(
            schemas.PersonnelCheckInResponse(
                id=person.id,
                name=person.name,
                role=person.role,
                availability=person.availability,
                checked_in=checked_in,
                checked_in_at=attendance.checked_in_at if attendance else None,
                checked_out_at=attendance.checked_out_at if attendance else None,
                is_assigned=is_assigned,
            )
        )

    return response_list


async def check_in_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
) -> schemas.PersonnelCheckInResponse | None:
    """
    Check in a person for a specific event (mark as present on-site).

    Args:
        db: Database session
        event_id: Event ID to check in for
        personnel_id: ID of personnel to check in
        current_user: Optional user performing the action (for audit log)
        request: Optional request object (for audit log)

    Returns:
        Updated personnel with event-specific check-in status, or None if not found

    Raises:
        ValueError: If personnel is unavailable
    """
    # Get personnel record
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    person = result.scalar_one_or_none()

    if not person:
        return None

    # Can't check in if unavailable
    if person.availability == "unavailable":
        raise ValueError("Cannot check in unavailable personnel")

    # Check if assigned to any incident in this event
    assignment_query = (
        select(IncidentAssignment.id)
        .where(
            and_(
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.resource_id == personnel_id,
                IncidentAssignment.unassigned_at.is_(None),
                IncidentAssignment.incident_id.in_(select(Incident.id).where(Incident.event_id == event_id)),
            )
        )
        .limit(1)
    )
    is_assigned_result = await db.execute(assignment_query)
    is_assigned = is_assigned_result.scalar_one_or_none() is not None

    # Get or create event attendance record
    attendance_result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id, EventAttendance.personnel_id == personnel_id
        )
    )
    attendance = attendance_result.scalar_one_or_none()

    now = datetime.utcnow()

    if attendance:
        # Already checked in for this event
        if attendance.checked_in:
            return schemas.PersonnelCheckInResponse(
                id=person.id,
                name=person.name,
                role=person.role,
                availability=person.availability,
                checked_in=True,
                checked_in_at=attendance.checked_in_at,
                checked_out_at=attendance.checked_out_at,
                is_assigned=is_assigned,
            )
        # Update existing record
        attendance.checked_in = True
        attendance.checked_in_at = now
        attendance.updated_at = now
    else:
        # Create new attendance record
        attendance = EventAttendance(
            event_id=event_id,
            personnel_id=personnel_id,
            checked_in=True,
            checked_in_at=now,
        )
        db.add(attendance)

    # Log action
    if current_user and request:
        await log_action(
            db=db,
            action_type="check_in",
            resource_type="personnel",
            resource_id=person.id,
            user=current_user,
            changes={"name": person.name, "event_id": str(event_id), "checked_in": True},
            request=request,
        )

    await db.commit()
    await db.refresh(attendance)

    return schemas.PersonnelCheckInResponse(
        id=person.id,
        name=person.name,
        role=person.role,
        availability=person.availability,
        checked_in=attendance.checked_in,
        checked_in_at=attendance.checked_in_at,
        checked_out_at=attendance.checked_out_at,
        is_assigned=is_assigned,
    )


async def check_out_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
) -> schemas.PersonnelCheckInResponse | None:
    """
    Check out a person from a specific event (mark as left site).

    Args:
        db: Database session
        event_id: Event ID to check out from
        personnel_id: ID of personnel to check out
        current_user: Optional user performing the action (for audit log)
        request: Optional request object (for audit log)

    Returns:
        Updated personnel with event-specific check-in status, or None if not found
    """
    # Get personnel record
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    person = result.scalar_one_or_none()

    if not person:
        return None

    # Check if assigned to any incident in this event
    assignment_query = (
        select(IncidentAssignment.id)
        .where(
            and_(
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.resource_id == personnel_id,
                IncidentAssignment.unassigned_at.is_(None),
                IncidentAssignment.incident_id.in_(select(Incident.id).where(Incident.event_id == event_id)),
            )
        )
        .limit(1)
    )
    is_assigned_result = await db.execute(assignment_query)
    is_assigned = is_assigned_result.scalar_one_or_none() is not None

    # Prevent checkout if assigned to an incident
    if is_assigned:
        raise ValueError("Cannot check out personnel who are assigned to an incident")

    # Get event attendance record
    attendance_result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id, EventAttendance.personnel_id == personnel_id
        )
    )
    attendance = attendance_result.scalar_one_or_none()

    now = datetime.utcnow()

    if attendance:
        # Already checked out for this event
        if not attendance.checked_in:
            return schemas.PersonnelCheckInResponse(
                id=person.id,
                name=person.name,
                role=person.role,
                availability=person.availability,
                checked_in=False,
                checked_in_at=attendance.checked_in_at,
                checked_out_at=attendance.checked_out_at,
                is_assigned=is_assigned,
            )
        # Update existing record
        attendance.checked_in = False
        attendance.checked_out_at = now
        attendance.updated_at = now
    else:
        # Create new attendance record marked as checked out
        # (This handles the case where someone was never checked in but we want to explicitly mark them as out)
        attendance = EventAttendance(
            event_id=event_id,
            personnel_id=personnel_id,
            checked_in=False,
            checked_out_at=now,
        )
        db.add(attendance)

    # Log action
    if current_user and request:
        await log_action(
            db=db,
            action_type="check_out",
            resource_type="personnel",
            resource_id=person.id,
            user=current_user,
            changes={"name": person.name, "event_id": str(event_id), "checked_in": False},
            request=request,
        )

    await db.commit()
    await db.refresh(attendance)

    return schemas.PersonnelCheckInResponse(
        id=person.id,
        name=person.name,
        role=person.role,
        availability=person.availability,
        checked_in=attendance.checked_in,
        checked_in_at=attendance.checked_in_at,
        checked_out_at=attendance.checked_out_at,
        is_assigned=is_assigned,
    )
