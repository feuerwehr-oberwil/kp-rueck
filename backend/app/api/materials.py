"""Material management API endpoints."""

import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import materials as crud
from ..database import get_db
from ..models import Material, MaterialGroup
from ..websocket_manager import broadcast_material_update

router = APIRouter(prefix="/materials", tags=["materials"])


def _archive_refused_detail(refused: crud.ArchiveRefused) -> str:
    """The 409 for archiving a deployed material — same shape as the purge's `in_use`."""
    return (
        f"«{refused.name}» steht aktuell auf {refused.active_incidents} Einsätzen und kann "
        "nicht archiviert werden – zuerst die Zuteilung aufheben."
    )


async def _with_usage(db: AsyncSession, rows: Sequence[Material]) -> list[schemas.Material]:
    """Serialise materials and attach their Einsatz history in one extra query.

    `assignment_count` is the archive line («Auf 14 Einsätzen gestanden»),
    `can_delete` says whether a permanent delete would be refused — the settings
    table greys its button on it, and the API enforces the same rule with a 409.
    """
    usage = await crud.resource_usage(db, "material", [row.id for row in rows])
    items: list[schemas.Material] = []
    for row in rows:
        item = schemas.Material.model_validate(row)
        counts = usage.get(row.id, crud.NO_USAGE)
        item.assignment_count = counts.total
        item.can_delete = counts.can_delete
        items.append(item)
    return items


@router.get("/", response_model=list[schemas.Material])
async def list_materials(
    current_user: CurrentUser,
    include_archived: bool = Query(
        False,
        description="Include archived materials. Off for the board, on for «Archivierte anzeigen».",
    ),
    db: AsyncSession = Depends(get_db),
) -> list[schemas.Material]:
    """List materials (all users). Archived rows are excluded unless asked for."""
    return await _with_usage(db, await crud.get_all_materials(db, include_archived=include_archived))


