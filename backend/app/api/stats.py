"""Stats API endpoints for real-time event statistics."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth.dependencies import CurrentUser
from ..database import get_db

router = APIRouter(prefix="/events", tags=["stats"])


@router.get("/{event_id}/stats", response_model=schemas.EventStats)
async def get_event_stats(
    event_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """
    Get real-time statistics for an event.

    Returns:
        - Active incidents count by status
        - Personnel availability (X/Y available)
        - Average incident duration
        - Resource utilization percentage
    """
    # Verify event exists
    event_result = await db.execute(select(models.Event).where(models.Event.id == event_id))
    event = event_result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Get all incidents for this event (active and completed)
    incidents_result = await db.execute(
        select(models.Incident).where(models.Incident.event_id == event_id, models.Incident.deleted_at.is_(None))
    )
    incidents = incidents_result.scalars().all()

    # Count incidents by status
    status_counts = {}
    incident_statuses = ["eingegangen", "reko", "reko_done", "disponiert", "einsatz", "einsatz_beendet", "abschluss"]
    for status_value in incident_statuses:
        count = sum(1 for i in incidents if i.status == status_value)
        status_counts[status_value] = count

    # Get personnel availability (only checked-in personnel for this event)
    # Find all personnel who are checked in for this event
    checked_in_result = await db.execute(
        select(models.EventAttendance.personnel_id).where(
            models.EventAttendance.event_id == event_id,
            models.EventAttendance.checked_in,
            models.EventAttendance.checked_out_at.is_(None),
        )
    )
    checked_in_personnel_ids = [row[0] for row in checked_in_result.all()]

    # Get those personnel records
    if checked_in_personnel_ids:
        personnel_result = await db.execute(
            select(models.Personnel).where(models.Personnel.id.in_(checked_in_personnel_ids))
        )
        personnel = personnel_result.scalars().all()
    else:
        personnel = []

    available = sum(1 for p in personnel if p.availability == "available")
    total_personnel = len(personnel)

    # Calculate average duration for completed incidents
    # (from created_at to completed_at)
    completed_incidents = [i for i in incidents if i.completed_at is not None]
    if completed_incidents:
        durations = [(i.completed_at - i.created_at).total_seconds() for i in completed_incidents]
        avg_duration_sec = sum(durations) / len(durations)
        avg_duration_minutes = int(avg_duration_sec / 60)
    else:
        avg_duration_minutes = 0

    # Calculate resource utilization (percentage of personnel assigned to incidents)
    # Get personnel assigned to any active incident in this event
    assigned_result = await db.execute(
        select(models.IncidentAssignment.resource_id)
        .distinct()
        .join(models.Incident, models.IncidentAssignment.incident_id == models.Incident.id)
        .where(
            models.IncidentAssignment.resource_type == "personnel",
            models.IncidentAssignment.unassigned_at.is_(None),
            models.Incident.event_id == event_id,
            models.Incident.deleted_at.is_(None),
        )
    )
    assigned_personnel_ids = set(row[0] for row in assigned_result.all())

    # Count checked-in personnel who are assigned to incidents
    assigned_count = sum(1 for p in personnel if p.id in assigned_personnel_ids)
    if total_personnel > 0:
        utilization = (assigned_count / total_personnel) * 100
    else:
        utilization = 0.0

    return schemas.EventStats(
        status_counts=status_counts,
        personnel_available=available,
        personnel_total=total_personnel,
        avg_duration_minutes=avg_duration_minutes,
        resource_utilization_percent=round(utilization, 1),
    )
