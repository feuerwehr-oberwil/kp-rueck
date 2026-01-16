"""Special Function CRUD operations."""

import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import EventSpecialFunction, User
from ..services.audit import log_action


async def get_event_special_functions(db: AsyncSession, event_id: uuid.UUID) -> list[EventSpecialFunction]:
    """Get all special function assignments for an event."""
    result = await db.execute(select(EventSpecialFunction).where(EventSpecialFunction.event_id == event_id))
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


async def create_special_function(
    db: AsyncSession,
    event_id: uuid.UUID,
    assignment: schemas.EventSpecialFunctionCreate,
    current_user: User,
    request: Request,
) -> EventSpecialFunction:
    """Assign a special function to personnel for an event."""
    # Validate driver assignment has a vehicle
    if assignment.function_type == "driver" and not assignment.vehicle_id:
        raise ValueError("Driver assignments must include a vehicle_id")

    # Check if vehicle already has a driver (for driver assignments)
    if assignment.function_type == "driver" and assignment.vehicle_id:
        existing = await check_vehicle_driver_exists(db, event_id, assignment.vehicle_id)
        if existing:
            raise ValueError("Vehicle already has a driver assigned")

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

    await db.commit()
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
    """Remove a special function assignment."""
    query = select(EventSpecialFunction).where(
        EventSpecialFunction.event_id == event_id,
        EventSpecialFunction.personnel_id == personnel_id,
        EventSpecialFunction.function_type == function_type,
    )

    # For driver assignments, also match vehicle_id
    if function_type == "driver" and vehicle_id:
        query = query.where(EventSpecialFunction.vehicle_id == vehicle_id)

    result = await db.execute(query)
    db_assignment = result.scalar_one_or_none()

    if not db_assignment:
        return False

    # Log the removal
    await log_action(
        db=db,
        action_type="delete",
        resource_type="special_function",
        resource_id=db_assignment.id,
        user=current_user,
        changes={
            "event_id": str(event_id),
            "personnel_id": str(personnel_id),
            "function_type": function_type,
            "vehicle_id": str(vehicle_id) if vehicle_id else None,
        },
        request=request,
    )

    await db.delete(db_assignment)
    await db.commit()
    return True
