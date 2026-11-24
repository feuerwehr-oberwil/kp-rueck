"""Assigning a Reko to a Schadenplatz — the BOARD's operation.

Called `reko_dashboard` until plan 26 removed the login-less page of that name.
Nothing in here ever belonged to that page: every caller is editor-authed, and
the page only ever *read*. The Reko trupp files from `/feld` like everybody
else now, so what is left is the KP's side of it — who is available, who has it,
and handing it over.
"""

import math
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EventSpecialFunction, Incident, IncidentAssignment, Personnel, RekoReport, User
from .assignments import unassign_resource
from .locking import lock_resource
from .manual_order import OrderChangedError, plan_manual_order


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """Straight-line distance in metres between two WGS84 points."""
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(2 * r * math.asin(math.sqrt(a)))


async def get_reko_personnel_for_event(
    db: AsyncSession,
    event_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """
    Get all personnel with Reko function assigned for an event.

    Returns list of personnel with their current assignment status.

    Args:
        db: Database session
        event_id: Event UUID

    Returns:
        List of personnel dictionaries with assignment info
    """
    # Get all personnel who have 'reko' function for this event
    reko_functions = await db.execute(
        select(EventSpecialFunction).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    reko_assignments = list(reko_functions.scalars().all())

    if not reko_assignments:
        return []

    personnel_ids = [ra.personnel_id for ra in reko_assignments]

    # Get personnel details
    personnel_result = await db.execute(select(Personnel).where(Personnel.id.in_(personnel_ids)))
    personnel_map = {p.id: p for p in personnel_result.scalars().all()}

    # Get active incident assignments for these personnel in this event
    # First, get all incidents for this event (with location, so callers can
    # show where a person's open work is and compute proximity)
    incidents_result = await db.execute(
        select(
            Incident.id,
            Incident.title,
            Incident.location_address,
            Incident.location_lat,
            Incident.location_lng,
        ).where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    incident_info = {
        row.id: {
            "incident_id": row.id,
            "incident_title": row.title,
            "location_address": row.location_address,
            "location_lat": float(row.location_lat) if row.location_lat is not None else None,
            "location_lng": float(row.location_lng) if row.location_lng is not None else None,
        }
        for row in incidents_result.all()
    }
    incident_ids = list(incident_info)

    # Count EVERY incident a reko person was ever assigned to — not just the
    # currently-active ones. Submitting a reko form unassigns the person
    # (sets unassigned_at), so an active-only count would hide the incidents
    # they already handled and understate how busy they were. We therefore look
    # at all assignment rows (active + historical) and dedupe per (person,
    # incident), then split into:
    #   - done:  the incident has a completed (non-draft) reko report
    #   - open:  the person is still actively assigned and no reko is done yet
    #   - total: distinct incidents ever assigned (the "how busy" number)
    assigned_incidents: dict[uuid.UUID, set[uuid.UUID]] = {}
    active_incidents: dict[uuid.UUID, set[uuid.UUID]] = {}
    last_assigned_incident: dict[uuid.UUID, tuple[datetime, uuid.UUID]] = {}
    completed_incident_ids: set[uuid.UUID] = set()
    if incident_ids:
        assignments_result = await db.execute(
            select(
                IncidentAssignment.resource_id,
                IncidentAssignment.incident_id,
                IncidentAssignment.unassigned_at,
                IncidentAssignment.assigned_at,
            ).where(
                IncidentAssignment.incident_id.in_(incident_ids),
                IncidentAssignment.resource_type == "personnel",
                IncidentAssignment.resource_id.in_(personnel_ids),
            )
        )
        all_assignments = assignments_result.all()

        # Incidents that already have a completed (non-draft) reko report.
        completed_result = await db.execute(
            select(RekoReport.incident_id)
            .where(
                RekoReport.incident_id.in_(incident_ids),
                RekoReport.is_draft == False,  # noqa: E712 - SQLAlchemy needs == not 'is'
            )
            .distinct()
        )
        completed_incident_ids = {row[0] for row in completed_result.all()}

        for resource_id, incident_id, unassigned_at, assigned_at in all_assignments:
            assigned_incidents.setdefault(resource_id, set()).add(incident_id)
            if unassigned_at is None:
                active_incidents.setdefault(resource_id, set()).add(incident_id)
            previous = last_assigned_incident.get(resource_id)
            if previous is None or assigned_at > previous[0]:
                last_assigned_incident[resource_id] = (assigned_at, incident_id)

    # Build response
    result = []
    for p_id in personnel_ids:
        personnel = personnel_map.get(p_id)
        if personnel:
            ever_assigned = assigned_incidents.get(personnel.id, set())
            done_ids = {i for i in ever_assigned if i in completed_incident_ids}
            open_ids = {i for i in active_incidents.get(personnel.id, set()) if i not in completed_incident_ids}
            last = last_assigned_incident.get(personnel.id)
            result.append(
                {
                    "personnel_id": personnel.id,
                    "name": personnel.name,
                    "role": personnel.role,
                    "assignment_count": len(ever_assigned),
                    "open_count": len(open_ids),
                    "done_count": len(done_ids),
                    "open_assignments": sorted(
                        (incident_info[i] for i in open_ids),
                        key=lambda info: info["incident_title"],
                    ),
                    "last_assignment": incident_info[last[1]] if last else None,
                }
            )

    # Sort by open work first (least loaded first), then by name
    result.sort(key=lambda x: (x["open_count"], x["name"]))

    return result


async def get_reko_assignments_for_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """
    Get all incident assignments for a Reko personnel, including previously submitted.

    Returns list of incidents the personnel is assigned to (active) or has
    submitted a reko report for (historical), along with Reko report status.

    Args:
        db: Database session
        event_id: Event UUID
        personnel_id: Personnel UUID

    Returns:
        List of incident dictionaries with Reko status and active flag
    """
    # Verify personnel has reko function for this event – an existence check: an old
    # Ereignis can hold the same Reko role twice, and the handover must still work.
    holds_reko = select(EventSpecialFunction.id).where(
        EventSpecialFunction.event_id == event_id,
        EventSpecialFunction.personnel_id == personnel_id,
        EventSpecialFunction.function_type == "reko",
    )
    if not await db.scalar(select(holds_reko.exists())):
        return []

    # Get all incident IDs for this event
    incidents_result = await db.execute(
        select(Incident.id).where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
        )
    )
    incident_ids = [row[0] for row in incidents_result.all()]

    if not incident_ids:
        return []

    # Get active assignments for this personnel in these incidents
    assignments_result = await db.execute(
        select(IncidentAssignment).where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    assignments = list(assignments_result.scalars().all())
    active_incident_ids = {a.incident_id for a in assignments}
    assignment_map = {a.incident_id: a for a in assignments}

    # Get incidents where this personnel has submitted a reko report (including unassigned)
    submitted_reko_result = await db.execute(
        select(RekoReport.incident_id)
        .where(
            RekoReport.incident_id.in_(incident_ids),
            RekoReport.submitted_by_personnel_id == personnel_id,
            RekoReport.is_draft == False,  # noqa: E712 - SQLAlchemy needs == not 'is'
        )
        .distinct()
    )
    submitted_reko_incident_ids = {row[0] for row in submitted_reko_result.all()}

    # Combine: active assignments + previously submitted rekos
    all_relevant_incident_ids = active_incident_ids | submitted_reko_incident_ids

    if not all_relevant_incident_ids:
        return []

    # Get incident details
    incidents_detail_result = await db.execute(select(Incident).where(Incident.id.in_(all_relevant_incident_ids)))
    incidents = {i.id: i for i in incidents_detail_result.scalars().all()}

    # Get reko report status for each incident (check if non-draft report exists)
    reko_reports_result = await db.execute(
        select(RekoReport.incident_id)
        .where(
            RekoReport.incident_id.in_(all_relevant_incident_ids),
            RekoReport.is_draft == False,  # noqa: E712 - SQLAlchemy needs == not 'is'
        )
        .distinct()
    )
    completed_reko_incidents = {row[0] for row in reko_reports_result.all()}

    # Build response
    result = []
    for incident_id in all_relevant_incident_ids:
        incident = incidents.get(incident_id)
        if incident:
            assignment = assignment_map.get(incident_id)
            is_active = incident_id in active_incident_ids
            result.append(
                {
                    "incident_id": incident.id,
                    "incident_title": incident.title or incident.location_address or "Unbekannt",
                    "incident_type": incident.type,
                    "incident_status": incident.status,
                    "location_address": incident.location_address,
                    "location_lat": str(incident.location_lat) if incident.location_lat else None,
                    "location_lng": str(incident.location_lng) if incident.location_lng else None,
                    "assignment_id": assignment.id if assignment else None,
                    "assigned_at": assignment.assigned_at if assignment else None,
                    "has_completed_reko": incident_id in completed_reko_incidents,
                    "is_active_assignment": is_active,
                    # The order the operator gave this person's Rekos (Reko-Modus), then
                    # the kanban order (Incident.position). Kept off the response schema,
                    # used only for sorting below.
                    "_reko_position": assignment.reko_position if assignment else None,
                    "_position": incident.position,
                    "_created_at": incident.created_at,
                }
            )

    # Sort so the reko person sees the SAME priority order the operator arranged:
    # active first, incomplete-reko first, then this person's Reko order, then the
    # kanban order (Incident.position), then created_at as a stable tiebreaker.
    result.sort(
        key=lambda x: (
            not x["is_active_assignment"],  # Active first
            x["has_completed_reko"],  # Incomplete first within each group
            x["_reko_position"] is None,  # Ordered Rekos before unordered rows
            x["_reko_position"] or 0,  # The Reko-Modus order
            x["_position"],  # Operator's kanban priority order
            x["_created_at"],  # Stable tiebreaker
        )
    )

    # Strip the internal sort-only keys so they don't leak into the API response.
    for row in result:
        row.pop("_reko_position", None)
        row.pop("_position", None)
        row.pop("_created_at", None)

    return result


async def unassign_reko_personnel_from_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
    personnel_id: uuid.UUID,
    assignment_id: uuid.UUID | None = None,
    current_user: User | None = None,
    request: Request | None = None,
) -> bool:
    """
    Unassign a Reko personnel from an incident.

    Called by the board (chip ✕, person popover), by a Reko replacement and by the handover.

    Args:
        db: Database session
        incident_id: Incident UUID
        personnel_id: Personnel UUID
        assignment_id: The row the board showed (its chip ✕, the person popover's tick).
            Only that row goes, still active – without it, any active row of the person on
            the incident, whatever its purpose: a crew row the board drew as Reko included.
        current_user, request: for the audit entry of a crew row's release.

    Returns:
        True if unassignment was successful, False otherwise
    """
    # The incident first, like every release (crud/locking.py step 2), so the row read
    # below stays what it is until this transaction ends.
    await db.execute(select(Incident.id).where(Incident.id == incident_id).with_for_update())
    query = select(IncidentAssignment).where(
        IncidentAssignment.incident_id == incident_id,
        IncidentAssignment.resource_type == "personnel",
        IncidentAssignment.resource_id == personnel_id,
        IncidentAssignment.unassigned_at.is_(None),
    )
    if assignment_id is not None:
        query = query.where(IncidentAssignment.id == assignment_id)
    result = await db.execute(query.execution_options(populate_existing=True))
    assignment = result.scalar_one_or_none()

    if not assignment:
        return False

    if assignment.purpose == "crew":
        # A crew row the board drew as Reko: the crew release, which hands the
        # Einsatzleiter role on and writes the audit entry.
        await unassign_resource(db, assignment.id, current_user, request, incident_id=incident_id)
        return True

    assignment.unassigned_at = datetime.now(UTC)
    await db.flush()

    return True


async def get_available_reko_personnel_for_incident(
    db: AsyncSession,
    incident_id: uuid.UUID,
) -> tuple[list[dict[str, Any]], uuid.UUID | None]:
    """
    Get available Reko personnel for assignment to an incident.

    Returns all Reko personnel with their assignment counts, plus
    the ID of any currently assigned Reko person (for replacement).

    Constraints:
    - Each incident can only have ONE Reko person assigned
    - A Reko person CAN be assigned to multiple incidents

    Args:
        db: Database session
        incident_id: Incident UUID

    Returns:
        Tuple of (list of personnel with assignment counts, currently_assigned_id or None)
    """
    # Get the incident's event_id
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = incident_result.scalar_one_or_none()

    if not incident:
        return [], None

    event_id = incident.event_id

    # Get all Reko personnel IDs for this event
    reko_functions = await db.execute(
        select(EventSpecialFunction.personnel_id).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    reko_personnel_ids = {row[0] for row in reko_functions.all()}

    if not reko_personnel_ids:
        return [], None

    # Check if this incident already has a Reko person assigned
    existing_reko_assignment = await db.execute(
        select(IncidentAssignment).where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id.in_(reko_personnel_ids),
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    existing = existing_reko_assignment.scalar_one_or_none()
    currently_assigned_id = existing.resource_id if existing else None

    # Get all Reko personnel for this event (with assignment counts)
    all_reko = await get_reko_personnel_for_event(db, event_id)

    # Proximity: distance from the target incident to each person's nearest
    # open assignment (their assigned incidents are the best proxy we have for
    # where they currently are). Falls back to the most recent assignment when
    # nothing is open. Straight-line distance is good enough at Gemeinde scale.
    target_lat = float(incident.location_lat) if incident.location_lat is not None else None
    target_lng = float(incident.location_lng) if incident.location_lng is not None else None
    for person in all_reko:
        person["distance_m"] = None
        person["distance_source"] = None
        if target_lat is None or target_lng is None:
            continue
        open_distances = [
            _haversine_m(target_lat, target_lng, a["location_lat"], a["location_lng"])
            for a in person["open_assignments"]
            if a["location_lat"] is not None and a["location_lng"] is not None and a["incident_id"] != incident_id
        ]
        if open_distances:
            person["distance_m"] = min(open_distances)
            person["distance_source"] = "open"
            continue
        last = person["last_assignment"]
        if (
            last
            and last["location_lat"] is not None
            and last["location_lng"] is not None
            and last["incident_id"] != incident_id
        ):
            person["distance_m"] = _haversine_m(target_lat, target_lng, last["location_lat"], last["location_lng"])
            person["distance_source"] = "last"

    # Least open work first, then closest, then name — the operator sees the
    # least-loaded nearby person on top.
    all_reko.sort(
        key=lambda p: (
            p["open_count"],
            p["distance_m"] if p["distance_m"] is not None else float("inf"),
            p["name"],
        )
    )

    return all_reko, currently_assigned_id


# ============================================
# A Reko person's order
# ============================================
#
# Their open Rekos are driven in an order the KP sets in the Reko-Modus, exactly like the
# stops of an Auftrag (`groups.reorder_group_stops`, same `plan_manual_order`) – shown as
# numbered pins on the map and as the order of their /feld list. The order lives on the
# assignment rows (`IncidentAssignment.reko_position`), not on an Auftrag: a Reko person is
# a person, not a route.
#
# Lock: the person's row (step 3 of `crud/locking.py`). Every writer of a Reko row for a
# person – assign-reko, the handover, this reorder – holds it while it reads and writes
# their positions, so a new Reko always takes the next free number and a reorder never
# races one. The rows themselves are leaves under that lock.


async def person_reko_rows(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[IncidentAssignment]:
    """The person's active personnel rows in this Ereignis, in their Reko order, one per Einsatz.

    The same set the board reads as «this person's Rekos» (an active row of a Reko person on
    a live Einsatz, done or not) – the reorder's ``expected_ids`` is compared against it.
    """
    result = await db.execute(
        select(IncidentAssignment)
        .join(Incident, Incident.id == IncidentAssignment.incident_id)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
            IncidentAssignment.resource_type == "personnel",
            IncidentAssignment.resource_id == personnel_id,
            IncidentAssignment.unassigned_at.is_(None),
        )
        .order_by(
            IncidentAssignment.reko_position.asc().nulls_last(),
            IncidentAssignment.assigned_at.asc(),
            IncidentAssignment.id.asc(),
        )
    )
    rows: list[IncidentAssignment] = []
    seen: set[uuid.UUID] = set()
    for row in result.scalars():
        if row.incident_id not in seen:
            seen.add(row.incident_id)
            rows.append(row)
    return rows


async def next_reko_position(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID) -> int:
    """The number a NEW Reko of this person takes: after all of theirs. Call under their row lock.

    Numbers the person's current rows 0..n-1 on the way (``person_reko_rows`` order), so a row
    that never had a number – written before the order existed, or as a crew row of somebody
    who became a Reko later – keeps its place before the new one instead of sorting after it.
    """
    rows = await person_reko_rows(db, event_id, personnel_id)
    for index, row in enumerate(rows):
        if row.reko_position != index:
            row.reko_position = index
    return len(rows)


async def reorder_reko_assignments(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    ordered_ids: list[uuid.UUID],
    expected_ids: list[uuid.UUID] | None = None,
) -> int:
    """Put a Reko person's Rekos (Einsatz ids) in ``ordered_ids`` order. Flushes only.

    ``expected_ids`` = the Rekos the client last saw (``person_reko_rows``); when that SET has
    changed since – a Reko added, taken over or released elsewhere – ``OrderChangedError`` and
    nothing is written. A set, not the order: rows that never had a position (a Reko person's
    crew rows) tie on the server by ``assigned_at``, which the board does not hold, and two
    drags of the same list are both the operator's fresh decision (as for a manual stop drag).
    Returns how many of ``ordered_ids`` were this person's Rekos.

    Raises:
        LookupError: the person does not exist or holds no Reko function in this Ereignis.
        OrderChangedError: the list is not ``expected_ids`` any more.
    """
    if await lock_resource(db, "personnel", personnel_id) is None:
        raise LookupError(f"personnel {personnel_id} does not exist")
    is_reko = await db.scalar(
        select(EventSpecialFunction.id).where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.personnel_id == personnel_id,
            EventSpecialFunction.function_type == "reko",
        )
    )
    if is_reko is None:
        raise LookupError(f"personnel {personnel_id} is no Reko in event {event_id}")

    rows = await person_reko_rows(db, event_id, personnel_id)
    by_incident = {row.incident_id: row for row in rows}
    if expected_ids is not None and (len(expected_ids) != len(by_incident) or set(expected_ids) != set(by_incident)):
        raise OrderChangedError("the person's Rekos changed since the order was read")
    order = plan_manual_order(list(by_incident), ordered_ids)
    for index, incident_id in enumerate(order):
        by_incident[incident_id].reko_position = index
    await db.flush()
    return len(set(ordered_ids) & set(by_incident))
