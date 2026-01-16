"""Material CRUD operations."""

import uuid
from datetime import datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Material, User
from ..services.audit import calculate_changes, log_action


async def get_all_materials(db: AsyncSession) -> list[Material]:
    """Get all materials."""
    result = await db.execute(
        select(Material).order_by(Material.location_sort_order.asc(), Material.location.asc(), Material.name.asc())
    )
    return list(result.scalars().all())


async def get_material(db: AsyncSession, material_id: uuid.UUID) -> Material | None:
    """Get single material by ID."""
    result = await db.execute(select(Material).where(Material.id == material_id))
    return result.scalar_one_or_none()


async def create_material(
    db: AsyncSession,
    material_data: schemas.MaterialCreate,
    current_user: User,
    request: Request,
) -> Material:
    """Create new material."""
    material = Material(
        name=material_data.name,
        type=material_data.type,
        status=material_data.status or "available",
        location=material_data.location,
        location_sort_order=material_data.location_sort_order,
        description=material_data.description,
    )
    db.add(material)
    await db.flush()

    # Log creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="material",
        resource_id=material.id,
        user=current_user,
        changes={
            "name": material_data.name,
            "type": material_data.type,
            "status": material_data.status,
            "location": material_data.location,
            "description": material_data.description,
        },
        request=request,
    )

    await db.commit()
    await db.refresh(material)
    return material


async def update_material(
    db: AsyncSession,
    material_id: uuid.UUID,
    material_data: schemas.MaterialUpdate,
    current_user: User,
    request: Request,
) -> Material | None:
    """Update existing material."""
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()

    if not material:
        return None

    # Capture before state
    before_state = {
        "name": material.name,
        "status": material.status,
        "location": material.location,
    }

    # Apply updates
    update_data = material_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(material, field, value)

    material.updated_at = datetime.utcnow()

    # Capture after state
    after_state = {
        "name": material.name,
        "status": material.status,
        "location": material.location,
    }

    # Calculate changes
    changes = calculate_changes(before_state, after_state)

    # Log update if changes
    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="material",
            resource_id=material.id,
            user=current_user,
            changes=changes,
            request=request,
        )

    await db.commit()
    await db.refresh(material)
    return material


async def delete_material(
    db: AsyncSession,
    material_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """Delete material (soft delete by marking as maintenance)."""
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()

    if not material:
        return False

    # Soft delete: mark as 'maintenance'
    material.status = "maintenance"
    material.updated_at = datetime.utcnow()

    # Log deletion
    await log_action(
        db=db,
        action_type="delete",
        resource_type="material",
        resource_id=material.id,
        user=current_user,
        changes={"name": material.name},
        request=request,
    )

    await db.commit()
    return True
