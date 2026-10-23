"""What a person's `/feld` briefing shows them – the half of `/feld` that never decides access.

`get_feld_assignments_for_personnel` builds the list a crew sees for the Schadenplätze that
`visibility.py` already said are theirs: the briefing (crew, vehicles, material, the Reko
dangers, KP messages, pickup acknowledgements). Who may see which Schadenplatz is
`visibility.py`'s question, and stays there.
"""

import uuid
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy import func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import (
    AuditLog,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    Notification,
    Personnel,
    RekoReport,
    Vehicle,
)
from ...services.incident_dispatch import dispatched_incident_ids, rapport_applies
from .reports import is_automation_user
from .requests import requests_for_incidents
from .visibility import (
    _event_incidents,
    _rapport_state,
    _rapport_states,
    get_incident_leaders,
    visible_incidents_for_personnel,
)


async def _briefings(
    db: AsyncSession,
    event_id: uuid.UUID,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, Any]]:
    """What the board knows about these Schadenplätze, batched (§18.22).

    Crew, vehicles and material per incident in **four** queries for the whole
    list, not four per row: a storm night is forty Schadenplätze and this
    response is refetched on every window focus.

    **Released rows are filtered — with one exception.** A row the KP
    unassigned mid-incident is a correction (the wrong vehicle picked and fixed
    a second later) or a resource moved elsewhere, and showing it told a crew
    the TLF was theirs when only the Pio ever drove. The exception is the
    completion cascade: completing an incident auto-releases everything while
    the crew is physically still at the address filing, so rows whose release
    stamp is at/after ``completed_at`` stay on the briefing. Material has no
    completion cascade (it stays assigned, possibly left on site), so a
    released material row always means "returned" and is always dropped.

    The unit of a material line is its NAME per depot: two identical pumps
    from one shelf are one line with a count, because a crew reads a slip, not
    an assignment table — and the line carries WHERE the unit lives
    (``Material.location``), because the squad has to know where to fetch it.

    **Route-level resources count as this stop's.** An Auftrag owns its
    resources and shares them across every stop, so a squad the KP put on the
    route holds no row on any of them — and a briefing built from per-incident
    rows alone showed those crews an empty one: no colleagues, no vehicle, on
    the very Schadenplatz they were standing on. The fourth query folds the
    Auftrag's resources into each of its stops, which is what the Auftrag says
    they are.
    """
    briefings: dict[uuid.UUID, dict[str, Any]] = {
        incident_id: {"crew": [], "vehicles": [], "materials": []} for incident_id in incident_ids
    }
    if not incident_ids:
        return briefings

    # Which of these stops belong to an Auftrag, so its resources can be read
    # in as theirs. Only active route rows: a released one is a resource the
    # board has taken off the whole route.
    group_rows = await db.execute(
        select(Incident.id, Incident.group_id).where(Incident.id.in_(incident_ids), Incident.group_id.is_not(None))
    )
    # The `is not None` mirrors the WHERE above; it is what keeps the values a
    # plain UUID, which is what the route lookups below index with.
    group_of = {incident_id: group_id for incident_id, group_id in group_rows.tuples().all() if group_id is not None}
    # When each incident completed — the anchor for telling a completion-cascade
    # release apart from a mid-incident correction (see the docstring).
    # `completed_at` is stamped BEFORE the cascade runs (`crud/incidents.py`),
    # so every row it releases carries a stamp >= this one.
    completed_rows = await db.execute(
        select(Incident.id, Incident.completed_at).where(
            Incident.id.in_(incident_ids), Incident.completed_at.is_not(None)
        )
    )
    completed_at_of: dict[uuid.UUID, Any] = dict(completed_rows.tuples().all())

    def still_on_briefing(incident_id: uuid.UUID, unassigned_at: Any) -> bool:
        """An active row, or one the completion cascade released — never a
        mid-incident correction."""
        if unassigned_at is None:
            return True
        completed_at = completed_at_of.get(incident_id)
        return completed_at is not None and unassigned_at >= completed_at

    # Who drives what, for this Ereignis. One query for the whole fleet: the
    # driver is set per event (`EventSpecialFunction`), not per Schadenplatz.
    driver_rows = await db.execute(
        select(EventSpecialFunction.vehicle_id, Personnel.name)
        .join(Personnel, Personnel.id == EventSpecialFunction.personnel_id)
        .where(
            EventSpecialFunction.event_id == event_id,
            EventSpecialFunction.function_type == "driver",
            EventSpecialFunction.vehicle_id.is_not(None),
        )
    )
    # The `is not None` mirrors the WHERE above; it is there so the key type is
    # a plain UUID rather than an optional one.
    drivers: dict[uuid.UUID, str] = {
        vehicle_id: name for vehicle_id, name in driver_rows.tuples().all() if vehicle_id is not None
    }

    route: dict[uuid.UUID, dict[str, list[Any]]] = {}
    if group_of:
        route_result = await db.execute(
            select(
                IncidentGroupAssignment.incident_group_id,
                IncidentGroupAssignment.resource_type,
                IncidentGroupAssignment.resource_id,
                Personnel.name,
                Vehicle.name,
                Material.name,
            )
            .outerjoin(
                Personnel,
                and_(
                    Personnel.id == IncidentGroupAssignment.resource_id,
                    IncidentGroupAssignment.resource_type == "personnel",
                ),
            )
            .outerjoin(
                Vehicle,
                and_(
                    Vehicle.id == IncidentGroupAssignment.resource_id,
                    IncidentGroupAssignment.resource_type == "vehicle",
                ),
            )
            .outerjoin(
                Material,
                and_(
                    Material.id == IncidentGroupAssignment.resource_id,
                    IncidentGroupAssignment.resource_type == "material",
                ),
            )
            .where(
                IncidentGroupAssignment.incident_group_id.in_(set(group_of.values())),
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
        for (
            group_id,
            resource_type,
            resource_id,
            person_name,
            vehicle_name,
            material_name,
        ) in route_result.all():
            bucket = route.setdefault(group_id, {"crew": [], "vehicles": [], "materials": []})
            name = {"personnel": person_name, "vehicle": vehicle_name, "material": material_name}.get(resource_type)
            if not name:
                continue
            key = {"personnel": "crew", "vehicle": "vehicles", "material": "materials"}[resource_type]
            bucket[key].append(
                # `via_auftrag` is what makes "kommt das mit?" answerable: this
                # row belongs to the ROUTE and is therefore on every stop of it.
                #
                # `stays` stays None: an Auftrag has no driver-stay toggle
                # (`GroupAssignmentUpdate` is `is_leader` and nothing else), so
                # the column here is a copy nobody can correct. Saying «fährt
                # zurück» on that basis would be the board answering a question
                # it was never asked — see `FeldVehicleLine`.
                {
                    "name": name,
                    "driver": drivers.get(resource_id),
                    "stays": None,
                    "via_auftrag": True,
                }
                if resource_type == "vehicle"
                else name
            )

    crew_result = await db.execute(
        select(IncidentAssignment.incident_id, Personnel.id, Personnel.name, IncidentAssignment.unassigned_at)
        .join(Personnel, Personnel.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "personnel",
        )
        .order_by(Personnel.name)
    )
    for incident_id, group_id in group_of.items():
        shared = route.get(group_id)
        if not shared:
            continue
        briefings[incident_id]["crew"].extend(shared["crew"])
        briefings[incident_id]["vehicles"].extend(shared["vehicles"])

    seen_crew: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for incident_id, personnel_id, name, unassigned_at in crew_result.all():
        if not still_on_briefing(incident_id, unassigned_at):
            continue
        # One person can hold several rows on one incident (assigned, released,
        # re-assigned) and is still one person on the slip.
        if (incident_id, personnel_id) in seen_crew:
            continue
        seen_crew.add((incident_id, personnel_id))
        # A resource can sit at both levels — `_mirror` puts it there on purpose
        # (crud/feld/melden.py). One person is one line on the slip either way.
        if name not in briefings[incident_id]["crew"]:
            briefings[incident_id]["crew"].append(name)

    vehicle_result = await db.execute(
        select(
            IncidentAssignment.incident_id,
            Vehicle.id,
            Vehicle.name,
            IncidentAssignment.driver_stay,
            IncidentAssignment.unassigned_at,
        )
        .join(Vehicle, Vehicle.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "vehicle",
        )
        .order_by(Vehicle.display_order, Vehicle.name)
    )
    seen_vehicles: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for incident_id, vehicle_id, name, driver_stay, unassigned_at in vehicle_result.all():
        if not still_on_briefing(incident_id, unassigned_at):
            continue
        if (incident_id, vehicle_id) in seen_vehicles:
            continue
        seen_vehicles.add((incident_id, vehicle_id))
        # A resource can sit at both levels (`_mirror`); one vehicle is one line.
        # The route's copy wins when there is one — it is the truthful answer to
        # "does this come with us to the next stop".
        if not any(line["name"] == name for line in briefings[incident_id]["vehicles"]):
            briefings[incident_id]["vehicles"].append(
                {
                    "name": name,
                    "driver": drivers.get(vehicle_id),
                    "stays": bool(driver_stay),
                    "via_auftrag": False,
                }
            )

    # Material: active rows only — a released material row means «zurück im
    # Magazin», never a completion cascade (materials are excluded from it).
    material_result = await db.execute(
        select(IncidentAssignment.incident_id, Material.name, Material.location)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id.in_(incident_ids),
            IncidentAssignment.resource_type == "material",
            IncidentAssignment.unassigned_at.is_(None),
        )
        .order_by(Material.location_sort_order, Material.location, Material.name)
    )
    material_units = [(incident_id, name, location) for incident_id, name, location in material_result.all()]
    for incident_id, group_id in group_of.items():
        for name in route.get(group_id, {}).get("materials", []):
            # Route-level material carries no location join — the name-keyed
            # line below simply stays location-less for it.
            material_units.append((incident_id, name, None))
    for incident_id, name, location in material_units:
        lines: list[dict[str, Any]] = briefings[incident_id]["materials"]
        # One line per (name, depot): identical units from one shelf are one
        # line with a count, units living in different depots stay apart —
        # «wo holen?» is the question the line exists to answer.
        for line in lines:
            if line["name"] == name and line.get("location") == (location or None):
                line["count"] += 1
                break
        else:
            lines.append({"name": name, "count": 1, "location": location or None})

    return briefings


#: The ``DangersAssessment`` keys, in the order the board renders its badges.
#: Kept as an explicit tuple rather than "every truthy key": ``other_notes`` is
#: free text and must never be turned into a badge label.
_DANGER_KEYS = ("fire", "fire_danger", "explosion", "collapse", "chemical", "electrical")


async def _reko_briefings(
    db: AsyncSession,
    incident_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, Any]]:
    """The newest SUBMITTED Reko per incident, flattened for the field.

    Drafts are excluded: a draft Reko is somebody still typing, and quoting half
    a sentence back at the next crew as fact is worse than saying nothing. This
    is the same rule the board's ``has_completed_reko`` already uses.
    """
    if not incident_ids:
        return {}

    result = await db.execute(
        select(RekoReport, Personnel.name)
        .outerjoin(Personnel, Personnel.id == RekoReport.submitted_by_personnel_id)
        .where(
            RekoReport.incident_id.in_(incident_ids),
            RekoReport.is_draft.is_(False),
        )
        .order_by(RekoReport.submitted_at)
    )
    briefings: dict[uuid.UUID, dict[str, Any]] = {}
    for report, personnel_name in result.all():
        dangers_raw = report.dangers_json or {}
        # Newest wins: the query is ordered oldest-first, so a later row simply
        # replaces an earlier one.
        briefings[report.incident_id] = {
            "summary": report.summary_text or None,
            "notes": report.additional_notes or None,
            "dangers": [key for key in _DANGER_KEYS if dangers_raw.get(key)],
            # «Kein Einsatz nötig» feeds the rapport gate: an incident the Reko
            # declared irrelevant and the KP closed owes nobody a Rapport.
            "is_relevant": report.is_relevant,
            "submitted_at": report.submitted_at,
            "submitted_by_name": personnel_name,
        }
    return briefings


