"""The Schadenplatz-Rapport: reconciliation, read, write, photos.

The reconcile helpers are the heart of it — the board's assignments are the
*proposal*, the crew's answers are the *truth*, and each ``reconcile_*`` merges
one against the other without ever losing a hand-typed row.
"""

import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple

from fastapi import HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import (
    EventAttendance,
    Incident,
    IncidentAssignment,
    IncidentGroupAssignment,
    Material,
    Personnel,
    SchadenplatzReport,
    User,
    Vehicle,
)
from ...schemas.feld import RapportUpdate
from ...services.audit import log_action
from ...services.notification_service import create_field_notification
from ...services.photo_storage import photo_storage
from .reports import FieldActor, _broadcast, _get_or_create_report, _location, _stamp_updated_by
from .visibility import get_incident_leaders

# ============================================
# The Schadenplatz-Rapport (phase 2)
# ============================================
#
# The paper replacement. Same rule as everything above it: ONE implementation,
# two thin routers over it (decision 28). The GET computes a prefill and
# deliberately does not write; only the PUT creates a row.
#
# And, still: nothing here touches `incident_assignments`. The material
# checklist READS the assignments and records two ticks against them; releasing
# what came back is a board action offered by "Material zurück – freigeben"
# (decision 17), never a side effect of filing.

# How long another person's save is shown as "bearbeitet gerade" (§3).
CONCURRENT_EDITOR_WINDOW = timedelta(minutes=5)


def _material_used(row: Mapping[str, Any]) -> bool:
    """``used`` as a plain bool, defaulting to **true** (§18.32).

    Rows written before the reversal can still carry ``null`` in the JSONB of a
    database that skipped the normalising migration (or of a payload replayed
    from an old phone), and `null` no longer means anything: the default answer
    for a unit that was sent to this Schadenplatz is "gebraucht".
    """
    value = row.get("used")
    return True if value is None else bool(value)


def _is_answered(row: Mapping[str, Any]) -> bool:
    """Did the crew contradict the board about this unit?

    Since `used` is prefilled *ja* (§18.32) an untouched row is not "unanswered",
    it is the board's own answer — exactly as on the vehicle list. So the only
    rows carrying information the board does not already have are the ones where
    the crew unticked *gebraucht* or ticked *vor Ort verblieben*, and those are
    the only ones worth keeping when the board takes the unit away again.
    """
    return not _material_used(row) or bool(row.get("left_on_site"))


async def _board_material_units(
    db: AsyncSession,
    incident_id: uuid.UUID,
) -> tuple[list[dict[str, Any]], dict[uuid.UUID, dict[str, Any]]]:
    """Every material unit the board has (or had) on this incident.

    **Including already-released ones** (§4): a pump that came back early still
    belongs in the record, and the crew that used it is the only one who can say
    so. Ordered by depot, then name, so a crew with fourteen units reads them in
    the order it knows from the shelf.
    """
    result = await db.execute(
        select(IncidentAssignment, Material)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "material",
        )
        .order_by(Material.location_sort_order, Material.location, Material.name, IncidentAssignment.assigned_at)
    )
    ordered: list[dict[str, Any]] = []
    by_assignment: dict[uuid.UUID, dict[str, Any]] = {}
    for assignment, material in result.all():
        unit = {
            "assignment_id": assignment.id,
            "material_id": material.id,
            "name": material.name,
            "location": material.location or None,
            "consumable": material.consumable,
        }
        ordered.append(unit)
        by_assignment[assignment.id] = unit
    return ordered, by_assignment


