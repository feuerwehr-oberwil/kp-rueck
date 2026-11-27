"""Special Function CRUD operations."""

import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import EventSpecialFunction, SpecialFunctionType, User
from ..services.audit import log_action
from ..utils.error_codes import DomainError, ErrorCode
from .locking import lock_resource


async def get_event_special_functions(db: AsyncSession, event_id: uuid.UUID) -> list[EventSpecialFunction]:
    """Get all special function assignments for an event, first assigned first.

    The order is load-bearing: «Färben nach Reko» gives each Reko person the next colour
    in this order (frontend `rekoColorOrder`), on the board and on the shared wall alike.
    """
    result = await db.execute(
        select(EventSpecialFunction)
        .where(EventSpecialFunction.event_id == event_id)
        .order_by(EventSpecialFunction.assigned_at.asc(), EventSpecialFunction.id.asc())
    )
    return list(result.scalars().all())


async def get_personnel_special_functions(
    db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID
) -> list[EventSpecialFunction]:
    """Get all special functions for a specific person in an event."""
    result = await db.execute(
        select(EventSpecialFunction).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == personnel_id,
        )
    )
    return list(result.scalars().all())


async def check_vehicle_driver_exists(
    db: AsyncSession, event_id: uuid.UUID, vehicle_id: uuid.UUID
) -> EventSpecialFunction | None:
    """Check if a vehicle already has a driver assigned for this event."""
    result = await db.execute(
        select(EventSpecialFunction).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.vehicle_id == vehicle_id,
            EventSpecialFunction.function_type == "driver",
        )
    )
    return result.scalar_one_or_none()


class PersonnelNotInEventError(LookupError):
    """The person does not exist, or is a guest of another Ereignis (→ 404)."""


async def create_special_function(
    db: AsyncSession,
    event_id: uuid.UUID,
    assignment: schemas.EventSpecialFunctionCreate,
    current_user: User,
    request: Request,
) -> EventSpecialFunction:
    """Assign a special function to personnel for an event.

    Idempotent: a function the person already holds (the same vehicle, for a driver) answers
    with the row that is there. The board ticks off its own sync, so a stale unticked box can
    send the assign twice – and the unique constraint lets NULL ``vehicle_id`` rows repeat.
    The person's row lock (``crud/locking.py`` rule 2) serialises two such assigns.

    Raises:
        PersonnelNotInEventError: unknown person, or a guest of another Ereignis
            (``Personnel.in_scope``) – nobody this Ereignis lists.
        DomainError: unknown function (422), a driver without a vehicle (422), a vehicle
            that has a driver (409).
    """
    person = await lock_resource(db, "personnel", assignment.personnel_id)
    if person is None or person.guest_event_id not in (None, event_id):
        raise PersonnelNotInEventError(assignment.personnel_id)
    # The lookup table is the authority since plan 26 (decision 5) — a role the
    # station added is as valid as one that shipped. The FK would refuse an
    # unknown key anyway; asking first turns a 500 into a 400 that says which
    # value was wrong.
    known = await db.scalar(select(SpecialFunctionType.key).where(SpecialFunctionType.key == assignment.function_type))
    if known is None:
        raise DomainError(
            ErrorCode.FUNCTION_UNKNOWN,
            f"Unbekannte Funktion: {assignment.function_type}",
            status_code=422,
            params={"function": assignment.function_type},
        )

    # Validate driver assignment has a vehicle
    if assignment.function_type == "driver" and not assignment.vehicle_id:
        raise DomainError(ErrorCode.DRIVER_NEEDS_VEHICLE, "Ein Fahrer braucht ein Fahrzeug.", status_code=422)

    held = await db.scalar(
        select(EventSpecialFunction)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == assignment.personnel_id,
            EventSpecialFunction.function_type == assignment.function_type,
            EventSpecialFunction.vehicle_id.is_(None)
            if assignment.vehicle_id is None
            else EventSpecialFunction.vehicle_id == assignment.vehicle_id,
        )
        .order_by(EventSpecialFunction.assigned_at.asc(), EventSpecialFunction.id.asc())
        .limit(1)
    )
    if held is not None:
        return held

    # Check if vehicle already has a driver (for driver assignments)
    if assignment.function_type == "driver" and assignment.vehicle_id:
        existing = await check_vehicle_driver_exists(db, event_id, assignment.vehicle_id)
        if existing:
            raise DomainError(ErrorCode.VEHICLE_HAS_DRIVER, "Dieses Fahrzeug hat bereits einen Fahrer.")

    # Create the assignment
    db_assignment = EventSpecialFunction(
        event_id=event_id,
        personnel_id=assignment.personnel_id,
        function_type=assignment.function_type,
        vehicle_id=assignment.vehicle_id,
        assigned_by=current_user.id,
    )
    db.add(db_assignment)
    await db.flush()

    # Log the assignment
    await log_action(
        db=db,
        action_type="create",
        resource_type="special_function",
        resource_id=db_assignment.id,
        user=current_user,
        changes={
            "event_id": str(event_id),
            "personnel_id": str(assignment.personnel_id),
            "function_type": assignment.function_type,
            "vehicle_id": str(assignment.vehicle_id) if assignment.vehicle_id else None,
        },
        request=request,
    )

    await db.flush()
    await db.refresh(db_assignment)
    return db_assignment


async def delete_special_function(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    function_type: str,
    vehicle_id: uuid.UUID | None,
    current_user: User,
    request: Request,
) -> bool:
    """Remove a special function assignment (every copy of it, should there be two)."""
    query = select(EventSpecialFunction).where(
        EventSpecialFunction.event_id == event_id,
        EventSpecialFunction.personnel_id == personnel_id,
        EventSpecialFunction.function_type == function_type,
    )

    # For driver assignments, also match vehicle_id
    if function_type == "driver" and vehicle_id:
        query = query.where(EventSpecialFunction.vehicle_id == vehicle_id)

    # All of them: rows doubled before assignment was idempotent go together.
    rows = list((await db.execute(query)).scalars().all())

    if not rows:
        return False

    # Log the removal
    await log_action(
        db=db,
        action_type="delete",
        resource_type="special_function",
        resource_id=rows[0].id,
        user=current_user,
        changes={
            "event_id": str(event_id),
            "personnel_id": str(personnel_id),
            "function_type": function_type,
            "vehicle_id": str(vehicle_id) if vehicle_id else None,
        },
        request=request,
    )

    for row in rows:
        await db.delete(row)
    await db.flush()
    return True
