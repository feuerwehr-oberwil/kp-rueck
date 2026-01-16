"""CRUD operations using async SQLAlchemy."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models, schemas

# ============================================
# Incident CRUD
# ============================================


async def get_incidents(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[models.Incident]:
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


async def get_personnel(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[models.Personnel]:
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


async def update_person(db: AsyncSession, person_id: UUID, person: schemas.PersonnelUpdate) -> models.Personnel | None:
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


async def update_vehicle(db: AsyncSession, vehicle_id: UUID, vehicle: schemas.VehicleUpdate) -> models.Vehicle | None:
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