async def _pickup_acks(
    db: AsyncSession,
    incidents: dict[uuid.UUID, Incident],
) -> dict[uuid.UUID, dict[str, Any]]:
    """What the KP actually DID about each Abholung — derived, never claimed (§P3.1).

    Three signals, all read off state real KP actions already write, so no
    operator ever clicks an "acknowledge" button:

    * ``pickup_seen`` — the `field_pickup` warning bell for the OPEN request was
      dismissed. Dismissing a warning is the KP saying "gesehen".
    * ``pickup_vehicle`` — a vehicle was put on this Schadenplatz AFTER the
      request. That is what dispatching a pickup looks like on the board, and
      «Mowa disponiert» is the sentence a waiting crew is actually after.
    * ``pickup_resolved_at`` — the KP cleared the flag, which its own UI words
      as «Abholung disponiert». Without this the request just vanished from the
      crew's phone. Read off the audit log (`field_pickup_cleared`, source
      `kp`) because clearing wipes the request columns; a crew's own «Wir
      fahren selbst» carries source `feld` and is deliberately no ack.
    """
    acks: dict[uuid.UUID, dict[str, Any]] = {}
    open_requests = {
        incident_id: incident.pickup_requested_at
        for incident_id, incident in incidents.items()
        if incident.pickup_needed and incident.pickup_requested_at is not None
    }
    if open_requests:
        dismissed = await db.execute(
            select(Notification.incident_id, Notification.created_at).where(
                Notification.incident_id.in_(list(open_requests)),
                Notification.type == "field_pickup",
                Notification.dismissed.is_(True),
            )
        )
        for incident_id, created_at in dismissed.all():
            requested_at = open_requests.get(incident_id)
            # Only a dismissal of THIS request counts; an older pickup's bell
            # says nothing about the one the crew is waiting on now.
            if incident_id is None or requested_at is None or created_at < requested_at:
                continue
            acks.setdefault(incident_id, {})["pickup_seen"] = True

        vehicles = await db.execute(
            select(IncidentAssignment.incident_id, IncidentAssignment.assigned_at, Vehicle.name)
            .join(Vehicle, Vehicle.id == IncidentAssignment.resource_id)
            .where(
                IncidentAssignment.incident_id.in_(list(open_requests)),
                IncidentAssignment.resource_type == "vehicle",
                IncidentAssignment.unassigned_at.is_(None),
            )
            .order_by(IncidentAssignment.assigned_at)
        )
        for incident_id, assigned_at, name in vehicles.all():
            requested_at = open_requests.get(incident_id)
            if requested_at is None or assigned_at < requested_at:
                continue
            # Earliest dispatched-after-the-request vehicle wins (ordered query).
            acks.setdefault(incident_id, {}).setdefault("pickup_vehicle", name)

    cleared_candidates = [incident_id for incident_id, incident in incidents.items() if not incident.pickup_needed]
    if cleared_candidates:
        cleared = await db.execute(
            select(AuditLog.resource_id, sa_func.max(AuditLog.timestamp))
            .where(
                AuditLog.resource_type == "incident",
                AuditLog.resource_id.in_(cleared_candidates),
                AuditLog.action_type == "field_pickup_cleared",
                AuditLog.changes_json["source"].astext == "kp",
            )
            .group_by(AuditLog.resource_id)
        )
        for incident_id, at in cleared.all():
            if incident_id is None:
                continue
            acks.setdefault(incident_id, {})["pickup_resolved_at"] = at
    return acks


