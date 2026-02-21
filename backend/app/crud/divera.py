"""Divera emergency CRUD operations."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas


async def create_divera_emergency(
    db: AsyncSession,
    payload: schemas.DiveraWebhookPayload,
) -> models.DiveraEmergency:
    """
    Create a new Divera emergency from webhook payload.

    Args:
        db: Database session
        payload: Validated Divera webhook payload

    Returns:
        Created DiveraEmergency instance

    Raises:
        IntegrityError: If divera_id already exists (duplicate webhook)
    """
    emergency = models.DiveraEmergency(
        divera_id=payload.id,
        divera_number=payload.number,
        title=payload.title,
        text=payload.text,
        address=payload.address,
        latitude=payload.lat,
        longitude=payload.lng,
        # Note: priority is inferred from title/text when creating incidents
        raw_payload_json=payload.model_dump(),
    )

    db.add(emergency)
    await db.commit()
    await db.refresh(emergency)

    return emergency


async def get_divera_emergency_by_id(
    db: AsyncSession,
    emergency_id: UUID,
) -> models.DiveraEmergency | None:
    """Get Divera emergency by UUID."""
    result = await db.execute(select(models.DiveraEmergency).where(models.DiveraEmergency.id == emergency_id))
    return result.scalar_one_or_none()


async def get_divera_emergency_by_divera_id(
    db: AsyncSession,
    divera_id: int,
) -> models.DiveraEmergency | None:
    """Get Divera emergency by Divera's internal ID (for deduplication)."""
    result = await db.execute(select(models.DiveraEmergency).where(models.DiveraEmergency.divera_id == divera_id))
    return result.scalar_one_or_none()


async def get_divera_emergencies(
    db: AsyncSession,
    attached: bool | None = None,
    event_id: UUID | None = None,
    include_archived: bool = False,
    skip: int = 0,
    limit: int = 100,
) -> list[models.DiveraEmergency]:
    """
    Get list of Divera emergencies with filters.

    Args:
        db: Database session
        attached: Filter by attachment status (None = all, True = attached, False = unattached)
        event_id: Filter by specific event ID
        include_archived: Include archived emergencies
        skip: Pagination offset
        limit: Max results

    Returns:
        List of DiveraEmergency instances
    """
    query = select(models.DiveraEmergency)

    # Filter by attachment status
    if attached is True:
        query = query.where(models.DiveraEmergency.attached_to_event_id.is_not(None))
    elif attached is False:
        query = query.where(models.DiveraEmergency.attached_to_event_id.is_(None))

    # Filter by specific event
    if event_id is not None:
        query = query.where(models.DiveraEmergency.attached_to_event_id == event_id)

    # Filter archived
    if not include_archived:
        query = query.where(models.DiveraEmergency.is_archived.is_(False))

    # Order by received time (newest first)
    query = query.order_by(models.DiveraEmergency.received_at.desc())

    # Pagination
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())


async def count_divera_emergencies(
    db: AsyncSession,
    attached: bool | None = None,
    event_id: UUID | None = None,
    include_archived: bool = False,
) -> int:
    """Count Divera emergencies with filters."""
    query = select(func.count()).select_from(models.DiveraEmergency)

    # Apply same filters as get_divera_emergencies
    if attached is True:
        query = query.where(models.DiveraEmergency.attached_to_event_id.is_not(None))
    elif attached is False:
        query = query.where(models.DiveraEmergency.attached_to_event_id.is_(None))

    if event_id is not None:
        query = query.where(models.DiveraEmergency.attached_to_event_id == event_id)

    if not include_archived:
        query = query.where(models.DiveraEmergency.is_archived.is_(False))

    result = await db.execute(query)
    return result.scalar_one()


async def attach_emergency_to_event(
    db: AsyncSession,
    emergency_id: UUID,
    event_id: UUID,
    incident_id: UUID | None = None,
) -> models.DiveraEmergency:
    """
    Attach a Divera emergency to an Event (and optionally link created Incident).

    Allows re-attachment to different events - each attachment creates a new incident.

    Args:
        db: Database session
        emergency_id: Divera emergency UUID
        event_id: Event UUID to attach to
        incident_id: Optional UUID of created Incident

    Returns:
        Updated DiveraEmergency instance

    Raises:
        ValueError: If emergency not found
    """
    emergency = await get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise ValueError(f"Divera emergency {emergency_id} not found")

    # Allow re-attachment - update to new event and incident
    await db.execute(
        update(models.DiveraEmergency)
        .where(models.DiveraEmergency.id == emergency_id)
        .values(
            attached_to_event_id=event_id,
            attached_at=datetime.utcnow(),
            created_incident_id=incident_id,
        )
    )
    await db.commit()
    await db.refresh(emergency)

    return emergency


async def detach_emergency_from_event(
    db: AsyncSession,
    emergency_id: UUID,
) -> models.DiveraEmergency:
    """
    Detach a Divera emergency from its Event.

    Note: This does NOT delete the created Incident, just unlinks it.
    """
    emergency = await get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise ValueError(f"Divera emergency {emergency_id} not found")

    await db.execute(
        update(models.DiveraEmergency)
        .where(models.DiveraEmergency.id == emergency_id)
        .values(
            attached_to_event_id=None,
            attached_at=None,
            created_incident_id=None,
        )
    )
    await db.commit()
    await db.refresh(emergency)

    return emergency


async def archive_divera_emergency(
    db: AsyncSession,
    emergency_id: UUID,
) -> models.DiveraEmergency:
    """Archive a Divera emergency (soft delete)."""
    emergency = await get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise ValueError(f"Divera emergency {emergency_id} not found")

    await db.execute(
        update(models.DiveraEmergency)
        .where(models.DiveraEmergency.id == emergency_id)
        .values(
            is_archived=True,
            archived_at=datetime.utcnow(),
        )
    )
    await db.commit()
    await db.refresh(emergency)

    return emergency


async def unarchive_divera_emergency(
    db: AsyncSession,
    emergency_id: UUID,
) -> models.DiveraEmergency:
    """Unarchive a Divera emergency."""
    emergency = await get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise ValueError(f"Divera emergency {emergency_id} not found")

    await db.execute(
        update(models.DiveraEmergency)
        .where(models.DiveraEmergency.id == emergency_id)
        .values(
            is_archived=False,
            archived_at=None,
        )
    )
    await db.commit()
    await db.refresh(emergency)

    return emergency
