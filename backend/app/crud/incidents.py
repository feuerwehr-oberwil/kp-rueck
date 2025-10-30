"""Incident CRUD operations."""
from datetime import datetime
from typing import Optional
import uuid

from fastapi import Request
from sqlalchemy import and_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import Incident, IncidentAssignment, Material, Personnel, StatusTransition, User, Vehicle
from ..services.audit import calculate_changes, log_action
from . import events as events_crud


async def get_incidents(
    db: AsyncSession,
    event_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
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
    # Eager load relationships to prevent N+1 queries
    query = (
        select(Incident)
        .options(
            selectinload(Incident.status_transitions),
            selectinload(Incident.assignments)
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

    # Populate status_changed_at and assigned_vehicles for each incident
    # Data is already loaded via eager loading, so no additional queries
    for incident in incidents:
        # Get most recent status transition from already-loaded data
        if incident.status_transitions:
            latest_timestamp = max(
                transition.timestamp for transition in incident.status_transitions
            )
            incident.status_changed_at = latest_timestamp
        else:
            incident.status_changed_at = incident.created_at

        # Load all assigned resources from already-loaded assignments
        incident.assigned_vehicles = await _get_assigned_vehicles_from_loaded_assignments(
            db, incident
        )
        incident.assigned_personnel = await _get_assigned_personnel_from_loaded_assignments(
            db, incident
        )
        incident.assigned_materials = await _get_assigned_materials_from_loaded_assignments(
            db, incident
        )

    return incidents


async def get_incident(db: AsyncSession, incident_id: uuid.UUID) -> Incident | None:
    """Get incident by ID with status_changed_at and assigned_vehicles populated."""
    # Eager load relationships to prevent N+1 queries
    result = await db.execute(
        select(Incident)
        .options(
            selectinload(Incident.status_transitions),
            selectinload(Incident.assignments)
        )
        .where(Incident.id == incident_id)
    )
    incident = result.scalar_one_or_none()

    if incident:
        # Get most recent status transition from already-loaded data
        if incident.status_transitions:
            latest_timestamp = max(
                transition.timestamp for transition in incident.status_transitions
            )
            incident.status_changed_at = latest_timestamp
        else:
            incident.status_changed_at = incident.created_at

        # Load all assigned resources from already-loaded assignments
        incident.assigned_vehicles = await _get_assigned_vehicles_from_loaded_assignments(
            db, incident
        )
        incident.assigned_personnel = await _get_assigned_personnel_from_loaded_assignments(
            db, incident
        )
        incident.assigned_materials = await _get_assigned_materials_from_loaded_assignments(
            db, incident
        )

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
        changes={"created": incident.model_dump()},
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
    expected_updated_at: Optional[datetime] = None,  # For optimistic locking
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
        raise ValueError(
            f"Concurrent modification detected. "
            f"Expected {expected_updated_at}, got {incident.updated_at}"
        )

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
    notes: Optional[str] = None,
) -> Incident | None:
    """
    Update incident status and create status transition record.

    Used for Kanban drag-and-drop.
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


async def get_incident_status_history(
    db: AsyncSession, incident_id: uuid.UUID
) -> list[StatusTransition]:
    """Get all status transitions for an incident."""
    result = await db.execute(
        select(StatusTransition)
        .where(StatusTransition.incident_id == incident_id)
        .order_by(StatusTransition.timestamp.asc())
    )
    return list(result.scalars().all())


async def _get_assigned_vehicles(
    db: AsyncSession, incident_id: uuid.UUID
) -> list[schemas.AssignedVehicle]:
    """
    Get all assigned vehicles for an incident with vehicle details.

    Internal helper function to populate assigned_vehicles in incident responses.
    Used when assignments are not already loaded (e.g., get_incident single query).
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


async def _get_assigned_vehicles_from_loaded_assignments(
    db: AsyncSession, incident: Incident
) -> list[schemas.AssignedVehicle]:
    """
    Get assigned vehicles from already-loaded incident.assignments relationship.

    This avoids N+1 queries when assignments are eagerly loaded.
    Fetches vehicle details in a single batch query for all vehicle assignments.
    """
    # Filter for active vehicle assignments from already-loaded data
    vehicle_assignments = [
        assignment
        for assignment in incident.assignments
        if assignment.resource_type == "vehicle" and assignment.unassigned_at is None
    ]

    if not vehicle_assignments:
        return []

    # Fetch all vehicles in a single query
    vehicle_ids = [assignment.resource_id for assignment in vehicle_assignments]
    result = await db.execute(
        select(Vehicle).where(Vehicle.id.in_(vehicle_ids))
    )
    vehicles = {vehicle.id: vehicle for vehicle in result.scalars().all()}

    # Build response using loaded data
    assigned_vehicles = []
    for assignment in sorted(vehicle_assignments, key=lambda a: a.assigned_at):
        vehicle = vehicles.get(assignment.resource_id)
        if vehicle:
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


async def _get_assigned_personnel_from_loaded_assignments(
    db: AsyncSession, incident: Incident
) -> list[schemas.AssignedPersonnel]:
    """
    Get assigned personnel from already-loaded incident.assignments relationship.

    This avoids N+1 queries when assignments are eagerly loaded.
    Fetches personnel details in a single batch query for all personnel assignments.
    """
    # Filter for active personnel assignments from already-loaded data
    personnel_assignments = [
        assignment
        for assignment in incident.assignments
        if assignment.resource_type == "personnel" and assignment.unassigned_at is None
    ]

    if not personnel_assignments:
        return []

    # Fetch all personnel in a single query
    personnel_ids = [assignment.resource_id for assignment in personnel_assignments]
    result = await db.execute(
        select(Personnel).where(Personnel.id.in_(personnel_ids))
    )
    personnel_map = {person.id: person for person in result.scalars().all()}

    # Build response using loaded data
    assigned_personnel = []
    for assignment in sorted(personnel_assignments, key=lambda a: a.assigned_at):
        person = personnel_map.get(assignment.resource_id)
        if person:
            assigned_personnel.append(
                schemas.AssignedPersonnel(
                    assignment_id=assignment.id,
                    personnel_id=person.id,
                    name=person.name,
                    role=person.role,
                    assigned_at=assignment.assigned_at,
                )
            )

    return assigned_personnel


async def _get_assigned_materials_from_loaded_assignments(
    db: AsyncSession, incident: Incident
) -> list[schemas.AssignedMaterial]:
    """
    Get assigned materials from already-loaded incident.assignments relationship.

    This avoids N+1 queries when assignments are eagerly loaded.
    Fetches material details in a single batch query for all material assignments.
    """
    # Filter for active material assignments from already-loaded data
    material_assignments = [
        assignment
        for assignment in incident.assignments
        if assignment.resource_type == "material" and assignment.unassigned_at is None
    ]

    if not material_assignments:
        return []

    # Fetch all materials in a single query
    material_ids = [assignment.resource_id for assignment in material_assignments]
    result = await db.execute(
        select(Material).where(Material.id.in_(material_ids))
    )
    materials_map = {material.id: material for material in result.scalars().all()}

    # Build response using loaded data
    assigned_materials = []
    for assignment in sorted(material_assignments, key=lambda a: a.assigned_at):
        material = materials_map.get(assignment.resource_id)
        if material:
            assigned_materials.append(
                schemas.AssignedMaterial(
                    assignment_id=assignment.id,
                    material_id=material.id,
                    name=material.name,
                    assigned_at=assignment.assigned_at,
                )
            )

    return assigned_materials
