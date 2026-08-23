"""Vehicle management API endpoints."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import materials as materials_crud
from ..crud import vehicles as crud
from ..database import get_db
from ..models import EventSpecialFunction, Incident, IncidentAssignment, Personnel, Vehicle
from ..services import incident_display
from ..websocket_manager import broadcast_vehicle_update

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


def _archive_refused_detail(refused: materials_crud.ArchiveRefused) -> str:
    """The 409 for archiving a deployed vehicle — same shape as the purge's `in_use`."""
    return (
        f"«{refused.name}» steht aktuell auf {refused.active_incidents} Einsätzen und kann "
        "nicht archiviert werden – zuerst die Zuteilung aufheben."
    )


async def _with_usage(db: AsyncSession, rows: Sequence[Vehicle]) -> list[schemas.Vehicle]:
    """Serialise vehicles and attach their Einsatz history in one extra query.

    `assignment_count` is the archive line («Auf 14 Einsätzen gestanden»),
    `can_delete` says whether a permanent delete would be refused — the settings
    table greys its button on it, and the API enforces the same rule with a 409.
    """
    usage = await materials_crud.resource_usage(db, "vehicle", [row.id for row in rows])
    items: list[schemas.Vehicle] = []
    for row in rows:
        item = schemas.Vehicle.model_validate(row)
        counts = usage.get(row.id, materials_crud.NO_USAGE)
        item.assignment_count = counts.total
        item.can_delete = counts.can_delete
        items.append(item)
    return items


@router.get("/", response_model=list[schemas.Vehicle])
async def list_vehicles(
    current_user: CurrentUser,
    include_archived: bool = Query(
        False,
        description="Include archived vehicles. Off for the board, on for «Archivierte anzeigen».",
    ),
    db: AsyncSession = Depends(get_db),
) -> list[schemas.Vehicle]:
    """List vehicles (all users). Archived rows are excluded unless asked for."""
    return await _with_usage(db, await crud.get_all_vehicles(db, include_archived=include_archived))


@router.get("/{vehicle_id}", response_model=schemas.Vehicle)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> schemas.Vehicle:
    """Get single vehicle by ID. Archived vehicles are returned here."""
    vehicle = await crud.get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return (await _with_usage(db, [vehicle]))[0]


