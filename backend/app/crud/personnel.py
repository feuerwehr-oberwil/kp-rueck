"""Personnel CRUD operations."""
from datetime import datetime
from typing import Optional
import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Personnel, User
from ..services.audit import calculate_changes, log_action


async def get_all_personnel(
    db: AsyncSession, checked_in_only: bool = False
) -> list[Personnel]:
    """
    Get all personnel, optionally filtered by check-in status.

    Args:
        db: Database session
        checked_in_only: If True, only return checked-in personnel

    Returns:
        List of personnel
    """
    query = select(Personnel)

    if checked_in_only:
        query = query.where(Personnel.checked_in == True)

    query = query.order_by(Personnel.name.asc())

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_personnel(db: AsyncSession, personnel_id: uuid.UUID) -> Personnel | None:
    """Get single personnel by ID."""
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    return result.scalar_one_or_none()


async def create_personnel(
    db: AsyncSession,
    personnel_data: schemas.PersonnelCreate,
    current_user: User,
    request: Request,
) -> Personnel:
    """Create new personnel."""
    personnel = Personnel(
        name=personnel_data.name,
        role=personnel_data.role,
        availability=personnel_data.availability or "available",
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
            "role": personnel_data.role,
            "availability": personnel_data.availability,
        },
        request=request,
    )

    await db.commit()
    await db.refresh(personnel)
    return personnel


async def update_personnel(
    db: AsyncSession,
    personnel_id: uuid.UUID,
    personnel_data: schemas.PersonnelUpdate,
    current_user: User,
    request: Request,
) -> Personnel | None:
    """Update existing personnel."""
    result = await db.execute(
        select(Personnel).where(Personnel.id == personnel_id)
    )
    personnel = result.scalar_one_or_none()

    if not personnel:
        return None

    # Capture before state
    before_state = {
        "name": personnel.name,
        "role": personnel.role,
        "availability": personnel.availability,
    }

    # Apply updates
    update_data = personnel_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(personnel, field, value)

    personnel.updated_at = datetime.utcnow()

    # Capture after state
    after_state = {
        "name": personnel.name,
        "role": personnel.role,
        "availability": personnel.availability,
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

    await db.commit()
    await db.refresh(personnel)
    return personnel


async def delete_personnel(
    db: AsyncSession,
    personnel_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """Delete personnel (soft delete by marking as unavailable)."""
    result = await db.execute(
        select(Personnel).where(Personnel.id == personnel_id)
    )
    personnel = result.scalar_one_or_none()

    if not personnel:
        return False

    # Soft delete: mark as 'unavailable'
    personnel.availability = "unavailable"
    personnel.updated_at = datetime.utcnow()

    # Log deletion
    await log_action(
        db=db,
        action_type="delete",
        resource_type="personnel",
        resource_id=personnel.id,
        user=current_user,
        changes={"name": personnel.name},
        request=request,
    )

    await db.commit()
    return True
