"""Vehicle management API endpoints."""
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import vehicles as crud
from ..database import get_db
from ..models import Vehicle, EventSpecialFunction, IncidentAssignment, Incident, Personnel
from ..websocket_manager import broadcast_vehicle_update

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("/", response_model=list[schemas.Vehicle])
async def list_vehicles(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """List all vehicles (all users)."""
    return await crud.get_all_vehicles(db)


@router.get("/{vehicle_id}", response_model=schemas.Vehicle)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get single vehicle by ID."""
    vehicle = await crud.get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@router.post("/", response_model=schemas.Vehicle, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    vehicle: schemas.VehicleCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Create new vehicle (editor only)."""
    new_vehicle = await crud.create_vehicle(db, vehicle, current_user, request)

    # Convert to Pydantic and broadcast WebSocket update
    vehicle_response = schemas.Vehicle.model_validate(new_vehicle)
    background_tasks.add_task(
        broadcast_vehicle_update,
        vehicle_response.model_dump(mode='json'),
        "create"
    )

    return vehicle_response


@router.put("/{vehicle_id}", response_model=schemas.Vehicle)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    vehicle: schemas.VehicleUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Update vehicle (editor only)."""
    updated = await crud.update_vehicle(db, vehicle_id, vehicle, current_user, request)
    if not updated:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Convert to Pydantic and broadcast WebSocket update
    vehicle_response = schemas.Vehicle.model_validate(updated)
    background_tasks.add_task(
        broadcast_vehicle_update,
        vehicle_response.model_dump(mode='json'),
        "update"
    )

    return vehicle_response


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vehicle(
    vehicle_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Delete vehicle (editor only) - soft delete."""
    success = await crud.delete_vehicle(db, vehicle_id, current_user, request)
    if not success:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Broadcast WebSocket update for deletion
    background_tasks.add_task(
        broadcast_vehicle_update,
        {'id': str(vehicle_id)},
        "delete"
    )


@router.get("/{vehicle_id}/status", response_model=schemas.VehicleStatusResponse)
async def get_vehicle_status(
    vehicle_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    event_id: uuid.UUID = Query(..., description="Event ID to check driver and incident assignment"),
):
    """
    Get vehicle status including driver assignment and current incident.

    Returns detailed status for a vehicle within the context of an event:
    - Basic vehicle info (name, type, status)
    - Driver assignment (if any) for this event
    - Current incident assignment (if any)
    - Duration of assignment
    """
    # Get vehicle
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()

    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Get driver assignment for this event (if any)
    driver_query = (
        select(EventSpecialFunction, Personnel)
        .join(Personnel, Personnel.id == EventSpecialFunction.personnel_id)
        .where(
            and_(
                EventSpecialFunction.event_id == event_id,
                EventSpecialFunction.vehicle_id == vehicle_id,
                EventSpecialFunction.function_type == "driver"
            )
        )
    )
    driver_result = await db.execute(driver_query)
    driver_row = driver_result.first()

    driver_id = None
    driver_name = None
    driver_assigned_at = None
    if driver_row:
        special_func, personnel = driver_row
        driver_id = personnel.id
        driver_name = personnel.name
        driver_assigned_at = special_func.assigned_at

    # Get current incident assignment (if any)
    # Find active assignment for this vehicle
    assignment_query = (
        select(IncidentAssignment, Incident)
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .where(
            and_(
                IncidentAssignment.resource_type == "vehicle",
                IncidentAssignment.resource_id == vehicle_id,
                IncidentAssignment.unassigned_at.is_(None),  # Active assignment
                Incident.event_id == event_id,  # Must be in the specified event
                Incident.deleted_at.is_(None)  # Not deleted
            )
        )
    )
    assignment_result = await db.execute(assignment_query)
    assignment_row = assignment_result.first()

    incident_id = None
    incident_title = None
    incident_location_address = None
    incident_status = None
    incident_assigned_at = None
    assignment_duration_minutes = None

    if assignment_row:
        assignment, incident = assignment_row
        incident_id = incident.id
        incident_title = incident.title
        incident_location_address = incident.location_address
        incident_status = incident.status
        incident_assigned_at = assignment.assigned_at

        # Calculate duration in minutes
        from datetime import timezone
        duration = datetime.now(timezone.utc) - assignment.assigned_at
        assignment_duration_minutes = int(duration.total_seconds() / 60)

    return schemas.VehicleStatusResponse(
        id=vehicle.id,
        name=vehicle.name,
        type=vehicle.type,
        status=vehicle.status,
        radio_call_sign=vehicle.radio_call_sign,
        driver_id=driver_id,
        driver_name=driver_name,
        driver_assigned_at=driver_assigned_at,
        incident_id=incident_id,
        incident_title=incident_title,
        incident_location_address=incident_location_address,
        incident_status=incident_status,
        incident_assigned_at=incident_assigned_at,
        assignment_duration_minutes=assignment_duration_minutes,
    )
