"""Incident CRUD operations."""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import (
    Incident,
    IncidentAssignment,
    IncidentGroup,
    Personnel,
    RekoReport,
    SchadenplatzReport,
    StatusTransition,
    User,
    Vehicle,
)
from ..services.audit import calculate_changes, log_action
from ..services.incident_dispatch import dispatched_incident_ids, is_dispatched
from ..services.incident_leader import effective_leader_id
from . import events as events_crud
from . import feld as feld_crud


class InvalidIncidentGroupError(ValueError):
    """Incident group is missing, deleted, or belongs to another event."""


async def _validate_and_lock_group(db: AsyncSession, group_id: uuid.UUID, event_id: uuid.UUID) -> IncidentGroup:
    group = await db.scalar(select(IncidentGroup).where(IncidentGroup.id == group_id).with_for_update())
    if group is None or group.deleted_at is not None:
        raise InvalidIncidentGroupError("Auftrag not found or deleted")
    if group.event_id != event_id:
        raise InvalidIncidentGroupError("Auftrag belongs to a different event")
    return group


async def count_incidents(
    db: AsyncSession,
    event_id: uuid.UUID | None = None,
    status: str | None = None,
) -> int:
    """
    Total incidents matching the same filters `get_incidents` applies, ignoring skip/limit.

    Exists so the board can say "showing 500 of 640" instead of silently rendering a
    truncated list. Deliberately mirrors the filters above — if a filter is added there it
    has to be added here too, or the count starts lying, which is worse than no count.
    """
    query = select(func.count()).select_from(Incident).where(Incident.deleted_at.is_(None))
    if event_id is not None:
        query = query.where(Incident.event_id == event_id)
    if status:
        query = query.where(Incident.status == status)
    return int((await db.execute(query)).scalar_one())


