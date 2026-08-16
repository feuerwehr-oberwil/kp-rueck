"""Event CRUD operations."""

import uuid
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Event, Incident, User
from ..services.audit import log_action
from . import auftrag_templates as auftrag_templates_crud


async def get_events(
    db: AsyncSession,
    include_archived: bool = False,
    skip: int = 0,
    limit: int = 100,
) -> list[Event]:
    """
    Get all events, optionally including archived.

    Args:
        db: Database session
        include_archived: Whether to include archived events
        skip: Pagination offset
        limit: Max results

    Returns:
        List of events ordered by last_activity_at descending
    """
    query = select(Event)

    if not include_archived:
        query = query.where(Event.archived_at.is_(None))

    query = query.order_by(Event.last_activity_at.desc())
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_event_by_id(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    """Get a single event by ID."""
    query = select(Event).where(Event.id == event_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def create_event(
    db: AsyncSession,
    event_data: schemas.EventCreate,
    created_by: uuid.UUID | None = None,
) -> Event:
    """
    Create a new event, opening the station's automatic Standard-Aufträge with it.

    The templates are the whole reason this is not a two-line insert: a station
    that has switched «Sturmholz» and «Absperren» on expects them on the board
    the moment the Lage exists, not after somebody remembers to type them. One
    transaction, so a board never appears with half its standing Aufträge.

    Args:
        db: Database session
        event_data: Event creation data
        created_by: Who is opening the Lage — recorded on the auto-created Aufträge

    Returns:
        Created event
    """
    event = Event(
        name=event_data.name,
        training_flag=event_data.training_flag,
        auto_attach_divera=event_data.auto_attach_divera if event_data.auto_attach_divera is not None else False,
        last_activity_at=datetime.now(UTC),
    )
    db.add(event)
    await db.flush()
    await auftrag_templates_crud.instantiate_auto_templates(db, event.id, created_by)
    await db.commit()
    await db.refresh(event)
    return event


async def update_event(db: AsyncSession, event_id: uuid.UUID, event_data: schemas.EventUpdate) -> Event | None:
    """
    Update an event.

    Args:
        db: Database session
        event_id: Event ID to update
        event_data: Event update data

    Returns:
        Updated event or None if not found
    """
    event = await get_event_by_id(db, event_id)
    if not event:
        return None

    update_data = event_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(event, field, value)

    event.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(event)
    return event


async def archive_event(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    """
    Archive an event (soft delete). Idempotent — archiving twice does not move the timestamp.

    ``archived_at`` is when the Ereignis was closed, and a second archive used to overwrite it
    with "now": a double-click, a retried request or two operators on the same card silently
    rewrote history, and the archive list is sorted and read by that timestamp.

    The re-stamp is prevented by the ``archived_at IS NULL`` predicate on the UPDATE rather
    than by the read above. Postgres re-evaluates that predicate after the row lock is
    granted, so a *concurrent* second archive matches zero rows instead of overwriting the
    winner — the early return only covers the sequential case. Either way the row is re-read
    afterwards, so the caller is told the truth about when it was actually archived.

    Args:
        db: Database session
        event_id: Event ID to archive

    Returns:
        Archived event (with its original timestamp if it was already archived), or None if
        not found
    """
    event = await get_event_by_id(db, event_id)
    if not event:
        return None

    if event.archived_at is not None:
        return event

    now = datetime.now(UTC)
    await db.execute(
        update(Event).where(Event.id == event_id, Event.archived_at.is_(None)).values(archived_at=now, updated_at=now)
    )
    await db.commit()
    await db.refresh(event)
    return event


async def unarchive_event(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    """
    Unarchive an event (restore from archive).

    Args:
        db: Database session
        event_id: Event ID to unarchive

    Returns:
        Unarchived event or None if not found
    """
    event = await get_event_by_id(db, event_id)
    if not event:
        return None

    event.archived_at = None
    event.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(event)
    return event


async def delete_event(
    db: AsyncSession,
    event_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
) -> bool:
    """
    Permanently delete an event (only if archived).

    The cascade is intentional and the dialog says so ("dauerhaft", "kann nicht rückgängig
    gemacht werden", plus the incident count). What was missing is the record OF it: this is
    the most destructive operation in the application — every incident under the event, with
    its assignments, Reko- and Schadenplatz-Rapporte, status transitions and notifications —
    and it used to leave nothing behind saying it happened. Unlike an incident deletion it
    has no Undo to fall back on, so the audit entry is the only thing that can answer "the
    Ereignis from the storm week is gone, who deleted it and what went with it".

    The entry is written BEFORE the delete, while the counts can still be read, and survives
    it: ``audit_log.resource_id`` carries no foreign key, so nothing cascades into it. It is
    only flushed, not committed (``services/audit.log_action``), so the entry and the cascade
    share the single commit at the end: either the Ereignis is gone and the deletion is
    recorded exactly once, or neither happened.

    Two concurrent calls used to both pass the read below, both write that entry and both
    report success — the loser's cascade matched no rows and said so only as a SQLAlchemy
    warning. Two entries for one deletion is precisely the thing somebody would be reading
    while trying to work out what went wrong. The ``SELECT … FOR UPDATE`` — the same row-lock
    pattern as ``crud/assignments.py`` and ``crud/groups.py`` — makes the loser wait on the
    winner's row lock instead; under READ COMMITTED it re-evaluates the row once the lock is
    released, finds it deleted, and returns False. So the second caller gets an honest 404,
    with no second audit entry and no cascade running against a row that is already gone.

    Args:
        db: Database session
        event_id: Event ID to delete
        current_user: Who asked for it — recorded in the audit entry
        request: FastAPI request, for IP/user-agent capture

    Returns:
        True if deleted, False if not found

    Raises:
        ValueError: If event is not archived
    """
    event = await db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if not event:
        return False

    # Require event to be archived before deletion
    if event.archived_at is None:
        raise ValueError("Event must be archived before deletion")

    doomed_incidents = (
        await db.execute(select(Incident.id, Incident.title).where(Incident.event_id == event_id))
    ).all()

    await log_action(
        db=db,
        action_type="delete",
        resource_type="event",
        resource_id=event_id,
        user=current_user,
        changes={
            "name": event.name,
            "archived_at": event.archived_at.isoformat() if event.archived_at else None,
            "incident_count": len(doomed_incidents),
            # Titles as well as ids: after the cascade the ids resolve to nothing, and
            # "Wasser im Keller, Hauptstrasse 4" is what somebody will be asking about.
            "incidents": [{"id": str(row.id), "title": row.title} for row in doomed_incidents],
        },
        request=request,
    )

    # Cascade delete will handle all related incidents, assignments, etc.
    await db.delete(event)
    await db.commit()
    return True


async def get_event_incident_count(db: AsyncSession, event_id: uuid.UUID) -> int:
    """
    Get count of incidents for an event.

    Args:
        db: Database session
        event_id: Event ID

    Returns:
        Number of incidents in the event
    """
    query = select(func.count(Incident.id)).where(Incident.event_id == event_id)
    result = await db.execute(query)
    return result.scalar() or 0


async def get_event_incident_counts_batch(db: AsyncSession, event_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """
    Get incident counts for multiple events in a single query.

    Args:
        db: Database session
        event_ids: List of event IDs

    Returns:
        Dictionary mapping event_id to incident count
    """
    if not event_ids:
        return {}

    query = (
        select(Incident.event_id, func.count(Incident.id).label("incident_count"))
        .where(Incident.event_id.in_(event_ids))
        .group_by(Incident.event_id)
    )
    result = await db.execute(query)

    # Create map with default count of 0 for events with no incidents
    counts_map: dict[uuid.UUID, int] = dict.fromkeys(event_ids, 0)
    for row in result:
        counts_map[row.event_id] = row.incident_count

    return counts_map


async def update_event_activity(db: AsyncSession, event_id: uuid.UUID) -> None:
    """
    Update last_activity_at timestamp for an event.

    This should be called whenever an incident in the event is modified.

    Flushes only — the calling operation owns the single commit, so a crash
    mid-operation can't leave a half-committed status change (audit H3).

    Args:
        db: Database session
        event_id: Event ID to update
    """
    await db.execute(update(Event).where(Event.id == event_id).values(last_activity_at=datetime.now(UTC)))
    await db.flush()
