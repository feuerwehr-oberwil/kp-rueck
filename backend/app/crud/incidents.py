"""Incident CRUD operations."""

import uuid
from datetime import datetime

from fastapi import Request
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import Incident, IncidentAssignment, RekoReport, StatusTransition, User, Vehicle
from ..services.audit import calculate_changes, log_action
from . import events as events_crud


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
        .order_by(Incident.created_at.desc())
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
    vehicles_by_incident = {}
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
                )
            )

    # Batch load reko completion status and arrived_at for all incidents
    reko_query = (
        select(RekoReport.incident_id, RekoReport.is_draft, RekoReport.arrived_at)
        .where(RekoReport.incident_id.in_(incident_ids))
    )
    reko_result = await db.execute(reko_query)
    incidents_with_completed_reko = set()
    reko_arrived_at_map = {}
    for row in reko_result:
        if not row.is_draft:
            incidents_with_completed_reko.add(row.incident_id)
        # Keep the earliest arrived_at for each incident
        if row.arrived_at:
            if row.incident_id not in reko_arrived_at_map or row.arrived_at < reko_arrived_at_map[row.incident_id]:
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
) -> Incident:
    """Create new incident with audit logging."""
    db_incident = Incident(
        **incident.model_dump(),
        created_by=current_user.id,
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
    }

    old_status = incident.status

    # Apply updates
    for field, value in incident_update.model_dump(exclude_unset=True).items():
        setattr(incident, field, value)

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

        # Mark completed if moved to abschluss
        if incident.status == "abschluss" and not incident.completed_at:
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

    # Capture after state
    after_state = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "status": incident.status,
        "location_address": incident.location_address,
        "description": incident.description,
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

    await db.commit()
    await db.refresh(incident)

    return incident


async def update_incident_status(
    db: AsyncSession,
    incident_id: uuid.UUID,
    new_status: str,
    current_user: User,
    request: Request,
    notes: str | None = None,
) -> Incident | None:
    """
    Update incident status and create status transition record.

    Used for Kanban drag-and-drop.

    When status is changed to 'abschluss', automatically releases personnel
    and vehicles (but keeps materials assigned as they may be left on site).
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return None

    old_status = incident.status

    # Update status
    incident.status = new_status
    incident.updated_at = datetime.utcnow()

    # Mark completed if moved to abschluss
    if new_status == "abschluss" and not incident.completed_at:
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

    # Auto-print assignment slip when status changes to "einsatz" (Anfahrt)
    if new_status == "einsatz" and old_status != "einsatz":
        from ..services import settings as settings_service
        from . import print_jobs as print_crud

        # Check if auto-print is enabled
        printer_enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
        auto_anfahrt = await settings_service.get_setting_value(db, "printer.auto_anfahrt", "true")

        if printer_enabled.lower() == "true" and auto_anfahrt.lower() == "true":
            try:
                await print_crud.queue_assignment_print(db, incident_id)
            except Exception as e:
                # Log error but don't fail the status change
                import logging

                logger = logging.getLogger(__name__)
                logger.warning(f"Auto-print failed for incident {incident_id}: {e}")

    await db.commit()
    await db.refresh(incident)

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

    # Soft delete (mark deleted)
    incident.deleted_at = datetime.utcnow()
    if not incident.completed_at:
        incident.completed_at = datetime.utcnow()

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
            )
        )

    return assigned_vehicles
