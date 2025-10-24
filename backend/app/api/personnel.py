"""Personnel management API endpoints."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import personnel as crud
from ..database import get_db

router = APIRouter(prefix="/personnel", tags=["personnel"])


@router.get("/", response_model=list[schemas.Personnel])
async def list_personnel(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all personnel (all users)."""
    return await crud.get_all_personnel(db)


@router.get("/{personnel_id}", response_model=schemas.Personnel)
async def get_personnel(
    personnel_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get single personnel by ID."""
    personnel = await crud.get_personnel(db, personnel_id)
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel not found")
    return personnel


@router.post("/", response_model=schemas.Personnel, status_code=status.HTTP_201_CREATED)
async def create_personnel(
    personnel: schemas.PersonnelCreate,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Create new personnel (editor only)."""
    return await crud.create_personnel(db, personnel, current_user, request)


@router.put("/{personnel_id}", response_model=schemas.Personnel)
async def update_personnel(
    personnel_id: uuid.UUID,
    personnel: schemas.PersonnelUpdate,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Update personnel (editor only)."""
    updated = await crud.update_personnel(db, personnel_id, personnel, current_user, request)
    if not updated:
        raise HTTPException(status_code=404, detail="Personnel not found")
    return updated


@router.delete("/{personnel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_personnel(
    personnel_id: uuid.UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Delete personnel (editor only) - soft delete."""
    success = await crud.delete_personnel(db, personnel_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Personnel not found")
