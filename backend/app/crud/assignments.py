"""Resource assignment CRUD operations."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import and_, select
from sqlalchemy import update as update_stmt
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..models import (
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroupAssignment,
    Material,
    Personnel,
    SchadenplatzReport,
    User,
    Vehicle,
)
from ..services.audit import log_action
from ..services.ranks import rank_tier
from ..services.rapport_rows import left_on_site_assignment_ids
from .locking import (
    AssignableResource,
    lock_incident_with_group,
    lock_incidents_with_groups,
    lock_resource,
    lock_resources,
)


class IncidentNotOnBoardError(Exception):
    """The incident was deleted or merged into another card — nothing goes onto it any more."""


class AssignmentReleasedError(ValueError):
    """A stale edit reached an assignment after its responder was released."""


class ResourceNotAssignableError(ValueError):
    """The resource exists but may not be assigned right now. ``str()`` is the German 409 detail.

    A ``ValueError`` so a route that only maps ``ValueError`` (the transfer) answers 4xx,
    not 500; the assign routes catch it first and answer 409.
    """


def ensure_assignable(
    resource: AssignableResource,
    *,
    event: Event,
    incident: Incident | None = None,
    auftrag_closed: bool = False,
) -> None:
    """The one place that decides whether a resource may go onto an Einsatz or an Auftrag.

    Called by ``assign_resource`` (``incident`` given) and
    ``group_assignments.assign_group_resource`` (Auftrag: ``incident`` None,
    ``auftrag_closed`` from ``group_assignments.auftrag_is_closed``) with the
    target and the resource row locked (``crud/locking.py``) – the resource lock is
    the one archive and purge take, so nothing changes between this check and the
    insert. ``event`` is the target's Ereignis, read without a lock: archiving one is
    a deliberate step, and locking its row here would invert ``delete_event``'s order.

    Hiding a resource in the picker does not stop a stale tab or a script, so the
    server refuses (owner decision, audit 2026-10 F13):

    * archived inventory,
    * a vehicle or material marked «Nicht einsatzbereit» (``out_of_service_since``),
    * anything onto an archived Ereignis,
    * a guest of another Ereignis (``Personnel.guest_event_id``) – nobody this one lists,
    * anything onto a closed Einsatz, or onto an Auftrag whose stops are all closed
      (owner feedback 23.11.2026 #7). Material left on site at the close keeps its
      row – that is the close, not a new assignment.

    Only new assignments pass through here (also the Reko assignment, a template's
    equipment, a `/feld` take-over and a transfer). Rows already assigned stay as they
    are, and the internal re-openers (the completion undo, merges, imports, seed, the
    `/feld` route mirror) write rows directly and do not ask.
    """
    if isinstance(resource, Vehicle | Material):
        label = f"{'Fahrzeug' if isinstance(resource, Vehicle) else 'Material'} «{resource.name}»"
        if resource.archived_at is not None:
            raise ResourceNotAssignableError(f"{label} ist archiviert und kann nicht zugewiesen werden.")
        if resource.out_of_service_since is not None:
            raise ResourceNotAssignableError(f"{label} ist nicht einsatzbereit und kann nicht zugewiesen werden.")
    if event.archived_at is not None:
        raise ResourceNotAssignableError("Das Ereignis ist archiviert – es kann nichts mehr zugewiesen werden.")
    if isinstance(resource, Personnel) and resource.guest_event_id not in (None, event.id):
        raise ResourceNotAssignableError(f"«{resource.name}» ist Gast eines anderen Ereignisses.")
    if incident is not None and incident.status == "complete":
        raise ResourceNotAssignableError("Der Einsatz ist abgeschlossen – es kann nichts mehr zugewiesen werden.")
    if auftrag_closed:
        raise ResourceNotAssignableError(
            "Alle Stopps des Auftrags sind abgeschlossen – es kann nichts mehr zugewiesen werden."
        )


async def lock_for_new_assignment(
    db: AsyncSession, incident_id: uuid.UUID, resource_type: str, resource_id: uuid.UUID
) -> Incident:
    """Lock an Einsatz and a resource for a NEW assignment row the caller writes itself.

    For writers that build the row by hand (the Reko assignment). Lock order
    (``crud/locking.py``): the Einsatz with its Auftrag, then the resource row; then
    ``ensure_assignable``. Returns the locked Einsatz.

    Raises:
        LookupError: the Einsatz or the resource does not exist.
        IncidentNotOnBoardError: the Einsatz is deleted or merged.
        ResourceNotAssignableError: ``ensure_assignable`` refused the resource.
    """
    incident = await lock_incident_with_group(db, incident_id)
    if incident is None:
        raise LookupError(f"incident {incident_id} does not exist")
    if incident.deleted_at is not None or incident.merged_into_id is not None:
        raise IncidentNotOnBoardError(f"incident {incident_id} is deleted or merged")
    resource = await lock_resource(db, resource_type, resource_id)
    if resource is None:
        raise LookupError(f"{resource_type} {resource_id} does not exist")
    event = await db.get(Event, incident.event_id)
    if event is None:
        raise LookupError(f"event {incident.event_id} does not exist")
    ensure_assignable(resource, event=event, incident=incident)
    return incident


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

    Lock order (``crud/locking.py``): the incident, then the resource row.

    Returns:
        Created assignment

    Raises:
        ValueError: If resource already assigned to this incident
        LookupError: If the incident or the resource does not exist
        ResourceNotAssignableError: ``ensure_assignable`` refused the resource
    """
    # Both ends must exist before anything is written. Without the incident check the INSERT
    # died on a foreign-key violation, i.e. a 500 for what is plainly a stale id; without the
    # resource check it SUCCEEDED and stored an assignment pointing at nothing, which is worse
    # — an orphan row that shows up on the board as a resource nobody can find.
    # Locked, and it must still be on the board: a merge (services/duplicates.py)
    # soft-deletes the losing card under the same row lock after checking it has
    # nobody on it — without the lock here, a crew assigned in that instant would
    # land on a card nobody can see any more.
    incident = (
        await db.execute(
            select(Incident)
            .where(Incident.id == incident_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if incident is None:
        raise LookupError(f"incident {incident_id} does not exist")
    if incident.deleted_at is not None or incident.merged_into_id is not None:
        raise IncidentNotOnBoardError(f"incident {incident_id} is deleted or merged")

    resource = await lock_resource(db, resource_type, resource_id)
    if resource is None:
        raise LookupError(f"{resource_type} {resource_id} does not exist")
    event = await db.get(Event, incident.event_id)
    if event is None:
        raise LookupError(f"event {incident.event_id} does not exist")
    ensure_assignable(resource, event=event, incident=incident)

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
        raise ValueError("Ressource ist diesem Einsatz bereits zugewiesen")

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
    try:
        await db.flush()
    except IntegrityError as exc:
        # The SELECT ... FOR UPDATE above cannot serialise the FIRST assignment: there are no
        # rows yet, so it locks nothing and two concurrent transactions both read an empty
        # result and both insert. `uq_assignments_active_resource` is what actually decides,
        # and the loser lands here. Same outcome the check above produces, so say the same
        # thing — the resource IS on the incident, the caller just did not win the insert.
        await db.rollback()
        raise ValueError("Ressource ist diesem Einsatz bereits zugewiesen") from exc

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

    await db.flush()
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
    if incident_id is None:
        incident_id = await db.scalar(
            select(IncidentAssignment.incident_id).where(IncidentAssignment.id == assignment_id)
        )
    if incident_id is None:
        return None
    incident = await lock_incident_with_group(db, incident_id)
    if incident is None or incident.deleted_at is not None:
        return None
    assignment = await db.scalar(
        select(IncidentAssignment)
        .where(
            IncidentAssignment.id == assignment_id,
            IncidentAssignment.incident_id == incident_id,
        )
        .execution_options(populate_existing=True)
    )
    if assignment is None:
        return None
    if assignment.unassigned_at is not None:
        raise AssignmentReleasedError("Diese Zuweisung wurde bereits freigegeben.")

    update_data = update.model_dump(exclude_unset=True)

    if "is_leader" in update_data:
        # Only a person can lead an incident. The unique index is on
        # `incident_id` alone, so a vehicle or a pallet of Ölbindemittel marked
        # is_leader occupies the incident's one leader slot — and the automatic
        # resolver, which only ever looks at personnel rows, can neither see it
        # nor clear it. The incident is then stuck with a truck as its
        # Einsatzleiter and no way back through the UI.
        if assignment.resource_type != "personnel":
            raise ValueError("Nur Personal kann als Einsatzleiter markiert werden")

        if update_data["is_leader"]:
            # A hand-picked leader pins the choice: automatic re-selection stops
            # for this incident until someone explicitly hands it back.
            incident.leader_manual = True
            # The most deliberate choose-site there is, so it stamps the
            # leader of record directly — `sync_auto_leader` does not run on
            # this branch (it would immediately undo the pin).
            incident.leader_personnel_id = assignment.resource_id
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
        else:
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

    await db.flush()
    await db.refresh(assignment)
    return schemas.AssignmentResponse.model_validate(assignment)


async def unassign_resource(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    current_user: User,
    request: Request | None,
    *,
    incident_id: uuid.UUID,
    stamp_leader_of_record: bool = True,
) -> IncidentAssignment | None:
    """
    Release a resource from the incident ``incident_id``; returns the released row.

    Sets ``unassigned_at`` and clears the Einsatzleiter flag. ``None`` when no
    assignment ``assignment_id`` belongs to ``incident_id`` – a stale or mismatched
    id must not release a row on another incident (audit 2026-10, F03); the route
    turns that into its 404. Releasing an already released row of the right
    incident is a no-op: its original release time and audit record survive a retry.

    Locks the incident first, then writes the assignment – the order in
    ``crud/locking.py``, the same one completion takes.

    Flushes only — the CALLER owns the commit. This runs inside larger
    operations (incident completion auto-release); a commit here would let a
    crash mid-completion leave status=complete with crew still assigned and
    no StatusTransition/audit row (audit H3).

    ``stamp_leader_of_record=False`` is for the bulk release only — see
    ``auto_release_incident_resources``. A single release IS a leader change
    (the EL drives off, the next person takes over) and must move the record.
    """
    await db.execute(select(Incident.id).where(Incident.id == incident_id).with_for_update())
    assignment = await db.scalar(
        select(IncidentAssignment)
        .where(
            IncidentAssignment.id == assignment_id,
            IncidentAssignment.incident_id == incident_id,
        )
        .execution_options(populate_existing=True)
    )

    if assignment is None or assignment.unassigned_at is not None:
        return assignment

    # Mark unassigned. The Einsatzleiter flag goes with it: the index only
    # counts active rows, so a released row keeping `is_leader` is legal — but
    # `/participants` ORs the flag across a resource's rows, and completion
    # releases the crew ONE AT A TIME, each release promoting the next person.
    # Left alone, an incident finishes with every single person on it flagged as
    # having led it, which is exactly the record "Bisher im Einsatz" is there to
    # get right.
    assignment.unassigned_at = datetime.now(UTC)
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
        await sync_auto_leader(db, assignment.incident_id, stamp_leader_of_record=stamp_leader_of_record)

    return assignment


class MaterialCollectRefusedError(Exception):
    """«Abgeholt» or its undo cannot run on this row now; ``str()`` is the German reason (409)."""


async def _lock_material_assignment(
    db: AsyncSession, incident_id: uuid.UUID, assignment_id: uuid.UUID
) -> tuple[Incident, IncidentAssignment, Material | None] | None:
    """The material assignment ``assignment_id`` of ``incident_id`` with its incident and its
    (locked) material, locked in the order of ``crud/locking.py``: the incident (with its
    Auftrag), then the material row. None when the row is no material assignment of that
    incident. The material is None when its row is gone (purged)."""
    incident = await lock_incident_with_group(db, incident_id)
    if incident is None:
        return None
    assignment = await db.scalar(
        select(IncidentAssignment)
        .where(IncidentAssignment.id == assignment_id, IncidentAssignment.incident_id == incident_id)
        .execution_options(populate_existing=True)
    )
    if assignment is None or assignment.resource_type != "material":
        return None
    material = await lock_resource(db, "material", assignment.resource_id)
    return incident, assignment, material


async def _still_left_on_site(
    db: AsyncSession, incident: Incident, assignment: IncidentAssignment, material: Material | None
) -> bool:
    """The Restliste's test for this one open row (``crud/feld/material.event_restliste``):
    the card is on the board, the unit exists and is no consumable, and the FILED rapport
    still marks this assignment «vor Ort verblieben» – read fresh, so an amendment the crew
    filed after the operator opened the confirm counts."""
    if incident.deleted_at is not None or material is None or material.consumable:
        return False
    report = await db.scalar(
        select(SchadenplatzReport)
        .where(SchadenplatzReport.incident_id == incident.id)
        .execution_options(populate_existing=True)
    )
    return assignment.id in left_on_site_assignment_ids(report)


async def collect_material(
    db: AsyncSession,
    *,
    incident_id: uuid.UUID,
    assignment_id: uuid.UUID,
    current_user: User,
    request: Request | None,
) -> datetime | None:
    """«Abgeholt – freigeben» from the «Gerät vor Ort» roll-up (owner pick 6A, 24.11.2026).

    Releases exactly this material assignment and records the collection as a field fact
    (audit ``material_collected`` → journal and Chronik: «Abgeholt: Tauchpumpe»). Returns
    the release time – the undo's token: ``undo_collect_material`` only reverses the release
    that carries it. None when the row is no material assignment of the incident (404).
    Refused (409) when it is already released – somebody else took it back first, and a
    second «abgeholt» line would lie – or when the Restliste no longer lists it (the crew
    amended the rapport, so the unit is not «vor Ort» any more). Flushes only; the request
    commits.
    """
    locked = await _lock_material_assignment(db, incident_id, assignment_id)
    if locked is None:
        return None
    incident, assignment, material = locked
    if assignment.unassigned_at is not None:
        raise MaterialCollectRefusedError("Dieses Material ist schon freigegeben.")
    if not await _still_left_on_site(db, incident, assignment, material):
        raise MaterialCollectRefusedError("Laut Rapport ist dieses Material nicht mehr vor Ort.")
    await unassign_resource(db, assignment_id, current_user, request, incident_id=incident_id)
    released_at = assignment.unassigned_at
    if released_at is None:  # unassign_resource stamps it; this is for the type checker
        raise MaterialCollectRefusedError("Dieses Material ist schon freigegeben.")
    await log_action(
        db=db,
        action_type="material_collected",
        resource_type="incident",
        resource_id=incident_id,
        user=current_user,
        changes={
            "assignment_id": str(assignment_id),
            "material_name": material.name if material else None,
            "source": "kp",
        },
        request=request,
    )
    await db.flush()
    return released_at


async def undo_collect_material(
    db: AsyncSession,
    *,
    incident_id: uuid.UUID,
    assignment_id: uuid.UUID,
    released_at: datetime,
    current_user: User,
    request: Request | None,
) -> IncidentAssignment | None:
    """The undo of ``collect_material``: re-opens the SAME row (``unassigned_at`` back to NULL).

    The same row, not a new assignment: the Schadenplatz-Rapport names this assignment as
    left on site, and the Restliste finds the unit only through it. Like the completion undo
    (``restore_released_assignments``) it is an internal re-opener, so it skips
    ``ensure_assignable`` (the Einsatz is usually closed). Under the material's row lock,
    which every assignment and lifecycle writer takes, it refuses (409):

    * unless the row's current release IS the collection – ``released_at`` is the time
      ``collect_material`` returned. A regular release, a row already re-opened, or a later
      release of the same row after an undo do not match;
    * when the unit is archived or gone;
    * when the unit has since gone onto another Einsatz or an Auftrag.

    Records ``material_collected_cleared``. Flushes only.
    """
    locked = await _lock_material_assignment(db, incident_id, assignment_id)
    if locked is None:
        return None
    _, assignment, material = locked
    if assignment.unassigned_at is None or assignment.unassigned_at != released_at:
        raise MaterialCollectRefusedError("Diese Freigabe war kein «Abgeholt» – nichts zurückzunehmen.")
    if material is None or material.archived_at is not None:
        raise MaterialCollectRefusedError("Das Material ist archiviert oder gelöscht.")
    on_incident = await db.scalar(
        select(IncidentAssignment.id).where(
            IncidentAssignment.resource_type == "material",
            IncidentAssignment.resource_id == material.id,
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    if on_incident is not None:
        raise MaterialCollectRefusedError("Das Material ist inzwischen einem anderen Einsatz zugewiesen.")
    on_auftrag = await db.scalar(
        select(IncidentGroupAssignment.id).where(
            IncidentGroupAssignment.resource_type == "material",
            IncidentGroupAssignment.resource_id == material.id,
            IncidentGroupAssignment.unassigned_at.is_(None),
        )
    )
    if on_auftrag is not None:
        raise MaterialCollectRefusedError("Das Material ist inzwischen einem Auftrag zugewiesen.")
    assignment.unassigned_at = None
    await log_action(
        db=db,
        action_type="material_collected_cleared",
        resource_type="incident",
        resource_id=incident_id,
        user=current_user,
        changes={
            "assignment_id": str(assignment_id),
            "material_name": material.name,
            "source": "kp",
        },
        request=request,
    )
    await db.flush()
    return assignment


# `update_resource_status(db, resource_type, resource_id, new_status)` used to sit
# here and wrote `Vehicle.status` / `Material.status` straight. It is gone rather
# than fixed. Nothing in `app/` ever called it — assignment is tracked in this
# table, which is what the two "we no longer update resource base status" notes
# above mean — and a single setter across all three resource kinds cannot be
# right any more: `status` on a vehicle or a material is now only a legacy mirror
# of `out_of_service_since` (see `crud/materials.apply_out_of_service`), so this
# was a second, unaudited door onto readiness that left the timestamp stale. A
# caller that means readiness wants `apply_out_of_service`; one that means
# deployment wants `assign_resource` / `unassign_resource`.


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


async def auto_release_incident_resources(
    db: AsyncSession,
    incident_id: uuid.UUID,
    current_user: User,
    request: Request | None,
    exclude_materials: bool = True,
) -> list[dict[str, Any]]:
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

    Returns the rows it closed, in the shape ``StatusTransition.released_assignments_json``
    stores — the completing caller stamps them on the transition so that reopening
    the incident can undo exactly this release and nothing else.

    Freezes the Einsatzleiter of record FIRST, then releases with the stamp
    switched off. Both halves matter:

    * The crew leaves one row at a time and every release promotes whoever is
      still there, so a stamping cascade would walk the record through the whole
      crew and leave it on whoever happened to go last. That is the same bug the
      comment in ``unassign_resource`` describes, one level up.
    * Nothing else can answer the question afterwards: the flag is gone from
      every row by the time this returns.

    The guard lives here rather than at the call sites so a future bulk-release
    caller cannot forget it — this function *is* "the crew is done here", and a
    bulk release is never a leader decision.
    """
    incident = (await db.execute(select(Incident).where(Incident.id == incident_id))).scalar_one_or_none()
    if incident is not None:
        active_leader_id = await db.scalar(
            select(IncidentAssignment.resource_id).where(
                IncidentAssignment.incident_id == incident_id,
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.unassigned_at.is_(None),
                IncidentAssignment.is_leader.is_(True),
            )
        )
        # Only ever overwritten by a real answer: an incident finishing with
        # nobody flagged keeps whatever the last genuine choice was.
        if active_leader_id is not None:
            incident.leader_personnel_id = active_leader_id
            await db.flush()

    assignments = await get_incident_assignments(db, incident_id)

    released: list[dict[str, Any]] = []
    for assignment in assignments:
        # Skip materials if exclude_materials is True
        if exclude_materials and assignment.resource_type == "material":
            continue

        # Read the flag BEFORE the release clears it — restoring a crew without
        # its Einsatzleiter puts the card back minus the one thing the operator
        # is most likely to look for.
        was_leader = assignment.is_leader
        if await unassign_resource(
            db, assignment.id, current_user, request, incident_id=incident_id, stamp_leader_of_record=False
        ):
            released.append({"kind": "incident", "id": str(assignment.id), "was_leader": was_leader})

    return released


async def restore_released_assignments(
    db: AsyncSession,
    entries: list[Any] | None,
    current_user: User | None,
    request: Request | None,
) -> int:
    """Undo the release a completion performed — the other half of the record above.

    Re-opens the listed rows (``unassigned_at`` back to NULL) and gives the
    Einsatzleiter flag back to whoever carried it. Flushes only; the caller owns
    the commit, so the reopen and the restore land in one transaction and a crash
    between them is impossible.

    A row is skipped when the resource has since been assigned somewhere else.
    An undo seconds after the completion finds nothing reassigned and restores
    everything; a reopen an hour later must not silently put a person back on two
    incidents at once behind the operator's back. The skip is deliberate and
    quiet — the board shows what came back, and what did not is visibly on the
    other incident.

    Only ``kind == "incident"`` entries are this module's business; the Auftrag's
    shared rows live in another table and are restored by the group twin.

    Returns the number of rows restored.
    """
    wanted = parse_released_entries(entries, "incident")
    if not wanted:
        return 0

    result = await db.execute(select(IncidentAssignment).where(IncidentAssignment.id.in_(wanted)))
    rows = list(result.scalars().all())

    restored = 0
    touched_incident_ids: set[uuid.UUID] = set()
    for assignment in rows:
        if assignment.unassigned_at is None:
            continue  # already active — nothing to undo
        conflict = await db.scalar(
            select(IncidentAssignment.id).where(
                IncidentAssignment.resource_type == assignment.resource_type,
                IncidentAssignment.resource_id == assignment.resource_id,
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        if conflict is not None:
            continue
        assignment.unassigned_at = None
        assignment.is_leader = False  # claimed below, once the incident is known to be free
        restored += 1
        touched_incident_ids.add(assignment.incident_id)
        await log_action(
            db=db,
            action_type="assign",
            resource_type=f"{assignment.resource_type}_assignment",
            resource_id=assignment.id,
            user=current_user,
            changes={"reason": "completion_undone"},
            request=request,
        )

    if not restored:
        return 0
    await db.flush()

    # Give the pin back — but never to a second holder. Somebody may have been
    # assigned and promoted while the incident sat in Abgeschlossen; the partial
    # unique index would reject the row and, worse, an operator's deliberate pick
    # must not lose to an undo.
    for incident_id in touched_incident_ids:
        existing_leader = await db.scalar(
            select(IncidentAssignment.id).where(
                IncidentAssignment.incident_id == incident_id,
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.unassigned_at.is_(None),
                IncidentAssignment.is_leader.is_(True),
            )
        )
        if existing_leader is not None:
            continue
        former_leader = next(
            (
                assignment
                for assignment in rows
                if assignment.incident_id == incident_id
                and assignment.unassigned_at is None
                and assignment.resource_type == "personnel"
                and wanted.get(assignment.id)
            ),
            None,
        )
        if former_leader is not None:
            former_leader.is_leader = True
        else:
            # The EL is on another incident now — derive one from who did come
            # back rather than showing a crew with nobody in charge. Stamping is
            # off: the completion already froze the leader of record, and this is
            # not a fresh human decision.
            await sync_auto_leader(db, incident_id, stamp_leader_of_record=False)

    await db.flush()
    return restored


def parse_released_entries(entries: list[Any] | None, kind: str) -> dict[uuid.UUID, bool]:
    """``released_assignments_json`` → ``{assignment_id: was_leader}`` for one kind.

    Tolerant by design: the column is JSONB written by an older release of this
    code as much as by this one, and a row it cannot parse must be skipped rather
    than turn a reopen into a 500.
    """
    parsed: dict[uuid.UUID, bool] = {}
    for entry in entries or []:
        if not isinstance(entry, dict) or entry.get("kind") != kind:
            continue
        try:
            parsed[uuid.UUID(str(entry.get("id")))] = bool(entry.get("was_leader"))
        except (TypeError, ValueError):
            continue
    return parsed


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


class TransferChangedError(ValueError):
    """An undo named assignments that are no longer all active on the incident."""


class TransferRefusedError(ValueError):
    """«Übertragen» cannot start from this Einsatz or onto this target (→ 409). ``str()`` is German."""


# Lead's call on review B (24.11.2026): a closed Einsatz is no transfer source. Its material
# left on site would move, and «Rückgängig» could not put it back onto the closed Einsatz.
CLOSED_SOURCE_REFUSED = "Der Einsatz ist abgeschlossen – seine Ressourcen werden nicht übertragen."


async def transfer_assignments(
    db: AsyncSession,
    source_incident_id: uuid.UUID,
    target_incident_id: uuid.UUID,
    current_user: User,
    request: Request,
    only_assignment_ids: list[uuid.UUID] | None = None,
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

    The rows are NEW assignments on the target, so ``ensure_assignable`` applies to
    each resource (a closed or archived target, a vehicle now «nicht einsatzbereit»)
    and refuses the whole transfer. A closed source is refused too (``CLOSED_SOURCE_REFUSED``).
    Lock order (``crud/locking.py``): both Einsätze
    with their Aufträge, then all resource rows (``lock_resources``).

    ``only_assignment_ids`` is the undo of a transfer: exactly those rows move, and only
    if every one of them is still active on the source – an undo is a new write that must
    still be valid now, so a crew somebody has since released or re-sorted stays put.

    Raises:
        ValueError: If source has no assignments or if conflicts exist
        TransferChangedError: (a ``ValueError``) the undo's rows are no longer all there
        TransferRefusedError: (a ``ValueError``) the source is closed
        ResourceNotAssignableError: (a ``ValueError``) the policy refused a resource
    """
    locked = await lock_incidents_with_groups(db, [source_incident_id, target_incident_id])
    source_incident = locked.get(source_incident_id)
    if source_incident is None:
        raise ValueError("Quell-Einsatz nicht gefunden")
    if source_incident.status == "complete":
        raise TransferRefusedError(CLOSED_SOURCE_REFUSED)

    target_incident = locked.get(target_incident_id)
    if target_incident is None or target_incident.deleted_at is not None or target_incident.merged_into_id is not None:
        raise ValueError("Ziel-Einsatz nicht gefunden")

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

    if only_assignment_ids is not None:
        wanted = set(only_assignment_ids)
        source_assignments = [a for a in source_assignments if a.id in wanted]
        if len(source_assignments) != len(wanted):
            raise TransferChangedError("Nicht mehr rückgängig machbar – die Zuweisungen wurden inzwischen geändert.")

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

    target_event = await db.get(Event, target_incident.event_id)
    if target_event is None:
        raise ValueError("Ziel-Einsatz nicht gefunden")
    resources = await lock_resources(db, [(a.resource_type, a.resource_id) for a in source_assignments])
    # A row pointing at a deleted resource is absent here and moves as it is.
    for resource in resources.values():
        try:
            ensure_assignable(resource, event=target_event, incident=target_incident)
        except ResourceNotAssignableError as refused:
            raise ResourceNotAssignableError(f"Übertragen nicht möglich – {refused}") from refused

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
        assignment.unassigned_at = datetime.now(UTC)
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

    await db.flush()

    return {
        "transferred_count": len(new_assignment_ids),
        "assignment_ids": new_assignment_ids,
    }


def leader_rank(person: Personnel) -> int:
    """Lower is more senior. Unknown roles sort last but still ahead of nothing.

    An explicit non-zero ``Personnel.role_sort_order`` wins. It is 0 for everyone on most
    stations (set by the importer or in Einstellungen), so the Grad's tier
    (``services.ranks``) stands in: without it the "highest ranking person" rule silently
    decays into "whoever was assigned first", which looks like a bug the first time an
    Offizier joins a crew and stays unmarked.
    """
    if person.role_sort_order:
        return person.role_sort_order
    return rank_tier(person.role) or 99


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


async def sync_auto_leader(
    db: AsyncSession,
    incident_id: uuid.UUID,
    *,
    stamp_leader_of_record: bool = True,
) -> None:
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

    Every pick here is a genuine one — somebody joined, somebody left, a pin was
    handed back — so it also stamps ``Incident.leader_personnel_id``, the leader
    of record that outlives the assignment rows. Stamping is the DEFAULT on
    purpose: a call site added later gets the right behaviour without knowing
    this exists, and the one exception (the completion cascade, which walks the
    whole crew and would end on whoever left last) opts out explicitly in
    ``auto_release_incident_resources``. Do not invert this.

    A pick with no candidates never clears the record: an incident whose crew
    has all gone home still had a leader.

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
        if stamp_leader_of_record:
            incident.leader_personnel_id = winner.resource_id

    await db.flush()
