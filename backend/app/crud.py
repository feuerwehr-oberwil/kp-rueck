"""CRUD operations using async SQLAlchemy."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models, schemas


# Operations CRUD
async def get_operations(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[models.Operation]:
    """Get all operations."""
    result = await db.execute(select(models.Operation).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_operation(db: AsyncSession, operation_id: int) -> models.Operation | None:
    """Get a specific operation."""
    result = await db.execute(select(models.Operation).where(models.Operation.id == operation_id))
    return result.scalar_one_or_none()


async def create_operation(db: AsyncSession, operation: schemas.OperationCreate) -> models.Operation:
    """Create a new operation."""
    db_operation = models.Operation(**operation.model_dump())
    db.add(db_operation)
    await db.flush()
    await db.refresh(db_operation)
    return db_operation


async def update_operation(
    db: AsyncSession, operation_id: int, operation: schemas.OperationUpdate
) -> models.Operation | None:
    """Update an operation."""
    db_operation = await get_operation(db, operation_id)
    if db_operation:
        update_data = operation.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_operation, key, value)
        await db.flush()
        await db.refresh(db_operation)
    return db_operation


async def delete_operation(db: AsyncSession, operation_id: int) -> bool:
    """Delete an operation."""
    db_operation = await get_operation(db, operation_id)
    if db_operation:
        await db.delete(db_operation)
        await db.flush()
        return True
    return False


# Personnel CRUD
async def get_personnel(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[models.Personnel]:
    """Get all personnel."""
    result = await db.execute(select(models.Personnel).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_person(db: AsyncSession, person_id: int) -> models.Personnel | None:
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


async def update_person(db: AsyncSession, person_id: int, person: schemas.PersonnelUpdate) -> models.Personnel | None:
    """Update a person."""
    db_person = await get_person(db, person_id)
    if db_person:
        update_data = person.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_person, key, value)
        await db.flush()
        await db.refresh(db_person)
    return db_person


# Materials CRUD
async def get_materials(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[models.Material]:
    """Get all materials."""
    result = await db.execute(select(models.Material).offset(skip).limit(limit))
    return list(result.scalars().all())


async def get_material(db: AsyncSession, material_id: int) -> models.Material | None:
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
    db: AsyncSession, material_id: int, material: schemas.MaterialUpdate
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
