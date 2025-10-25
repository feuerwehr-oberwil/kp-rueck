"""Personnel check-in CRUD operations."""
from datetime import datetime
import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import Personnel, User
from ..services.audit import log_action


async def get_available_personnel(
    db: AsyncSession,
    include_checked_out: bool = True,
) -> list[Personnel]:
    """
    Get personnel eligible for check-in.

    Args:
        db: Database session
        include_checked_out: If True, returns all available personnel
                           If False, only returns checked-in personnel

    Returns:
        List of personnel (excludes unavailable personnel)
    """
    query = select(Personnel).where(
        Personnel.availability != 'unavailable'
    )

    if not include_checked_out:
        query = query.where(Personnel.checked_in == True)

    query = query.order_by(Personnel.name.asc())

    result = await db.execute(query)
    return list(result.scalars().all())


async def check_in_personnel(
    db: AsyncSession,
    personnel_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
) -> Personnel | None:
    """
    Check in a person (mark as present on-site).

    Args:
        db: Database session
        personnel_id: ID of personnel to check in
        current_user: Optional user performing the action (for audit log)
        request: Optional request object (for audit log)

    Returns:
        Updated personnel record, or None if not found

    Raises:
        ValueError: If personnel is unavailable
    """
    result = await db.execute(
        select(Personnel).where(Personnel.id == personnel_id)
    )
    person = result.scalar_one_or_none()

    if not person:
        return None

    # Can't check in if unavailable
    if person.availability == 'unavailable':
        raise ValueError("Cannot check in unavailable personnel")

    # Already checked in
    if person.checked_in:
        return person

    # Update check-in status
    person.checked_in = True
    person.checked_in_at = datetime.utcnow()
    person.updated_at = datetime.utcnow()

    # Log action
    if current_user and request:
        await log_action(
            db=db,
            action_type="check_in",
            resource_type="personnel",
            resource_id=person.id,
            user=current_user,
            changes={"name": person.name, "checked_in": True},
            request=request,
        )

    await db.commit()
    await db.refresh(person)

    return person


async def check_out_personnel(
    db: AsyncSession,
    personnel_id: uuid.UUID,
    current_user: User | None = None,
    request: Request | None = None,
) -> Personnel | None:
    """
    Check out a person (mark as left site).

    Args:
        db: Database session
        personnel_id: ID of personnel to check out
        current_user: Optional user performing the action (for audit log)
        request: Optional request object (for audit log)

    Returns:
        Updated personnel record, or None if not found
    """
    result = await db.execute(
        select(Personnel).where(Personnel.id == personnel_id)
    )
    person = result.scalar_one_or_none()

    if not person:
        return None

    # Already checked out
    if not person.checked_in:
        return person

    # Update check-out status
    person.checked_in = False
    person.checked_out_at = datetime.utcnow()
    person.updated_at = datetime.utcnow()

    # Log action
    if current_user and request:
        await log_action(
            db=db,
            action_type="check_out",
            resource_type="personnel",
            resource_id=person.id,
            user=current_user,
            changes={"name": person.name, "checked_in": False},
            request=request,
        )

    await db.commit()
    await db.refresh(person)

    return person
