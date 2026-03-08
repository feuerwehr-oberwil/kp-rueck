"""Reko Dashboard API endpoints."""

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..crud import events as events_crud
from ..crud import incidents as incidents_crud
from ..crud import reko_dashboard as crud
from ..database import get_db
from ..models import IncidentAssignment, Personnel
from ..services.tokens import generate_reko_dashboard_token, validate_reko_dashboard_token
from ..websocket_manager import broadcast_assignment_update, broadcast_incident_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reko-dashboard", tags=["reko-dashboard"])


@router.post("/generate-link", response_model=dict)
async def generate_reko_dashboard_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for Reko Dashboard"),
):
    """
    Generate Reko Dashboard link (editor only).

    Returns shareable link scoped to a specific event.
    """
    token = generate_reko_dashboard_token(event_id)
    link = f"/reko-dashboard?token={token}"

    # Get base URL from request
    base_url = str(request.base_url).rstrip("/")

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend will generate QR code from this
    }


@router.get("/personnel", response_model=schemas.RekoDashboardPersonnelListResponse)
async def list_reko_personnel(
    token: str = Query(..., description="Access token from generated link"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get list of Reko personnel for the dashboard.

    Requires valid token (no user authentication).
    Returns personnel with Reko function assigned for the event.
    """
    event_id = validate_reko_dashboard_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Get event information
    event = await events_crud.get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    personnel = await crud.get_reko_personnel_for_event(db, event_id)

    return schemas.RekoDashboardPersonnelListResponse(
        personnel=[schemas.RekoDashboardPersonnel(**p) for p in personnel],
        event_id=event.id,
        event_name=event.name,
    )


@router.get("/assignments/{personnel_id}", response_model=schemas.RekoDashboardAssignmentsResponse)
async def get_reko_assignments(
    personnel_id: uuid.UUID,
    token: str = Query(..., description="Access token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get active incident assignments for a Reko personnel.

    Requires valid token (no user authentication).
    Returns list of incidents the personnel is assigned to.
    """
    event_id = validate_reko_dashboard_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Get personnel name
    personnel_result = await db.execute(
        select(Personnel).where(Personnel.id == personnel_id)
    )
    personnel = personnel_result.scalar_one_or_none()
    if not personnel:
        raise HTTPException(status_code=404, detail="Personnel not found")

    assignments = await crud.get_reko_assignments_for_personnel(db, event_id, personnel_id)

    return schemas.RekoDashboardAssignmentsResponse(
        personnel_id=personnel_id,
        personnel_name=personnel.name,
        assignments=[schemas.RekoDashboardAssignment(**a) for a in assignments],
    )


@router.get(
    "/incidents/{incident_id}/available-reko",
    response_model=schemas.AvailableRekoPersonnelResponse,
)
async def get_available_reko_personnel(
    incident_id: uuid.UUID,
    current_user: CurrentEditor,  # Editor only
    db: AsyncSession = Depends(get_db),
):
    """
    Get available Reko personnel for assignment to an incident.

    Editor only - used when assigning Reko personnel from incident card.
    Returns all Reko personnel with their assignment counts.
    """
    available, currently_assigned_id = await crud.get_available_reko_personnel_for_incident(db, incident_id)

    return schemas.AvailableRekoPersonnelResponse(
        personnel=[schemas.AvailableRekoPersonnel(**p) for p in available],
        currently_assigned_id=currently_assigned_id,
    )


@router.post(
    "/incidents/{incident_id}/assign-reko",
    response_model=schemas.AssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_reko_personnel(
    incident_id: uuid.UUID,
    assignment: schemas.AssignRekoPersonnelRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,  # Editor only
    db: AsyncSession = Depends(get_db),
):
    """
    Assign Reko personnel to an incident.

    Editor only - creates a personnel assignment for the Reko person.
    If another Reko person is already assigned, they will be unassigned first.
    """
    # Get available Reko personnel to check for existing assignment
    _, currently_assigned_id = await crud.get_available_reko_personnel_for_incident(db, incident_id)

    # If the same person is already assigned, do nothing
    if currently_assigned_id == assignment.personnel_id:
        raise HTTPException(status_code=400, detail="Personnel already assigned to this incident")

    # If a different Reko person is assigned, unassign them first
    if currently_assigned_id is not None:
        await crud.unassign_reko_personnel_from_incident(db, incident_id, currently_assigned_id)
        logger.info(
            "Unassigned previous Reko personnel %s from incident %s for replacement",
            currently_assigned_id,
            incident_id,
        )

    # Create the new assignment
    db_assignment = IncidentAssignment(
        incident_id=incident_id,
        resource_type="personnel",
        resource_id=assignment.personnel_id,
        assigned_by=current_user.id,
    )
    db.add(db_assignment)
    await db.commit()
    await db.refresh(db_assignment)

    # Auto-move incident from "eingegangen" to "reko" when reko personnel is assigned
    incident = await incidents_crud.get_incident(db, incident_id)
    if incident and incident.status == "eingegangen":
        await incidents_crud.update_incident_status(
            db=db,
            incident_id=incident_id,
            new_status="reko",
            current_user=current_user,
            request=request,
            notes="Automatisch verschoben: Reko-Person zugewiesen",
        )
        await db.commit()
        logger.info(
            "Auto-moved incident %s from eingegangen to reko after reko assignment",
            incident_id,
        )
        # Broadcast incident update for the status change
        background_tasks.add_task(
            broadcast_incident_update,
            {"id": str(incident_id), "status": "reko"},
            "update",
        )

    # Broadcast WebSocket update
    background_tasks.add_task(
        broadcast_assignment_update,
        {
            "id": str(db_assignment.id),
            "incident_id": str(incident_id),
            "resource_type": "personnel",
            "resource_id": str(assignment.personnel_id),
            "assigned_at": db_assignment.assigned_at.isoformat(),
        },
        "create",
    )

    return schemas.AssignmentResponse.model_validate(db_assignment)


@router.delete(
    "/incidents/{incident_id}/unassign-reko/{personnel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unassign_reko_personnel(
    incident_id: uuid.UUID,
    personnel_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,  # Editor only
    db: AsyncSession = Depends(get_db),
):
    """
    Unassign Reko personnel from an incident.

    Editor only - removes the personnel assignment for the Reko person.
    """
    success = await crud.unassign_reko_personnel_from_incident(db, incident_id, personnel_id)

    if not success:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Broadcast WebSocket update
    background_tasks.add_task(
        broadcast_assignment_update,
        {
            "incident_id": str(incident_id),
            "resource_type": "personnel",
            "resource_id": str(personnel_id),
        },
        "delete",
    )

    return None
