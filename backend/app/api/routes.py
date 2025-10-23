"""API routes."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import crud, schemas
from ..database import get_db

router = APIRouter()


# Operations endpoints
@router.get("/operations", response_model=list[schemas.Operation])
async def read_operations(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)) -> list[schemas.Operation]:
    """Get all operations."""
    operations = await crud.get_operations(db, skip=skip, limit=limit)
    return operations


@router.get("/operations/{operation_id}", response_model=schemas.Operation)
async def read_operation(operation_id: int, db: AsyncSession = Depends(get_db)) -> schemas.Operation:
    """Get a specific operation."""
    db_operation = await crud.get_operation(db, operation_id=operation_id)
    if db_operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operation not found")
    return db_operation


@router.post("/operations", response_model=schemas.Operation, status_code=status.HTTP_201_CREATED)
async def create_operation(operation: schemas.OperationCreate, db: AsyncSession = Depends(get_db)) -> schemas.Operation:
    """Create a new operation."""
    return await crud.create_operation(db=db, operation=operation)


@router.put("/operations/{operation_id}", response_model=schemas.Operation)
async def update_operation(
    operation_id: int, operation: schemas.OperationUpdate, db: AsyncSession = Depends(get_db)
) -> schemas.Operation:
    """Update an operation."""
    db_operation = await crud.update_operation(db, operation_id=operation_id, operation=operation)
    if db_operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operation not found")
    return db_operation


@router.delete("/operations/{operation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_operation(operation_id: int, db: AsyncSession = Depends(get_db)) -> None:
    """Delete an operation."""
    success = await crud.delete_operation(db, operation_id=operation_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operation not found")


# Personnel endpoints
@router.get("/personnel", response_model=list[schemas.Personnel])
async def read_personnel(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)) -> list[schemas.Personnel]:
    """Get all personnel."""
    personnel = await crud.get_personnel(db, skip=skip, limit=limit)
    return personnel


@router.get("/personnel/{person_id}", response_model=schemas.Personnel)
async def read_person(person_id: int, db: AsyncSession = Depends(get_db)) -> schemas.Personnel:
    """Get a specific person."""
    db_person = await crud.get_person(db, person_id=person_id)
    if db_person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")
    return db_person


@router.post("/personnel", response_model=schemas.Personnel, status_code=status.HTTP_201_CREATED)
async def create_person(person: schemas.PersonnelCreate, db: AsyncSession = Depends(get_db)) -> schemas.Personnel:
    """Create a new person."""
    return await crud.create_person(db=db, person=person)


@router.put("/personnel/{person_id}", response_model=schemas.Personnel)
async def update_person(
    person_id: int, person: schemas.PersonnelUpdate, db: AsyncSession = Depends(get_db)
) -> schemas.Personnel:
    """Update a person."""
    db_person = await crud.update_person(db, person_id=person_id, person=person)
    if db_person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")
    return db_person


# Materials endpoints
@router.get("/materials", response_model=list[schemas.Material])
async def read_materials(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)) -> list[schemas.Material]:
    """Get all materials."""
    materials = await crud.get_materials(db, skip=skip, limit=limit)
    return materials


@router.get("/materials/{material_id}", response_model=schemas.Material)
async def read_material(material_id: int, db: AsyncSession = Depends(get_db)) -> schemas.Material:
    """Get a specific material."""
    db_material = await crud.get_material(db, material_id=material_id)
    if db_material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return db_material


@router.post("/materials", response_model=schemas.Material, status_code=status.HTTP_201_CREATED)
async def create_material(material: schemas.MaterialCreate, db: AsyncSession = Depends(get_db)) -> schemas.Material:
    """Create a new material."""
    return await crud.create_material(db=db, material=material)


@router.put("/materials/{material_id}", response_model=schemas.Material)
async def update_material(
    material_id: int, material: schemas.MaterialUpdate, db: AsyncSession = Depends(get_db)
) -> schemas.Material:
    """Update a material."""
    db_material = await crud.update_material(db, material_id=material_id, material=material)
    if db_material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return db_material
