"""Assignment API endpoints."""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import assignments as crud
from ..database import get_db
from ..models import IncidentAssignment
from ..utils.error_codes import CodedHTTPException, ErrorCode
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_assignment_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incidents", tags=["assignments"])


@router.post("/{incident_id}/assign", response_model=schemas.AssignmentResponse)
async def assign_resource(
    incident_id: uuid.UUID,
    assignment: schemas.AssignmentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.AssignmentResponse:
    """
    Assign resource to incident (editor only).

    A resource already bound to another incident is rejected with 409
    (``crud.assign_resource`` raises ``ValueError``); the frontend surfaces the
    conflict (vehicles offer a move/keep dialog, personnel/material are filtered
    out of the picker).

    A missing incident or resource is a 404 (``LookupError``) — previously the first
    crashed on a foreign-key violation and the second quietly stored an orphan row.
    A resource ``crud.ensure_assignable`` refuses (archived inventory) is a 409.
    """
    try:
        result = await crud.assign_resource(
            db=db,
            incident_id=incident_id,
            resource_type=assignment.resource_type,
            resource_id=assignment.resource_id,
            current_user=current_user,
            request=request,
        )
    except LookupError as e:
        # Not warn-worthy: a stale id from a client that missed a delete is routine.
        logger.info("Assignment target missing for incident %s: %s", incident_id, e)
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND) from e
    except crud.ResourceNotAssignableError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except crud.IncidentNotOnBoardError as e:
        raise HTTPException(
            status_code=409, detail="Dieser Einsatz ist nicht mehr auf dem Board (gelöscht oder zusammengeführt)."
        ) from e
    except ValueError as e:
        logger.warning("Assignment conflict for incident %s: %s", incident_id, e)
        raise CodedHTTPException(409, ErrorCode.ASSIGNMENT_RACE, ErrorMessages.RESOURCE_ALREADY_ASSIGNED) from e

    # Convert SQLAlchemy model to Pydantic for response
    assignment_response = schemas.AssignmentResponse.model_validate(result)

    # Broadcast WebSocket update
    background_tasks.add_task(broadcast_assignment_update, assignment_response.model_dump(mode="json"), "create")

    return assignment_response


@router.post("/{incident_id}/unassign/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_resource(
    incident_id: uuid.UUID,
    assignment_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Release resource from incident.

    404 when the assignment does not belong to ``incident_id`` – the path names the
    card the operator acted on, and a mismatched id must not release another one.
    """
    released = await crud.unassign_resource(
        db=db,
        assignment_id=assignment_id,
        current_user=current_user,
        request=request,
        incident_id=incident_id,
    )

    if released is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.ASSIGNMENT_NOT_FOUND)

    # Broadcast WebSocket update for deletion – the parent as stored on the row.
    background_tasks.add_task(
        broadcast_assignment_update, {"id": str(assignment_id), "incident_id": str(released.incident_id)}, "delete"
    )


@router.post("/{incident_id}/material-collected/{assignment_id}", response_model=schemas.MaterialCollectedResponse)
async def collect_material(
    incident_id: uuid.UUID,
    assignment_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.MaterialCollectedResponse:
    """«Abgeholt – freigeben»: a unit left on site was collected (editor only).

    Releases exactly this material assignment and records «Abgeholt» in the journal and the
    Chronik. Answers the release time, which the undo must send back. 404 when it is no
    material assignment of ``incident_id``; 409 when it is already released or the rapport no
    longer marks it «vor Ort verblieben». The undo is ``DELETE`` on the same path.
    """
    try:
        released_at = await crud.collect_material(
            db, incident_id=incident_id, assignment_id=assignment_id, current_user=current_user, request=request
        )
    except crud.MaterialCollectRefusedError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if released_at is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.ASSIGNMENT_NOT_FOUND)
    background_tasks.add_task(
        broadcast_assignment_update, {"id": str(assignment_id), "incident_id": str(incident_id)}, "delete"
    )
    return schemas.MaterialCollectedResponse(released_at=released_at)


@router.delete("/{incident_id}/material-collected/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def undo_collect_material(
    incident_id: uuid.UUID,
    assignment_id: uuid.UUID,
    released_at: datetime,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Undo «Abgeholt»: the same assignment is open again, so the unit is back on the
    Restliste (editor only). ``released_at`` is what the POST answered. 409 when the row's
    current release is not that collection, or the unit is archived or assigned elsewhere
    (an Einsatz or an Auftrag)."""
    try:
        restored = await crud.undo_collect_material(
            db,
            incident_id=incident_id,
            assignment_id=assignment_id,
            released_at=released_at,
            current_user=current_user,
            request=request,
        )
    except crud.MaterialCollectRefusedError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if restored is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.ASSIGNMENT_NOT_FOUND)
    background_tasks.add_task(
        broadcast_assignment_update, {"id": str(assignment_id), "incident_id": str(incident_id)}, "create"
    )


@router.get("/{incident_id}/assignments", response_model=list[schemas.AssignmentResponse])
async def get_assignments(
    incident_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[IncidentAssignment]:
    """Get all active assignments for incident."""
    return await crud.get_incident_assignments(db, incident_id)


@router.patch("/{incident_id}/assignments/{assignment_id}", response_model=schemas.AssignmentResponse)
async def update_assignment(
    incident_id: uuid.UUID,
    assignment_id: uuid.UUID,
    update: schemas.AssignmentUpdate,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.AssignmentResponse:
    """Update assignment properties (driver_stay flag, Einsatzleiter)."""
    try:
        assignment = await crud.update_assignment(db, assignment_id, update, incident_id=incident_id)
    except crud.AssignmentReleasedError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        # Currently: marking a non-personnel assignment as Einsatzleiter.
        raise HTTPException(status_code=422, detail=str(e)) from e
    except IntegrityError as e:
        # Two editors promoting someone on the same incident at the same moment
        # collide on `uq_assignments_single_leader`. That is a conflict, not a
        # server fault — say so, so the client can refetch and show what won.
        await db.rollback()
        raise HTTPException(status_code=409, detail=ErrorMessages.CONFLICT) from e
    if not assignment:
        raise HTTPException(status_code=404, detail=ErrorMessages.ASSIGNMENT_NOT_FOUND)

    # "driver_stay" lets other clients apply the change surgically (just the
    # on-site flag on the matching assignment) instead of a full board reload.
    # An Einsatzleiter change must NOT use it: the client resolves that action
    # against its vehicle assignments only, so a personnel row silently matches
    # nothing and the update is dropped — the new EL would be visible to the
    # person who set it and to nobody else. Any other action falls through to
    # the full-reload path on the client.
    action = "leader" if "is_leader" in update.model_dump(exclude_unset=True) else "driver_stay"
    response = schemas.AssignmentResponse.model_validate(assignment)
    background_tasks.add_task(broadcast_assignment_update, response.model_dump(mode="json"), action)
    return response


# Bulk assignments endpoint (outside incidents prefix)
from fastapi import APIRouter as NewRouter

bulk_router = NewRouter(prefix="/assignments", tags=["assignments"])


@bulk_router.get("/by-event/{event_id}", response_model=None)
async def get_assignments_by_event(
    event_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, list[schemas.AssignmentResponse]]:
    """
    Get all assignments for all incidents in an event.

    Optimizes frontend by returning all assignments in one request
    instead of N separate requests (one per incident).

    Returns:
        Dictionary mapping incident_id to list of assignments
    """
    assignments = await crud.get_assignments_by_event(db, event_id)

    # Convert UUID keys to strings for JSON serialization
    return {str(incident_id): assignments_list for incident_id, assignments_list in assignments.items()}
