"""Stats API endpoints for real-time event statistics."""

from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth.dependencies import CurrentUser
from ..database import get_db
from ..services.incident_display import get_home_city, location_display
from ..services.reaction_times import load_event_figures

router = APIRouter(prefix="/events", tags=["stats"])


@router.get("/{event_id}/stats", response_model=schemas.EventStats)
async def get_event_stats(
    event_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> schemas.EventStats:
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
    incident_statuses = ["incoming", "reko", "reko_done", "enroute", "active", "returning", "complete"]
    for status_value in incident_statuses:
        count = sum(1 for i in incidents if i.status == status_value)
        status_counts[status_value] = count

    # Get personnel availability (only checked-in personnel for this event).
    # `checked_in` alone, like the board's roster: a re-check-in keeps the earlier
    # `checked_out_at` stamp, so also requiring it to be NULL left everybody who had
    # gone home and come back out of the count.
    checked_in_result = await db.execute(
        select(models.EventAttendance.personnel_id, models.EventAttendance.checked_in_at).where(
            models.EventAttendance.event_id == event_id,
            models.EventAttendance.checked_in,
        )
    )
    checked_in_rows = checked_in_result.all()
    checked_in_personnel_ids = [row[0] for row in checked_in_rows]
    checked_in_at_by_id = {row[0]: row[1] for row in checked_in_rows}

    # Get those personnel records
    if checked_in_personnel_ids:
        personnel_result = await db.execute(
            select(models.Personnel).where(models.Personnel.id.in_(checked_in_personnel_ids))
        )
        personnel = personnel_result.scalars().all()
    else:
        personnel = []

    available = sum(1 for p in personnel if p.status == "available")
    total_personnel = len(personnel)

    # Calculate average duration for completed incidents
    # (from created_at to completed_at)
    completed_incidents = [i for i in incidents if i.completed_at is not None]
    if completed_incidents:
        durations = [
            (completed_at - i.created_at).total_seconds()
            for i in completed_incidents
            if (completed_at := i.completed_at) is not None
        ]
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
    assigned_personnel_ids = {row[0] for row in assigned_result.all()}

    # Count checked-in personnel who are assigned to incidents
    assigned_count = sum(1 for p in personnel if p.id in assigned_personnel_ids)
    utilization = assigned_count / total_personnel * 100 if total_personnel > 0 else 0.0

    personnel_activity = await _personnel_activity(db, event_id, personnel, checked_in_at_by_id)

    return schemas.EventStats(
        status_counts=status_counts,
        personnel_available=available,
        personnel_total=total_personnel,
        avg_duration_minutes=avg_duration_minutes,
        resource_utilization_percent=round(utilization, 1),
        personnel_activity=personnel_activity,
    )


@router.get("/{event_id}/figures", response_model=schemas.EventFigures)
async def get_event_figures(
    event_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> schemas.EventFigures:
    """Kennzahlen of an event: Lage counts, Reaktionszeiten per priority (median / P90)
    and the oldest «hoch» Meldung still waiting.

    The same stage times as the PDF's Reaktionszeiten table (`services/reaction_times.py`).
    Its own route rather than part of ``/stats``: the board and the wall reload it every
    10 s, and this needs two queries (incidents, their transitions), nothing else.
    """
    event = await db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    incidents = (
        (
            await db.execute(
                select(models.Incident).where(
                    models.Incident.event_id == event_id, models.Incident.deleted_at.is_(None)
                )
            )
        )
        .scalars()
        .all()
    )
    return schemas.EventFigures.model_validate(await load_event_figures(db, incidents))


@router.get("/{event_id}/personnel-activity", response_model=list[schemas.PersonnelActivity])
async def get_personnel_activity(
    event_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[schemas.PersonnelActivity]:
    """Time on duty of everybody checked in for this Ereignis — the Dienstzeiten overview.

    The same rows as ``personnel_activity`` in ``/stats``, without the incident statistics
    around them: the overview asks again whenever somebody's assignment changes.
    """
    event_result = await db.execute(select(models.Event.id).where(models.Event.id == event_id))
    if event_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    checked_in_result = await db.execute(
        select(models.Personnel, models.EventAttendance.checked_in_at)
        .join(models.EventAttendance, models.EventAttendance.personnel_id == models.Personnel.id)
        .where(models.EventAttendance.event_id == event_id, models.EventAttendance.checked_in)
    )
    rows = checked_in_result.all()
    return await _personnel_activity(db, event_id, [p for p, _ in rows], {p.id: at for p, at in rows})


#: An assignment released within this long is a correction (a mis-drag, an undo, a
#: «verschieben» straight away), not an Einsatz the person worked.
MIN_WORKED = timedelta(minutes=2)


async def _personnel_activity(
    db: AsyncSession,
    event_id: UUID,
    personnel: Sequence[models.Personnel],
    checked_in_at_by_id: dict[UUID, datetime | None],
) -> list[schemas.PersonnelActivity]:
    """Who is here, since when, and how much they have done — the crew's time on duty.

    One row per checked-in person, longest on duty first:
    - ``active_duration_minutes``: time since ``checked_in_at`` (arrival), the same clock
      the time-on-duty notification uses — never the current assignment's age.
    - ``assigned_minutes``: time on an incident or Auftrag since check-in, finished and
      current, overlaps counted once — on duty minus this is the Pause the overview shows.
    - ``assignment_count``: Einsätze worked in this Ereignis — distinct incidents plus
      distinct Aufträge (a route counts once, whatever its stops), finished and current,
      ignoring assignments that were released again within ``MIN_WORKED``.
    - ``current_incident_title``: where they are now, the way the board card names it
      (short address, else title; an Auftrag by its name), several joined by « · ».
    """
    if not personnel:
        return []

    ids = [p.id for p in personnel]
    now = datetime.now(UTC)
    home_city = await get_home_city(db)

    worked: dict[UUID, set[tuple[str, UUID]]] = defaultdict(set)
    current: dict[UUID, list[str]] = defaultdict(list)
    spans: dict[UUID, list[tuple[datetime, datetime]]] = defaultdict(list)

    def add_span(person_id: UUID, assigned_at: datetime | None, unassigned_at: datetime | None) -> None:
        if assigned_at is not None:
            spans[person_id].append((assigned_at, unassigned_at or now))

    def counts(assigned_at: datetime | None, unassigned_at: datetime | None) -> bool:
        if unassigned_at is None:
            return True
        return assigned_at is None or unassigned_at - assigned_at >= MIN_WORKED

    incident_rows = await db.execute(
        select(
            models.IncidentAssignment.resource_id,
            models.IncidentAssignment.assigned_at,
            models.IncidentAssignment.unassigned_at,
            models.Incident.id,
            models.Incident.title,
            models.Incident.location_address,
        )
        .join(models.Incident, models.IncidentAssignment.incident_id == models.Incident.id)
        .where(
            models.Incident.event_id == event_id,
            models.Incident.deleted_at.is_(None),
            models.IncidentAssignment.resource_type == "personnel",
            models.IncidentAssignment.resource_id.in_(ids),
        )
        .order_by(models.IncidentAssignment.assigned_at)
    )
    for person_id, assigned_at, unassigned_at, incident_id, title, address in incident_rows.all():
        if counts(assigned_at, unassigned_at):
            worked[person_id].add(("incident", incident_id))
        add_span(person_id, assigned_at, unassigned_at)
        if unassigned_at is None:
            current[person_id].append(location_display(address, home_city) or title)

    group_rows = await db.execute(
        select(
            models.IncidentGroupAssignment.resource_id,
            models.IncidentGroupAssignment.assigned_at,
            models.IncidentGroupAssignment.unassigned_at,
            models.IncidentGroup.id,
            models.IncidentGroup.name,
        )
        .join(models.IncidentGroup, models.IncidentGroupAssignment.incident_group_id == models.IncidentGroup.id)
        .where(
            models.IncidentGroup.event_id == event_id,
            models.IncidentGroup.deleted_at.is_(None),
            models.IncidentGroupAssignment.resource_type == "personnel",
            models.IncidentGroupAssignment.resource_id.in_(ids),
        )
        .order_by(models.IncidentGroupAssignment.assigned_at)
    )
    for person_id, assigned_at, unassigned_at, group_id, name in group_rows.all():
        if counts(assigned_at, unassigned_at):
            worked[person_id].add(("group", group_id))
        add_span(person_id, assigned_at, unassigned_at)
        if unassigned_at is None:
            current[person_id].append(name)

    rows: list[schemas.PersonnelActivity] = []
    for person in personnel:
        checked_in_at = checked_in_at_by_id.get(person.id)
        minutes = int(max(0.0, (now - checked_in_at).total_seconds()) // 60) if checked_in_at else 0
        rows.append(
            schemas.PersonnelActivity(
                personnel_id=person.id,
                name=person.name,
                role=person.role,
                status="assigned" if current.get(person.id) else person.status,
                active_duration_minutes=minutes,
                assignment_count=len(worked.get(person.id, ())),
                assigned_minutes=_assigned_minutes(spans.get(person.id, []), checked_in_at, now),
                current_incident_title=" · ".join(current[person.id]) if current.get(person.id) else None,
                checked_in_at=checked_in_at,
            )
        )
    rows.sort(key=lambda r: (-r.active_duration_minutes, r.name))
    return rows


def _assigned_minutes(spans: list[tuple[datetime, datetime]], since: datetime | None, now: datetime) -> int:
    """Minutes covered by ``spans`` between ``since`` (check-in) and ``now``; overlaps once.

    Two cards at once (a person on an incident and its Auftrag) is one stretch of work,
    not two — so the spans are merged before they are summed. Nothing before check-in
    counts: an assignment left over from an earlier stint is not this stint's work.
    """
    if since is None:
        return 0
    clipped = sorted((max(start, since), min(end, now)) for start, end in spans)
    total = timedelta()
    run_start: datetime | None = None
    run_end: datetime | None = None
    for start, end in clipped:
        if end <= start:
            continue
        if run_end is None or start > run_end:
            if run_start is not None and run_end is not None:
                total += run_end - run_start
            run_start, run_end = start, end
        else:
            run_end = max(run_end, end)
    if run_start is not None and run_end is not None:
        total += run_end - run_start
    return int(total.total_seconds() // 60)
