"""CRUD operations using async SQLAlchemy."""
from uuid import UUID

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models, schemas


# ============================================
# Incident CRUD
# ============================================


async def get_incidents(
    db: AsyncSession, skip: int = 0, limit: int = 100
) -> list[models.Incident]:
    """Get all incidents."""
    result = await db.execute(select(models.Incident).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_incident(db: AsyncSession, incident_id: UUID) -> models.Incident | None:
    """Get a specific incident."""
    result = await db.execute(select(models.Incident).where(models.Incident.id == incident_id))
    return result.scalar_one_or_none()


async def create_incident(
    db: AsyncSession, incident: schemas.IncidentCreate, created_by: UUID | None = None
) -> models.Incident:
    """Create a new incident."""
    incident_data = incident.model_dump()
    if created_by:
        incident_data["created_by"] = created_by
    db_incident = models.Incident(**incident_data)
    db.add(db_incident)
    await db.flush()
    await db.refresh(db_incident)
    return db_incident


async def update_incident(
    db: AsyncSession, incident_id: UUID, incident: schemas.IncidentUpdate
) -> models.Incident | None:
    """Update an incident."""
    db_incident = await get_incident(db, incident_id)
    if db_incident:
        update_data = incident.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_incident, key, value)
        await db.flush()
        await db.refresh(db_incident)
    return db_incident


async def delete_incident(db: AsyncSession, incident_id: UUID) -> bool:
    """Delete an incident."""
    db_incident = await get_incident(db, incident_id)
    if db_incident:
        await db.delete(db_incident)
        await db.flush()
        return True
    return False


# ============================================
# Personnel CRUD
# ============================================


async def get_personnel(
    db: AsyncSession, skip: int = 0, limit: int = 100
) -> list[models.Personnel]:
    """Get all personnel."""
    result = await db.execute(select(models.Personnel).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_person(db: AsyncSession, person_id: UUID) -> models.Personnel | None:
    """Get a specific person."""
    result = await db.execute(select(models.Personnel).where(models.Personnel.id == person_id))
    return result.scalar_one_or_none()


async def create_person(db: AsyncSession, person: schemas.PersonnelCreate) -> models.Personnel:
    """Create a new person."""
    db_person = models.Personnel(**person.model_dump())
    db.add(db_person)
    await db.flush()
    await db.refresh(db_person)
    return db_person


async def update_person(
    db: AsyncSession, person_id: UUID, person: schemas.PersonnelUpdate
) -> models.Personnel | None:
    """Update a person."""
    db_person = await get_person(db, person_id)
    if db_person:
        update_data = person.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_person, key, value)
        await db.flush()
        await db.refresh(db_person)
    return db_person


# ============================================
# Vehicle CRUD
# ============================================


