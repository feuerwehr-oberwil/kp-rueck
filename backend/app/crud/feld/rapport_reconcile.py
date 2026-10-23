"""The Schadenplatz-Rapport's pure half: reconcile the board's rows with the crew's answers.

`reconcile_materials` / `_vehicles` / `_personnel` merge what the board dispatched with what a
saved Rapport says, the `normalize_*` helpers clean the free «weitere» rows, and the
`_jsonable_*` ones shape the answers for the JSON columns. Plain functions over rows – no
session, no I/O – so they are unit-testable on their own; `rapport.py` is the database half
(read, save, photos) that calls them.
"""

import uuid
from collections.abc import Mapping
from typing import Any


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
