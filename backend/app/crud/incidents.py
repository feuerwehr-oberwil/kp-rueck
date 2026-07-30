"""Incident CRUD operations."""

import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import Request
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import Incident, IncidentAssignment, IncidentGroup, RekoReport, StatusTransition, User, Vehicle
from ..services.audit import calculate_changes, log_action
from . import events as events_crud


class InvalidIncidentGroupError(ValueError):
    """Incident group is missing, deleted, or belongs to another event."""


async def _validate_and_lock_group(db: AsyncSession, group_id: uuid.UUID, event_id: uuid.UUID) -> IncidentGroup:
    group = await db.scalar(select(IncidentGroup).where(IncidentGroup.id == group_id).with_for_update())
    if group is None or group.deleted_at is not None:
        raise InvalidIncidentGroupError("Auftrag not found or deleted")
    if group.event_id != event_id:
        raise InvalidIncidentGroupError("Auftrag belongs to a different event")
    return group


async def get_incidents(
    db: AsyncSession,
    event_id: uuid.UUID | None = None,
    skip: int = 0,
    limit: int = 100,
    status: str | None = None,
) -> list[Incident]:
    """
    Get incidents with optional filters.

    Args:
        db: Database session
        event_id: Filter by event ID (required in API, optional here for flexibility)
        skip: Pagination offset
        limit: Max results
        status: Filter by status

    Returns:
        List of incidents with status_changed_at and assigned_vehicles populated (excludes soft-deleted incidents)
    """
    # Use eager loading for relationships to avoid N+1 queries
    query = (
        select(Incident)
        .options(
            selectinload(Incident.status_transitions),
            selectinload(Incident.assignments).selectinload(IncidentAssignment.vehicle),
            selectinload(Incident.reko_reports),
        )
        .where(Incident.deleted_at.is_(None))
        # Manual board order first; created_at DESC breaks ties (e.g. brand-new
        # cards that share the default position 0 — newest on top).
        .order_by(Incident.position.asc(), Incident.created_at.desc())
    )

    # Filter by event if provided
    if event_id is not None:
        query = query.where(Incident.event_id == event_id)

    if status:
        query = query.where(Incident.status == status)

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    incidents = list(result.scalars().all())

    if not incidents:
        return incidents

    # Batch load status transitions for all incidents in one query
    incident_ids = [incident.id for incident in incidents]

    # Subquery to get latest status transition timestamp for each incident

    latest_transitions_query = (
        select(StatusTransition.incident_id, func.max(StatusTransition.timestamp).label("latest_timestamp"))
        .where(StatusTransition.incident_id.in_(incident_ids))
        .group_by(StatusTransition.incident_id)
    )

    transitions_result = await db.execute(latest_transitions_query)
    transitions_map = {row.incident_id: row.latest_timestamp for row in transitions_result}

    # Batch load all assignments and vehicles in one query
    assignments_query = (
        select(IncidentAssignment, Vehicle)
        .outerjoin(
            Vehicle, and_(Vehicle.id == IncidentAssignment.resource_id, IncidentAssignment.resource_type == "vehicle")
        )
        .where(
            and_(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.resource_type == "vehicle",
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentAssignment.assigned_at.asc())
    )

    assignments_result = await db.execute(assignments_query)

    # Group assignments by incident_id
    vehicles_by_incident: dict[uuid.UUID, list[Any]] = {}
    for assignment, vehicle in assignments_result.all():
        if assignment.incident_id not in vehicles_by_incident:
            vehicles_by_incident[assignment.incident_id] = []

        if vehicle:  # Vehicle might be None if not found
            vehicles_by_incident[assignment.incident_id].append(
                schemas.AssignedVehicle(
                    assignment_id=assignment.id,
                    vehicle_id=vehicle.id,
                    name=vehicle.name,
                    type=vehicle.type,
                    assigned_at=assignment.assigned_at,
                    driver_stay=assignment.driver_stay,
                )
            )

    # Batch load reko completion status and arrived_at for all incidents
    reko_query = select(RekoReport.incident_id, RekoReport.is_draft, RekoReport.arrived_at).where(
        RekoReport.incident_id.in_(incident_ids)
    )
    reko_result = await db.execute(reko_query)
    incidents_with_completed_reko = set()
    reko_arrived_at_map: dict[uuid.UUID, datetime] = {}
    for row in reko_result:
        if not row.is_draft:
            incidents_with_completed_reko.add(row.incident_id)
        # Keep the earliest arrived_at for each incident
        if row.arrived_at and (
            row.incident_id not in reko_arrived_at_map or row.arrived_at < reko_arrived_at_map[row.incident_id]
        ):
            reko_arrived_at_map[row.incident_id] = row.arrived_at

    # Populate status_changed_at, assigned_vehicles, has_completed_reko, and reko_arrived_at for each incident
    for incident in incidents:
        # Set status_changed_at from batch-loaded map
        incident.status_changed_at = transitions_map.get(incident.id, incident.created_at)

        # Set assigned vehicles from batch-loaded map
        incident.assigned_vehicles = vehicles_by_incident.get(incident.id, [])

        # Set has_completed_reko flag
        incident.has_completed_reko = incident.id in incidents_with_completed_reko

        # Set reko_arrived_at timestamp
        incident.reko_arrived_at = reko_arrived_at_map.get(incident.id)

    return incidents


async def get_incident(db: AsyncSession, incident_id: uuid.UUID) -> Incident | None:
    """Get incident by ID with status_changed_at, assigned_vehicles, and has_completed_reko populated."""
    # Use eager loading for relationships to avoid N+1 queries
    result = await db.execute(
        select(Incident)
        .options(
            selectinload(Incident.status_transitions),
            selectinload(Incident.assignments).selectinload(IncidentAssignment.vehicle),
            selectinload(Incident.reko_reports),
        )
        .where(Incident.id == incident_id)
    )
    incident = result.scalar_one_or_none()

    if incident:
        # Get latest status transition timestamp (single query)
        latest_transition_query = (
            select(StatusTransition.timestamp)
            .where(StatusTransition.incident_id == incident.id)
            .order_by(StatusTransition.timestamp.desc())
            .limit(1)
        )
        transition_result = await db.execute(latest_transition_query)
        latest_timestamp = transition_result.scalar_one_or_none()

        # Set status_changed_at to latest transition timestamp, or created_at if no transitions exist
        incident.status_changed_at = latest_timestamp if latest_timestamp else incident.created_at

        # Load assigned vehicles (reuse helper function - acceptable for single incident)
        incident.assigned_vehicles = await _get_assigned_vehicles(db, incident.id)

        # Check for completed reko report and arrived_at
        reko_check = await db.execute(
            select(RekoReport.id, RekoReport.is_draft, RekoReport.arrived_at)
            .where(RekoReport.incident_id == incident.id)
            .order_by(RekoReport.arrived_at.asc().nullslast())
        )
        reko_rows = reko_check.all()
        incident.has_completed_reko = any(not row.is_draft for row in reko_rows)
        # Get the earliest arrived_at timestamp
        incident.reko_arrived_at = next((row.arrived_at for row in reko_rows if row.arrived_at), None)

    return incident


async def create_incident(
    db: AsyncSession,
    incident: schemas.IncidentCreate,
    current_user: User,
    request: Request,
    *,
    source: str | None = None,
    source_ref: str | None = None,
) -> Incident:
    """Create new incident with audit logging.

    ``source``/``source_ref`` carry alarm provenance when the incident is
    created from a pool alarm ("divera" or a generic-webhook slug + the
    alarm's id in that system); dashboard creations keep the "operator"
    default.

    When ``group_id`` is set (streamlined "add stop"), the new incident is
    appended to the end of that Auftrag (``group_position = max + 1``).
    """
    # When attaching to an Auftrag on create, append at the end of the route.
    group_position = 0
    if incident.group_id is not None:
        await _validate_and_lock_group(db, incident.group_id, incident.event_id)
        max_pos = await db.scalar(
            select(func.max(Incident.group_position)).where(
                Incident.group_id == incident.group_id,
                Incident.deleted_at.is_(None),
            )
        )
        group_position = (max_pos + 1) if max_pos is not None else 0

    db_incident = Incident(
        **incident.model_dump(),
        created_by=current_user.id,
        group_position=group_position,
        **({"source": source} if source else {}),
        source_ref=source_ref,
    )

    db.add(db_incident)
    await db.flush()

    # Log creation
    await log_action(
        db=db,
        action_type="create",
        resource_type="incident",
        resource_id=db_incident.id,
        user=current_user,
        changes={"created": incident.model_dump(mode="json")},
        request=request,
    )

    # Update event activity timestamp
    await events_crud.update_event_activity(db, db_incident.event_id)

    await db.commit()
    await db.refresh(db_incident)

    return db_incident


async def create_public_incident(
    db: AsyncSession,
    event_id: uuid.UUID,
    incident: schemas.PublicIncidentCreate,
    request: Request,
) -> Incident:
    """Create an incident from the public token-gated intake form.

    No authenticated user: ``created_by`` is None and ``source`` is "intake" so
    operators can see the alarm came from an untrusted source and verify it. The
    audit log records the action with IP/user-agent but no user_id.
    """
    db_incident = Incident(
        **incident.model_dump(),
        event_id=event_id,
        status="incoming",
        source="intake",
        created_by=None,
    )

    db.add(db_incident)
    await db.flush()

    # Log creation (no user — audit service captures IP/user-agent from request)
    await log_action(
        db=db,
        action_type="create",
        resource_type="incident",
        resource_id=db_incident.id,
        user=None,
        changes={"created": incident.model_dump(mode="json"), "source": "intake"},
        request=request,
    )

    # Update event activity timestamp
    await events_crud.update_event_activity(db, db_incident.event_id)

    await db.commit()
    await db.refresh(db_incident)

    return db_incident


async def update_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
    incident_update: schemas.IncidentUpdate,
    current_user: User,
    request: Request,
    expected_updated_at: datetime | None = None,  # For optimistic locking
) -> Incident | None:
    """
    Update incident with optimistic locking and audit logging.

    Args:
        expected_updated_at: Client's last known updated_at (for conflict detection)

    Raises:
        ValueError: If concurrent modification detected
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return None

    # Optimistic locking check
    if expected_updated_at and incident.updated_at != expected_updated_at:
        raise ValueError(f"Concurrent modification detected. Expected {expected_updated_at}, got {incident.updated_at}")

    # Capture before state
    before_state = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "status": incident.status,
        "location_address": incident.location_address,
        "description": incident.description,
        "group_id": str(incident.group_id) if incident.group_id else None,
    }

    old_status = incident.status

    # Apply updates
    update_data = incident_update.model_dump(exclude_unset=True)
    if update_data.get("group_id") is not None:
        await _validate_and_lock_group(db, update_data["group_id"], incident.event_id)

    # Detect an Auftrag (incident group) attach: when moving into a new group,
    # stamp group_position to the end of that route after the field is applied.
    attaching_group_id = None
    if "group_id" in update_data:
        new_group_id = update_data["group_id"]
        if new_group_id is not None and new_group_id != incident.group_id:
            attaching_group_id = new_group_id

    for field, value in update_data.items():
        setattr(incident, field, value)

    if attaching_group_id is not None:
        max_pos = await db.scalar(
            select(func.max(Incident.group_position)).where(
                Incident.group_id == attaching_group_id,
                Incident.id != incident.id,
                Incident.deleted_at.is_(None),
            )
        )
        incident.group_position = (max_pos + 1) if max_pos is not None else 0

    incident.updated_at = datetime.utcnow()

    # If status changed, create a status transition record
    if incident.status != old_status:
        transition = StatusTransition(
            incident_id=incident.id,
            from_status=old_status,
            to_status=incident.status,
            user_id=current_user.id,
            notes=None,
        )
        db.add(transition)

        # Entering complete always runs release side effects, even after reopening.
        if incident.status == "complete":
            incident.completed_at = datetime.utcnow()

            # Automatically release personnel and vehicles (but keep materials)
            from . import assignments as assignments_crud

            await assignments_crud.auto_release_incident_resources(
                db=db,
                incident_id=incident.id,
                current_user=current_user,
                request=request,
                exclude_materials=True,
            )

            # Route resources belong to the Auftrag: release them only when this
            # was the last still-open stop of the group.
            from . import group_assignments as group_assignments_crud

            incident.group_resources_released = await group_assignments_crud.auto_release_group_resources_if_last_stop(
                db=db, incident=incident, current_user=current_user, request=request
            )
        elif old_status == "complete":
            incident.completed_at = None

    # Capture after state
    after_state = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "status": incident.status,
        "location_address": incident.location_address,
        "description": incident.description,
        "group_id": str(incident.group_id) if incident.group_id else None,
    }

    # Calculate changes
    changes = calculate_changes(before_state, after_state)

    # Log if changed
    if changes:
        await log_action(
            db=db,
            action_type="update",
            resource_type="incident",
            resource_id=incident.id,
            user=current_user,
            changes=changes,
            request=request,
        )

    # Update event activity timestamp
    await events_crud.update_event_activity(db, incident.event_id)

    # Auto-print assignment slip when status changes to "enroute" or "active"
    queued_print = None
    if incident.status != old_status and incident.status in ("enroute", "active"):
        from ..services import settings as settings_service
        from . import print_jobs as print_crud

        printer_enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
        auto_anfahrt = await settings_service.get_setting_value(db, "printer.auto_anfahrt", "true")

        if printer_enabled.lower() == "true" and auto_anfahrt.lower() == "true":
            try:
                queued_print = await print_crud.queue_assignment_print(db, incident_id)
            except Exception as e:
                logger = logging.getLogger(__name__)
                logger.warning(f"Auto-print failed for incident {incident_id}: {e}")

    await db.commit()
    await db.refresh(incident)

    # The slip only flushes above, so the wake-up belongs after this commit — this is the
    # auto-print on dispatch, the one print whose latency anybody actually feels.
    if queued_print is not None:
        from ..services import print_signal

        print_signal.notify_job_queued()

    return incident


async def update_incident_status(
    db: AsyncSession,
    incident_id: uuid.UUID,
    new_status: str,
    current_user: User,
    request: Request | None,
    notes: str | None = None,
) -> Incident | None:
    """
    Update incident status and create status transition record.

    Used for Kanban drag-and-drop.

    ``request`` is None for system-initiated transitions (GPS automation) — there is no
    HTTP request to attribute, and ``log_action`` already handles a missing one by
    recording no IP/user-agent. The chain below (auto-release, unassign) accepts the
    same None for the same reason.

    When status is changed to 'complete', automatically releases personnel
    and vehicles (but keeps materials assigned as they may be left on site).
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return None

    old_status = incident.status

    # Update status
    incident.status = new_status
    incident.updated_at = datetime.utcnow()

    # Entering complete always runs release side effects, even after reopening.
    if new_status == "complete" and old_status != "complete":
        incident.completed_at = datetime.utcnow()

        # Automatically release personnel and vehicles (but keep materials)
        from . import assignments as assignments_crud

        await assignments_crud.auto_release_incident_resources(
            db=db,
            incident_id=incident_id,
            current_user=current_user,
            request=request,
            exclude_materials=True,
        )

        # Route resources belong to the Auftrag: release them only when this was
        # the last still-open stop of the group.
        from . import group_assignments as group_assignments_crud

        incident.group_resources_released = await group_assignments_crud.auto_release_group_resources_if_last_stop(
            db=db, incident=incident, current_user=current_user, request=request
        )
    elif old_status == "complete":
        incident.completed_at = None

    # Create status transition record
    transition = StatusTransition(
        incident_id=incident.id,
        from_status=old_status,
        to_status=new_status,
        user_id=current_user.id,
        notes=notes,
    )
    db.add(transition)

    # Log to audit
    await log_action(
        db=db,
        action_type="status_change",
        resource_type="incident",
        resource_id=incident.id,
        user=current_user,
        changes={
            "status": {"before": old_status, "after": new_status},
            "notes": notes,
        },
        request=request,
    )

    # Update event activity timestamp
    await events_crud.update_event_activity(db, incident.event_id)

    # Auto-print assignment slip when status changes to "enroute" or "active"
    queued_print = None
    if new_status in ("enroute", "active"):
        from ..services import settings as settings_service
        from . import print_jobs as print_crud

        printer_enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
        auto_anfahrt = await settings_service.get_setting_value(db, "printer.auto_anfahrt", "true")

        if printer_enabled.lower() == "true" and auto_anfahrt.lower() == "true":
            try:
                queued_print = await print_crud.queue_assignment_print(db, incident_id)
            except Exception as e:
                logger = logging.getLogger(__name__)
                logger.warning(f"Auto-print failed for incident {incident_id}: {e}")

    await db.commit()
    await db.refresh(incident)

    if queued_print is not None:
        from ..services import print_signal

        print_signal.notify_job_queued()

    return incident


