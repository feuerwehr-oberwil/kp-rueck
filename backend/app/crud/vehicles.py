"""Vehicle CRUD operations.

Mirror image of ``crud/materials.py`` — same three axes (readiness, lifecycle,
deployment), same rules. The shared lifecycle helpers live there and are imported
here rather than written twice; materials and vehicles are the only two resource
kinds that can be archived, so a third module would carry two callers.
"""

import uuid
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import IncidentAssignment, User, Vehicle
from ..services.audit import calculate_changes, log_action
from .materials import (
    NO_USAGE,
    ArchiveRefused,
    PurgeOutcome,
    apply_out_of_service,
    count_active_deployments,
    resolve_out_of_service,
    resource_usage,
)


async def get_all_vehicles(db: AsyncSession, *, include_archived: bool = False) -> list[Vehicle]:
    """Get all vehicles, archived ones excluded unless asked for.

    The default is what the board and the Fahrzeug sheet want: an archived vehicle
    is gone. `include_archived=True` is for the settings table's «Archivierte anzeigen».
    """
    query = select(Vehicle)
    if not include_archived:
        query = query.where(Vehicle.archived_at.is_(None))
    result = await db.execute(query.order_by(Vehicle.name.asc()))
    return list(result.scalars().all())


async def get_vehicle(db: AsyncSession, vehicle_id: uuid.UUID) -> Vehicle | None:
    """Get single vehicle by ID. Archived rows are returned — the archive has to read them."""
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    return result.scalar_one_or_none()


async def create_vehicle(
    db: AsyncSession,
    vehicle_data: schemas.VehicleCreate,
    current_user: User,
    request: Request,
) -> Vehicle:
    """Create new vehicle. Readiness comes from `out_of_service` (or legacy `status`)."""
    vehicle = Vehicle(
        name=vehicle_data.name,
        type=vehicle_data.type,
        display_order=vehicle_data.display_order,
        radio_call_sign=vehicle_data.radio_call_sign,
        status="available",
    )
    apply_out_of_service(vehicle, resolve_out_of_service(vehicle_data, current=False))
    db.add(vehicle)
    await db.flush()

    # Log creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="vehicle",
        resource_id=vehicle.id,
        user=current_user,
        changes={
            "name": vehicle.name,
            "type": vehicle.type,
            "status": vehicle.status,
            "out_of_service": vehicle.out_of_service,
            "display_order": vehicle.display_order,
            "radio_call_sign": vehicle.radio_call_sign,
        },
        request=request,
    )

    await db.commit()
    await db.refresh(vehicle)
    return vehicle


async def update_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    vehicle_data: schemas.VehicleUpdate,
    current_user: User,
    request: Request,
) -> Vehicle | None:
    """Update existing vehicle.

    Readiness is applied through `apply_out_of_service` so `status` and
    `out_of_service_since` can never drift apart; `archived_at` is untouched here.
    """
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()

    if not vehicle:
        return None

    # Capture before state
    before_state = {
        "name": vehicle.name,
        "type": vehicle.type,
        "status": vehicle.status,
    }

    # Apply updates. Readiness has its own path: setting `status` directly would
    # leave `out_of_service_since` stale, which is the drift this module exists to
    # prevent.
    update_data = vehicle_data.model_dump(exclude_unset=True, exclude={"status", "out_of_service"})
    for field, value in update_data.items():
        setattr(vehicle, field, value)
    apply_out_of_service(vehicle, resolve_out_of_service(vehicle_data, current=vehicle.out_of_service))

    vehicle.updated_at = datetime.now(UTC)

    # Capture after state
    after_state = {
        "name": vehicle.name,
        "type": vehicle.type,
        "status": vehicle.status,
    }

    # Calculate changes
    changes = calculate_changes(before_state, after_state)

    # Log update if changes
    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="vehicle",
            resource_id=vehicle.id,
            user=current_user,
            changes=changes,
            request=request,
        )

    await db.commit()
    await db.refresh(vehicle)
    return vehicle


async def archive_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> Vehicle | ArchiveRefused | None:
    """Archive a vehicle: out of the board, out of the fleet sheet, out of the picker.

    Refused (`ArchiveRefused`, the routes' 409) while the vehicle stands on a live
    Einsatz — archiving it mid-deployment would make it vanish from a card an
    operator is working, with nobody told. Unassign first, then archive.

    Reversible via `restore_vehicle`. Past assignments and the audit trail keep
    it, so past Einsätze still evaluate correctly. Readiness is left alone — a
    restored vehicle comes back exactly as it went in. Already archived is a no-op.
    """
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()

    if not vehicle:
        return None

    if vehicle.archived_at is None:
        deployed = await count_active_deployments(db, "vehicle", vehicle_id)
        if deployed:
            return ArchiveRefused(name=vehicle.name, active_incidents=deployed)
        vehicle.archived_at = datetime.now(UTC)
        vehicle.updated_at = datetime.now(UTC)

        await log_action(
            db=db,
            action_type="archive",
            resource_type="vehicle",
            resource_id=vehicle.id,
            user=current_user,
            changes={"name": vehicle.name, "archived_at": vehicle.archived_at.isoformat()},
            request=request,
        )
        await db.commit()
        await db.refresh(vehicle)

    return vehicle


async def restore_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> Vehicle | None:
    """Bring an archived vehicle back («Zurückholen»). Not archived is a no-op."""
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()

    if not vehicle:
        return None

    if vehicle.archived_at is not None:
        vehicle.archived_at = None
        vehicle.updated_at = datetime.now(UTC)

        await log_action(
            db=db,
            action_type="restore",
            resource_type="vehicle",
            resource_id=vehicle.id,
            user=current_user,
            changes={"name": vehicle.name},
            request=request,
        )
        await db.commit()
        await db.refresh(vehicle)

    return vehicle


async def purge_vehicle(
    db: AsyncSession,
    vehicle_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> PurgeOutcome:
    """Permanently delete a vehicle — the row really leaves the database.

    Two deliberate steps, because this one is not reversible: the vehicle has to be
    archived first, and it must never have stood on a live, non-training Einsatz.
    Assignments to training incidents are removed along with it, and its
    `event_special_functions` rows (Fahrer) go by ON DELETE CASCADE. The audit_log
    entries stay, because they are the Protokoll and a purge is itself an entry in it.
    """
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()

    if not vehicle:
        return PurgeOutcome(purged=False, refusal="not_found")

    name = vehicle.name
    if vehicle.archived_at is None:
        return PurgeOutcome(purged=False, refusal="not_archived", name=name)

    usage = (await resource_usage(db, "vehicle", [vehicle_id])).get(vehicle_id, NO_USAGE)
    if not usage.can_delete:
        return PurgeOutcome(purged=False, refusal="in_use", name=name, usage=usage)

    # incident_assignments.resource_id carries no foreign key (it is polymorphic),
    # so leftovers would dangle. Only training/deleted-incident rows can be here.
    await db.execute(
        delete(IncidentAssignment).where(
            IncidentAssignment.resource_type == "vehicle",
            IncidentAssignment.resource_id == vehicle_id,
        )
    )
    await db.delete(vehicle)

    await log_action(
        db=db,
        action_type="purge",
        resource_type="vehicle",
        resource_id=vehicle_id,
        user=current_user,
        changes={"name": name, "assignment_count": usage.total},
        request=request,
    )

    await db.commit()
    return PurgeOutcome(purged=True, name=name, usage=usage)
