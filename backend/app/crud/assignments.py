"""Resource assignment CRUD operations."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import Request
from sqlalchemy import and_, select
from sqlalchemy import update as update_stmt
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import (
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    User,
    Vehicle,
)
from ..services.audit import log_action

# resource_type is constrained to these three by AssignmentCreate's validator.
_RESOURCE_MODELS = {"personnel": Personnel, "vehicle": Vehicle, "material": Material}


async def assign_resource(
    db: AsyncSession,
    incident_id: uuid.UUID,
    resource_type: str,  # 'personnel', 'vehicle', 'material'
    resource_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> IncidentAssignment:
    """
    Assign resource to incident with transaction isolation.

    Uses SELECT FOR UPDATE to prevent race conditions when multiple requests
    try to assign the same resource concurrently. This ensures atomic
    check-and-create operations.

    Checks for conflicts (resource already assigned elsewhere).
    Updates the resource status field.

    Returns:
        Created assignment

    Raises:
        ValueError: If resource already assigned to this incident
        LookupError: If the incident or the resource does not exist
    """
    # Both ends must exist before anything is written. Without the incident check the INSERT
    # died on a foreign-key violation, i.e. a 500 for what is plainly a stale id; without the
    # resource check it SUCCEEDED and stored an assignment pointing at nothing, which is worse
    # — an orphan row that shows up on the board as a resource nobody can find.
    if await db.get(Incident, incident_id) is None:
        raise LookupError(f"incident {incident_id} does not exist")

    if await db.get(_RESOURCE_MODELS[resource_type], resource_id) is None:
        raise LookupError(f"{resource_type} {resource_id} does not exist")

    # Use FOR UPDATE to lock rows and prevent race conditions
    # This ensures that if two concurrent requests try to assign the same
    # resource, only one will succeed - the other will wait for the lock
    # and then see the newly created assignment.
    existing = await db.execute(
        select(IncidentAssignment)
        .where(
            and_(
                IncidentAssignment.resource_type == resource_type,
                IncidentAssignment.resource_id == resource_id,
                IncidentAssignment.unassigned_at.is_(None),  # Active assignment
            )
        )
        .with_for_update()  # Row-level locking for transaction isolation
    )
    existing_assignments = existing.scalars().all()

    # Check if already assigned to THIS incident
    already_assigned_to_this = any(assignment.incident_id == incident_id for assignment in existing_assignments)
    if already_assigned_to_this:
        raise ValueError("Resource already assigned to this incident")

    # Check if assigned to OTHER incidents (conflict)
    # Note: We allow override with warning (UI should show warning to user before calling this)
    # The lock ensures we have accurate conflict information even under concurrent access

    # Create assignment
    assignment = IncidentAssignment(
        incident_id=incident_id,
        resource_type=resource_type,
        resource_id=resource_id,
        assigned_by=current_user.id,
    )
    db.add(assignment)
    await db.flush()

    # Note: We no longer update resource base status - assignment is tracked via incident_assignments table

    # Log assignment
    await log_action(
        db=db,
        action_type="assign",
        resource_type=f"{resource_type}_assignment",
        resource_id=assignment.id,
        user=current_user,
        changes={
            "incident_id": str(incident_id),
            "resource_type": resource_type,
            "resource_id": str(resource_id),
        },
        request=request,
    )

    if resource_type == "personnel":
        await sync_auto_leader(db, incident_id)

    await db.commit()
    await db.refresh(assignment)

    return assignment


async def update_assignment(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    update: schemas.AssignmentUpdate,
    incident_id: uuid.UUID | None = None,
) -> schemas.AssignmentResponse | None:
    """Update assignment properties (e.g., driver_stay, Einsatzleiter).

    ``incident_id`` is the one from the request path. It is checked against the
    assignment so a valid assignment id cannot be used to write to an incident
    the caller did not name — the route-level twin already did this, and
    `is_leader` turns the omission into a cross-incident write.
    """
    result = await db.execute(select(IncidentAssignment).where(IncidentAssignment.id == assignment_id))
    assignment = result.scalar_one_or_none()
    if not assignment:
        return None
    if incident_id is not None and assignment.incident_id != incident_id:
        return None

    update_data = update.model_dump(exclude_unset=True)

    if "is_leader" in update_data:
        # Only a person can lead an incident. The unique index is on
        # `incident_id` alone, so a vehicle or a pallet of Ölbindemittel marked
        # is_leader occupies the incident's one leader slot — and the automatic
        # resolver, which only ever looks at personnel rows, can neither see it
        # nor clear it. The incident is then stuck with a truck as its
        # Einsatzleiter and no way back through the UI.
        if assignment.resource_type != "personnel":
            raise ValueError("Only personnel assignments can be marked as Einsatzleiter")

        incident = (
            await db.execute(select(Incident).where(Incident.id == assignment.incident_id))
        ).scalar_one_or_none()

        if update_data["is_leader"]:
            # A hand-picked leader pins the choice: automatic re-selection stops
            # for this incident until someone explicitly hands it back.
            if incident is not None:
                incident.leader_manual = True
            # Single-holder, guarded by a partial unique index, so the old holder
            # has to be demoted in the SAME transaction — writing the new one
            # first would hit the index instead of replacing the role. Not
            # filtered by resource_type on purpose: it must also clear a stray
            # flag left on a non-personnel row by an older build.
            await db.execute(
                update_stmt(IncidentAssignment)
                .where(
                    IncidentAssignment.incident_id == assignment.incident_id,
                    IncidentAssignment.id != assignment.id,
                    IncidentAssignment.unassigned_at.is_(None),
                    IncidentAssignment.is_leader.is_(True),
                )
                .values(is_leader=False)
            )
        elif incident is not None:
            # Explicitly demoting hands the choice BACK to the board rather than
            # leaving the incident permanently leaderless — otherwise the pin is
            # a one-way door with no way out through the UI.
            incident.leader_manual = False

    for key, value in update_data.items():
        setattr(assignment, key, value)

    # Un-pinning has to re-derive before the transaction closes, or the incident
    # sits with no leader until the next crew change.
    if update_data.get("is_leader") is False:
        await db.flush()
        await sync_auto_leader(db, assignment.incident_id)

    await db.commit()
    await db.refresh(assignment)
    return schemas.AssignmentResponse.model_validate(assignment)


async def unassign_resource(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    current_user: User,
    request: Request | None,
) -> bool:
    """
    Release resource from incident.

    Sets unassigned_at timestamp and updates resource status to 'available'.

    Flushes only — the CALLER owns the commit. This runs inside larger
    operations (incident completion auto-release); a commit here would let a
    crash mid-completion leave status=complete with crew still assigned and
    no StatusTransition/audit row (audit H3).
    """
    result = await db.execute(select(IncidentAssignment).where(IncidentAssignment.id == assignment_id))
    assignment = result.scalar_one_or_none()

    if not assignment:
        return False

    # Mark unassigned. The Einsatzleiter flag goes with it: the index only
    # counts active rows, so a released row keeping `is_leader` is legal — but
    # `/participants` ORs the flag across a resource's rows, and completion
    # releases the crew ONE AT A TIME, each release promoting the next person.
    # Left alone, an incident finishes with every single person on it flagged as
    # having led it, which is exactly the record "Bisher im Einsatz" is there to
    # get right.
    assignment.unassigned_at = datetime.utcnow()
    assignment.is_leader = False

    # Note: We no longer update resource base status - assignment is tracked via incident_assignments table

    # Log unassignment
    await log_action(
        db=db,
        action_type="unassign",
        resource_type=f"{assignment.resource_type}_assignment",
        resource_id=assignment.id,
        user=current_user,
        request=request,
    )

    await db.flush()

    # Releasing the leader must hand the role on, not leave the incident without
    # one — unless an operator picked deliberately, in which case it stays gone
    # until they pick again.
    if assignment.resource_type == "personnel":
        await sync_auto_leader(db, assignment.incident_id)

    return True


async def update_resource_status(db: AsyncSession, resource_type: str, resource_id: uuid.UUID, new_status: str) -> None:
    """Update a resource's duty status field."""
    if resource_type == "personnel":
        person = (await db.execute(select(Personnel).where(Personnel.id == resource_id))).scalar_one_or_none()
        if person:
            person.status = new_status
            person.updated_at = datetime.utcnow()

    elif resource_type == "vehicle":
        vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == resource_id))).scalar_one_or_none()
        if vehicle:
            vehicle.status = new_status
            vehicle.updated_at = datetime.utcnow()

    elif resource_type == "material":
        material = (await db.execute(select(Material).where(Material.id == resource_id))).scalar_one_or_none()
        if material:
            material.status = new_status
            material.updated_at = datetime.utcnow()