@router.get("/{material_id}", response_model=schemas.Material)
async def get_material(
    material_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> schemas.Material:
    """Get single material by ID. Archived materials are returned here."""
    material = await crud.get_material(db, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    return (await _with_usage(db, [material]))[0]


@router.post("/", response_model=schemas.Material, status_code=status.HTTP_201_CREATED)
async def create_material(
    material: schemas.MaterialCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.Material:
    """Create new material (editor only)."""
    new_material = await crud.create_material(db, material, current_user, request)

    # Convert to Pydantic and broadcast WebSocket update
    material_response = (await _with_usage(db, [new_material]))[0]
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
) -> schemas.Material:
    """Update material (editor only).

    This is also the write path for «Nicht einsatzbereit»: `{"out_of_service": true}`
    from the board's right-click menu or from the settings row, nothing else needed.
    """
    updated = await crud.update_material(db, material_id, material, current_user, request)
    if not updated:
        raise HTTPException(status_code=404, detail="Material not found")

    # Convert to Pydantic and broadcast WebSocket update
    material_response = (await _with_usage(db, [updated]))[0]
    background_tasks.add_task(broadcast_material_update, material_response.model_dump(mode="json"), "update")

    return material_response


@router.post("/{material_id}/archive", response_model=schemas.Material)
async def archive_material(
    material_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.Material:
    """Archive material (editor only) — the normal way to retire a device.

    It leaves the board, the sidebar and the assignment dialog; past Einsätze keep it.
    Refuses with 409 while the material stands on a live Einsatz — same pattern as
    the purge's `in_use` refusal. Reversible with /restore. Broadcast as a `delete`
    so live boards drop the row.
    """
    archived = await crud.archive_material(db, material_id, current_user, request)
    if not archived:
        raise HTTPException(status_code=404, detail="Material not found")
    if isinstance(archived, crud.ArchiveRefused):
        raise HTTPException(status_code=409, detail=_archive_refused_detail(archived))

    material_response = (await _with_usage(db, [archived]))[0]
    background_tasks.add_task(broadcast_material_update, {"id": str(material_id)}, "delete")

    return material_response


@router.post("/{material_id}/restore", response_model=schemas.Material)
async def restore_material(
    material_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.Material:
    """Bring an archived material back (editor only) — «Zurückholen»."""
    restored = await crud.restore_material(db, material_id, current_user, request)
    if not restored:
        raise HTTPException(status_code=404, detail="Material not found")

    material_response = (await _with_usage(db, [restored]))[0]
    background_tasks.add_task(broadcast_material_update, material_response.model_dump(mode="json"), "create")

    return material_response


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    material_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    permanent: bool = Query(
        False,
        description="Delete the row for good instead of archiving it. Only from the archive, "
        "and only for material that never stood on a live Einsatz.",
    ),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete material (editor only).

    Default is an archive — reversible, and the row really does leave every list;
    it refuses with 409 while the material stands on a live Einsatz.
    `?permanent=true` is the purge for test entries and typos; it refuses with 409
    unless the material is archived and has no live Einsatz history.
    """
    if not permanent:
        archived = await crud.archive_material(db, material_id, current_user, request)
        if not archived:
            raise HTTPException(status_code=404, detail="Material not found")
        if isinstance(archived, crud.ArchiveRefused):
            raise HTTPException(status_code=409, detail=_archive_refused_detail(archived))
        background_tasks.add_task(broadcast_material_update, {"id": str(material_id)}, "delete")
        return

    outcome = await crud.purge_material(db, material_id, current_user, request)
    if outcome.refusal == "not_found":
        raise HTTPException(status_code=404, detail="Material not found")
    if outcome.refusal == "not_archived":
        raise HTTPException(
            status_code=409,
            detail="Material muss zuerst archiviert werden, bevor es endgültig gelöscht werden kann.",
        )
    if outcome.refusal == "in_use":
        raise HTTPException(
            status_code=409,
            detail=(
                f"«{outcome.name}» stand auf {outcome.usage.protected} Einsätzen und kann nur "
                "archiviert werden – endgültiges Löschen würde deren Auswertung verfälschen."
            ),
        )

    background_tasks.add_task(broadcast_material_update, {"id": str(material_id)}, "delete")


@router.post("/categories/sort-order", status_code=status.HTTP_200_OK, response_model=None)
async def update_location_sort_orders(
    sort_update: schemas.BulkCategorySortOrderUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
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
) -> Sequence[MaterialGroup]:
    """List all material groups with their materials."""
    result = await db.execute(select(MaterialGroup).order_by(MaterialGroup.location_sort_order, MaterialGroup.name))
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
) -> MaterialGroup:
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
        await db.execute(update(Material).where(Material.id.in_(group.material_ids)).values(group_id=db_group.id))

    await db.commit()
    await db.refresh(db_group, ["materials"])
    return db_group


@groups_router.put("/{group_id}", response_model=schemas.MaterialGroupResponse)
async def update_material_group(
    group_id: uuid.UUID,
    group_update: schemas.MaterialGroupUpdate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> MaterialGroup:
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
        await db.execute(update(Material).where(Material.group_id == group_id).values(group_id=None))
        # Add new members
        if group_update.material_ids:
            await db.execute(
                update(Material).where(Material.id.in_(group_update.material_ids)).values(group_id=group_id)
            )

    await db.commit()
    await db.refresh(db_group, ["materials"])
    return db_group


@groups_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material_group(
    group_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a material group. Materials are unlinked, not deleted."""
    result = await db.execute(select(MaterialGroup).where(MaterialGroup.id == group_id))
    db_group = result.scalar_one_or_none()
    if not db_group:
        raise HTTPException(status_code=404, detail="Material group not found")

    # Unlink all materials first
    await db.execute(update(Material).where(Material.group_id == group_id).values(group_id=None))

    await db.delete(db_group)
    try:
        await db.commit()
    except IntegrityError:
        # Something still references this group (unexpected — members were just
        # unlinked). Roll back and return a clear conflict instead of a raw 500.
        await db.rollback()
        raise HTTPException(status_code=409, detail="Material group is still in use") from None