async def get_incidents(
    db: AsyncSession,
    event_id: uuid.UUID | None = None,
    skip: int = 0,
    # 500, not 100. Every production caller omits this, so the old default was a hard ceiling
    # on what the board could ever show — at 200 incidents an arbitrary 100 were invisible
    # with no banner and no count. That is the storm scenario, and no hardware helps.
    limit: int = 500,
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
    reko_query = select(
        RekoReport.incident_id,
        RekoReport.is_draft,
        RekoReport.arrived_at,
        RekoReport.arrived_reported_by_user_id,
    ).where(RekoReport.incident_id.in_(incident_ids))
    reko_result = await db.execute(reko_query)
    incidents_with_completed_reko = set()
    reko_arrived_at_map: dict[uuid.UUID, datetime] = {}
    # Which channel reported it — carried alongside the timestamp so the detail's
    # Feldmeldungen row can say "(Funkmeldung)" without a second request.
    reko_arrived_by_kp: set[uuid.UUID] = set()
    for row in reko_result:
        if not row.is_draft:
            incidents_with_completed_reko.add(row.incident_id)
        # Keep the earliest arrived_at for each incident
        if row.arrived_at and (
            row.incident_id not in reko_arrived_at_map or row.arrived_at < reko_arrived_at_map[row.incident_id]
        ):
            reko_arrived_at_map[row.incident_id] = row.arrived_at
            if row.arrived_reported_by_user_id is not None:
                reko_arrived_by_kp.add(row.incident_id)
            else:
                reko_arrived_by_kp.discard(row.incident_id)

    # Batch load the /feld arrival ("Angekommen") and whether a rapport exists.
    # One row per incident (UNIQUE(incident_id)), so this is a plain map.
    feld_query = select(
        SchadenplatzReport.incident_id,
        SchadenplatzReport.arrived_at,
        SchadenplatzReport.is_draft,
        SchadenplatzReport.arrived_by_personnel_id,
        SchadenplatzReport.arrived_by_user_id,
    ).where(SchadenplatzReport.incident_id.in_(incident_ids))
    feld_result = await db.execute(feld_query)
    field_arrived_map: dict[uuid.UUID, tuple[datetime | None, uuid.UUID | None, bool]] = {}
    submitted_rapports: set[uuid.UUID] = set()
    # Kept apart rather than derived from each other: "nobody has filed" and
    # "somebody started and walked away" are different states on the board.
    draft_rapports: set[uuid.UUID] = set()
    # Own loop variable: `row` above is a differently-shaped Row and mypy holds
    # the first binding's type for the whole function.
    for feld_row in feld_result:
        field_arrived_map[feld_row.incident_id] = (
            feld_row.arrived_at,
            feld_row.arrived_by_personnel_id,
            feld_crud.is_automation_user(feld_row.arrived_by_user_id),
        )
        if feld_row.is_draft:
            draft_rapports.add(feld_row.incident_id)
        else:
            submitted_rapports.add(feld_row.incident_id)

    # Was this Schadenplatz ever disponiert? One query for the whole board, on
    # the same principle as the flags above — the rapport surfaces read it per
    # card and a query per card is what a storm night cannot afford.
    dispatched = await dispatched_incident_ids(db, incidents)

    # The effective Einsatzleiter per incident (services.incident_leader):
    # active `is_leader` assignments first, `leader_personnel_id` as the record
    # behind them — a completed incident's assignments are released, so the
    # record is the only way a closed card can still say who led it. Batched:
    # one query for the flags, one for the names, never one per card.
    leader_rows = await db.execute(
        select(IncidentAssignment.incident_id, IncidentAssignment.resource_id).where(
            and_(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.is_leader.is_(True),
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
    )
    active_leaders: dict[uuid.UUID, set[uuid.UUID]] = {}
    for leader_row in leader_rows:
        active_leaders.setdefault(leader_row.incident_id, set()).add(leader_row.resource_id)
    leader_by_incident = {
        incident.id: effective_leader_id(incident, active_leaders.get(incident.id, set())) for incident in incidents
    }
    leader_ids = {pid for pid in leader_by_incident.values() if pid is not None}
    leader_names: dict[uuid.UUID, str] = {}
    if leader_ids:
        name_rows = await db.execute(select(Personnel.id, Personnel.name).where(Personnel.id.in_(leader_ids)))
        leader_names = {row.id: row.name for row in name_rows}

    # Populate status_changed_at, assigned_vehicles, has_completed_reko, and reko_arrived_at for each incident
    for incident in incidents:
        arrival = field_arrived_map.get(incident.id)
        incident.field_arrived_at = arrival[0] if arrival else None
        incident.field_arrived_by = arrival[1] if arrival else None
        incident.field_arrived_by_automation = bool(arrival and arrival[2])
        incident.has_schadenplatz_rapport = incident.id in submitted_rapports
        incident.has_schadenplatz_rapport_draft = incident.id in draft_rapports
        incident.has_been_dispatched = incident.id in dispatched
        # Set status_changed_at from batch-loaded map
        incident.status_changed_at = transitions_map.get(incident.id, incident.created_at)

        # Set assigned vehicles from batch-loaded map
        incident.assigned_vehicles = vehicles_by_incident.get(incident.id, [])

        # Set has_completed_reko flag
        incident.has_completed_reko = incident.id in incidents_with_completed_reko

        # Set reko_arrived_at timestamp
        incident.reko_arrived_at = reko_arrived_at_map.get(incident.id)
        incident.reko_arrived_by_kp = incident.id in reko_arrived_by_kp

        leader_id = leader_by_incident.get(incident.id)
        incident.leader_name = leader_names.get(leader_id) if leader_id else None

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
            select(
                RekoReport.id,
                RekoReport.is_draft,
                RekoReport.arrived_at,
                RekoReport.arrived_reported_by_user_id,
            )
            .where(RekoReport.incident_id == incident.id)
            .order_by(RekoReport.arrived_at.asc().nullslast())
        )
        reko_rows = reko_check.all()
        incident.has_completed_reko = any(not row.is_draft for row in reko_rows)
        # Get the earliest arrived_at timestamp, and which channel reported it
        arrival_row = next((row for row in reko_rows if row.arrived_at), None)
        incident.reko_arrived_at = arrival_row.arrived_at if arrival_row else None
        incident.reko_arrived_by_kp = bool(arrival_row and arrival_row.arrived_reported_by_user_id is not None)

        # The /feld arrival + rapport state (one row per incident).
        feld_check = await db.execute(
            select(
                SchadenplatzReport.arrived_at,
                SchadenplatzReport.is_draft,
                SchadenplatzReport.arrived_by_personnel_id,
                SchadenplatzReport.arrived_by_user_id,
            ).where(SchadenplatzReport.incident_id == incident.id)
        )
        feld_row = feld_check.first()
        incident.field_arrived_at = feld_row.arrived_at if feld_row else None
        incident.field_arrived_by = feld_row.arrived_by_personnel_id if feld_row else None
        incident.field_arrived_by_automation = bool(
            feld_row and feld_crud.is_automation_user(feld_row.arrived_by_user_id)
        )
        incident.has_schadenplatz_rapport = bool(feld_row and not feld_row.is_draft)
        incident.has_schadenplatz_rapport_draft = bool(feld_row and feld_row.is_draft)
        incident.has_been_dispatched = await is_dispatched(db, incident)

        # Effective Einsatzleiter, same rule as the batched list above.
        active_leader_rows = await db.execute(
            select(IncidentAssignment.resource_id).where(
                and_(
                    IncidentAssignment.incident_id == incident.id,
                    IncidentAssignment.resource_type == "personnel",
                    IncidentAssignment.is_leader.is_(True),
                    IncidentAssignment.unassigned_at.is_(None),
                )
            )
        )
        leader_id = effective_leader_id(incident, {row[0] for row in active_leader_rows})
        incident.leader_name = (
            await db.scalar(select(Personnel.name).where(Personnel.id == leader_id)) if leader_id else None
        )

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
    alarm's id in that system). It wins over the schema's ``source``, which
    only ever carries what an editor may claim ("operator"/"intake") and is
    the modal's "Telefonisch gemeldet" toggle — the pool path builds its
    payload with the default and names its real sender here.

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

    incident_data = incident.model_dump()
    editor_source = incident_data.pop("source")

    db_incident = Incident(
        **incident_data,
        created_by=current_user.id,
        group_position=group_position,
        source=source or editor_source,
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


async def _apply_completion_release(
    db: AsyncSession,
    incident: Incident,
    transition: StatusTransition,
    current_user: User,
    request: Request | None,
) -> None:
    """Completion's release side effects, recorded on the transition that caused them.

    Releases personnel and vehicles (materials stay — they may be on site) and,
    when this was the Auftrag's last open stop, the route's shared resources. It
    freezes the Einsatzleiter of record before releasing anyone: after that call
    nothing else knows who led the incident.

    Everything it closed is written to ``transition.released_assignments_json``.
    That record is what makes the move undoable — see ``_undo_completion_release``.
    """
    from . import assignments as assignments_crud
    from . import group_assignments as group_assignments_crud

    released = await assignments_crud.auto_release_incident_resources(
        db=db,
        incident_id=incident.id,
        current_user=current_user,
        request=request,
        exclude_materials=True,
    )

    group_released, group_entries = await group_assignments_crud.auto_release_group_resources_if_last_stop(
        db=db, incident=incident, current_user=current_user, request=request
    )
    incident.group_resources_released = group_released

    transition.released_assignments_json = released + group_entries or None


async def _undo_completion_release(
    db: AsyncSession,
    incident: Incident,
    current_user: User,
    request: Request | None,
) -> None:
    """Leaving ``complete`` puts the crew back.

    Completing an incident empties its card — every person and every vehicle is
    released, and the Auftrag's squad with them on the last stop. Until this
    existed, reverting the move (the Abbrechen of any completion gate, or simply
    dragging the card back out of Abgeschlossen) restored the status and nothing
    else: the incident reappeared with no crew, no vehicles, no Einsatzleiter, and
    the operator had to rebuild it from memory.

    It runs inside the same transaction as the status change, which is the whole
    point of doing it here rather than as a second call from the browser: there is
    no window in which the incident is open again but its crew is still released.

    Only the most recent completion is undone, and only once — its record is
    cleared as it is consumed, so a later reopen cannot replay it.
    """
    from . import assignments as assignments_crud
    from . import group_assignments as group_assignments_crud

    result = await db.execute(
        select(StatusTransition)
        .where(
            StatusTransition.incident_id == incident.id,
            StatusTransition.to_status == "complete",
            StatusTransition.released_assignments_json.isnot(None),
        )
        .order_by(StatusTransition.timestamp.desc())
        .limit(1)
    )
    completion = result.scalar_one_or_none()
    if completion is None:
        return

    entries = completion.released_assignments_json
    await assignments_crud.restore_released_assignments(db, entries, current_user, request)
    group_restored = await group_assignments_crud.restore_released_group_resources(db, entries, current_user, request)
    completion.released_assignments_json = None
    # Same flag the release sets: it is what makes the caller broadcast the
    # Auftrag, and the route's card changed here just as much as it did there.
    incident.group_resources_released = group_restored > 0
    await db.flush()


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
        # "Telefonisch gemeldet" is a claim, not evidence (plan 26 §11), so a
        # correction of one has to be readable in the audit trail.
        "source": incident.source,
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

    incident.updated_at = datetime.now(UTC)

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
            incident.completed_at = datetime.now(UTC)
            await _apply_completion_release(db, incident, transition, current_user, request)
        elif old_status == "complete":
            incident.completed_at = None
            await _undo_completion_release(db, incident, current_user, request)

    # Capture after state
    after_state = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "status": incident.status,
        "location_address": incident.location_address,
        "description": incident.description,
        "group_id": str(incident.group_id) if incident.group_id else None,
        "source": incident.source,
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
    current_user: User | None,
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

    ``current_user`` is None for a FIELD-originated transition (sweep 27 §P3.3):
    a crew tapping «Angekommen»/«Einsatz beendet» on `/feld` moves the card
    itself, and attributing that to any user would fake provenance — the GPS
    automation has a system user because it IS a system, but a field tap is a
    named crew member who holds no user row. The transition and audit rows carry
    no user then; `notes` and the audit's `source: feld` say who and why.
    Such transitions never enter or leave `complete` — closing a Schadenplatz
    stays the operator's decision, and the release cascade requires an actor.

    When status is changed to 'complete', automatically releases personnel
    and vehicles (but keeps materials assigned as they may be left on site).
    """
    incident = await get_incident(db, incident_id)
    if not incident:
        return None

    old_status = incident.status

    # Update status
    incident.status = new_status
    incident.updated_at = datetime.now(UTC)

    # Create status transition record. It is written BEFORE the release below so
    # the release has a transition to hang its record on — undoing a completion
    # means undoing exactly what THAT completion closed.
    transition = StatusTransition(
        incident_id=incident.id,
        from_status=old_status,
        to_status=new_status,
        user_id=current_user.id if current_user else None,
        notes=notes,
    )
    db.add(transition)

    # Entering complete always runs release side effects, even after reopening.
    if new_status == "complete" and old_status != "complete":
        if current_user is None:
            raise ValueError("Completing an incident requires an acting user")
        incident.completed_at = datetime.now(UTC)
        await _apply_completion_release(db, incident, transition, current_user, request)
    elif old_status == "complete":
        if current_user is None:
            raise ValueError("Reopening a completed incident requires an acting user")
        incident.completed_at = None
        await _undo_completion_release(db, incident, current_user, request)

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
            # The one caller that passes no user is the field auto-move; the
            # Einsatztagebuch tells the provenances apart by this.
            **({"source": "feld"} if current_user is None else {}),
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
    now = datetime.now(UTC)
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