async def get_incident_assignments(db: AsyncSession, incident_id: uuid.UUID) -> list[IncidentAssignment]:
    """Get all active assignments for an incident."""
    result = await db.execute(
        select(IncidentAssignment)
        .where(
            and_(
                IncidentAssignment.incident_id == incident_id,
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentAssignment.assigned_at.asc())
    )
    return list(result.scalars().all())


async def get_assignments_by_event(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[uuid.UUID, list[schemas.AssignmentResponse]]:
    """
    Get all active assignments for all incidents in an event.

    Optimizes the frontend by fetching all assignments in one query
    instead of N separate queries (one per incident).

    Returns:
        Dictionary mapping incident_id to list of assignments
    """
    from ..models import Incident

    # Get all incidents for this event
    incidents_query = select(Incident.id).where(
        and_(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    incidents_result = await db.execute(incidents_query)
    incident_ids = [row[0] for row in incidents_result.all()]

    if not incident_ids:
        return {}

    # Fetch all assignments for these incidents in one query
    assignments_query = (
        select(IncidentAssignment)
        .where(
            and_(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        .order_by(IncidentAssignment.assigned_at.asc())
    )

    result = await db.execute(assignments_query)
    assignments = result.scalars().all()

    # Group by incident_id
    assignments_by_incident: dict[uuid.UUID, list[schemas.AssignmentResponse]] = {}
    for assignment in assignments:
        if assignment.incident_id not in assignments_by_incident:
            assignments_by_incident[assignment.incident_id] = []

        assignments_by_incident[assignment.incident_id].append(schemas.AssignmentResponse.model_validate(assignment))

    return assignments_by_incident


async def check_resource_conflicts(db: AsyncSession, resource_type: str, resource_id: uuid.UUID) -> list[uuid.UUID]:
    """
    Check if resource is assigned to any active incidents.

    Returns:
        List of incident IDs where resource is currently assigned
    """
    result = await db.execute(
        select(IncidentAssignment.incident_id).where(
            and_(
                IncidentAssignment.resource_type == resource_type,
                IncidentAssignment.resource_id == resource_id,
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
    )
    return list(result.scalars().all())


async def auto_release_incident_resources(
    db: AsyncSession,
    incident_id: uuid.UUID,
    current_user: User,
    request: Request | None,
    exclude_materials: bool = True,
) -> None:
    """
    Automatically release resources when incident completed.

    Called when incident status moves to 'complete'.

    Args:
        db: Database session
        incident_id: ID of the incident
        current_user: User performing the action
        request: HTTP request for audit logging
        exclude_materials: If True, only release personnel and vehicles (keep materials assigned)
                          Default: True (materials may be left on site)
    """
    assignments = await get_incident_assignments(db, incident_id)

    for assignment in assignments:
        # Skip materials if exclude_materials is True
        if exclude_materials and assignment.resource_type == "material":
            continue

        await unassign_resource(db, assignment.id, current_user, request)


_RESOURCE_TYPE_LABELS = {"personnel": "Person", "vehicle": "Fahrzeug", "material": "Material"}


async def _resolve_resource_label(db: AsyncSession, resource_type: str, resource_id: uuid.UUID) -> str:
    """Human-readable 'Typ Name' for a resource, for user-facing error messages."""
    model: type[Any] | None = {"personnel": Personnel, "vehicle": Vehicle, "material": Material}.get(resource_type)
    type_label = _RESOURCE_TYPE_LABELS.get(resource_type, resource_type)
    if model is None:
        return f"{type_label} {resource_id}"
    result = await db.execute(select(model).where(model.id == resource_id))
    obj = result.scalar_one_or_none()
    return f"{type_label} {obj.name}" if obj is not None else f"{type_label} {resource_id}"


async def transfer_assignments(
    db: AsyncSession,
    source_incident_id: uuid.UUID,
    target_incident_id: uuid.UUID,
    current_user: User,
    request: Request,
) -> dict[str, Any]:
    """
    Transfer all active assignments from source incident to target incident.

    This function:
    1. Gets all active assignments from source incident
    2. Checks for conflicts (resources already assigned to target)
    3. Creates new assignments for target incident
    4. Marks source assignments as unassigned
    5. Logs the transfer action

    Args:
        db: Database session
        source_incident_id: ID of source incident
        target_incident_id: ID of target incident
        current_user: User performing the transfer
        request: HTTP request for audit logging

    Returns:
        Dictionary with:
        - transferred_count: Number of assignments transferred
        - assignment_ids: List of new assignment IDs

    Raises:
        ValueError: If source has no assignments or if conflicts exist
    """
    from ..models import EventSpecialFunction, Incident

    # Verify both incidents exist
    source_result = await db.execute(select(Incident).where(Incident.id == source_incident_id))
    source_incident = source_result.scalar_one_or_none()
    if not source_incident:
        raise ValueError("Source incident not found")

    target_result = await db.execute(select(Incident).where(Incident.id == target_incident_id))
    target_incident = target_result.scalar_one_or_none()
    if not target_incident:
        raise ValueError("Target incident not found")

    # Get all active assignments from source
    source_assignments = await get_incident_assignments(db, source_incident_id)

    # Exclude reko personnel: a reko person is stored as a normal personnel
    # IncidentAssignment, but their reko role belongs to the event (not the incident).
    # They must neither be transferred nor block the transfer as a conflict.
    reko_result = await db.execute(
        select(EventSpecialFunction.personnel_id).where(
            and_(
                EventSpecialFunction.event_id == source_incident.event_id,
                EventSpecialFunction.function_type == "reko",
            )
        )
    )
    reko_personnel_ids = set(reko_result.scalars().all())
    if reko_personnel_ids:
        source_assignments = [
            a
            for a in source_assignments
            if not (a.resource_type == "personnel" and a.resource_id in reko_personnel_ids)
        ]

    if not source_assignments:
        raise ValueError("Quell-Einsatz hat keine aktiven Ressourcen zum Übertragen.")

    # Check for conflicts - resources already assigned to target
    target_assignments = await get_incident_assignments(db, target_incident_id)
    target_resources = {(a.resource_type, a.resource_id) for a in target_assignments}

    conflicts = []
    for assignment in source_assignments:
        resource_key = (assignment.resource_type, assignment.resource_id)
        if resource_key in target_resources:
            conflicts.append(await _resolve_resource_label(db, assignment.resource_type, assignment.resource_id))

    if conflicts:
        raise ValueError("Übertragen nicht möglich – im Ziel-Einsatz bereits zugewiesen: " + ", ".join(conflicts))

    # Transfer assignments
    new_assignment_ids = []

    for assignment in source_assignments:
        # Create new assignment for target
        new_assignment = IncidentAssignment(
            incident_id=target_incident_id,
            resource_type=assignment.resource_type,
            resource_id=assignment.resource_id,
            assigned_by=current_user.id,
        )
        db.add(new_assignment)
        await db.flush()
        new_assignment_ids.append(new_assignment.id)

        # Mark old assignment as unassigned (same reasoning as unassign_resource:
        # the role does not travel on a released row).
        assignment.unassigned_at = datetime.utcnow()
        assignment.is_leader = False

    # Log transfer action
    await log_action(
        db=db,
        action_type="assignments_transferred",
        resource_type="incident",
        resource_id=source_incident_id,
        user=current_user,
        changes={
            "source_incident_id": str(source_incident_id),
            "target_incident_id": str(target_incident_id),
            "count": len(new_assignment_ids),
            "assignment_ids": [str(aid) for aid in new_assignment_ids],
        },
        request=request,
    )

    # Both incidents changed crew, so both need their Einsatzleiter re-derived:
    # the source just lost its leader with the rest of its people, and the
    # target's new rows arrived with the flag defaulted to false. Without this a
    # transferred crew has nobody leading it until the next unrelated assign.
    await db.flush()
    await sync_auto_leader(db, source_incident_id)
    await sync_auto_leader(db, target_incident_id)

    await db.commit()

    return {
        "transferred_count": len(new_assignment_ids),
        "assignment_ids": new_assignment_ids,
    }


# Rank order used when a station has not filled in `Personnel.role_sort_order`
# — which is the common case, since it is set by the importer and defaults to 0
# for everyone. Without this the "highest ranking person" rule silently decays
# into "whoever was assigned first", which is not the same thing and looks like
# a bug the first time an Offizier joins a crew and stays unmarked.
# An explicit non-zero `role_sort_order` always wins over this table.
_RANK_FALLBACK = {
    "offizier": 1,
    "wachtmeister": 2,
    "korporal": 3,
    "mannschaft": 4,
}


def leader_rank(person: Personnel) -> int:
    """Lower is more senior. Unknown roles sort last but still ahead of nothing."""
    if person.role_sort_order:
        return person.role_sort_order
    return _RANK_FALLBACK.get((person.role or "").strip().lower(), 99)


async def _reko_personnel_ids(db: AsyncSession, event_id: uuid.UUID | None) -> set[uuid.UUID]:
    """Personnel holding the Reko function for an event."""
    if event_id is None:
        return set()
    rows = await db.execute(
        select(EventSpecialFunction.personnel_id).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    return {row[0] for row in rows.all()}


async def sync_auto_leader(db: AsyncSession, incident_id: uuid.UUID) -> None:
    """Keep the Einsatzleiter on the highest-ranking person present.

    An incident that nobody has explicitly assigned a leader to still has one in
    practice — whoever outranks the rest of the crew. Leaving `is_leader` unset
    until someone remembers to click means the Funkspruch and the printed slip
    go out with no EL at all, which is the case where naming one matters most.

    So the role is derived on every crew change: highest rank wins
    (``Personnel.role_sort_order``, lower = more senior), earliest assigned
    breaks a tie. The moment an operator picks someone by hand,
    ``Incident.leader_manual`` is set and this stops touching it — a human
    decision must not be undone by the next person to arrive.

    Flushes only; the caller owns the transaction.
    """
    incident = (await db.execute(select(Incident).where(Incident.id == incident_id))).scalar_one_or_none()
    if incident is None or incident.leader_manual:
        return

    # Reko personnel are excluded: they are on reconnaissance, not crew — the
    # board, the print slip and the WhatsApp text all already treat them as a
    # separate role, and an incident whose only assignment is its Reko has no
    # Einsatzleiter yet rather than one who is out looking at it.
    reko_ids = await _reko_personnel_ids(db, incident.event_id)

    rows = [
        row
        for row in (
            await db.execute(
                select(IncidentAssignment, Personnel)
                .join(Personnel, Personnel.id == IncidentAssignment.resource_id)
                .where(
                    IncidentAssignment.incident_id == incident_id,
                    IncidentAssignment.resource_type == "personnel",
                    IncidentAssignment.unassigned_at.is_(None),
                )
                .order_by(IncidentAssignment.assigned_at.asc())
            )
        ).all()
        if row[1].id not in reko_ids
    ]

    # Sorted in Python, not SQL: the rank fallback above cannot be expressed as
    # a column, and a crew is a handful of rows.
    rows.sort(key=lambda row: (leader_rank(row[1]), row[0].assigned_at))
    winner = rows[0][0] if rows else None

    # Clear across ALL active personnel rows, not just the candidates: someone
    # who has since become the Reko must not keep a stale marker.
    await db.execute(
        update_stmt(IncidentAssignment)
        .where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.unassigned_at.is_(None),
        )
        .values(is_leader=False)
    )
    if winner is not None:
        winner.is_leader = True

    await db.flush()