def reconcile_materials(
    stored: list[Any] | None,
    board_units: list[dict[str, Any]],
    board_by_assignment: dict[uuid.UUID, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Re-reconcile the checklist against the board — **never replace it** (§4).

    Three rules, and the third is the one that matters:

    * a unit the KP assigned after the draft started appears, ticked *gebraucht*
      (§18.32 — that is the default answer, not an unanswered state);
    * a unit that is still on the board keeps whatever the crew answered;
    * a unit the board no longer has keeps its row **if the crew contradicted
      the board** (unticked *gebraucht* or ticked *vor Ort verblieben*) and drops
      if it still carries nothing but the defaults. Deleting a contradicted row
      would lose exactly the information the checklist exists to capture.

    Consumables can never carry *vor Ort verblieben* (decision 26): a consumable
    that was used is gone. Enforced here rather than only in the UI, so neither
    door and no later caller can write the impossible state.
    """
    stored_rows: dict[uuid.UUID, dict[str, Any]] = {}
    orphans: list[dict[str, Any]] = []
    for raw in stored or []:
        if not isinstance(raw, dict):
            continue
        try:
            assignment_id = uuid.UUID(str(raw.get("assignment_id")))
        except (TypeError, ValueError):
            continue
        row = dict(raw)
        row["assignment_id"] = assignment_id
        if assignment_id in board_by_assignment:
            stored_rows[assignment_id] = row
        elif _is_answered(row):
            row["on_board"] = False
            orphans.append(row)

    merged: list[dict[str, Any]] = []
    for unit in board_units:
        previous = stored_rows.get(unit["assignment_id"], {})
        consumable = bool(unit["consumable"])
        merged.append(
            {
                "assignment_id": unit["assignment_id"],
                "material_id": unit["material_id"],
                "name": unit["name"],
                "location": unit["location"],
                "consumable": consumable,
                # Prefilled ticked: the unit was sent here, so "gebraucht" is the
                # board's own answer and the crew's job is to contradict it.
                "used": _material_used(previous),
                "left_on_site": False if consumable else bool(previous.get("left_on_site")),
                "on_board": True,
            }
        )

    # The answered orphans go last: they are history, not a to-do.
    for row in orphans:
        consumable = bool(row.get("consumable"))
        merged.append(
            {
                "assignment_id": row["assignment_id"],
                "material_id": row.get("material_id"),
                "name": row.get("name") or "Unbekannt",
                "location": row.get("location"),
                "consumable": consumable,
                "used": _material_used(row),
                "left_on_site": False if consumable else bool(row.get("left_on_site")),
                "on_board": False,
            }
        )
    return merged


def _jsonable_materials(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The checklist as it goes into JSONB: ids as strings, no derived flags.

    ``location`` and ``on_board`` are recomputed on every read from the live
    catalogue and the live assignments, so storing them would be storing a
    second, staler copy of the board.
    """
    return [
        {
            "assignment_id": str(row["assignment_id"]),
            "material_id": str(row["material_id"]) if row.get("material_id") else None,
            "name": row.get("name"),
            "consumable": bool(row.get("consumable")),
            "used": _material_used(row),
            "left_on_site": bool(row.get("left_on_site")),
        }
        for row in rows
    ]


def normalize_extra_materials(stored: Any) -> list[dict[str, Any]]:
    """ "Weiteres gebrauchtes Material" as a list of ``{name, left_on_site}`` (§18.35).

    Defensive on the way in, because the column is JSONB written by two doors and
    read by five outputs: anything without a usable name is dropped, the name is
    trimmed, the flag is coerced to a bool, and the crew's order is kept. A
    duplicate name collapses into one entry — the same thing named twice is one
    thing standing at the address — and it keeps the *left* flag if either copy
    carried it, because the answer that sends somebody driving must not be lost
    to a merge.

    There is no ``used`` here on purpose: naming something on this list already
    means it was used.
    """
    entries: list[dict[str, Any]] = []
    seen: dict[str, dict[str, Any]] = {}
    for raw in stored or []:
        if isinstance(raw, str):
            # Tolerated for a payload replayed from a phone that still speaks the
            # old comma-separated shape; the migration handled the database.
            raw = {"name": raw}
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        left = bool(raw.get("left_on_site"))
        existing = seen.get(name.lower())
        if existing is not None:
            existing["left_on_site"] = existing["left_on_site"] or left
            continue
        entry = {"name": name, "left_on_site": left}
        seen[name.lower()] = entry
        entries.append(entry)
    return entries


async def _route_assigned_ids(
    db: AsyncSession,
    incident: Incident,
    resource_type: str,
) -> set[uuid.UUID]:
    """What the incident's Auftrag holds, if it is a stop in one.

    Resources on a route belong to the route, not to its stops — so a crew that
    drove a four-stop Auftrag has NO assignment on any single Schadenplatz, and
    the rapport's checklist offered it nothing to confirm. Everybody had to be
    ticked by hand, at every stop, for people who were demonstrably there.
    """
    if not incident.group_id:
        return set()
    result = await db.execute(
        select(IncidentGroupAssignment.resource_id).where(
            IncidentGroupAssignment.incident_group_id == incident.group_id,
            IncidentGroupAssignment.resource_type == resource_type,
        )
    )
    return {row[0] for row in result.all()}


class _VehicleOffer(NamedTuple):
    """What the Fahrzeuge section shows, and what it can reach.

    ``dispatched`` are the **rows**: only what the board put on *this*
    Schadenplatz. ``candidates`` is the rest of the fleet — reachable through the
    section's search and one fold away, but never a row of its own.
    """

    dispatched: list[dict[str, Any]]
    assigned_ids: set[uuid.UUID]
    candidates: list[dict[str, Any]]

    @property
    def names(self) -> dict[uuid.UUID, str]:
        """Live names for every vehicle the station still owns."""
        return {row["vehicle_id"]: str(row["name"]) for row in (*self.dispatched, *self.candidates)}


async def _fleet_vehicles(db: AsyncSession, incident: Incident) -> _VehicleOffer:
    """What the board disponiert here, and the fleet behind it.

    **Rows for the disponierten vehicles only.** The fleet used to be the list
    (§18.33), which made the rapport a fleet inventory with one question stapled
    to every row: a station with twelve vehicles answered eleven questions it had
    no reason to be asked, and the one vehicle that actually rolled was as easy
    to overlook as the eleven that did not. The set the board sent is the only
    set the system can honestly claim was *at this address*, so that is the
    confirm list. The correction §18.33 was right about — a vehicle that came
    along without anybody assigning it — is still possible and is now what the
    search and the fold are for; it is the exception, not the shape of the list.

    The assigned set includes **released** assignments and the vehicles of a
    multi-stop Auftrag: both were at the Schadenplatz, and only the crew can say
    otherwise.

    Ordered the way the fleet is ordered everywhere else in the app, so the crew
    reads the vehicles in the order it knows them.

    **Archived** vehicles are in neither list. That is exactly the "left the
    fleet" case `reconcile_vehicles` already knows: a rapport that had ticked one
    keeps the tick, because that is a correction of the board; an untouched row
    for a vehicle the station no longer owns says nothing and drops away.
    """
    result = await db.execute(
        select(Vehicle).where(Vehicle.archived_at.is_(None)).order_by(Vehicle.display_order, Vehicle.name)
    )
    fleet = [{"vehicle_id": vehicle.id, "name": vehicle.name} for vehicle in result.scalars().all()]

    assigned = await db.execute(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "vehicle",
        )
    )
    own = {row[0] for row in assigned.all()}
    assigned_ids = own | await _route_assigned_ids(db, incident, "vehicle")
    return _VehicleOffer(
        dispatched=[row for row in fleet if row["vehicle_id"] in assigned_ids],
        assigned_ids=assigned_ids,
        candidates=[row for row in fleet if row["vehicle_id"] not in assigned_ids],
    )


def reconcile_vehicles(
    stored: list[Any] | None,
    dispatched: list[dict[str, Any]],
    assigned_ids: set[uuid.UUID],
    fleet_names: dict[uuid.UUID, str] | None = None,
) -> list[dict[str, Any]]:
    """Re-reconcile the vehicle list against the board — never replace it.

    Keyed on the **vehicle**, not on an assignment: a vehicle the crew added by
    hand was never dispatched and has no assignment to key on.

    Three rules:

    * every vehicle the board has (or had) here gets a row, arriving ticked —
      that prefill *is* the board's answer, and the crew corrects it in either
      direction;
    * a vehicle the crew already answered keeps that answer, whatever the board
      has done since;
    * a vehicle the board never sent survives only when it is **ticked**. That is
      the crew adding one — or a correction that outlived its assignment. An
      unticked row for a vehicle nobody dispatched says nothing at all.

    ``fleet_names`` refreshes the name of an added vehicle from the live fleet,
    so renaming a vehicle does not leave an old spelling frozen in a draft.
    """
    stored_rows: dict[uuid.UUID, dict[str, Any]] = {}
    for raw in stored or []:
        if not isinstance(raw, dict):
            continue
        try:
            vehicle_id = uuid.UUID(str(raw.get("vehicle_id")))
        except (TypeError, ValueError):
            # Pre-§18.33 rows for a vanished assignment carry no vehicle_id at
            # all. There is nothing left to key them on, and the vehicle they
            # named is either dispatched below (and therefore already covered)
            # or gone from the station.
            continue
        row = dict(raw)
        row["vehicle_id"] = vehicle_id
        stored_rows[vehicle_id] = row

    known = fleet_names or {}
    merged: list[dict[str, Any]] = []
    for unit in dispatched:
        previous = stored_rows.pop(unit["vehicle_id"], {})
        merged.append(
            {
                "vehicle_id": unit["vehicle_id"],
                "name": unit["name"],
                "present": bool(previous.get("present", unit["vehicle_id"] in assigned_ids)),
                "on_board": unit["vehicle_id"] in assigned_ids,
            }
        )

    # Whatever is left the crew ticked for a vehicle the board never sent here.
    for row in stored_rows.values():
        if not row.get("present"):
            continue
        merged.append(
            {
                "vehicle_id": row["vehicle_id"],
                "name": known.get(row["vehicle_id"]) or row.get("name") or "Unbekannt",
                "present": True,
                "on_board": False,
            }
        )
    return merged


def _jsonable_vehicles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The vehicle checklist as it goes into JSONB: ids as strings, no ``on_board``.

    ``on_board`` is recomputed on every read from the live assignments, so
    storing it would be storing a second, staler copy of the board.

    **Only the rows that carry an answer are stored** (§18.33). Since the fleet
    row for a vehicle nobody dispatched arrives unticked, writing it down would
    mean copying the whole fleet table into every rapport — and worse, it would
    freeze a default as a decision: a vehicle the KP assigns ten minutes later
    would then stay unticked because a form that never asked about it had
    already "answered" no. So a row survives when it is ticked (the crew says it
    was there) or when the board has it (an unticked one is then a real
    contradiction). Everything else is the default, and the default is recomputed.
    """
    return [
        {
            "vehicle_id": str(row["vehicle_id"]),
            "name": row.get("name"),
            "present": bool(row.get("present")),
        }
        for row in rows
        if row.get("present") or row.get("on_board")
    ]


class _PersonnelOffer(NamedTuple):
    """What the Personal section shows, and what it can reach.

    ``dispatched`` are the **rows**: only who the board put on *this*
    Schadenplatz. ``candidates`` is everybody else on the roster — the Appell
    first, the rest of the roster behind it — reachable through the section's
    search and one fold away, but never a row of its own.
    """

    dispatched: list[dict[str, Any]]
    assigned_ids: set[uuid.UUID]
    candidates: list[dict[str, Any]]

    @property
    def names(self) -> dict[uuid.UUID, str]:
        """Live names for everybody still on the roster."""
        return {row["personnel_id"]: str(row["name"]) for row in (*self.dispatched, *self.candidates)}


async def _event_personnel(db: AsyncSession, incident: Incident) -> _PersonnelOffer:
    """Who the board aufgeboten here, and who else the crew can reach.

    **Rows for the aufgebotenen only.** The list used to be the whole Appell —
    everybody checked in at the Ereignis — plus whoever the board had here, and
    on a storm night that is half the brigade standing in a rapport about one
    cellar. Being checked in says somebody turned out tonight; it says nothing
    about *this address*. The assigned set is the only one the system can honestly
    claim was here, so it is the confirm list.

    Nobody becomes unreachable: everybody else on the roster is a ``candidate``,
    with ``checked_in`` marking the Appell so the search can put those first. The
    roster behind them is offered too, because the Appell is not always kept and
    a name that cannot be found gets typed as free text — after which it belongs
    to no person at all.

    The assigned set includes **released** assignments and the crew of a
    multi-stop Auftrag: a stop carries no assignments of its own, so without that
    everybody on a four-stop Auftrag had to be entered by hand, four times, for
    people who were demonstrably there.

    Ordered the way the roster is ordered everywhere else, so the crew reads the
    names in the order it knows them.
    """
    assigned_result = await db.execute(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "personnel",
        )
    )
    assigned_ids = {row[0] for row in assigned_result.all()}
    assigned_ids |= await _route_assigned_ids(db, incident, "personnel")

    checked_in_result = await db.execute(
        select(EventAttendance.personnel_id).where(
            EventAttendance.event_id == incident.event_id,
            EventAttendance.checked_in.is_(True),
        )
    )
    checked_in_ids = {row[0] for row in checked_in_result.all()}

    # The whole roster, in roster order. It is a station's members, not a
    # catalogue: there is no five-figure case to cap against, and capping would
    # mean a name the crew cannot find.
    roster_result = await db.execute(
        select(Personnel).order_by(Personnel.role_sort_order, Personnel.role, Personnel.name)
    )
    roster = [{"personnel_id": person.id, "name": person.name} for person in roster_result.scalars().all()]

    dispatched = [row for row in roster if row["personnel_id"] in assigned_ids]
    # Somebody assigned who is not on the roster at all cannot happen through the
    # board, but a stale assignment row could outlive a deleted person; the
    # checklist's stored rows carry the name for that case.
    candidates = [
        {**row, "checked_in": row["personnel_id"] in checked_in_ids}
        for row in roster
        if row["personnel_id"] not in assigned_ids
    ]
    # The Appell first: those are the people who plausibly stood there.
    candidates.sort(key=lambda row: not row["checked_in"])
    return _PersonnelOffer(dispatched=dispatched, assigned_ids=assigned_ids, candidates=candidates)


def reconcile_personnel(
    stored: list[Any] | None,
    dispatched: list[dict[str, Any]],
    assigned_ids: set[uuid.UUID],
    roster_names: dict[uuid.UUID, str] | None = None,
) -> list[dict[str, Any]]:
    """Re-reconcile the crew list against the board — never replace it.

    The vehicle rules, applied to people (see :func:`reconcile_vehicles`): every
    aufgebotene name gets a row prefilled from the board, an answer the crew
    already gave survives whatever the board does next, and somebody the board
    never sent keeps their row only when they are **ticked** — that is the crew
    adding them; an unticked row for a name nobody sent says nothing.
    """
    stored_rows: dict[uuid.UUID, dict[str, Any]] = {}
    for raw in stored or []:
        if not isinstance(raw, dict):
            continue
        try:
            personnel_id = uuid.UUID(str(raw.get("personnel_id")))
        except (TypeError, ValueError):
            continue
        row = dict(raw)
        row["personnel_id"] = personnel_id
        stored_rows[personnel_id] = row

    known = roster_names or {}
    merged: list[dict[str, Any]] = []
    for person in dispatched:
        previous = stored_rows.pop(person["personnel_id"], {})
        merged.append(
            {
                "personnel_id": person["personnel_id"],
                "name": person["name"],
                "present": bool(previous.get("present", person["personnel_id"] in assigned_ids)),
                "on_board": person["personnel_id"] in assigned_ids,
            }
        )

    for row in stored_rows.values():
        if not row.get("present"):
            continue
        merged.append(
            {
                "personnel_id": row["personnel_id"],
                "name": known.get(row["personnel_id"]) or row.get("name") or "Unbekannt",
                "present": True,
                "on_board": False,
            }
        )
    return merged


def _jsonable_personnel(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The crew checklist as it goes into JSONB — same rules as the vehicles.

    ``on_board`` is recomputed from the live assignments on every read, so it is
    not stored, and only rows that carry an answer are written: an untouched row
    for somebody nobody dispatched would freeze "nein" as a decision nobody made.
    """
    return [
        {
            "personnel_id": str(row["personnel_id"]),
            "name": row["name"],
            "present": bool(row["present"]),
        }
        for row in rows
        if row["present"] or row["on_board"]
    ]


def normalize_extra_personnel(stored: Any) -> list[dict[str, Any]]:
    """People on no roster of this station, as ``{name, note}``.

    Defensive like :func:`normalize_extra_materials`, and for the same reason —
    JSONB written by two doors and read by several outputs. A duplicate name
    collapses into one entry and keeps whichever note is non-empty: the same
    person named twice is one person standing at the address.
    """
    entries: list[dict[str, Any]] = []
    seen: dict[str, dict[str, Any]] = {}
    for raw in stored or []:
        if isinstance(raw, str):
            raw = {"name": raw}
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        note = str(raw.get("note") or "").strip()
        existing = seen.get(name.lower())
        if existing is not None:
            existing["note"] = existing["note"] or note
            continue
        entry = {"name": name, "note": note}
        seen[name.lower()] = entry
        entries.append(entry)
    return entries


def derive_personnel_count(personnel_rows: list[dict[str, Any]], extra_rows: list[dict[str, Any]]) -> int:
    """The head count, from the list rather than from a keyboard.

    Ticked names plus everybody the crew added by hand. It cannot disagree with
    what the rapport shows, which is the whole reason the number stopped being
    typed.
    """
    return sum(1 for row in personnel_rows if row.get("present")) + len(extra_rows)


async def _board_personnel_count(db: AsyncSession, incident: Incident) -> int:
    """The board's own head count — the number the crew confirms or corrects.

    Distinct people, not assignment rows: somebody assigned, released and
    re-assigned worked one Einsatz, not two. Released rows count — the crew that
    left an hour ago was still eingesetzt. **An Auftrag's crew counts too**, for
    the same reason it gets a row: a stop in a multi-stop route carries no
    assignments of its own, and counting only the stop's own rows made every
    Auftrag rapport report "korrigiert" against a board count of zero.

    It has to stay the same set ``_event_personnel`` builds rows from, or the
    «vom Board: n» line contradicts the list printed right above it.

    The vehicles have no number of their own: the crew confirms the LIST
    (``_fleet_vehicles``), and the ticked rows are the count.
    """
    result = await db.execute(
        select(IncidentAssignment.resource_id).where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "personnel",
        )
    )
    assigned = {row[0] for row in result.all()} | await _route_assigned_ids(db, incident, "personnel")
    return len(assigned)