@router.post("/", response_model=schemas.Vehicle, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    vehicle: schemas.VehicleCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.Vehicle:
    """Create new vehicle (editor only)."""
    new_vehicle = await crud.create_vehicle(db, vehicle, current_user, request)

    # Convert to Pydantic and broadcast WebSocket update
    vehicle_response = (await _with_usage(db, [new_vehicle]))[0]
    background_tasks.add_task(broadcast_vehicle_update, vehicle_response.model_dump(mode="json"), "create")

    return vehicle_response


@router.put("/{vehicle_id}", response_model=schemas.Vehicle)
async def update_vehicle(
    vehicle_id: uuid.UUID,
    vehicle: schemas.VehicleUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.Vehicle:
    """Update vehicle (editor only).

    This is also the write path for «Nicht einsatzbereit»: `{"out_of_service": true}`
    from the board's right-click menu or from the settings row, nothing else needed.
    """
    updated = await crud.update_vehicle(db, vehicle_id, vehicle, current_user, request)
    if not updated:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    # Convert to Pydantic and broadcast WebSocket update
    vehicle_response = (await _with_usage(db, [updated]))[0]
    background_tasks.add_task(broadcast_vehicle_update, vehicle_response.model_dump(mode="json"), "update")

    return vehicle_response


@router.post("/{vehicle_id}/archive", response_model=schemas.Vehicle)
async def archive_vehicle(
    vehicle_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.Vehicle:
    """Archive vehicle (editor only) — the normal way to retire a vehicle.

    It leaves the board, the fleet sheet and the assignment dialog; past Einsätze
    keep it. Refuses with 409 while the vehicle stands on a live Einsatz — same
    pattern as the purge's `in_use` refusal. Reversible with /restore. Broadcast
    as a `delete` so live boards drop it.
    """
    archived = await crud.archive_vehicle(db, vehicle_id, current_user, request)
    if not archived:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if isinstance(archived, materials_crud.ArchiveRefused):
        raise HTTPException(status_code=409, detail=_archive_refused_detail(archived))

    vehicle_response = (await _with_usage(db, [archived]))[0]
    background_tasks.add_task(broadcast_vehicle_update, {"id": str(vehicle_id)}, "delete")

    return vehicle_response


@router.post("/{vehicle_id}/restore", response_model=schemas.Vehicle)
async def restore_vehicle(
    vehicle_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> schemas.Vehicle:
    """Bring an archived vehicle back (editor only) — «Zurückholen»."""
    restored = await crud.restore_vehicle(db, vehicle_id, current_user, request)
    if not restored:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    vehicle_response = (await _with_usage(db, [restored]))[0]
    background_tasks.add_task(broadcast_vehicle_update, vehicle_response.model_dump(mode="json"), "create")

    return vehicle_response


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vehicle(
    vehicle_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    permanent: bool = Query(
        False,
        description="Delete the row for good instead of archiving it. Only from the archive, "
        "and only for vehicles that never stood on a live Einsatz.",
    ),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete vehicle (editor only).

    Default is an archive — reversible, and the row really does leave every list;
    it refuses with 409 while the vehicle stands on a live Einsatz.
    `?permanent=true` is the purge for test entries and typos; it refuses with 409
    unless the vehicle is archived and has no live Einsatz history.
    """
    if not permanent:
        archived = await crud.archive_vehicle(db, vehicle_id, current_user, request)
        if not archived:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        if isinstance(archived, materials_crud.ArchiveRefused):
            raise HTTPException(status_code=409, detail=_archive_refused_detail(archived))
        background_tasks.add_task(broadcast_vehicle_update, {"id": str(vehicle_id)}, "delete")
        return

    outcome = await crud.purge_vehicle(db, vehicle_id, current_user, request)
    if outcome.refusal == "not_found":
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if outcome.refusal == "not_archived":
        raise HTTPException(
            status_code=409,
            detail="Fahrzeug muss zuerst archiviert werden, bevor es endgültig gelöscht werden kann.",
        )
    if outcome.refusal == "in_use":
        raise HTTPException(
            status_code=409,
            detail=(
                f"«{outcome.name}» stand auf {outcome.usage.protected} Einsätzen und kann nur "
                "archiviert werden – endgültiges Löschen würde deren Auswertung verfälschen."
            ),
        )

    background_tasks.add_task(broadcast_vehicle_update, {"id": str(vehicle_id)}, "delete")


@router.get("/{vehicle_id}/status", response_model=schemas.VehicleStatusResponse)
async def get_vehicle_status(
    vehicle_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    event_id: uuid.UUID = Query(..., description="Event ID to check driver and incident assignment"),
) -> schemas.VehicleStatusResponse:
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
                EventSpecialFunction.function_type == "driver",
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
                Incident.deleted_at.is_(None),  # Not deleted
            )
        )
    )
    assignment_result = await db.execute(assignment_query)
    assignment_row = assignment_result.first()

    incident_id = None
    incident_title = None
    incident_location_address = None
    incident_location_display = None
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
        # The deployment line the sheet draws. Falls back to the title exactly
        # like the sheet does — an incident's title usually IS the raw address —
        # so the label covers both and neither has to be formatted client-side.
        # Read only for a deployed vehicle: an idle one costs no extra query.
        incident_location_display = incident_display.location_display(
            incident_location_address or incident_title,
            await incident_display.get_home_city(db),
        )

        # Calculate duration in minutes

        duration = datetime.now(UTC) - assignment.assigned_at
        assignment_duration_minutes = int(duration.total_seconds() / 60)

    return schemas.VehicleStatusResponse(
        id=vehicle.id,
        name=vehicle.name,
        type=vehicle.type,
        status=vehicle.status,
        out_of_service=vehicle.out_of_service,
        out_of_service_since=vehicle.out_of_service_since,
        radio_call_sign=vehicle.radio_call_sign,
        driver_id=driver_id,
        driver_name=driver_name,
        driver_assigned_at=driver_assigned_at,
        incident_id=incident_id,
        incident_title=incident_title,
        incident_location_address=incident_location_address,
        incident_location_display=incident_location_display,
        incident_status=incident_status,
        incident_assigned_at=incident_assigned_at,
        assignment_duration_minutes=assignment_duration_minutes,
    )