async def get_feld_assignments_for_personnel(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """ "Meine Einsatzstellen" — every Schadenplatz this event holds for them.

    Released crew and Reko assignments stay in the list (decision 4 / §2): the
    rapport is filed after the crew leaves, so dropping them would hide exactly
    the rows the page exists for. Driver rows behave the other way round and
    disappear with their vehicle — see the module docstring.

    Each row carries the ``source`` that put it there, because the field surface
    has to be able to say *why* an incident nobody assigned you to is in your
    list, and because only a ``crew`` row may be asked for a Rapport.
    """
    incidents = await _event_incidents(db, event_id)
    incident_ids = list(incidents)
    if not incident_ids:
        return []

    mine_sources = await visible_incidents_for_personnel(db, event_id, personnel_id)
    if not mine_sources:
        return []
    mine = {incident_id: source.is_active for incident_id, source in mine_sources.items()}

    mine_ids = list(mine)
    reports = await _rapport_states(db, mine_ids)
    # No rapport before the Schadenplatz was disponiert (§18.27) — one query for
    # the whole list, so a crew with fourteen rows still costs one round trip.
    dispatched = await dispatched_incident_ids(db, [incidents[incident_id] for incident_id in mine_ids])
    leaders = await get_incident_leaders(db, mine_ids)
    # The Auftrag each stop belongs to. A route-assigned crew holds no row on
    # any stop, so without the name their Schadenplätze look like unrelated
    # jobs — and the order is the whole point of grouping them.
    group_rows = await db.execute(
        select(IncidentGroup.id, IncidentGroup.name).where(
            IncidentGroup.id.in_({incidents[i].group_id for i in mine_ids if incidents[i].group_id})
        )
    )
    group_names = {row[0]: row[1] for row in group_rows.all()}
    briefings = await _briefings(db, event_id, mine_ids)
    rekos = await _reko_briefings(db, mine_ids)
    # The KP's side of the loop (sweep 27 §P3): what it did about an Abholung,
    # and what it sent the squad. Lazy import — `crud.incidents` imports this
    # package, and `crud.kp_messages` sits next to it.
    from .. import kp_messages as kp_messages_crud

    pickup_acks = await _pickup_acks(db, {incident_id: incidents[incident_id] for incident_id in mine_ids})
    kp_messages = await kp_messages_crud.messages_for_incidents(db, mine_ids)
    # What the field asked for and where it stands (R13). The Abholung has its
    # own standing box on the phone, so its work item is not repeated here.
    field_requests = await requests_for_incidents(db, mine_ids, include_pickup=False)

    rows: list[dict[str, Any]] = []
    for incident_id, is_active in mine.items():
        incident = incidents[incident_id]
        report = reports.get(incident_id)
        leader = leaders.get(incident_id)
        briefing = briefings.get(incident_id, {})
        source = mine_sources[incident_id]
        acks = pickup_acks.get(incident_id, {})
        rows.append(
            {
                "incident_id": incident.id,
                "incident_title": incident.title or incident.location_address or "Unbekannt",
                "incident_type": incident.type,
                "incident_status": incident.status,
                # The briefing (§18.22): what a crew standing at the address
                # needs before it opens a form.
                "description": incident.description,
                "contact": incident.contact,
                "contact_phone": incident.contact_phone,
                "crew": briefing.get("crew", []),
                "vehicles": briefing.get("vehicles", []),
                "materials": briefing.get("materials", []),
                "reko": rekos.get(incident_id),
                "location_address": incident.location_address,
                "location_lat": str(incident.location_lat) if incident.location_lat is not None else None,
                "location_lng": str(incident.location_lng) if incident.location_lng is not None else None,
                "is_active_assignment": is_active,
                # Why this row is here: "crew" | "reko" | "driver" | "magazin".
                # The phone labels only the unusual ones — an own assignment
                # needs no explanation, its absence is the explanation.
                "source": source.kind,
                "source_vehicle": source.vehicle_name,
                "rapport_state": _rapport_state(report),
                "has_been_dispatched": incident_id in dispatched,
                "arrived_at": report.arrived_at if report else None,
                # Who said so: the crew's own tap, or the GPS automation having
                # watched an assigned vehicle reach the address (§18.24). The
                # phone has to be able to word it — a crew that never tapped
                # "Angekommen" must not read its own name off that line.
                "arrived_by_automation": bool(
                    report and report.arrived_at and is_automation_user(report.arrived_by_user_id)
                ),
                "field_complete_reported_at": incident.field_complete_reported_at,
                # The crew must see an open pickup when it comes back to the
                # page, not only in the response of the tap that set it.
                "pickup_needed": incident.pickup_needed,
                "pickup_note": incident.pickup_note,
                "pickup_requested_at": incident.pickup_requested_at,
                # Acks derived from real KP actions (§P3.1) — see `_pickup_acks`.
                "pickup_seen": acks.get("pickup_seen", False),
                "pickup_vehicle": acks.get("pickup_vehicle"),
                "pickup_resolved_at": acks.get("pickup_resolved_at"),
                # «Meldungen vom KP» (§P3.2), oldest first — thread order.
                "kp_messages": kp_messages.get(incident_id, []),
                "field_requests": field_requests.get(incident_id, []),
                "leader_personnel_id": leader[0] if leader else None,
                "leader_name": leader[1] if leader else None,
                "group_id": incident.group_id,
                "group_name": group_names.get(incident.group_id) if incident.group_id else None,
                "group_position": incident.group_position if incident.group_id else None,
                # Sort-only, stripped below. "Owes a rapport" rather than "has
                # none": a Schadenplatz that was never disponiert owes nothing,
                # so it must not be sorted up as if it were the crew's homework.
                # Nor does one somebody only drove to or recced — that is what
                # `source.owes_rapport` is guarding (decision 11).
                "_owes_rapport": source.owes_rapport
                and _rapport_state(report) != "submitted"
                and rapport_applies(
                    dispatched=incident_id in dispatched,
                    has_report=report is not None,
                    reko_not_relevant=bool((reko := rekos.get(incident_id)) and reko.get("is_relevant") is False),
                    status=incident.status,
                ),
                "_position": incident.position,
                "_created_at": incident.created_at,
            }
        )

    # Where each Auftrag sits in the list: at its earliest stop.
    #
    # Without this, the stops of one route sorted by their own kanban position —
    # which is where the operator happened to drop each card in its status
    # column, and has nothing to do with the order they are to be driven in.
    # A crew read «Stopp 2» above «Stopp 1» and the numbers were the only thing
    # saying otherwise. The route order IS the reason the KP grouped them.
    group_rank: dict[uuid.UUID, int] = {}
    for row in rows:
        group_id = row["group_id"]
        if group_id is None:
            continue
        group_rank[group_id] = min(group_rank.get(group_id, row["_position"]), row["_position"])

    # Same priority order the operator arranged on the board: still-assigned
    # first, then the ones still missing a rapport, then the kanban order — with
    # a whole Auftrag travelling as one block, internally in route order.
    rows.sort(
        key=lambda row: (
            not row["is_active_assignment"],
            not row["_owes_rapport"],
            group_rank[row["group_id"]] if row["group_id"] in group_rank else row["_position"],
            row["group_position"] if row["group_id"] else 0,
            row["_position"],
            row["_created_at"],
        )
    )
    for row in rows:
        row.pop("_owes_rapport", None)
        row.pop("_position", None)
        row.pop("_created_at", None)

    return rows
