"""«Danach» – planned assignments (Jetzt / Danach, owner picks 24.11.2026).

The board plans a resource for an Einsatz or an Auftrag after its current work, lists the
Ereignis's plans with their queue place and readiness, answers the «Danach frei» to-do
(«Zuteilen» = promote, «Verwerfen» = dismiss) and removes plans. Rules: ``crud.planned_assignments``.

Every change broadcasts ``planned_assignment_update`` with the Ereignis id; boards refetch the
list (readiness also changes on any assignment release, so they refetch on those too).
"""

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import assignments as assignments_crud
from ..crud import group_assignments as ga_crud
from ..crud import planned_assignments as crud
from ..database import get_db
from ..models import IncidentAssignment, PlannedAssignment
from ..utils.error_codes import CodedHTTPException, ErrorCode
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_assignment_update, broadcast_planned_assignment_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/planned-assignments", tags=["planned-assignments"])


def _response(view: crud.PlannedView) -> schemas.PlannedAssignmentResponse:
    return schemas.PlannedAssignmentResponse.model_validate(view.row).model_copy(
        update={"position": view.position, "ready": view.ready}
    )


@router.get("/", response_model=list[schemas.PlannedAssignmentResponse])
async def list_planned(
    event_id: Annotated[uuid.UUID, Query()],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[schemas.PlannedAssignmentResponse]:
    """The Ereignis's Danach on live holders, each resource's queue in order."""
    return [_response(v) for v in await crud.list_for_event(db, event_id)]


@router.post("/", response_model=schemas.PlannedAssignmentResponse, status_code=status.HTTP_201_CREATED)
async def plan_resource(
    body: schemas.PlannedAssignmentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.PlannedAssignmentResponse:
    """«Danach vormerken» – at the end of the resource's queue (editor only).

    404: target or resource unknown. 409 ``plan_refused``: closed target, consumable material,
    already Jetzt or planned there; 409: ``ensure_assignable`` refused the resource.
    """
    try:
        row = await crud.plan_resource(
            db,
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            incident_id=body.incident_id,
            group_id=body.incident_group_id,
            current_user=current_user,
            request=request,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND) from e
    except crud.PlanRefusedError as e:
        raise CodedHTTPException(409, ErrorCode.PLAN_REFUSED, str(e)) from e
    except assignments_crud.ResourceNotAssignableError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    view = next((v for v in await crud.list_for_event(db, row.event_id) if v.row.id == row.id), None)
    background_tasks.add_task(broadcast_planned_assignment_update, str(row.event_id))
    return _response(view) if view else schemas.PlannedAssignmentResponse.model_validate(row)


@router.patch("/{planned_id}", response_model=schemas.PlannedAssignmentResponse)
async def update_planned(
    planned_id: uuid.UUID,
    body: schemas.PlannedAssignmentUpdate,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.PlannedAssignmentResponse:
    """«Verwerfen» of the «Danach frei» to-do, or its undo (editor only). The plan stays."""
    row = await crud.set_dismissed(db, planned_id, body.dismissed)
    if row is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND)
    view = next((v for v in await crud.list_for_event(db, row.event_id) if v.row.id == row.id), None)
    background_tasks.add_task(broadcast_planned_assignment_update, str(row.event_id))
    return _response(view) if view else schemas.PlannedAssignmentResponse.model_validate(row)


@router.delete("/{planned_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_planned(
    planned_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> None:
    """«Vormerkung löschen» (editor only). 404 when it is gone already."""
    row = await crud.remove_plan(db, planned_id, current_user, request)
    if row is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND)
    background_tasks.add_task(broadcast_planned_assignment_update, str(row.event_id))


@router.post("/{planned_id}/promote", response_model=schemas.AssignmentResponse | schemas.GroupAssignmentResponse)
async def promote_planned(
    planned_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.AssignmentResponse | schemas.GroupAssignmentResponse:
    """«Zuteilen»: the Danach becomes Jetzt (editor only).

    404: the plan is gone (answered by somebody else). 409 ``resource_busy``: the resource is
    still Jetzt elsewhere – release it there first, or wait. Other 409s as the assign routes.
    """
    plan = await db.get(PlannedAssignment, planned_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND)
    event_id = str(plan.event_id)
    try:
        result = await crud.promote(db, planned_id, current_user, request)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND) from e
    except crud.ResourceBusyError as e:
        raise CodedHTTPException(409, ErrorCode.RESOURCE_BUSY, str(e), params={"holders": ", ".join(e.holders)}) from e
    except (assignments_crud.ResourceNotAssignableError, assignments_crud.IncidentNotOnBoardError) as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except (ga_crud.ResourceNotFoundError, ga_crud.ResourceTypeMismatchError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise CodedHTTPException(409, ErrorCode.ASSIGNMENT_RACE, ErrorMessages.RESOURCE_ALREADY_ASSIGNED) from e

    background_tasks.add_task(broadcast_planned_assignment_update, event_id)
    if isinstance(result, IncidentAssignment):
        response = schemas.AssignmentResponse.model_validate(result)
        background_tasks.add_task(broadcast_assignment_update, response.model_dump(mode="json"), "create")
        return response
    group_response = schemas.GroupAssignmentResponse.model_validate(result)
    background_tasks.add_task(
        broadcast_assignment_update, {"group_id": str(result.incident_group_id), "event_id": event_id}, "refresh"
    )
    return group_response
