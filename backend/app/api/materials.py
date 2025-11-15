"""Material management API endpoints."""
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import materials as crud
from ..database import get_db
from ..models import Material
from ..websocket_manager import broadcast_material_update

router = APIRouter(prefix="/materials", tags=["materials"])


@router.get("/", response_model=list[schemas.Material])
async def list_materials(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all materials (all users)."""
    return await crud.get_all_materials(db)


@router.get("/{material_id}", response_model=schemas.Material)
async def get_material(
    material_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get single material by ID."""
    material = await crud.get_material(db, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    return material


@router.post("/", response_model=schemas.Material, status_code=status.HTTP_201_CREATED)
async def create_material(
    material: schemas.MaterialCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Create new material (editor only)."""
    new_material = await crud.create_material(db, material, current_user, request)

    # Convert to Pydantic and broadcast WebSocket update
    material_response = schemas.Material.model_validate(new_material)
    background_tasks.add_task(
        broadcast_material_update,
        material_response.model_dump(mode='json'),
        "create"
    )

    return material_response


@router.put("/{material_id}", response_model=schemas.Material)
async def update_material(
    material_id: uuid.UUID,
    material: schemas.MaterialUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Update material (editor only)."""
    updated = await crud.update_material(db, material_id, material, current_user, request)
    if not updated:
        raise HTTPException(status_code=404, detail="Material not found")

    # Convert to Pydantic and broadcast WebSocket update
    material_response = schemas.Material.model_validate(updated)
    background_tasks.add_task(
        broadcast_material_update,
        material_response.model_dump(mode='json'),
        "update"
    )

    return material_response


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Delete material (editor only) - soft delete."""
    success = await crud.delete_material(db, material_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Material not found")

    # Broadcast WebSocket update for deletion
    background_tasks.add_task(
        broadcast_material_update,
        {'id': str(material_id)},
        "delete"
    )


@router.post("/categories/sort-order", status_code=status.HTTP_200_OK)
async def update_location_sort_orders(
    sort_update: schemas.BulkCategorySortOrderUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """
    Update sort orders for material location categories (editor only).

    This endpoint allows reordering how materials are grouped by location.
    All materials with the same location will get the same sort_order value.
    """
    # Update sort order for each location category
    for category_update in sort_update.categories:
        await db.execute(
            update(Material)
            .where(Material.location == category_update.category)
            .values(location_sort_order=category_update.sort_order)
        )

    await db.commit()
    return {"status": "success", "updated_categories": len(sort_update.categories)}