async def delete_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> bool:
    """
    Soft delete incident (mark as deleted).

    All incidents are soft deleted by setting deleted_at timestamp.
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return False

    # Soft delete (mark deleted). Use ONE `now` for both columns so a later
    # restore can tell whether `completed_at` was stamped as a side effect of
    # the delete (completed_at == deleted_at) versus a pre-existing completion.
    now = datetime.utcnow()
    incident.deleted_at = now
    if not incident.completed_at:
        incident.completed_at = now

    await log_action(
        db=db,
        action_type="archive",
        resource_type="incident",
        resource_id=incident.id,
        user=current_user,
        request=request,
    )

    # Update event activity timestamp
    await events_crud.update_event_activity(db, incident.event_id)

    await db.commit()
    return True


async def restore_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> Incident | None:
    """Restore a soft-deleted incident.

    Loads the incident directly (the default query helpers exclude soft-deleted
    rows, so we query the model without the ``deleted_at`` filter).

    Returns:
        The restored incident on success.
        ``None`` if the incident does not exist (endpoint maps to 404).

    Raises:
        ValueError: If the incident is not deleted (endpoint maps to 409). This
            makes a double-click on the undo toast harmless — the second call
            409s instead of mutating anything.
    """
    result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = result.scalar_one_or_none()

    if incident is None:
        return None

    if incident.deleted_at is None:
        raise ValueError("Incident is not deleted")

    # If the delete stamped `completed_at` as a side effect (both timestamps set
    # to the same `now`), clear it so the restored incident isn't wrongly
    # "completed". A pre-existing completion (different timestamp) is preserved.
    if incident.completed_at == incident.deleted_at:
        incident.completed_at = None

    # If this incident is a route stop, its old `group_position` slot may have
    # been reused while it was deleted (a replacement stop was added, or the
    # remaining stops were reindexed). Restoring it into the stale slot would
    # collide with the partial unique index `uq_incidents_group_position_active`
    # and raise an IntegrityError. Append it at the end of the active route
    # instead — collision-free regardless of what happened to its old slot.
    # This must run *before* clearing `deleted_at`: the max() query autoflushes
    # pending changes, and we don't want the row re-entering the partial index
    # (which only covers deleted_at IS NULL rows) at its stale slot mid-flush.
    if incident.group_id is not None:
        max_pos = await db.scalar(
            select(func.max(Incident.group_position)).where(
                Incident.group_id == incident.group_id,
                Incident.deleted_at.is_(None),
                Incident.id != incident.id,
            )
        )
        incident.group_position = (max_pos + 1) if max_pos is not None else 0

    incident.deleted_at = None

    await log_action(
        db=db,
        action_type="restore",
        resource_type="incident",
        resource_id=incident.id,
        user=current_user,
        request=request,
    )

    # Update event activity timestamp
    await events_crud.update_event_activity(db, incident.event_id)

    await db.commit()
    await db.refresh(incident)

    return incident


async def reorder_incidents(
    db: AsyncSession,
    event_id: uuid.UUID,
    ordered_ids: list[uuid.UUID],
) -> int:
    """Persist a manual board order for a status column.

    `ordered_ids` is the target column's cards top-to-bottom; each card's
    `position` is set to its index. Only incidents belonging to `event_id`
    (and not soft-deleted) are touched — unknown ids are ignored so a stale
    client can't corrupt another event's order. Status is intentionally NOT
    changed here; a cross-column move persists status via the normal update
    path, keeping its side effects (status transitions, auto-release) intact.

    Returns the number of cards repositioned.
    """
    if not ordered_ids:
        return 0

    result = await db.execute(
        select(Incident).where(
            Incident.event_id == event_id,
            Incident.id.in_(ordered_ids),
            Incident.deleted_at.is_(None),
        )
    )
    incidents_by_id = {incident.id: incident for incident in result.scalars().all()}

    updated = 0
    for index, incident_id in enumerate(ordered_ids):
        incident = incidents_by_id.get(incident_id)
        if incident is None:
            continue
        if incident.position != index:
            incident.position = index
        updated += 1

    if updated:
        await events_crud.update_event_activity(db, event_id)
        await db.commit()

    return updated


async def get_incident_status_history(db: AsyncSession, incident_id: uuid.UUID) -> list[StatusTransition]:
    """Get all status transitions for an incident."""
    result = await db.execute(
        select(StatusTransition)
        .where(StatusTransition.incident_id == incident_id)
        .order_by(StatusTransition.timestamp.asc())
    )
    return list(result.scalars().all())


async def _get_assigned_vehicles(db: AsyncSession, incident_id: uuid.UUID) -> list[schemas.AssignedVehicle]:
    """
    Get all assigned vehicles for an incident with vehicle details.

    Internal helper function to populate assigned_vehicles in incident responses.
    """
    # Query active vehicle assignments with vehicle details
    result = await db.execute(
        select(IncidentAssignment, Vehicle)
        .join(Vehicle, Vehicle.id == IncidentAssignment.resource_id)
        .where(
            and_(
                IncidentAssignment.incident_id == incident_id,
                IncidentAssignment.resource_type == "vehicle",
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentAssignment.assigned_at.asc())
    )

    assigned_vehicles = []
    for assignment, vehicle in result.all():
        assigned_vehicles.append(
            schemas.AssignedVehicle(
                assignment_id=assignment.id,
                vehicle_id=vehicle.id,
                name=vehicle.name,
                type=vehicle.type,
                assigned_at=assignment.assigned_at,
                driver_stay=assignment.driver_stay,
            )
        )

    return assigned_vehicles
