"""Auftrag (incident group) API endpoints.

An Auftrag is an ordered, lightweight container over real incidents. Mutations
broadcast a ``group_update`` WS event; membership changes additionally emit an
``incident_update`` refresh so boards re-fetch the affected stops.
"""

import logging
import uuid
from typing import Annotated, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import events as events_crud
from ..crud import group_assignments as ga_crud
from ..crud import groups as crud
from ..crud.manual_order import OrderChangedError
from ..crud.planned_assignments import ResourceBusyError
from ..database import get_db
from ..models import IncidentGroup, IncidentGroupAssignment
from ..utils.error_codes import CodedHTTPException, ErrorCode
from ..utils.errors import ErrorMessages
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
) -> list[schemas.IncidentGroupResponse]:
    """List the Aufträge for an event, with derived stop_ids + progress."""
    return await crud.list_groups_by_event(db, event_id)


@router.post("/", response_model=schemas.IncidentGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    group: schemas.IncidentGroupCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.IncidentGroupResponse:
    """Create a new Auftrag (editor only). Verifies the event exists."""
    event = await events_crud.get_event_by_id(db, group.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.EVENT_NOT_FOUND)

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
) -> None:
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
) -> schemas.IncidentGroupResponse:
    """Update an Auftrag's name/color/notes (editor only)."""
    group = await crud.update_group(db, group_id, group_update, current_user, request)
    if not group:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    response = await crud.build_group_response(db, group)
    background_tasks.add_task(broadcast_group_update, response.model_dump(mode="json"), "update")
    return response


@router.post("/{group_id}/announce", response_model=schemas.IncidentGroupResponse)
async def record_group_announcement(
    group_id: uuid.UUID,
    announcement: schemas.GroupAnnouncementRequest,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.IncidentGroupResponse:
    """Record the Funkdurchsage that was just made for an Auftrag (editor only).

    The next stop of the same Auftrag reads this back to decide between the full
    announcement and the short «weiter mit Stop N» form. Broadcast so the second
    device and the wall screen agree on what has already been read out.
    """
    group = await crud.record_announcement(db, group_id, announcement)
    if not group:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

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
) -> None:
    """Soft-delete an Auftrag (editor only); its stops stay on the board, ungrouped."""
    group = await crud.soft_delete_group(db, group_id, current_user, request)
    if not group:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

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
) -> None:
    """Persist the manual order of the stops within one Auftrag (editor only).

    With ``expected_ids`` the reorder is conditional (409 when the current order
    differs) — used by the undo after a route optimisation.
    """
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    try:
        updated = await crud.reorder_group_stops(db, group_id, reorder.ordered_ids, reorder.expected_ids)
    except OrderChangedError:
        # Nothing was written (the check precedes the first write); get_db rolls
        # back and releases the Auftrag lock. German like every API detail; the
        # board shows its own localized text.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Auftrag wurde inzwischen geändert",
        ) from None

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
) -> schemas.IncidentGroupResponse:
    """Attach existing incidents to an Auftrag as stops (editor only).

    With ``via_vehicle_id`` the add is conditional (409 when an Einsatz is gone, closed or in
    an Auftrag meanwhile, or the vehicle left this one) – the #23 question's answer. With
    ``only_unassigned`` (a release's «Rückgängig») it is 409 when a stop is gone or in
    another Auftrag now.
    """
    try:
        attached = await crud.add_stops_to_group(
            db,
            group_id,
            body.incident_ids,
            current_user,
            request,
            via_vehicle_id=body.via_vehicle_id,
            only_unassigned=body.only_unassigned,
        )
    except crud.StopsChangedError:
        # Nothing was written; get_db rolls back. German like every API detail; the
        # board says it in its own words.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Einsatz oder Auftrag wurde inzwischen geändert",
        ) from None

    if attached is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    # add_stops_to_group returned a non-None result, so the Auftrag exists.
    group = cast(IncidentGroup, await crud.get_group(db, group_id))
    response = await crud.build_group_response(db, group)

    background_tasks.add_task(broadcast_group_update, response.model_dump(mode="json"), "update")
    background_tasks.add_task(broadcast_incident_update, {"event_id": str(group.event_id)}, "refresh")
    return response


@router.post("/{group_id}/transfer", response_model=schemas.TransferToAuftragResponse)
async def transfer_to_auftrag(
    group_id: uuid.UUID,
    body: schemas.TransferToAuftragRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.TransferToAuftragResponse:
    """«Übertragen» an Einsatz onto this Auftrag (editor only): it becomes the last stop,
    its crew, vehicles and material move to the Auftrag (``crud.transfer_to_auftrag``).

    409 when the Einsatz is closed or already a stop, every stop of the Auftrag is closed,
    or a resource may not be assigned.
    """
    try:
        result = await crud.transfer_to_auftrag(db, group_id, body.incident_id, current_user, request)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND) from e
    await _broadcast_membership(background_tasks, db, group_id)
    return schemas.TransferToAuftragResponse.model_validate(result)


