"""Vehicle CRUD operations."""

import uuid
from datetime import datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import User, Vehicle
from ..services.audit import calculate_changes, log_action


async def get_all_vehicles(db: AsyncSession) -> list[Vehicle]:
    """Get all vehicles."""
    result = await db.execute(select(Vehicle).order_by(Vehicle.name.asc()))
    return list(result.scalars().all())


async def get_vehicle(db: AsyncSession, vehicle_id: uuid.UUID) -> Vehicle | None:
    """Get single vehicle by ID."""
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    return result.scalar_one_or_none()


async def create_vehicle(
    db: AsyncSession,
    vehicle_data: schemas.VehicleCreate,
    current_user: User,
    request: Request,
) -> Vehicle:
    """Create new vehicle."""
    vehicle = Vehicle(
        name=vehicle_data.name,
        type=vehicle_data.type,
        status=vehicle_data.status or "available",
        display_order=vehicle_data.display_order,
        radio_call_sign=vehicle_data.radio_call_sign,
    )
    db.add(vehicle)
    await db.flush()

    # Log creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="vehicle",
        resource_id=vehicle.id,
        user=current_user,
        changes={
            "name": vehicle_data.name,
            "type": vehicle_data.type,
            "status": vehicle_data.status,
            "display_order": vehicle_data.display_order,
            "radio_call_sign": vehicle_data.radio_call_sign,
        },
        request=request,
    )

    await db.commit()
    await db.refresh(vehicle)
    return vehicle


async def update_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    vehicle_data: schemas.VehicleUpdate,
    current_user: User,
    request: Request,
) -> Vehicle | None:
    """Update existing vehicle."""
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()

    if not vehicle:
        return None

    # Capture before state
    before_state = {
        "name": vehicle.name,
        "type": vehicle.type,
        "status": vehicle.status,
    }

    # Apply updates
    update_data = vehicle_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(vehicle, field, value)

    vehicle.updated_at = datetime.utcnow()

    # Capture after state
    after_state = {
        "name": vehicle.name,
        "type": vehicle.type,
        "status": vehicle.status,
    }

    # Calculate changes
    changes = calculate_changes(before_state, after_state)

    # Log update if changes
    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="vehicle",
            resource_id=vehicle.id,
            user=current_user,
            changes=changes,
            request=request,
        )

    await db.commit()
    await db.refresh(vehicle)
    return vehicle


async def delete_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """Delete vehicle (soft delete by marking as maintenance)."""
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()

    if not vehicle:
        return False

    # Soft delete: mark as 'maintenance'
    vehicle.status = "maintenance"
    vehicle.updated_at = datetime.utcnow()

    # Log deletion
    await log_action(
        db=db,
        action_type="delete",
        resource_type="vehicle",
        resource_id=vehicle.id,
        user=current_user,
        changes={"name": vehicle.name},
        request=request,
    )

    await db.commit()
    return True
