"""API routes."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db

router = APIRouter()


# ============================================
# Incident endpoints (formerly Operations)
# ============================================


@router.get("/incidents", response_model=list[schemas.Incident])
async def read_incidents(
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
) -> list[schemas.Incident]:
    """Get all incidents (requires authentication)."""
    incidents = await crud.get_incidents(db, skip=skip, limit=limit)
    return incidents


@router.get("/incidents/{incident_id}", response_model=schemas.Incident)
async def read_incident(
    incident_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
) -> schemas.Incident:
    """Get a specific incident (requires authentication)."""
    db_incident = await crud.get_incident(db, incident_id=incident_id)
    if db_incident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    return db_incident


@router.post("/incidents", response_model=schemas.Incident, status_code=status.HTTP_201_CREATED)
async def create_incident(
    incident: schemas.IncidentCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Incident:
    """Create a new incident (editor only)."""
    return await crud.create_incident(db=db, incident=incident)


@router.put("/incidents/{incident_id}", response_model=schemas.Incident)
async def update_incident(
    incident_id: UUID,
    incident: schemas.IncidentUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Incident:
    """Update an incident (editor only)."""
    db_incident = await crud.update_incident(db, incident_id=incident_id, incident=incident)
    if db_incident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    return db_incident


@router.delete("/incidents/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> None:
    """Delete an incident (editor only)."""
    success = await crud.delete_incident(db, incident_id=incident_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")


# ============================================
# Personnel endpoints
# ============================================


@router.get("/personnel", response_model=list[schemas.Personnel])
async def read_personnel(
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
) -> list[schemas.Personnel]:
    """Get all personnel (requires authentication)."""
    personnel = await crud.get_personnel(db, skip=skip, limit=limit)
    return personnel


@router.get("/personnel/{person_id}", response_model=schemas.Personnel)
async def read_person(
    person_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
) -> schemas.Personnel:
    """Get a specific person (requires authentication)."""
    db_person = await crud.get_person(db, person_id=person_id)
    if db_person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")
    return db_person


@router.post("/personnel", response_model=schemas.Personnel, status_code=status.HTTP_201_CREATED)
async def create_person(
    person: schemas.PersonnelCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Personnel:
    """Create a new person (editor only)."""
    return await crud.create_person(db=db, person=person)


@router.put("/personnel/{person_id}", response_model=schemas.Personnel)
async def update_person(
    person_id: UUID,
    person: schemas.PersonnelUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Personnel:
    """Update a person (editor only)."""
    db_person = await crud.update_person(db, person_id=person_id, person=person)
    if db_person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")
    return db_person


# ============================================
# Vehicle endpoints
# ============================================


@router.get("/vehicles", response_model=list[schemas.Vehicle])
async def read_vehicles(
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
) -> list[schemas.Vehicle]:
    """Get all vehicles (requires authentication)."""
    vehicles = await crud.get_vehicles(db, skip=skip, limit=limit)
    return vehicles


@router.get("/vehicles/{vehicle_id}", response_model=schemas.Vehicle)
async def read_vehicle(
    vehicle_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
) -> schemas.Vehicle:
    """Get a specific vehicle (requires authentication)."""
    db_vehicle = await crud.get_vehicle(db, vehicle_id=vehicle_id)
    if db_vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return db_vehicle


@router.post("/vehicles", response_model=schemas.Vehicle, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    vehicle: schemas.VehicleCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Vehicle:
    """Create a new vehicle (editor only)."""
    return await crud.create_vehicle(db=db, vehicle=vehicle)


@router.put("/vehicles/{vehicle_id}", response_model=schemas.Vehicle)
async def update_vehicle(
    vehicle_id: UUID,
    vehicle: schemas.VehicleUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Vehicle:
    """Update a vehicle (editor only)."""
    db_vehicle = await crud.update_vehicle(db, vehicle_id=vehicle_id, vehicle=vehicle)
    if db_vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return db_vehicle


# ============================================
# Materials endpoints
# ============================================


@router.get("/materials", response_model=list[schemas.Material])
async def read_materials(
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db)
) -> list[schemas.Material]:
    """Get all materials (requires authentication)."""
    materials = await crud.get_materials(db, skip=skip, limit=limit)
    return materials


@router.get("/materials/{material_id}", response_model=schemas.Material)
async def read_material(
    material_id: UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
) -> schemas.Material:
    """Get a specific material (requires authentication)."""
    db_material = await crud.get_material(db, material_id=material_id)
    if db_material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return db_material


@router.post("/materials", response_model=schemas.Material, status_code=status.HTTP_201_CREATED)
async def create_material(
    material: schemas.MaterialCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Material:
    """Create a new material (editor only)."""
    return await crud.create_material(db=db, material=material)


@router.put("/materials/{material_id}", response_model=schemas.Material)
async def update_material(
    material_id: UUID,
    material: schemas.MaterialUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
) -> schemas.Material:
    """Update a material (editor only)."""
    db_material = await crud.update_material(db, material_id=material_id, material=material)
    if db_material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return db_material
