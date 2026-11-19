"""Vehicle management API endpoints."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import materials as materials_crud
from ..crud import vehicles as crud
from ..database import get_db
from ..models import EventSpecialFunction, Incident, IncidentAssignment, Personnel, Vehicle
from ..services import incident_display
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_vehicle_update

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


def _archive_refused_detail(refused: materials_crud.ArchiveRefused) -> str:
    """The 409 for archiving a deployed vehicle — same shape as the purge's `in_use`."""
    return (
        f"«{refused.name}» steht aktuell auf {refused.active_incidents} Einsätzen oder Aufträgen und kann "
        "nicht archiviert werden – zuerst die Zuweisung aufheben."
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


# Declared before `/{vehicle_id}`: otherwise «status» is read as a vehicle id (422).
@router.get("/status", response_model=list[schemas.VehicleStatusResponse])
async def list_vehicle_statuses(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    event_id: uuid.UUID = Query(..., description="Event whose drivers and Einsätze are read"),
) -> list[schemas.VehicleStatusResponse]:
    """Every fleet vehicle with its driver and active Einsätze in one event.

    The footer «Fahrzeuge» sheet reads this – one request for the whole fleet,
    three queries whatever its size. Archived vehicles are left out, as on the
    board. Order: `display_order`, then name; each vehicle's `deployments` are
    oldest assignment first.
    """
    vehicles = sorted(await crud.get_all_vehicles(db), key=lambda v: (v.display_order, v.name))
    vehicle_ids = [v.id for v in vehicles]

    drivers: dict[uuid.UUID, tuple[EventSpecialFunction, Personnel]] = {}
    driver_rows = await db.execute(
        select(EventSpecialFunction, Personnel)
        .join(Personnel, Personnel.id == EventSpecialFunction.personnel_id)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.vehicle_id.in_(vehicle_ids),
            EventSpecialFunction.function_type == "driver",
        )
        .order_by(EventSpecialFunction.assigned_at.desc())
    )
    for special_function, person in driver_rows.tuples():
        # Newest first: should a vehicle ever carry two driver rows, the latest one counts.
        drivers.setdefault(special_function.vehicle_id, (special_function, person))

    assignment_rows = (
        (
            await db.execute(
                select(IncidentAssignment, Incident)
                .join(Incident, Incident.id == IncidentAssignment.incident_id)
                .where(
                    IncidentAssignment.resource_type == "vehicle",
                    IncidentAssignment.resource_id.in_(vehicle_ids),
                    IncidentAssignment.unassigned_at.is_(None),
                    Incident.event_id == event_id,
                    Incident.deleted_at.is_(None),
                )
                .order_by(IncidentAssignment.assigned_at.asc(), Incident.id.asc())
            )
        )
        .tuples()
        .all()
    )
    # Read only when something is deployed: an idle fleet costs no settings query.
    home_city = await incident_display.get_home_city(db) if assignment_rows else ""
    now = datetime.now(UTC)
    deployments: dict[uuid.UUID, list[schemas.VehicleDeployment]] = {}
    for assignment, incident in assignment_rows:
        deployments.setdefault(assignment.resource_id, []).append(
            schemas.VehicleDeployment(
                incident_id=incident.id,
                title=incident.title,
                location_address=incident.location_address,
                location_display=incident_display.location_display(
                    incident.location_address or incident.title, home_city
                ),
                status=incident.status,
                assigned_at=assignment.assigned_at,
                duration_minutes=int((now - assignment.assigned_at).total_seconds() // 60),
            )
        )

    statuses: list[schemas.VehicleStatusResponse] = []
    for vehicle in vehicles:
        driver = drivers.get(vehicle.id)
        statuses.append(
            schemas.VehicleStatusResponse(
                id=vehicle.id,
                name=vehicle.name,
                type=vehicle.type,
                status=vehicle.status,
                out_of_service=vehicle.out_of_service,
                out_of_service_since=vehicle.out_of_service_since,
                radio_call_sign=vehicle.radio_call_sign,
                driver_id=driver[1].id if driver else None,
                driver_name=driver[1].name if driver else None,
                driver_assigned_at=driver[0].assigned_at if driver else None,
                deployments=deployments.get(vehicle.id, []),
            )
        )
    return statuses


@router.get("/{vehicle_id}", response_model=schemas.Vehicle)
async def get_vehicle(
    vehicle_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> schemas.Vehicle:
    """Get single vehicle by ID. Archived vehicles are returned here."""
    vehicle = await crud.get_vehicle(db, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)
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
        raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)

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
        raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)
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
        raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)

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
            raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)
        if isinstance(archived, materials_crud.ArchiveRefused):
            raise HTTPException(status_code=409, detail=_archive_refused_detail(archived))
        background_tasks.add_task(broadcast_vehicle_update, {"id": str(vehicle_id)}, "delete")
        return

    outcome = await crud.purge_vehicle(db, vehicle_id, current_user, request)
    if outcome.refusal == "not_found":
        raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)
    if outcome.refusal == "not_archived":
        raise HTTPException(
            status_code=409,
            detail="Fahrzeug muss zuerst archiviert werden, bevor es endgültig gelöscht werden kann.",
        )
    if outcome.refusal == "in_use":
        raise HTTPException(
            status_code=409,
            detail=(
                f"«{outcome.name}» stand auf {outcome.usage.protected} Einsätzen oder Aufträgen und kann nur "
                "archiviert werden – endgültiges Löschen würde deren Auswertung verfälschen."
            ),
        )

    background_tasks.add_task(broadcast_vehicle_update, {"id": str(vehicle_id)}, "delete")
