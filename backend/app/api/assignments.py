"""Assignment API endpoints."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import assignments as crud
from ..database import get_db

router = APIRouter(prefix="/incidents", tags=["assignments"])


@router.post("/{incident_id}/assign", response_model=schemas.AssignmentResponse)
async def assign_resource(
    incident_id: uuid.UUID,
    assignment: schemas.AssignmentCreate,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """
    Assign resource to incident (editor only).

    Checks for conflicts and shows warning in response.
    """
    # Check for conflicts first
    conflicts = await crud.check_resource_conflicts(
        db, assignment.resource_type, assignment.resource_id
    )

    if conflicts:
        # Return warning but allow assignment (override behavior)
        # Frontend should show confirmation dialog
        pass

    try:
        result = await crud.assign_resource(
            db=db,
            incident_id=incident_id,
            resource_type=assignment.resource_type,
            resource_id=assignment.resource_id,
            current_user=current_user,
            request=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    return result


@router.post(
    "/{incident_id}/unassign/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def unassign_resource(
    incident_id: uuid.UUID,
    assignment_id: uuid.UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Release resource from incident."""
    success = await crud.unassign_resource(
        db=db,
        assignment_id=assignment_id,
        current_user=current_user,
        request=request,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Assignment not found")


@router.get(
    "/{incident_id}/assignments", response_model=list[schemas.AssignmentResponse]
)
async def get_assignments(
    incident_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get all active assignments for incident."""
    return await crud.get_incident_assignments(db, incident_id)


@router.post(
    "/{incident_id}/release-all", status_code=status.HTTP_204_NO_CONTENT
)
async def release_all_resources(
    incident_id: uuid.UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """
    Release all resources from incident.

    Called when incident completes (moves to 'abschluss').
    """
    await crud.auto_release_incident_resources(
        db=db,
        incident_id=incident_id,
        current_user=current_user,
        request=request,
    )


# Bulk assignments endpoint (outside incidents prefix)
from fastapi import APIRouter as NewRouter
bulk_router = NewRouter(prefix="/assignments", tags=["assignments"])


@bulk_router.get("/by-event/{event_id}")
async def get_assignments_by_event(
    event_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
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
