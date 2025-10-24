"""Vehicle management API endpoints."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import vehicles as crud
from ..database import get_db

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("/", response_model=list[schemas.Vehicle])
async def list_vehicles(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all vehicles (all users)."""
    return await crud.get_all_vehicles(db)


@router.get("/{vehicle_id}", response_model=schemas.Vehicle)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get single vehicle by ID."""
    vehicle = await crud.get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@router.post("/", response_model=schemas.Vehicle, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    vehicle: schemas.VehicleCreate,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Create new vehicle (editor only)."""
    return await crud.create_vehicle(db, vehicle, current_user, request)


@router.put("/{vehicle_id}", response_model=schemas.Vehicle)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    vehicle: schemas.VehicleUpdate,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Update vehicle (editor only)."""
    updated = await crud.update_vehicle(db, vehicle_id, vehicle, current_user, request)
    if not updated:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return updated


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vehicle(
    vehicle_id: uuid.UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Delete vehicle (editor only) - soft delete."""
    success = await crud.delete_vehicle(db, vehicle_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Vehicle not found")
