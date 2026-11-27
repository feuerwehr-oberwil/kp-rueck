"""Divera emergency CRUD operations."""

from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..utils.error_codes import DomainError, ErrorCode
from .locking import lock_ereignis


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
        source="divera",
        source_id=str(payload.id),
        title=payload.title,
        text=payload.text,
        address=payload.address,
        latitude=payload.lat,
        longitude=payload.lng,
        # Note: priority is inferred from title/text when creating incidents
        raw_payload_json=payload.model_dump(),
    )

    db.add(emergency)
    await db.flush()
    await db.refresh(emergency)

    return emergency


async def create_alarm_emergency(
    db: AsyncSession,
    alarm: schemas.AlarmIn,
) -> models.DiveraEmergency:
    """Create a pool alarm from the generic webhook (POST /api/alarms).

    Raises:
        IntegrityError: If (source, source_id) already exists (concurrent redelivery)
    """
    emergency = models.DiveraEmergency(
        divera_id=None,
        divera_number=alarm.number,
        source=alarm.source,
        source_id=alarm.source_id,
        title=alarm.title,
        text=alarm.text,
        address=alarm.address,
        latitude=alarm.lat,
        longitude=alarm.lng,
        # mode="json", not the default: the payload now carries `started_at`, and a raw
        # datetime is not JSON-serialisable — psycopg's JSONB encoder raises and the whole
        # alarm 500s. Everything in here has to survive a round trip through the column.
        raw_payload_json=alarm.model_dump(mode="json"),
    )

    db.add(emergency)
    await db.flush()
    await db.refresh(emergency)

    return emergency


async def get_emergency_by_source(
    db: AsyncSession,
    source: str,
    source_id: str,
) -> models.DiveraEmergency | None:
    """Get a pool alarm by its provider-neutral identity (for deduplication)."""
    result = await db.execute(
        select(models.DiveraEmergency)
        .where(models.DiveraEmergency.source == source)
        .where(models.DiveraEmergency.source_id == source_id)
    )
    return result.scalar_one_or_none()


async def get_divera_emergency_by_id(
    db: AsyncSession,
    emergency_id: UUID,
) -> models.DiveraEmergency | None:
    """Get Divera emergency by UUID."""
    result = await db.execute(select(models.DiveraEmergency).where(models.DiveraEmergency.id == emergency_id))
    return result.scalar_one_or_none()


# An alarm that is attached and detached meanwhile makes the lock start over; each retry needs
# another committed attach of the same alarm in that instant.
_MAX_ALARM_LOCK_ATTEMPTS = 3


def ereignis_of_alarm() -> ColumnElement[UUID | None]:
    """The Ereignis an alarm belongs to: the one it is attached to (or its card's), else none."""
    card_event = select(models.Incident.event_id).where(
        models.Incident.id == models.DiveraEmergency.created_incident_id
    )
    return func.coalesce(models.DiveraEmergency.attached_to_event_id, card_event.scalar_subquery())


async def lock_ereignisse_of_alarms(db: AsyncSession, where: ColumnElement[bool]) -> set[UUID]:
    """Lock the Ereignisse of the alarms ``where`` selects (``locking.lock_ereignis``) and return
    them – for a write of many alarms at once. An alarm attached elsewhere meanwhile is in none
    of them: the caller locks the rows and writes only those whose ``attached_to_event_id`` is
    in the set or NULL."""
    ereignisse = {event_id for event_id in await db.scalars(select(ereignis_of_alarm()).where(where)) if event_id}
    await lock_ereignis(db, *ereignisse)
    return ereignisse


async def lock_divera_emergencies(
    db: AsyncSession, emergency_ids: Iterable[UUID], *, onto: Iterable[UUID | None] = ()
) -> dict[UUID, models.DiveraEmergency]:
    """Lock alarms for a write, held to the next commit: first the Ereignisse they belong to and
    ``onto`` (the one an attach puts them on, a merge target's) with ``locking.lock_ereignis``,
    then the rows by id.

    The attach paths read ``attached_to_event_id``, create a card, and only then write the link.
    Without the row lock two attaches of the same alarm (a double click, two operators, the
    auto-attach next to a manual one) both read "not attached here" and each created a card.
    An alarm's Ereignis is read before it is locked: one that changed meanwhile rolls the
    savepoint back – releasing its locks – and starts over. Returns the locked rows by id,
    refreshed (``populate_existing``); unknown ids are absent.

    ⚠️ The locks end at the first commit, so card and link must land in the SAME commit.
    """
    ids = sorted(set(emergency_ids))
    belongs = select(models.DiveraEmergency.id, ereignis_of_alarm()).where(models.DiveraEmergency.id.in_(ids))
    for _ in range(_MAX_ALARM_LOCK_ATTEMPTS):
        seen = dict((await db.execute(belongs)).tuples().all())
        savepoint = await db.begin_nested()
        await lock_ereignis(db, *onto, *seen.values())
        locked = {
            emergency.id: emergency
            for emergency in await db.scalars(
                select(models.DiveraEmergency)
                .where(models.DiveraEmergency.id.in_(ids))
                .order_by(models.DiveraEmergency.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        }
        if dict((await db.execute(belongs)).tuples().all()) == seen:
            await savepoint.commit()  # RELEASE SAVEPOINT – the locks stay with the transaction
            return locked
        await savepoint.rollback()
    raise RuntimeError("alarms kept changing Ereignis while locking; giving up")


async def lock_divera_emergency(
    db: AsyncSession, emergency_id: UUID, *, onto: Iterable[UUID | None] = ()
) -> models.DiveraEmergency | None:
    """``lock_divera_emergencies`` for one alarm."""
    return (await lock_divera_emergencies(db, [emergency_id], onto=onto)).get(emergency_id)


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
        raise DomainError(ErrorCode.ALARM_NOT_FOUND, "Divera-Alarm nicht gefunden", status_code=404)

    # Allow re-attachment - update to new event and incident
    await db.execute(
        update(models.DiveraEmergency)
        .where(models.DiveraEmergency.id == emergency_id)
        .values(
            attached_to_event_id=event_id,
            attached_at=datetime.now(UTC),
            created_incident_id=incident_id,
        )
    )
    await db.flush()
    await db.refresh(emergency)

    return emergency


async def detach_emergency(db: AsyncSession, emergency: models.DiveraEmergency) -> None:
    """Put an alarm back into the pool: no Ereignis, no card. The caller holds the row lock
    (``lock_divera_emergency``) and has dealt with the card."""
    emergency.attached_to_event_id = None
    emergency.attached_at = None
    emergency.created_incident_id = None
    await db.flush()


async def archive_divera_emergency(
    db: AsyncSession,
    emergency_id: UUID,
) -> models.DiveraEmergency:
    """Archive a Divera emergency (soft delete)."""
    emergency = await lock_divera_emergency(db, emergency_id)
    if not emergency:
        raise DomainError(ErrorCode.ALARM_NOT_FOUND, "Divera-Alarm nicht gefunden", status_code=404)

    emergency.is_archived = True
    emergency.archived_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(emergency)

    return emergency