@router.post("/{group_id}/transfer/undo", status_code=status.HTTP_204_NO_CONTENT)
async def undo_transfer_to_auftrag(
    group_id: uuid.UUID,
    body: schemas.TransferToAuftragUndoRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> None:
    """«Rückgängig» of a transfer onto an Auftrag (editor only): 409 once anything changed."""
    try:
        await crud.undo_transfer_to_auftrag(
            db,
            group_id,
            body.incident_id,
            body.group_assignment_ids,
            body.released_assignment_ids,
            current_user,
            request,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND) from e
    await _broadcast_membership(background_tasks, db, group_id)


async def _broadcast_membership(background_tasks: BackgroundTasks, db: AsyncSession, group_id: uuid.UUID) -> None:
    """Stops and resources both changed: the Auftrag, then a board refresh of incidents and assignments."""
    group = cast(IncidentGroup, await crud.get_group(db, group_id))
    response = await crud.build_group_response(db, group)
    event = {"event_id": str(group.event_id)}
    background_tasks.add_task(broadcast_group_update, response.model_dump(mode="json"), "update")
    background_tasks.add_task(broadcast_incident_update, event, "refresh")
    background_tasks.add_task(broadcast_assignment_update, {"group_id": str(group_id)} | event, "refresh")


@router.delete("/{group_id}/stops/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_stop(
    group_id: uuid.UUID,
    incident_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> None:
    """Detach a stop from an Auftrag (editor only); the incident stays on the board."""
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    success = await crud.remove_stop_from_group(db, group_id, incident_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Stopp gehört nicht zu diesem Auftrag")

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
) -> schemas.GroupAssignmentResponse:
    """Assign a resource directly to an Auftrag (editor only).

    The resource is shared across ALL the Auftrag's stops and may be assigned
    even when the Auftrag has zero stops. A duplicate active assignment on the
    same Auftrag, or a resource ``ensure_assignable`` refuses (archived), is a 409.
    """
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    try:
        result = await ga_crud.assign_group_resource(
            db=db,
            group_id=group_id,
            resource_type=assignment.resource_type,
            resource_id=assignment.resource_id,
            current_user=current_user,
            request=request,
            exclusive=True,
        )
    except LookupError as e:
        # The Auftrag was deleted between the check above and the lock.
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND) from e
    except ResourceBusyError as e:
        raise CodedHTTPException(409, ErrorCode.RESOURCE_BUSY, str(e), params={"holders": ", ".join(e.holders)}) from e

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
) -> None:
    """Release a route-level resource from an Auftrag (editor only)."""
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    success = await ga_crud.unassign_group_resource(db, group_id, assignment_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail=ErrorMessages.ASSIGNMENT_NOT_FOUND)

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
) -> list[IncidentGroupAssignment]:
    """List an Auftrag's active route-level assignments."""
    return await ga_crud.get_group_assignments(db, group_id)


@router.patch("/{group_id}/assignments/{assignment_id}", response_model=schemas.GroupAssignmentResponse)
async def update_group_assignment(
    group_id: uuid.UUID,
    assignment_id: uuid.UUID,
    update: schemas.GroupAssignmentUpdate,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.GroupAssignmentResponse:
    """Update a route-level assignment – the Einsatzleiter flag or a vehicle's driver stay.

    A route's stops own no resources, so a stop that belongs to an Auftrag takes
    its leader from here: one squad working a route has one leader, not one per
    stop on it.
    """
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    try:
        assignment = await ga_crud.update_group_assignment(db, group_id, assignment_id, update)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ErrorMessages.CONFLICT) from e
    if not assignment:
        raise HTTPException(status_code=404, detail=ErrorMessages.ASSIGNMENT_NOT_FOUND)

    # Re-read the Auftrag after the write: building a response from a stale
    # reference lazy-loads outside the greenlet — a 500 on the one call that pins a route's
    # Einsatzleiter. Which is why an Auftrag never had one.
    group = await crud.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.AUFTRAG_NOT_FOUND)

    # Every other write in this file broadcasts; without this the new
    # Einsatzleiter is visible only on the screen that set it, because polling
    # runs only while the socket is DOWN.
    group_response = await crud.build_group_response(db, group)
    background_tasks.add_task(broadcast_group_update, group_response.model_dump(mode="json"), "update")
    background_tasks.add_task(
        broadcast_assignment_update,
        {"group_id": str(group_id), "event_id": str(group.event_id)},
        "refresh",
    )
    return assignment