async def _material_name_suggestions(db: AsyncSession) -> list[str]:
    """Distinct catalogue names for the "Weiteres Material" autosuggest.

    A naming aid and nothing more. It deliberately carries **no ids**, precisely
    so no client can turn it into a picker: `/feld` never writes an assignment
    (decision 17), and suggesting a name is not picking a unit. Capped so a
    station with a large catalogue does not push a five-figure list to a phone.

    Archived material is left out: the list answers "what is in the depot", and a
    retired item is not. The field stays free text, so a crew that really did use
    one can still type it.
    """
    result = await db.execute(
        select(Material.name).where(Material.archived_at.is_(None)).distinct().order_by(Material.name).limit(200)
    )
    return [row[0] for row in result.all() if row[0]]


async def _names(db: AsyncSession, report: SchadenplatzReport | None) -> dict[str, str | None]:
    """The four provenance names, resolved in one round trip each side."""
    if report is None:
        return {"created_by_name": None, "updated_by_name": None}

    personnel_ids = {i for i in (report.created_by_personnel_id, report.updated_by_personnel_id) if i}
    user_ids = {i for i in (report.created_by_user_id, report.updated_by_user_id) if i}

    personnel_names: dict[uuid.UUID, str] = {}
    if personnel_ids:
        rows = await db.execute(select(Personnel.id, Personnel.name).where(Personnel.id.in_(personnel_ids)))
        personnel_names = {row[0]: row[1] for row in rows.all()}

    user_names: dict[uuid.UUID, str] = {}
    if user_ids:
        rows = await db.execute(select(User.id, User.username).where(User.id.in_(user_ids)))
        user_names = {row[0]: row[1] for row in rows.all()}

    def resolve(personnel_id: uuid.UUID | None, user_id: uuid.UUID | None) -> str | None:
        if personnel_id is not None:
            return personnel_names.get(personnel_id)
        if user_id is not None:
            return user_names.get(user_id)
        return None

    return {
        "created_by_name": resolve(report.created_by_personnel_id, report.created_by_user_id),
        "updated_by_name": resolve(report.updated_by_personnel_id, report.updated_by_user_id),
    }


