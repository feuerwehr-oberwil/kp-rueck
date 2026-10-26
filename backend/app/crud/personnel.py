"""Personnel CRUD operations."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import Request
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import EventAttendance, Personnel, User
from ..services.audit import calculate_changes, log_action
from . import external_identities
from .locking import lock_resource
from .materials import count_active_deployments


def to_personnel_schema(
    person: Personnel, attendance: EventAttendance | None, *, divera_linked: bool = False
) -> schemas.Personnel:
    """Serialise a roster row together with its attendance at ONE Ereignis.

    The single place the three attendance fields of ``schemas.Personnel`` are ever
    filled. They used to be read straight off the personnel row by
    ``from_attributes``, which is why ``/api/personnel/?checked_in_only=true`` could
    return exactly the people who were present and stamp every one of them
    ``checked_in: false`` — the filter had been moved to ``event_attendance``, the
    response field had not. Passing ``None`` says "no Ereignis was asked about", which
    is the only case where "not present" is an answer rather than an omission.

    ``divera_linked`` reports whether the person has a Divera identity in
    ``personnel_external_identities``; the caller resolves it (one membership query
    per request, never per row) because this serialiser stays sync.
    """
    return schemas.Personnel(
        id=person.id,
        name=person.name,
        kennung=person.kennung,
        role=person.role,
        role_sort_order=person.role_sort_order,
        status=person.status,
        tags=person.tags,
        divera_linked=divera_linked,
        checked_in=bool(attendance is not None and attendance.checked_in),
        checked_in_at=attendance.checked_in_at if attendance else None,
        checked_out_at=attendance.checked_out_at if attendance else None,
        created_at=person.created_at,
        updated_at=person.updated_at,
    )


async def get_all_personnel(db: AsyncSession) -> list[Personnel]:
    """Every roster row as an ORM object, for callers that work on the rows themselves.

    Deliberately knows nothing about events or attendance: an ORM ``Personnel`` carries
    no answer to "is this person here?", and a getter that accepted an ``event_id``
    while returning rows that cannot express one is how this went wrong. Anything that
    serialises personnel for a client wants ``list_personnel_with_attendance``.
    """
    result = await db.execute(
        select(Personnel).order_by(Personnel.role_sort_order.asc(), Personnel.role.asc(), Personnel.name.asc())
    )
    return list(result.scalars().all())


async def list_personnel_with_attendance(
    db: AsyncSession, checked_in_only: bool = False, event_id: uuid.UUID | None = None
) -> list[schemas.Personnel]:
    """
    Get all personnel with their attendance at ``event_id`` resolved.

    Args:
        db: Database session
        checked_in_only: If True, only return people currently checked in
        event_id: The Ereignis whose attendance is reported (and filtered on)

    Returns:
        Serialised personnel; ``checked_in``/``checked_in_at``/``checked_out_at``
        describe ``event_id`` and are all-empty when none was given.
    """
    if event_id is None:
        if checked_in_only:
            # Attendance is per Ereignis and lives in `event_attendance`. Without an
            # event there is nothing to filter on, and the whole roster would be the
            # wrong answer to "only the people who are here".
            return []
        rows = await get_all_personnel(db)
        linked_ids = set(await external_identities.get_identity_map(db, "divera"))
        return [to_personnel_schema(person, None, divera_linked=person.id in linked_ids) for person in rows]

    join_on = and_(
        EventAttendance.personnel_id == Personnel.id,
        EventAttendance.event_id == event_id,
    )
    query = select(Personnel, EventAttendance)
    if checked_in_only:
        query = query.join(EventAttendance, and_(join_on, EventAttendance.checked_in))
    else:
        # Outer join: somebody who never checked in has no attendance row at all, and
        # that is a report about them, not a reason to drop them from the roster.
        query = query.outerjoin(EventAttendance, join_on)

    query = query.order_by(Personnel.role_sort_order.asc(), Personnel.role.asc(), Personnel.name.asc())

    result = await db.execute(query)
    # One membership query for the whole list — never a per-row identity lookup.
    linked_ids = set(await external_identities.get_identity_map(db, "divera"))
    return [
        to_personnel_schema(person, attendance, divera_linked=person.id in linked_ids)
        for person, attendance in result.all()
    ]


def name_key(name: str, kennung: str | None) -> tuple[str, str | None]:
    """What makes two roster entries «the same person» on the board: name + Kennung.

    Case-insensitive, whitespace trimmed and collapsed. A missing Kennung is a value of its
    own, so a second «Meier Alex» without one clashes with the first. Shared with the Excel
    import, which applies the same rule to its rows.
    """

    def norm(text: str) -> str:
        return " ".join(text.split()).casefold()

    return norm(name), (norm(kennung) or None) if kennung else None


class PersonnelNameTakenError(Exception):
    """Name + Kennung already belongs to someone on the roster; ``detail`` is the German 409 text."""

    def __init__(self, name: str, kennung: str | None) -> None:
        if kennung:
            self.detail = f"„{name}“ mit Kennung „{kennung}“ gibt es schon."
        else:
            self.detail = f"„{name}“ gibt es schon. Kennung angeben, z.B. Jahrgang oder Personal-Nr."
        super().__init__(self.detail)


async def find_name_clash(
    db: AsyncSession, name: str, kennung: str | None, *, exclude_id: uuid.UUID | None = None
) -> bool:
    """True when somebody else on the roster has the same ``name_key``.

    Every roster row counts – personnel has no archive; somebody a roster sync marked as
    gone still stands on the board. Compared in Python over (id, name, kennung) rather than
    in SQL, so the import and this check cannot disagree about casefolding; a roster is a
    few hundred rows. Not locked: two simultaneous creates of the same name can both pass.
    That race is accepted – the result is a flagged pair on the board, the same state the
    syncs may produce on purpose (``allow_duplicate_name``), fixed by setting a Kennung.
    """
    key = name_key(name, kennung)
    rows = await db.execute(select(Personnel.id, Personnel.name, Personnel.kennung))
    return any(pid != exclude_id and name_key(n, k) == key for pid, n, k in rows.all())


async def get_personnel(db: AsyncSession, personnel_id: uuid.UUID) -> Personnel | None:
    """Get single personnel by ID."""
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    return result.scalar_one_or_none()


async def create_personnel(
    db: AsyncSession,
    personnel_data: schemas.PersonnelCreate,
    current_user: User,
    request: Request,
    *,
    allow_duplicate_name: bool = False,
) -> Personnel:
    """Create new personnel; raises ``PersonnelNameTakenError`` when name + Kennung is taken.

    ``allow_duplicate_name`` is for the provider syncs (Divera): they mirror a member list
    that may itself hold two people of one name and carry no Kennung. Refusing would break
    the sync; the board instead shows such a pair flagged until someone sets a Kennung.
    """
    if not allow_duplicate_name and await find_name_clash(db, personnel_data.name, personnel_data.kennung):
        raise PersonnelNameTakenError(personnel_data.name, personnel_data.kennung)
    personnel = Personnel(
        name=personnel_data.name,
        kennung=personnel_data.kennung,
        role=personnel_data.role,
        role_sort_order=personnel_data.role_sort_order,
        status=personnel_data.status or "available",
        tags=personnel_data.tags,
    )
    db.add(personnel)
    await db.flush()

    # Log creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="personnel",
        resource_id=personnel.id,
        user=current_user,
        changes={
            "name": personnel_data.name,
            "kennung": personnel_data.kennung,
            "role": personnel_data.role,
            "status": personnel_data.status,
            "tags": personnel_data.tags,
        },
        request=request,
    )

    await db.flush()
    await db.refresh(personnel)
    return personnel


async def update_personnel(
    db: AsyncSession,
    personnel_id: uuid.UUID,
    personnel_data: schemas.PersonnelUpdate,
    current_user: User,
    request: Request,
) -> Personnel | None:
    """Update existing personnel; raises ``PersonnelNameTakenError`` when the new name + Kennung is taken.

    Checked only when the edit changes name + Kennung (as ``name_key`` sees it), so a pair that
    already shares a name can still have its role or status edited.
    """
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    personnel = result.scalar_one_or_none()

    if not personnel:
        return None

    # Capture before state
    before_state = {
        "name": personnel.name,
        "kennung": personnel.kennung,
        "role": personnel.role,
        "status": personnel.status,
    }

    update_data = personnel_data.model_dump(exclude_unset=True)
    new_name = update_data.get("name", personnel.name)
    new_kennung = update_data.get("kennung", personnel.kennung)
    if name_key(new_name, new_kennung) != name_key(personnel.name, personnel.kennung) and await find_name_clash(
        db, new_name, new_kennung, exclude_id=personnel.id
    ):
        raise PersonnelNameTakenError(new_name, new_kennung)

    # Apply updates
    for field, value in update_data.items():
        setattr(personnel, field, value)

    personnel.updated_at = datetime.now(UTC)

    # Capture after state
    after_state = {
        "name": personnel.name,
        "kennung": personnel.kennung,
        "role": personnel.role,
        "status": personnel.status,
    }

    # Calculate changes
    changes = calculate_changes(before_state, after_state)

    # Log update if changes
    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="personnel",
            resource_id=personnel.id,
            user=current_user,
            changes=changes,
            request=request,
        )

    await db.flush()
    await db.refresh(personnel)
    return personnel


async def delete_personnel(
    db: AsyncSession,
    personnel_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> Literal["deleted", "not_found", "in_use"]:
    """Delete personnel permanently – refused (``"in_use"``) while assigned.

    A person on an open assignment (Einsatz or Auftrag, training included) is not
    deleted: ``resource_id`` carries no foreign key, so the row would stay on the
    card pointing at nobody. The person row is locked first (``locking.lock_resource``,
    the lock every assignment takes), so nobody is assigned between check and delete.
    """
    personnel = await lock_resource(db, "personnel", personnel_id)

    if not personnel:
        return "not_found"

    if await count_active_deployments(db, "personnel", personnel_id, include_training=True):
        return "in_use"

    # Store name for logging before deletion
    personnel_name = personnel.name

    # Log deletion before actually deleting
    await log_action(
        db=db,
        action_type="delete",
        resource_type="personnel",
        resource_id=personnel.id,
        user=current_user,
        changes={"name": personnel_name},
        request=request,
    )

    # Hard delete the personnel record
    await db.delete(personnel)
    await db.flush()
    return "deleted"
