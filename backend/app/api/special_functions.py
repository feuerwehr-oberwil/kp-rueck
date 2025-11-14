"""Special function management API endpoints."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import special_functions as crud
from ..database import get_db
from ..models import Personnel, Vehicle

router = APIRouter(prefix="/events/{event_id}/special-functions", tags=["special-functions"])


@router.get("/", response_model=list[schemas.EventSpecialFunctionResponse])
async def list_event_special_functions(
    event_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all special function assignments for an event (all users)."""
    assignments = await crud.get_event_special_functions(db, event_id)

    # Enrich with personnel and vehicle names
    response = []
    for assignment in assignments:
        # Get personnel name
        personnel_result = await db.execute(
            select(Personnel).where(Personnel.id == assignment.personnel_id)
        )
        personnel = personnel_result.scalar_one_or_none()

        # Get vehicle name if it's a driver assignment
        vehicle_name = None
        if assignment.vehicle_id:
            vehicle_result = await db.execute(
                select(Vehicle).where(Vehicle.id == assignment.vehicle_id)
            )
            vehicle = vehicle_result.scalar_one_or_none()
            if vehicle:
                vehicle_name = vehicle.name

        response.append(
            schemas.EventSpecialFunctionResponse(
                id=assignment.id,
                event_id=assignment.event_id,
                personnel_id=assignment.personnel_id,
                personnel_name=personnel.name if personnel else "Unknown",
                function_type=assignment.function_type,
                vehicle_id=assignment.vehicle_id,
                vehicle_name=vehicle_name,
                assigned_at=assignment.assigned_at,
                assigned_by=assignment.assigned_by,
            )
        )

    return response


@router.get("/personnel/{personnel_id}", response_model=list[schemas.EventSpecialFunctionResponse])
async def list_personnel_special_functions(
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all special functions for a specific person in an event (all users)."""
    assignments = await crud.get_personnel_special_functions(db, event_id, personnel_id)

    # Enrich with personnel and vehicle names
    response = []
    for assignment in assignments:
        # Get personnel name
        personnel_result = await db.execute(
            select(Personnel).where(Personnel.id == assignment.personnel_id)
        )
        personnel = personnel_result.scalar_one_or_none()

        # Get vehicle name if it's a driver assignment
        vehicle_name = None
        if assignment.vehicle_id:
            vehicle_result = await db.execute(
                select(Vehicle).where(Vehicle.id == assignment.vehicle_id)
            )
            vehicle = vehicle_result.scalar_one_or_none()
            if vehicle:
                vehicle_name = vehicle.name

        response.append(
            schemas.EventSpecialFunctionResponse(
                id=assignment.id,
                event_id=assignment.event_id,
                personnel_id=assignment.personnel_id,
                personnel_name=personnel.name if personnel else "Unknown",
                function_type=assignment.function_type,
                vehicle_id=assignment.vehicle_id,
                vehicle_name=vehicle_name,
                assigned_at=assignment.assigned_at,
                assigned_by=assignment.assigned_by,
            )
        )

    return response


@router.post("/", response_model=schemas.EventSpecialFunctionResponse, status_code=status.HTTP_201_CREATED)
async def assign_special_function(
    event_id: uuid.UUID,
    assignment: schemas.EventSpecialFunctionCreate,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Assign a special function to personnel for an event (editor only)."""
    try:
        db_assignment = await crud.create_special_function(
            db, event_id, assignment, current_user, request
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get personnel and vehicle names for response
    personnel_result = await db.execute(
        select(Personnel).where(Personnel.id == assignment.personnel_id)
    )
    personnel = personnel_result.scalar_one_or_none()

    vehicle_name = None
    if assignment.vehicle_id:
        vehicle_result = await db.execute(
            select(Vehicle).where(Vehicle.id == assignment.vehicle_id)
        )
        vehicle = vehicle_result.scalar_one_or_none()
        if vehicle:
            vehicle_name = vehicle.name

    return schemas.EventSpecialFunctionResponse(
        id=db_assignment.id,
        event_id=db_assignment.event_id,
        personnel_id=db_assignment.personnel_id,
        personnel_name=personnel.name if personnel else "Unknown",
        function_type=db_assignment.function_type,
        vehicle_id=db_assignment.vehicle_id,
        vehicle_name=vehicle_name,
        assigned_at=db_assignment.assigned_at,
        assigned_by=db_assignment.assigned_by,
    )


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_special_function(
    event_id: uuid.UUID,
    assignment: schemas.EventSpecialFunctionDelete,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Remove a special function assignment (editor only)."""
    success = await crud.delete_special_function(
        db,
        event_id,
        assignment.personnel_id,
        assignment.function_type,
        assignment.vehicle_id,
        current_user,
        request,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Assignment not found")