async def get_vehicles(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[models.Vehicle]:
    """Get all vehicles."""
    result = await db.execute(select(models.Vehicle).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_vehicle(db: AsyncSession, vehicle_id: UUID) -> models.Vehicle | None:
    """Get a specific vehicle."""
    result = await db.execute(select(models.Vehicle).where(models.Vehicle.id == vehicle_id))
    return result.scalar_one_or_none()


async def create_vehicle(db: AsyncSession, vehicle: schemas.VehicleCreate) -> models.Vehicle:
    """Create a new vehicle."""
    db_vehicle = models.Vehicle(**vehicle.model_dump())
    db.add(db_vehicle)
    await db.flush()
    await db.refresh(db_vehicle)
    return db_vehicle


async def update_vehicle(
    db: AsyncSession, vehicle_id: UUID, vehicle: schemas.VehicleUpdate
) -> models.Vehicle | None:
    """Update a vehicle."""
    db_vehicle = await get_vehicle(db, vehicle_id)
    if db_vehicle:
        update_data = vehicle.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_vehicle, key, value)
        await db.flush()
        await db.refresh(db_vehicle)
    return db_vehicle


# ============================================
# Materials CRUD
# ============================================


async def get_materials(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[models.Material]:
    """Get all materials."""
    result = await db.execute(select(models.Material).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_material(db: AsyncSession, material_id: UUID) -> models.Material | None:
    """Get a specific material."""
    result = await db.execute(select(models.Material).where(models.Material.id == material_id))
    return result.scalar_one_or_none()


async def create_material(db: AsyncSession, material: schemas.MaterialCreate) -> models.Material:
    """Create a new material."""
    db_material = models.Material(**material.model_dump())
    db.add(db_material)
    await db.flush()
    await db.refresh(db_material)
    return db_material


async def update_material(
    db: AsyncSession, material_id: UUID, material: schemas.MaterialUpdate
) -> models.Material | None:
    """Update a material."""
    db_material = await get_material(db, material_id)
    if db_material:
        update_data = material.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_material, key, value)
        await db.flush()
        await db.refresh(db_material)
    return db_material


# ============================================
# User CRUD
# ============================================


async def get_users(
    db: AsyncSession, skip: int = 0, limit: int = 100
) -> list[models.User]:
    """Get all users."""
    result = await db.execute(select(models.User).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_user(db: AsyncSession, user_id: UUID) -> models.User | None:
    """Get a specific user by ID."""
    result = await db.execute(select(models.User).where(models.User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> models.User | None:
    """Get a specific user by username."""
    result = await db.execute(select(models.User).where(models.User.username == username))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, user: schemas.UserCreate) -> models.User:
    """
    Create a new user with hashed password.

    Args:
        db: Database session
        user: User creation schema with plaintext password

    Returns:
        Created user model
    """
    # Hash password using bcrypt
    password_hash = bcrypt.hashpw(
        user.password.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')

    # Create user with hashed password
    user_data = user.model_dump(exclude={'password'})
    db_user = models.User(**user_data, password_hash=password_hash)

    db.add(db_user)
    await db.flush()
    await db.refresh(db_user)
    return db_user


async def update_user(
    db: AsyncSession, user_id: UUID, user: schemas.UserUpdate
) -> models.User | None:
    """
    Update a user (editors only).

    If password is provided, it will be hashed before storage.

    Args:
        db: Database session
        user_id: User UUID to update
        user: User update schema

    Returns:
        Updated user model or None if not found
    """
    db_user = await get_user(db, user_id)
    if not db_user:
        return None

    update_data = user.model_dump(exclude_unset=True, exclude={'password'})

    # Handle password update separately (needs hashing)
    if user.password is not None:
        password_hash = bcrypt.hashpw(
            user.password.encode('utf-8'),
            bcrypt.gensalt()
        ).decode('utf-8')
        update_data['password_hash'] = password_hash

    # Update fields
    for key, value in update_data.items():
        setattr(db_user, key, value)

    await db.flush()
    await db.refresh(db_user)
    return db_user


async def change_user_password(
    db: AsyncSession,
    user_id: UUID,
    current_password: str,
    new_password: str
) -> tuple[bool, str]:
    """
    Change user's own password after verifying current password.

    Args:
        db: Database session
        user_id: User UUID
        current_password: Current plaintext password for verification
        new_password: New plaintext password (will be hashed)

    Returns:
        Tuple of (success: bool, message: str)
    """
    db_user = await get_user(db, user_id)
    if not db_user:
        return False, "User not found"

    # Verify current password
    if not bcrypt.checkpw(
        current_password.encode('utf-8'),
        db_user.password_hash.encode('utf-8')
    ):
        return False, "Current password is incorrect"

    # Hash new password
    new_password_hash = bcrypt.hashpw(
        new_password.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')

    # Update password
    db_user.password_hash = new_password_hash
    await db.flush()

    return True, "Password changed successfully"


async def delete_user(db: AsyncSession, user_id: UUID) -> bool:
    """
    Delete a user (editors only).

    Args:
        db: Database session
        user_id: User UUID to delete

    Returns:
        True if deleted, False if not found
    """
    db_user = await get_user(db, user_id)
    if db_user:
        await db.delete(db_user)
        await db.flush()
        return True
    return False
