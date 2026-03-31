"""Material management API endpoints."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import materials as crud
from ..database import get_db
from ..models import Material, MaterialGroup
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
    background_tasks.add_task(broadcast_material_update, material_response.model_dump(mode="json"), "create")

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
    background_tasks.add_task(broadcast_material_update, material_response.model_dump(mode="json"), "update")

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
    background_tasks.add_task(broadcast_material_update, {"id": str(material_id)}, "delete")


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


# ============================================
# Material Group Endpoints
# ============================================

groups_router = APIRouter(prefix="/material-groups", tags=["material-groups"])


@groups_router.get("/", response_model=list[schemas.MaterialGroupResponse])
async def list_material_groups(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all material groups with their materials."""
    result = await db.execute(
        select(MaterialGroup).order_by(MaterialGroup.location_sort_order, MaterialGroup.name)
    )
    groups = result.scalars().all()
    # Eagerly load materials for each group
    for group in groups:
        await db.refresh(group, ["materials"])
    return groups


@groups_router.post("/", response_model=schemas.MaterialGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_material_group(
    group: schemas.MaterialGroupCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Create a material group and optionally assign materials to it."""
    db_group = MaterialGroup(
        name=group.name,
        description=group.description,
        location=group.location,
        location_sort_order=group.location_sort_order,
    )
    db.add(db_group)
    await db.flush()

    # Assign materials to group
    if group.material_ids:
        await db.execute(
            update(Material)
            .where(Material.id.in_(group.material_ids))
            .values(group_id=db_group.id)
        )

    await db.commit()
    await db.refresh(db_group, ["materials"])
    return db_group


@groups_router.put("/{group_id}", response_model=schemas.MaterialGroupResponse)
async def update_material_group(
    group_id: uuid.UUID,
    group_update: schemas.MaterialGroupUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Update a material group."""
    result = await db.execute(select(MaterialGroup).where(MaterialGroup.id == group_id))
    db_group = result.scalar_one_or_none()
    if not db_group:
        raise HTTPException(status_code=404, detail="Material group not found")

    update_data = group_update.model_dump(exclude_unset=True, exclude={"material_ids"})
    for field, value in update_data.items():
        setattr(db_group, field, value)

    # Update group membership if material_ids provided
    if group_update.material_ids is not None:
        # Remove all current members
        await db.execute(
            update(Material)
            .where(Material.group_id == group_id)
            .values(group_id=None)
        )
        # Add new members
        if group_update.material_ids:
            await db.execute(
                update(Material)
                .where(Material.id.in_(group_update.material_ids))
                .values(group_id=group_id)
            )

    await db.commit()
    await db.refresh(db_group, ["materials"])
    return db_group


@groups_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material_group(
    group_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Delete a material group. Materials are unlinked, not deleted."""
    result = await db.execute(select(MaterialGroup).where(MaterialGroup.id == group_id))
    db_group = result.scalar_one_or_none()
    if not db_group:
        raise HTTPException(status_code=404, detail="Material group not found")

    # Unlink all materials first
    await db.execute(
        update(Material)
        .where(Material.group_id == group_id)
        .values(group_id=None)
    )

    await db.delete(db_group)
    await db.commit()
