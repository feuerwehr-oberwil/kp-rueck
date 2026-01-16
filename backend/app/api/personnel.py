"""Personnel management API endpoints."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import personnel as crud
from ..database import get_db
from ..models import Personnel
from ..websocket_manager import broadcast_personnel_update

router = APIRouter(prefix="/personnel", tags=["personnel"])


@router.get("/", response_model=list[schemas.Personnel])
async def list_personnel(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    checked_in_only: bool = False,
    event_id: uuid.UUID | None = None,
):
    """
    List all personnel.

    Use checked_in_only=true with event_id to show only personnel checked in for a specific event.
    """
    return await crud.get_all_personnel(db, checked_in_only=checked_in_only, event_id=event_id)


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
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Create new personnel (editor only)."""
    new_personnel = await crud.create_personnel(db, personnel, current_user, request)

    # Convert to Pydantic and broadcast WebSocket update
    personnel_response = schemas.Personnel.model_validate(new_personnel)
    background_tasks.add_task(broadcast_personnel_update, personnel_response.model_dump(mode="json"), "create")

    return personnel_response


@router.put("/{personnel_id}", response_model=schemas.Personnel)
async def update_personnel(
    personnel_id: uuid.UUID,
    personnel: schemas.PersonnelUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Update personnel (editor only)."""
    updated = await crud.update_personnel(db, personnel_id, personnel, current_user, request)
    if not updated:
        raise HTTPException(status_code=404, detail="Personnel not found")

    # Convert to Pydantic and broadcast WebSocket update
    personnel_response = schemas.Personnel.model_validate(updated)
    background_tasks.add_task(broadcast_personnel_update, personnel_response.model_dump(mode="json"), "update")

    return personnel_response


@router.delete("/{personnel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_personnel(
    personnel_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Delete personnel (editor only) - soft delete."""
    success = await crud.delete_personnel(db, personnel_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Personnel not found")

    # Broadcast WebSocket update for deletion
    background_tasks.add_task(broadcast_personnel_update, {"id": str(personnel_id)}, "delete")


@router.post("/categories/sort-order", status_code=status.HTTP_200_OK)
async def update_role_sort_orders(
    sort_update: schemas.BulkCategorySortOrderUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """
    Update sort orders for personnel role categories (editor only).

    This endpoint allows reordering how personnel are grouped by role.
    All personnel with the same role will get the same sort_order value.
    """
    # Update sort order for each role category
    for category_update in sort_update.categories:
        await db.execute(
            update(Personnel)
            .where(Personnel.role == category_update.category)
            .values(role_sort_order=category_update.sort_order)
        )

    await db.commit()
    return {"status": "success", "updated_categories": len(sort_update.categories)}
