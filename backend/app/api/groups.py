"""Auftrag (incident group) API endpoints.

An Auftrag is an ordered, lightweight container over real incidents (see
``docs/plans/12-auftrag-multi-stop-routing.md``). Mutations broadcast a
``group_update`` WS event; membership changes additionally emit an
``incident_update`` refresh so boards re-fetch the affected stops.
"""

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import events as events_crud
from ..crud import group_assignments as ga_crud
from ..crud import groups as crud
from ..database import get_db
from ..websocket_manager import (
    broadcast_assignment_update,
    broadcast_group_update,
    broadcast_incident_update,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incident-groups", tags=["incident-groups"])


@router.get("/", response_model=list[schemas.IncidentGroupResponse])
async def list_groups(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    event_id: uuid.UUID,
):
    """List the Aufträge for an event, with derived stop_ids + progress."""
    return await crud.list_groups_by_event(db, event_id)


@router.post("/", response_model=schemas.IncidentGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    group: schemas.IncidentGroupCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Create a new Auftrag (editor only). Verifies the event exists."""
    event = await events_crud.get_event_by_id(db, group.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    new_group = await crud.create_group(db, group, current_user, request)
    response = await crud.build_group_response(db, new_group)

    background_tasks.add_task(broadcast_group_update, response.model_dump(mode="json"), "create")
    return response


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_groups(
    reorder: schemas.IncidentGroupReorder,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Persist the manual order of an event's Aufträge (editor only)."""
    updated = await crud.reorder_groups(db, reorder.event_id, reorder.ordered_ids)

    if updated:
        background_tasks.add_task(
            broadcast_group_update,
            {"event_id": str(reorder.event_id), "ordered_ids": [str(i) for i in reorder.ordered_ids]},
            "reorder",
        )


@router.patch("/{group_id}", response_model=schemas.IncidentGroupResponse)
async def update_group(
    group_id: uuid.UUID,
    group_update: schemas.IncidentGroupUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Update an Auftrag's name/color/notes (editor only)."""
    group = await crud.update_group(db, group_id, group_update, current_user, request)
    if not group:
        raise HTTPException(status_code=404, detail="Auftrag not found")

    response = await crud.build_group_response(db, group)
    background_tasks.add_task(broadcast_group_update, response.model_dump(mode="json"), "update")
    return response


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Soft-delete an Auftrag (editor only); its stops stay on the board, ungrouped."""
    group = await crud.soft_delete_group(db, group_id, current_user, request)
    if not group:
        raise HTTPException(status_code=404, detail="Auftrag not found")

    event_id = str(group.event_id)
    background_tasks.add_task(broadcast_group_update, {"id": str(group_id), "event_id": event_id}, "delete")
    # Stops changed group_id → signal boards to re-fetch incidents.
    background_tasks.add_task(broadcast_incident_update, {"event_id": event_id}, "refresh")


@router.post("/{group_id}/stops/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_stops(
    group_id: uuid.UUID,
    reorder: schemas.GroupStopsReorder,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Persist the manual order of the stops within one Auftrag (editor only)."""
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Auftrag not found")

    updated = await crud.reorder_group_stops(db, group_id, reorder.ordered_ids)

    if updated:
        background_tasks.add_task(
            broadcast_group_update,
            {
                "id": str(group_id),
                "event_id": str(group.event_id),
                "ordered_ids": [str(i) for i in reorder.ordered_ids],
            },
            "stops_reorder",
        )
        # Stop order lives on the incidents themselves — refresh boards too.
        background_tasks.add_task(broadcast_incident_update, {"event_id": str(group.event_id)}, "refresh")


@router.post("/{group_id}/stops", response_model=schemas.IncidentGroupResponse)
async def add_stops(
    group_id: uuid.UUID,
    body: schemas.AddStopsRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Attach existing incidents to an Auftrag as stops (editor only)."""
    try:
        attached = await crud.add_stops_to_group(db, group_id, body.incident_ids, current_user, request)
    except ValueError as e:
        logger.warning("Add stops rejected for Auftrag %s: %s", group_id, e)
        raise HTTPException(status_code=400, detail=str(e))

    if attached is None:
        raise HTTPException(status_code=404, detail="Auftrag not found")

    group = await crud.get_group(db, group_id)
    response = await crud.build_group_response(db, group)

    background_tasks.add_task(broadcast_group_update, response.model_dump(mode="json"), "update")
    background_tasks.add_task(broadcast_incident_update, {"event_id": str(group.event_id)}, "refresh")
    return response


@router.delete("/{group_id}/stops/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_stop(
    group_id: uuid.UUID,
    incident_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Detach a stop from an Auftrag (editor only); the incident stays on the board."""
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Auftrag not found")

    success = await crud.remove_stop_from_group(db, group_id, incident_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Stop not found in this Auftrag")

    event_id = str(group.event_id)
    background_tasks.add_task(broadcast_group_update, {"id": str(group_id), "event_id": event_id}, "update")
    background_tasks.add_task(broadcast_incident_update, {"event_id": event_id}, "refresh")


@router.post("/{group_id}/assign", response_model=schemas.GroupAssignmentResponse)
async def assign_group_resource(
    group_id: uuid.UUID,
    assignment: schemas.GroupAssignmentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Assign a resource directly to an Auftrag (editor only).

    The resource is shared across ALL the Auftrag's stops and may be assigned
    even when the Auftrag has zero stops. A duplicate active assignment on the
    same Auftrag is rejected with 409.
    """
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Auftrag not found")

    try:
        result = await ga_crud.assign_group_resource(
            db=db,
            group_id=group_id,
            resource_type=assignment.resource_type,
            resource_id=assignment.resource_id,
            current_user=current_user,
            request=request,
        )
    except ga_crud.ResourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ga_crud.ResourceTypeMismatchError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        logger.warning("Group assignment conflict for Auftrag %s: %s", group_id, e)
        raise HTTPException(status_code=409, detail=str(e))

    response = schemas.GroupAssignmentResponse.model_validate(result)

    # Rebuild the group so the group_update carries its refreshed assignment list.
    group_response = await crud.build_group_response(db, group)
    background_tasks.add_task(broadcast_group_update, group_response.model_dump(mode="json"), "update")
    # The Auftrag's stops are now "covered" → nudge boards to recompute assignments.
    background_tasks.add_task(
        broadcast_assignment_update,
        {"group_id": str(group_id), "event_id": str(group.event_id)},
        "refresh",
    )
    return response


@router.post("/{group_id}/unassign/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_group_resource(
    group_id: uuid.UUID,
    assignment_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Release a route-level resource from an Auftrag (editor only)."""
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Auftrag not found")

    success = await ga_crud.unassign_group_resource(db, group_id, assignment_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Assignment not found")

    group_response = await crud.build_group_response(db, group)
    background_tasks.add_task(broadcast_group_update, group_response.model_dump(mode="json"), "update")
    background_tasks.add_task(
        broadcast_assignment_update,
        {"group_id": str(group_id), "event_id": str(group.event_id)},
        "refresh",
    )


@router.get("/{group_id}/assignments", response_model=list[schemas.GroupAssignmentResponse])
async def get_group_assignments(
    group_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """List an Auftrag's active route-level assignments."""
    return await ga_crud.get_group_assignments(db, group_id)
