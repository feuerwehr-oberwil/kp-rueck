"""Reko Dashboard CRUD operations."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EventSpecialFunction, Incident, IncidentAssignment, Personnel, RekoReport


async def get_reko_personnel_for_event(
    db: AsyncSession,
    event_id: uuid.UUID,
) -> list[dict]:
    """
    Get all personnel with Reko function assigned for an event.

    Returns list of personnel with their current assignment status.

    Args:
        db: Database session
        event_id: Event UUID

    Returns:
        List of personnel dictionaries with assignment info
    """
    # Get all personnel who have 'reko' function for this event
    reko_functions = await db.execute(
        select(EventSpecialFunction)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    reko_assignments = list(reko_functions.scalars().all())

    if not reko_assignments:
        return []

    personnel_ids = [ra.personnel_id for ra in reko_assignments]

    # Get personnel details
    personnel_result = await db.execute(
        select(Personnel).where(Personnel.id.in_(personnel_ids))
    )
    personnel_map = {p.id: p for p in personnel_result.scalars().all()}

    # Get active incident assignments for these personnel in this event
    # First, get all incidents for this event
    incidents_result = await db.execute(
        select(Incident.id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    incident_ids = [row[0] for row in incidents_result.all()]

    # Get active assignments for reko personnel in these incidents
    assignment_counts: dict[uuid.UUID, int] = {}
    if incident_ids:
        assignments_result = await db.execute(
            select(IncidentAssignment.resource_id, func.count(IncidentAssignment.id))
            .where(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.resource_id.in_(personnel_ids),
                IncidentAssignment.unassigned_at.is_(None),
            )
            .group_by(IncidentAssignment.resource_id)
        )
        assignment_counts = {row[0]: row[1] for row in assignments_result.all()}

    # Build response
    result = []
    for p_id in personnel_ids:
        personnel = personnel_map.get(p_id)
        if personnel:
            result.append({
                "personnel_id": personnel.id,
                "name": personnel.name,
                "role": personnel.role,
                "assignment_count": assignment_counts.get(personnel.id, 0),
            })

    # Sort by assignment count (least assigned first), then by name
    result.sort(key=lambda x: (x["assignment_count"], x["name"]))

    return result


async def get_reko_assignments_for_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[dict]:
    """
    Get all incident assignments for a Reko personnel, including previously submitted.

    Returns list of incidents the personnel is assigned to (active) or has
    submitted a reko report for (historical), along with Reko report status.

    Args:
        db: Database session
        event_id: Event UUID
        personnel_id: Personnel UUID

    Returns:
        List of incident dictionaries with Reko status and active flag
    """
    # Verify personnel has reko function for this event
    reko_check = await db.execute(
        select(EventSpecialFunction)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == personnel_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    if not reko_check.scalar_one_or_none():
        return []

    # Get all incident IDs for this event
    incidents_result = await db.execute(
        select(Incident.id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    incident_ids = [row[0] for row in incidents_result.all()]

    if not incident_ids:
        return []

    # Get active assignments for this personnel in these incidents
    assignments_result = await db.execute(
        select(IncidentAssignment)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    assignments = list(assignments_result.scalars().all())
    active_incident_ids = {a.incident_id for a in assignments}
    assignment_map = {a.incident_id: a for a in assignments}

    # Get incidents where this personnel has submitted a reko report (including unassigned)
    submitted_reko_result = await db.execute(
        select(RekoReport.incident_id)
        .where(
            RekoReport.incident_id.in_(incident_ids),
            RekoReport.submitted_by_personnel_id == personnel_id,
            RekoReport.is_draft == False,  # noqa: E712 - SQLAlchemy needs == not 'is'
        )
        .distinct()
    )
    submitted_reko_incident_ids = {row[0] for row in submitted_reko_result.all()}

    # Combine: active assignments + previously submitted rekos
    all_relevant_incident_ids = active_incident_ids | submitted_reko_incident_ids

    if not all_relevant_incident_ids:
        return []

    # Get incident details
    incidents_detail_result = await db.execute(
        select(Incident).where(Incident.id.in_(all_relevant_incident_ids))
    )
    incidents = {i.id: i for i in incidents_detail_result.scalars().all()}

    # Get reko report status for each incident (check if non-draft report exists)
    reko_reports_result = await db.execute(
        select(RekoReport.incident_id)
        .where(
            RekoReport.incident_id.in_(all_relevant_incident_ids),
            RekoReport.is_draft == False,  # noqa: E712 - SQLAlchemy needs == not 'is'
        )
        .distinct()
    )
    completed_reko_incidents = {row[0] for row in reko_reports_result.all()}

    # Build response
    result = []
    for incident_id in all_relevant_incident_ids:
        incident = incidents.get(incident_id)
        if incident:
            assignment = assignment_map.get(incident_id)
            is_active = incident_id in active_incident_ids
            result.append({
                "incident_id": incident.id,
                "incident_title": incident.title or incident.location_address or "Unbekannt",
                "incident_type": incident.type,
                "incident_status": incident.status,
                "location_address": incident.location_address,
                "location_lat": str(incident.location_lat) if incident.location_lat else None,
                "location_lng": str(incident.location_lng) if incident.location_lng else None,
                "assignment_id": assignment.id if assignment else None,
                "assigned_at": assignment.assigned_at if assignment else None,
                "has_completed_reko": incident_id in completed_reko_incidents,
                "is_active_assignment": is_active,
            })

    # Sort: active first, then by has_completed_reko (incomplete first), then by title
    result.sort(key=lambda x: (
        not x["is_active_assignment"],  # Active first
        x["has_completed_reko"],  # Incomplete first within each group
        x["incident_title"],
    ))

    return result


async def unassign_reko_personnel_from_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> bool:
    """
    Unassign a Reko personnel from an incident.

    This is called after a Reko form is submitted to release the personnel.

    Args:
        db: Database session
        incident_id: Incident UUID
        personnel_id: Personnel UUID

    Returns:
        True if unassignment was successful, False otherwise
    """
    # Find the active assignment
    result = await db.execute(
        select(IncidentAssignment)
        .where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    assignment = result.scalar_one_or_none()

    if not assignment:
        return False

    # Mark as unassigned
    assignment.unassigned_at = datetime.now(UTC)
    await db.commit()

    return True


async def get_available_reko_personnel_for_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
) -> tuple[list[dict], uuid.UUID | None]:
    """
    Get available Reko personnel for assignment to an incident.

    Returns all Reko personnel with their assignment counts, plus
    the ID of any currently assigned Reko person (for replacement).

    Constraints:
    - Each incident can only have ONE Reko person assigned
    - A Reko person CAN be assigned to multiple incidents

    Args:
        db: Database session
        incident_id: Incident UUID

    Returns:
        Tuple of (list of personnel with assignment counts, currently_assigned_id or None)
    """
    # Get the incident's event_id
    incident_result = await db.execute(
        select(Incident).where(Incident.id == incident_id)
    )
    incident = incident_result.scalar_one_or_none()

    if not incident:
        return [], None

    event_id = incident.event_id

    # Get all Reko personnel IDs for this event
    reko_functions = await db.execute(
        select(EventSpecialFunction.personnel_id)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    reko_personnel_ids = {row[0] for row in reko_functions.all()}

    if not reko_personnel_ids:
        return [], None

    # Check if this incident already has a Reko person assigned
    existing_reko_assignment = await db.execute(
        select(IncidentAssignment)
        .where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id.in_(reko_personnel_ids),
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    existing = existing_reko_assignment.scalar_one_or_none()
    currently_assigned_id = existing.resource_id if existing else None

    # Get all Reko personnel for this event (with assignment counts)
    all_reko = await get_reko_personnel_for_event(db, event_id)

    return all_reko, currently_assigned_id
