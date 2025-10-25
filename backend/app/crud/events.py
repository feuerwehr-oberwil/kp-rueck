"""Event CRUD operations."""
from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Event, Incident


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
    db: AsyncSession, event_data: schemas.EventCreate
) -> Event:
    """
    Create a new event.

    Args:
        db: Database session
        event_data: Event creation data

    Returns:
        Created event
    """
    event = Event(
        name=event_data.name,
        training_flag=event_data.training_flag,
        last_activity_at=datetime.utcnow(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def update_event(
    db: AsyncSession, event_id: uuid.UUID, event_data: schemas.EventUpdate
) -> Event | None:
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

    event.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(event)
    return event


async def archive_event(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    """
    Archive an event (soft delete).

    Args:
        db: Database session
        event_id: Event ID to archive

    Returns:
        Archived event or None if not found
    """
    event = await get_event_by_id(db, event_id)
    if not event:
        return None

    event.archived_at = datetime.utcnow()
    event.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(event)
    return event


async def delete_event(db: AsyncSession, event_id: uuid.UUID) -> bool:
    """
    Permanently delete an event (only if archived).

    Args:
        db: Database session
        event_id: Event ID to delete

    Returns:
        True if deleted, False if not found

    Raises:
        ValueError: If event is not archived
    """
    event = await get_event_by_id(db, event_id)
    if not event:
        return False

    # Require event to be archived before deletion
    if event.archived_at is None:
        raise ValueError("Event must be archived before deletion")

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


async def update_event_activity(db: AsyncSession, event_id: uuid.UUID) -> None:
    """
    Update last_activity_at timestamp for an event.

    This should be called whenever an incident in the event is modified.

    Args:
        db: Database session
        event_id: Event ID to update
    """
    await db.execute(
        update(Event)
        .where(Event.id == event_id)
        .values(last_activity_at=datetime.utcnow())
    )
    await db.commit()