def _concurrent_editor(
    report: SchadenplatzReport | None,
    actor: FieldActor,
    updated_by_name: str | None,
) -> dict[str, Any] | None:
    """ "Frey Marc bearbeitet diesen Rapport gerade" — or nothing (§3).

    Only when the last save was **somebody else** inside the window. Visibility,
    not a lock: two crews on one Schadenplatz overwriting each other's
    Kurzbericht is an accepted cost (§12), and a lock in the field is worse than
    the problem it solves.
    """
    if report is None or report.updated_at is None or not updated_by_name:
        return None

    same_person = (
        actor.is_field
        and report.updated_by_personnel_id is not None
        and report.updated_by_personnel_id == actor.personnel_id
    ) or (
        not actor.is_field
        and actor.user is not None
        and report.updated_by_user_id is not None
        and report.updated_by_user_id == actor.user.id
    )
    if same_person:
        return None

    updated_at = report.updated_at
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=UTC)
    if datetime.now(UTC) - updated_at > CONCURRENT_EDITOR_WINDOW:
        return None

    return {
        "name": updated_by_name,
        "at": report.updated_at,
        "in_kp": report.updated_by_personnel_id is None and report.updated_by_user_id is not None,
    }


async def get_rapport(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
) -> dict[str, Any]:
    """The Schadenplatz-Rapport — **prefilled if it does not exist yet** (§4).

    A GET that computes and does **not** write. The prefill is defaults and
    orientation, never authoritative once the crew has touched the form, and it
    stays on the response afterwards so both the form and the export can show
    "vom Board: 6" next to a corrected 8.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()

    board_units, board_by_assignment = await _board_material_units(db, incident.id)
    materials = reconcile_materials(report.materials_json if report else None, board_units, board_by_assignment)

    fleet = await _fleet_vehicles(db, incident)
    vehicles = reconcile_vehicles(
        report.vehicles_json if report else None, fleet.dispatched, fleet.assigned_ids, fleet.names
    )

    crew_offer = await _event_personnel(db, incident)
    crew = reconcile_personnel(
        report.personnel_json if report else None, crew_offer.dispatched, crew_offer.assigned_ids, crew_offer.names
    )
    extra_personnel = normalize_extra_personnel(report.extra_personnel_json if report else None)

    board_personnel = await _board_personnel_count(db, incident)
    listed_personnel_ids = {row["personnel_id"] for row in crew}
    listed_vehicle_ids = {row["vehicle_id"] for row in vehicles}
    leaders = await get_incident_leaders(db, [incident.id])
    leader = leaders.get(incident.id)
    names = await _names(db, report)

    prefill = {
        "location_address": incident.location_address,
        # The reference the exports use. `title` is what the board shows on the
        # card and what the PDF prints, so the crew recognises the slip it is
        # filling from the row it tapped.
        "incident_ref": incident.title or incident.location_address or "Unbekannt",
        "leader_personnel_id": leader[0] if leader else None,
        "leader_name": leader[1] if leader else None,
        # "Melder übernehmen": one tap PREFILLS the two owner inputs with these.
        # The Melder is frequently not the Eigentümer, so the copy stays
        # editable and the two are never equated.
        "melder_name": incident.contact or None,
        "melder_phone": incident.contact_phone or None,
        "board_personnel_count": board_personnel,
        "material_name_suggestions": await _material_name_suggestions(db),
        # Everybody and everything the section can ADD, as opposed to confirm.
        #
        # Unlike the material suggestions these carry ids, and that is not a
        # widening of decision 18: the two checklists have always been keyed on
        # the person and the vehicle, and adding a row here still creates no
        # assignment and no attendance. What an id buys is the thing free text
        # cannot — a nachgetragene Person stays the same person the roster,
        # the export and the Lohnblatt know.
        #
        # Anybody who already has a row is not offered again.
        "personnel_candidates": [
            candidate for candidate in crew_offer.candidates if candidate["personnel_id"] not in listed_personnel_ids
        ],
        "vehicle_candidates": [
            candidate for candidate in fleet.candidates if candidate["vehicle_id"] not in listed_vehicle_ids
        ],
    }

    concurrent = _concurrent_editor(report, actor, names["updated_by_name"])

    if report is None:
        return {
            "incident_id": incident.id,
            "exists": False,
            "is_draft": True,
            "materials": materials,
            "vehicles": vehicles,
            "personnel": crew,
            "extra_personnel": extra_personnel,
            "photos": [],
            "personnel_count": board_personnel,
            "prefill": prefill,
            "concurrent_editor": None,
        }

    return {
        "incident_id": incident.id,
        "exists": True,
        "is_draft": report.is_draft,
        "submitted_at": report.submitted_at,
        "materials": materials,
        "vehicles": vehicles,
        "personnel": crew,
        "extra_personnel": extra_personnel,
        # Filenames only. They are read back through the shared
        # `GET /api/photos/{incident_id}/{filename}`, which is what the Reko
        # form already uses — the photo bytes are not per-door.
        "photos": list(report.photos_json or []),
        "extra_materials": normalize_extra_materials(report.extra_materials_json),
        "kurzbericht": report.kurzbericht,
        "handed_over_to": report.handed_over_to,
        "owner_name": report.owner_name,
        "owner_phone": report.owner_phone,
        # The stored number, which the WRITE derives from the checklist — not a
        # fresh count off the reconciled list above. The reconciled list has to
        # show people the board assigned since (so the crew can still correct it),
        # and re-counting it here would let a KP assigning two more names an hour
        # later silently raise a filed rapport's head count. Decision 6: a later
        # board edit cannot change a filed rapport.
        "personnel_count": report.personnel_count if report.personnel_count is not None else board_personnel,
        "personnel_count_corrected": report.personnel_count_corrected,
        "cost_snapshot_json": report.cost_snapshot_json,
        "arrived_at": report.arrived_at,
        "created_by_name": names["created_by_name"],
        "created_in_kp": report.created_by_personnel_id is None and report.created_by_user_id is not None,
        "updated_by_name": names["updated_by_name"],
        "updated_in_kp": report.updated_by_personnel_id is None and report.updated_by_user_id is not None,
        "updated_at": report.updated_at,
        "concurrent_editor": concurrent,
        "prefill": prefill,
    }


async def _build_cost_snapshot(db: AsyncSession, incident_id: uuid.UUID) -> list[dict[str, str | None]]:
    """Freeze who and which vehicles, with from/to, at the moment of submission.

    Decision 6: a later board edit cannot silently change a filed rapport. The
    per-person from/to is kept even though no output derives person-hours from
    it today — the snapshot is the thing that has to survive, and recomputing it
    later is exactly what it exists to prevent.
    """
    result = await db.execute(
        select(IncidentAssignment).where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type.in_(["personnel", "vehicle"]),
        )
    )
    assignments = list(result.scalars().all())
    if not assignments:
        return []

    personnel_ids = [a.resource_id for a in assignments if a.resource_type == "personnel"]
    vehicle_ids = [a.resource_id for a in assignments if a.resource_type == "vehicle"]

    personnel_names: dict[uuid.UUID, str] = {}
    if personnel_ids:
        rows = await db.execute(select(Personnel.id, Personnel.name).where(Personnel.id.in_(personnel_ids)))
        personnel_names = {row[0]: row[1] for row in rows.all()}
    vehicle_names: dict[uuid.UUID, str] = {}
    if vehicle_ids:
        rows = await db.execute(select(Vehicle.id, Vehicle.name).where(Vehicle.id.in_(vehicle_ids)))
        vehicle_names = {row[0]: row[1] for row in rows.all()}

    snapshot: list[dict[str, str | None]] = []
    for assignment in sorted(assignments, key=lambda a: (a.resource_type, a.assigned_at)):
        names = personnel_names if assignment.resource_type == "personnel" else vehicle_names
        snapshot.append(
            {
                "kind": assignment.resource_type,
                "name": names.get(assignment.resource_id, "Unbekannt"),
                "from": assignment.assigned_at.isoformat() if assignment.assigned_at else None,
                "to": assignment.unassigned_at.isoformat() if assignment.unassigned_at else None,
            }
        )
    return snapshot


async def save_rapport(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    payload: RapportUpdate,
    request: Request | None = None,
) -> dict[str, Any]:
    """Upsert the Schadenplatz-Rapport. ``is_draft=False`` files it.

    One row per incident (decision 3): whoever files first creates it, anyone
    else assigned amends the same row, and "zuletzt bearbeitet von X" is how the
    next person knows. Only the fields actually present in the payload are
    written — an autosave that carries half the form must not blank the rest.

    Submitting stamps ``submitted_at``, freezes ``cost_snapshot_json`` and emits
    ``rapport_submitted``. **A later board edit cannot change a filed rapport**
    (decision 6), which is the entire reason the snapshot exists.
    """
    report = await _get_or_create_report(db, incident.id, actor)
    provided = payload.model_fields_set
    was_draft = report.is_draft

    for field in (
        "kurzbericht",
        "handed_over_to",
        "owner_name",
        "owner_phone",
    ):
        if field in provided:
            setattr(report, field, getattr(payload, field))

    if "materials" in provided and payload.materials is not None:
        board_units, board_by_assignment = await _board_material_units(db, incident.id)
        ticks = {row.assignment_id: row for row in payload.materials}
        # Reconcile FIRST, then apply the ticks: a unit the KP added while the
        # crew was typing has to appear even though the payload knows nothing
        # about it, and one the board took away must not come back through a
        # stale form.
        merged = reconcile_materials(report.materials_json, board_units, board_by_assignment)
        for row in merged:
            tick = ticks.get(row["assignment_id"])
            if tick is None:
                continue
            row["used"] = bool(tick.used)
            row["left_on_site"] = False if row["consumable"] else bool(tick.left_on_site)
        # A unit that vanished from the board but was answered in THIS payload
        # keeps that answer — the reconciliation would otherwise have dropped a
        # row the crew just filled in. "Answered" means contradicting the board
        # (§18.32): a still-ticked `gebraucht` is the default, not a report.
        answered_ids = {row["assignment_id"] for row in merged}
        for assignment_id, tick in ticks.items():
            if assignment_id in answered_ids or assignment_id in board_by_assignment:
                continue
            if tick.used and not tick.left_on_site:
                continue
            merged.append(
                {
                    "assignment_id": assignment_id,
                    "material_id": None,
                    "name": "Unbekannt",
                    "location": None,
                    "consumable": False,
                    "used": bool(tick.used),
                    "left_on_site": bool(tick.left_on_site),
                    "on_board": False,
                }
            )
        report.materials_json = _jsonable_materials(merged)

    if "vehicles" in provided and payload.vehicles is not None:
        fleet = await _fleet_vehicles(db, incident)
        vehicle_ticks = {tick.vehicle_id: tick for tick in payload.vehicles}
        # Reconcile FIRST, then apply the ticks — same reason as the materials: a
        # vehicle the KP disponiert while the crew was typing has to appear, and
        # one it took away must not come back through a stale form.
        merged_vehicles = reconcile_vehicles(report.vehicles_json, fleet.dispatched, fleet.assigned_ids, fleet.names)
        for vehicle_row in merged_vehicles:
            vehicle_tick = vehicle_ticks.get(vehicle_row["vehicle_id"])
            if vehicle_tick is None:
                continue
            vehicle_row["present"] = bool(vehicle_tick.present)
        # A vehicle the board never sent but the crew TICKED in this payload —
        # the whole point of the search under the list — becomes a row here. An
        # unticked one carries nothing at all, so it is not written down.
        known_ids = {vehicle_row["vehicle_id"] for vehicle_row in merged_vehicles}
        fleet_names = fleet.names
        for vehicle_id, vehicle_tick in vehicle_ticks.items():
            if vehicle_id in known_ids or not vehicle_tick.present:
                continue
            merged_vehicles.append(
                {
                    "vehicle_id": vehicle_id,
                    "name": fleet_names.get(vehicle_id) or "Unbekannt",
                    "present": True,
                    "on_board": False,
                }
            )
        report.vehicles_json = _jsonable_vehicles(merged_vehicles)

    # "Weiteres gebrauchtes Material" (§18.35). Replaced wholesale when present:
    # the entries carry no id, so there is nothing a partial write could key on —
    # and unlike the two checklists above there is no board state to reconcile
    # against, because nothing here was ever dispatched.
    if "extra_materials" in provided:
        entries = normalize_extra_materials(
            [row.model_dump() for row in payload.extra_materials] if payload.extra_materials else []
        )
        report.extra_materials_json = entries or None

    # The crew list, reconciled first and then ticked — same shape and same
    # reasoning as the vehicles above. Somebody the board never sent but TICKED
    # in this payload becomes a row; an unticked one carries nothing at all.
    if "personnel" in provided and payload.personnel is not None:
        crew_offer = await _event_personnel(db, incident)
        crew_ticks = {tick.personnel_id: tick for tick in payload.personnel}
        merged_crew = reconcile_personnel(
            report.personnel_json, crew_offer.dispatched, crew_offer.assigned_ids, crew_offer.names
        )
        for crew_row in merged_crew:
            crew_tick = crew_ticks.get(crew_row["personnel_id"])
            if crew_tick is None:
                continue
            crew_row["present"] = bool(crew_tick.present)
        known_person_ids = {crew_row["personnel_id"] for crew_row in merged_crew}
        roster_names = crew_offer.names
        for personnel_id, crew_tick in crew_ticks.items():
            if personnel_id in known_person_ids or not crew_tick.present:
                continue
            merged_crew.append(
                {
                    # The roster's own spelling wins over the one the form sent:
                    # a phone can be a week behind a rename.
                    "name": roster_names.get(personnel_id) or crew_tick.name or "Unbekannt",
                    "personnel_id": personnel_id,
                    "present": True,
                    "on_board": False,
                }
            )
        report.personnel_json = _jsonable_personnel(merged_crew)

    # People on no roster of this station. Replaced wholesale when present, like
    # the extra material: the entries carry no id, so a partial write has nothing
    # to key on, and there is no board state to reconcile against.
    if "extra_personnel" in provided:
        report.extra_personnel_json = (
            normalize_extra_personnel(
                [row.model_dump() for row in payload.extra_personnel] if payload.extra_personnel else []
            )
            or None
        )

    # The head count follows from the two lists above rather than from a keyboard.
    # A value that differs from the board is stored AS corrected — the divergence
    # is itself information, it says the board was behind reality — and one that
    # matches clears the flag again.
    board_personnel = await _board_personnel_count(db, incident)
    if report.personnel_json is not None or report.extra_personnel_json:
        counted = derive_personnel_count(
            [dict(row) for row in (report.personnel_json or [])],
            normalize_extra_personnel(report.extra_personnel_json),
        )
        report.personnel_count = counted
        report.personnel_count_corrected = counted != board_personnel
    elif "personnel_count" in provided:
        # A client that still speaks the old shape (a phone replaying a queued
        # payload, the training seeder) keeps working: the number is taken as-is.
        report.personnel_count = payload.personnel_count
        report.personnel_count_corrected = (
            payload.personnel_count is not None and payload.personnel_count != board_personnel
        )

    submitting = payload.is_draft is False
    if submitting:
        report.is_draft = False
        if report.submitted_at is None:
            report.submitted_at = datetime.now(UTC)
        # Frozen once. Re-submitting an amended rapport must not silently
        # re-derive the counts from a board that has moved on since.
        if report.cost_snapshot_json is None:
            report.cost_snapshot_json = await _build_cost_snapshot(db, incident.id)
        if report.personnel_count is None:
            report.personnel_count = board_personnel
        # A rapport filed without the crew touching the vehicle list still has to
        # record which vehicles the board had — the all-ticked prefill IS the
        # answer, so it gets frozen into the row rather than staying implicit.
        if report.vehicles_json is None:
            fleet = await _fleet_vehicles(db, incident)
            report.vehicles_json = _jsonable_vehicles(
                reconcile_vehicles(None, fleet.dispatched, fleet.assigned_ids, fleet.names)
            )
        # …and the same for the crew, for the same reason: the ticked prefill IS
        # the answer of a crew that read the list and found nothing to correct.
        if report.personnel_json is None:
            crew_offer = await _event_personnel(db, incident)
            report.personnel_json = _jsonable_personnel(
                reconcile_personnel(None, crew_offer.dispatched, crew_offer.assigned_ids, crew_offer.names)
            )
            report.personnel_count = derive_personnel_count(
                [dict(row) for row in report.personnel_json],
                normalize_extra_personnel(report.extra_personnel_json),
            )

    _stamp_updated_by(report, actor)

    await log_action(
        db=db,
        # `rapport_submitted` marks the draft→filed transition and nothing else.
        # The KP mount autosaves with `is_draft: false`, so keying the action on
        # `submitting` alone would write a "Rapport erfasst" journal entry every
        # few seconds while an operator types. Same condition as the
        # notification below, for the same reason.
        action_type="rapport_submitted" if (submitting and was_draft) else "rapport_saved",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        # Deliberately no owner_* and no free text: the audit log is read by
        # everyone with an account, and the owner block is citizen PII (§9).
        changes={
            "is_draft": report.is_draft,
            "source": "feld" if actor.is_field else "kp",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(report)

    # Field crews only: a rapport typed at the KP itself (the board mount
    # autosaves with `is_draft: false`) must not ring the KP's own bell — the
    # operator would be toasting themselves. The audit entry above keeps the
    # kp/feld provenance either way.
    if submitting and was_draft and incident.event_id and actor.is_field:
        await create_field_notification(
            db,
            notification_type="rapport_submitted",
            incident_id=incident.id,
            event_id=incident.event_id,
            message=f"Rapport erfasst: {await _location(db, incident)}{actor.suffix}",
        )
    await _broadcast(incident)

    return await get_rapport(db, incident, actor=actor)


# ============================================
# Fotos (phase 3) — one implementation, two doors
# ============================================
#
# The crew photographs the cellar; the KP attaches the photo that arrived by
# WhatsApp (§6.1). Same storage as the Reko form (`services/photo_storage.py`),
# same files on disk, same `GET /api/photos/{incident_id}/{filename}` to read
# them back — only the door differs, and the two doors stay separate: a feld
# token does not open the Reko photo endpoints and a Reko form token does not
# open these (that is asserted in the tests, not left to review).


async def add_photo(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    file: UploadFile,
    request: Request | None = None,
) -> list[str]:
    """Attach a photo to the Schadenplatz-Rapport; returns the new list.

    Creates the report row if there is none — a photo is field contact, the same
    way "Angekommen" is, and it must not need a form to exist first. The row is
    created as a draft (``is_draft`` defaults True), so an incident that only has
    photos still counts as "kein Rapport" in the Restliste.
    """
    report = await _get_or_create_report(db, incident.id, actor)
    filename = await photo_storage.save_photo(
        incident_id=incident.id,
        file=file,
        current_photos=report.photos_json,
    )
    report.photos_json = [*(report.photos_json or []), filename]
    _stamp_updated_by(report, actor)

    await log_action(
        db=db,
        action_type="rapport_photo_added",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "filename": filename,
            "source": "feld" if actor.is_field else "kp",
            "personnel_name": actor.personnel_name,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(report)
    await _broadcast(incident)
    return list(report.photos_json or [])


async def remove_photo(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: FieldActor,
    filename: str,
    request: Request | None = None,
) -> list[str]:
    """Detach a photo; returns the remaining list. 404 if it was never on it.

    The row is dropped from ``photos_json`` even when the file has already gone
    from disk — a record pointing at a missing file is worse than no record.
    """
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    current = list(report.photos_json or []) if report else []
    if report is None or filename not in current:
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")

    photo_storage.delete_photo(incident.id, filename)
    report.photos_json = [name for name in current if name != filename]
    _stamp_updated_by(report, actor)

    await log_action(
        db=db,
        action_type="rapport_photo_removed",
        resource_type="incident",
        resource_id=incident.id,
        user=actor.user,
        changes={
            "filename": filename,
            "source": "feld" if actor.is_field else "kp",
            "personnel_name": actor.personnel_name,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(report)
    await _broadcast(incident)
    return list(report.photos_json or [])
