"""Two-way sync of the Ereignisse a standby box has led: a three-way merge, one Ereignis at a time.

The box mirrors the hosted board through logical replication (app/standby.py). An Ereignis that
somebody takes over on the box leaves that stream for good (`standby.detached_events`) and is
synced by this module instead, both ways, by the box's sidecar every few seconds:

- it reads the Ereignis's rows on both systems – the hosted side through the replication login,
  read-only – and the last state both agreed on (`standby.shadow`);
- per row and column: a change only one side made is taken; where both changed the same column,
  the system that leads (`event_leads`, the later takeover) wins and the other value goes to
  `event_conflicts`; a new row from either side is added; a deletion is taken unless the other
  side changed the row meanwhile – then the leader decides, and the losing side is a conflict;
- it writes the result to both: locally directly, to the hosted board through
  `POST /api/standby/sync` (a token, app/api/standby.py), which runs the same `apply_ops`.

Every op carries the row it expects to replace; one that finds something else is left for the
next round, which reads again. State, not a log: a round that dies halfway is simply repeated.
Nothing is dropped without a word – an op that cannot be applied stays pending (the band counts
it) and is logged.

Columns that are bookkeeping (`updated_at`, `last_activity_at`) take the later value and never
clash. Identity columns (`journal_entries.seq`) are each system's own and never travel. The
bell has two rules of its own, for the seconds in which both systems still poll it: a GPS
question both asked is asked once (`_ask_gps_once`), and a row dismissed on one side stands as
it was dismissed there – a time-on-duty warning with the people it named (`_as_dismissed`).

The merge itself (`merge`, `settle_lead`) is pure; `sync_event` is the round around it.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import partial
from typing import Any

import asyncpg

from .ereignis_lock import LOCK_SQL, ereignis_lock_keys
from .standby import SKIPPED_TABLES, event_links

logger = logging.getLogger(__name__)

HOSTED = "hosted"
STANDBY = "standby"
LEADS = "event_leads"
CONFLICTS = "event_conflicts"

# Both systems stamp these on every write; the later one is right, and it is never a clash.
BOOKKEEPING = frozenset({"updated_at", "last_activity_at"})
# The share-link generations on `events` (services/share_links.py). One number holds two
# counters: the hosted board counts its revokes in the upper half, a standby box in the lower
# half. Each system only ever raises its own half, so a merge takes the higher of each half
# (`merge_link_generations`): a revoke made on either side while they were apart survives, and
# a link issued on either side before the other's revoke no longer matches. No clock involved.
LINK_GENERATIONS = frozenset({"checkin_link_generation", "viewer_link_generation", "alarm_link_generation"})
LINK_REVOKE_STEP = {HOSTED: 1 << 16, STANDBY: 1}


def merge_link_generations(a: int, b: int) -> int:
    """The higher hosted count and the higher standby count of two generation numbers."""
    return max(a >> 16, b >> 16) << 16 | max(a & 0xFFFF, b & 0xFFFF)


# Unique indexes that say «this is the same thing twice»: the same person checked in or driving
# the same function, the same resource on the same Einsatz or Auftrag, the same phone request or
# Tagebuch entry, the one open Abholung, the Einsatz's one Schadenplatz-Rapport, the same alarm. A
# new row from the other side that hits one is a copy: the leader's stays, the copy is removed
# where it came from and listed as a conflict with its full content. Unnamed constraints differ
# between a migrated database (`…_key`) and `create_all` (`ix_…`), so both names are here.
#
# Every other unique index – a stop's place in its Auftrag, the one Einsatzleiter, a vehicle's one
# driver, one added later – is a clash between two real things and never deletes anything: the
# merge moves a stop to the next free place and keeps the second leader as crew (`_settle_slots`);
# what it cannot settle is held on its side, counted as pending, until somebody changes one of them.
SAME_THING = frozenset(
    {
        "unique_event_personnel_attendance",
        "unique_personnel_function_assignment",
        "uq_assignments_active_resource",
        "uq_group_assignments_active_resource",
        "field_requests_client_request_id_key",
        "uq_field_requests_open_pickup",
        "uq_journal_event_client_id",
        "uq_schadenplatz_report_incident",
        "uq_divera_emergencies_source_source_id",
        "divera_emergencies_divera_id_key",
        "ix_divera_emergencies_divera_id",
    }
)

# Missing from a row: the other system's schema has a column this one does not (yet).
_MISSING = object()

Row = dict[str, Any]
Key = tuple[str, str]  # (table, id)
Rows = dict[Key, Row]


@dataclass(frozen=True)
class Table:
    """One table whose rows belong to an Ereignis, as this database's catalogue has it."""

    name: str
    key: str  # the single key column a row is matched by on both systems (`id`; `event_id` for the lead)
    where: str  # SQL on alias `r`: the row belongs to the Ereignis `$1`
    columns: tuple[str, ...]  # everything that travels – identity columns excluded
    skip: tuple[str, ...]  # identity columns: each system's own
    text: frozenset[str]  # free-text columns (type text), which «Beide zusammen» can join

    @property
    def row_sql(self) -> str:
        """The row as JSON without its identity columns – what is compared, hashed and sent."""
        skip = ", ".join(f"'{c}'" for c in self.skip)
        return f"(to_jsonb(r) - ARRAY[{skip}]::text[])" if skip else "to_jsonb(r)"


async def event_tables(conn: asyncpg.Connection) -> dict[str, Table]:
    """Every table whose rows belong to an Ereignis, read from the live catalogue.

    The same discovery as the replication guards (`event_links`), so a table a later migration
    adds is synced the moment it exists. Each must have a single uuid key – the one a row is
    matched by on both systems; anything else is a schema this sync does not understand, and it
    says so instead of guessing.
    """
    links = await event_links(conn)
    cols = await conn.fetch(
        """
        SELECT table_name, column_name, data_type, is_identity FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position
        """
    )
    keys = {
        r["tbl"]: r["cols"]
        for r in await conn.fetch(
            """
            SELECT c.relname AS tbl, array_agg(a.attname::text) AS cols
            FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
            WHERE i.indisprimary AND c.relnamespace = 'public'::regnamespace GROUP BY c.relname
            """
        )
    }
    by_table: dict[str, list[asyncpg.Record]] = {}
    for c in cols:
        by_table.setdefault(c["table_name"], []).append(c)
    tables: dict[str, Table] = {}
    for name, link in links.items():
        if name in SKIPPED_TABLES:
            continue
        key = keys.get(name, [])
        if len(key) != 1:
            raise ValueError(f"{name}: an Ereignis table needs a single key column to be synced")
        columns = by_table[name]
        tables[name] = Table(
            name=name,
            key=key[0],
            where=f"({link.replace('{row}', 'r')}) = $1",
            columns=tuple(c["column_name"] for c in columns if c["is_identity"] != "YES"),
            skip=tuple(c["column_name"] for c in columns if c["is_identity"] == "YES"),
            # Not varchar: those are codes and short names (status, priority, colour) that two
            # values on two lines would break.
            text=frozenset(c["column_name"] for c in columns if c["data_type"] == "text"),
        )
    return tables


# --- reading ---------------------------------------------------------------------------------


async def table_hashes(conn: asyncpg.Connection, tables: dict[str, Table], event_id: uuid.UUID) -> dict[str, str]:
    """One hash per table over the Ereignis's rows – cheap enough to ask every few seconds."""
    parts = [
        f"SELECT '{t.name}' AS tbl, md5(string_agg({t.row_sql}::text, ',' ORDER BY r.{t.key})) AS h "  # noqa: S608
        f"FROM public.{t.name} r WHERE {t.where}"
        for t in tables.values()
    ]
    rows = await conn.fetch(" UNION ALL ".join(parts), event_id)
    return {r["tbl"]: r["h"] or "" for r in rows}


async def fetch_rows(conn: asyncpg.Connection, table: Table, event_id: uuid.UUID) -> tuple[Rows, dict[Key, str]]:
    """The Ereignis's rows of one table: parsed, and as the database writes them (for the shadow)."""
    records = await conn.fetch(
        f"SELECT r.{table.key}::text AS id, {table.row_sql}::text AS row FROM public.{table.name} r WHERE {table.where}",  # noqa: S608
        event_id,
    )
    raw = {(table.name, r["id"]): r["row"] for r in records}
    return {k: json.loads(v) for k, v in raw.items()}, raw


async def shadow_hashes(conn: asyncpg.Connection, event_id: uuid.UUID) -> dict[str, str]:
    """The same hash as `table_hashes`, over the last state both systems agreed on."""
    rows = await conn.fetch(
        "SELECT tbl, md5(string_agg(row::text, ',' ORDER BY id)) AS h FROM standby.shadow WHERE event_id = $1 GROUP BY tbl",
        event_id,
    )
    return {r["tbl"]: r["h"] or "" for r in rows}


async def shadow_rows(conn: asyncpg.Connection, event_id: uuid.UUID, tables: Iterable[str]) -> Rows:
    rows = await conn.fetch(
        "SELECT tbl, id::text AS id, row::text AS row FROM standby.shadow WHERE event_id = $1 AND tbl = ANY($2::text[])",
        event_id,
        list(tables),
    )
    return {(r["tbl"], r["id"]): json.loads(r["row"]) for r in rows}


async def snapshot(conn: asyncpg.Connection, event_id: uuid.UUID) -> int:
    """Record the Ereignis as it is now as the state both systems agree on – at the takeover.

    Right then the box holds what it last mirrored, which is what the hosted board had. Only
    once, if the Ereignis has no shadow yet: a second takeover after the hosted board took it
    back continues from the state the sync has kept since.
    """
    if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM standby.shadow WHERE event_id = $1)", event_id):
        return 0
    count = 0
    for table in (await event_tables(conn)).values():
        if table.name == LEADS:
            continue
        count += len(
            await conn.fetch(
                f"INSERT INTO standby.shadow (event_id, tbl, id, row) "  # noqa: S608
                f"SELECT $1, '{table.name}', r.{table.key}, {table.row_sql} FROM public.{table.name} r WHERE {table.where} "
                "RETURNING id",
                event_id,
            )
        )
    return count


# --- the merge (pure) ------------------------------------------------------------------------


@dataclass
class Op:
    """One write: `row` (None = delete) where the target holds `expected` (None = nothing)."""

    table: str
    id: str
    row: Row | None
    expected: Row | None
    required: bool = False

    def to_json(self) -> dict[str, Any]:
        return {
            "table": self.table,
            "id": self.id,
            "row": self.row,
            "expected": self.expected,
            "required": self.required,
        }

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> Op:
        return cls(raw["table"], raw["id"], raw.get("row"), raw.get("expected"), bool(raw.get("required")))


@dataclass
class Plan:
    """What one round writes: to the leading system, to the other one, and the agreed result."""

    to_leader: list[Op] = field(default_factory=list)
    to_follower: list[Op] = field(default_factory=list)
    merged: dict[Key, Row | None] = field(default_factory=dict)
    conflicts: int = 0


def settle_lead(local: Row | None, remote: Row | None) -> Row | None:
    """The later takeover leads. No row on either side: the hosted board, as always."""
    if local is None or remote is None:
        return local or remote
    if local["since"] == remote["since"]:
        return remote if remote["holder"] == HOSTED else local
    return local if _later(local["since"], remote["since"]) else remote


def _later(a: str, b: str) -> bool:
    return datetime.fromisoformat(a) > datetime.fromisoformat(b)


def _merge_row(base: Row, lead: Row, other: Row) -> tuple[Row, dict[str, dict[str, Any]]]:
    """Column by column: a change only one side made is taken; both changed it → the leader's."""
    merged: Row = {}
    clashes: dict[str, dict[str, Any]] = {}
    for col in dict.fromkeys([*lead, *other]):
        b, m, t = base.get(col, _MISSING), lead.get(col, _MISSING), other.get(col, _MISSING)
        if m is _MISSING or t is _MISSING:
            merged[col] = t if m is _MISSING else m  # a column only one schema has: never a clash
        elif m == t:
            merged[col] = m
        elif col in BOOKKEEPING:
            merged[col] = m if t is None or (m is not None and _later(m, t)) else t
        elif col in LINK_GENERATIONS:
            merged[col] = merge_link_generations(m, t)
        elif m == b:
            merged[col] = t
        elif t == b:
            merged[col] = m
        else:
            merged[col] = m
            clashes[col] = {"kept": m, "lost": t}
    return merged, clashes


# A bell row's dismissal, and what the time-on-duty warning names
# (services/notification_service._sync_fatigue_notification).
DISMISSAL = ("dismissed", "dismissed_at", "dismissed_by")
FATIGUE_NAMED = ("message", "params", "subject_keys")


def _as_dismissed(base: Row, lead: Row, other: Row) -> tuple[Row, Row]:
    """A bell row dismissed on one side stands as that side dismissed it, whole.

    Until a system has applied the other's takeover, both poll the bell, and a sync close
    (`_ask_gps_once`) can meet a dismissal. Column by column, two dismissals clashed, and a row
    the shadow misses (a round that died before it) clashed in every column. So, of two versions
    of a `notifications` row not yet dismissed in the shadow, the one that stands is the
    dismissed one, else an operator's dismissal (`dismissed_by`) over an automatic one; nothing
    reopens a bell row. Its dismissal columns win as a whole – and, for a time-on-duty warning,
    the people it named: dismissing it acknowledges exactly its `subject_keys`, and somebody
    the other side added meanwhile must not be acknowledged unseen. That side's next poll warns
    again. Returns `lead`, `other` as `_merge_row` is to see them.
    """
    if base.get("dismissed"):
        return lead, other
    stands = _dismissal_that_stands(lead, other)
    if stands is None:
        return lead, other
    columns = DISMISSAL + (FATIGUE_NAMED if stands.get("type") == "personnel_fatigue" else ())
    taken = {col: stands[col] for col in columns if col in stands}
    return {**lead, **taken}, {**other, **taken}


def _dismissal_that_stands(lead: Row, other: Row) -> Row | None:
    """The one of two bell-row versions whose dismissal wins; None: neither, or both alike."""
    if bool(lead.get("dismissed")) != bool(other.get("dismissed")):
        return lead if lead.get("dismissed") else other
    if lead.get("dismissed") and (lead.get("dismissed_by") is None) != (other.get("dismissed_by") is None):
        return lead if lead.get("dismissed_by") is not None else other
    return None


def merge(
    base: Rows,
    lead: Rows,
    other: Rows,
    *,
    event_id: str,
    leader: str,
    takeover: str,
    now: str,
    text_columns: dict[str, frozenset[str]] | None = None,
) -> Plan:
    """Merge one Ereignis. `lead`/`other` are the leading and the other system's rows.

    Keys absent everywhere are ignored, so callers may pass only the tables that changed.
    `takeover` is the lead's `since` – which takeover this round belongs to (see `conflict_row`).
    `text_columns` marks which clashing columns «Beide zusammen» can join.
    """
    plan = Plan()
    follower = STANDBY if leader == HOSTED else HOSTED

    def conflict(table: str, row_id: str, kind: str, **facts: Any) -> None:
        row = conflict_row(
            table,
            row_id,
            kind,
            event_id=event_id,
            leader=leader,
            takeover=takeover,
            now=now,
            lead=lead,
            other=other,
            **facts,
        )
        if _recorded(row["id"], lead, other):
            return
        plan.merged[(CONFLICTS, row["id"])] = row
        plan.to_leader.append(Op(CONFLICTS, row["id"], row, None))
        plan.to_follower.append(Op(CONFLICTS, row["id"], row, None))
        plan.conflicts += 1

    for key in sorted(set(base) | set(lead) | set(other)):
        table, row_id = key
        if table == LEADS:
            continue
        b, m, t = base.get(key), lead.get(key), other.get(key)
        if m == t:
            plan.merged[key] = m
            continue
        if b is None:  # new on one side (or, by chance, both)
            if m is None:
                plan.merged[key] = t
                plan.to_leader.append(Op(table, row_id, t, None))
                continue
            if t is None:
                plan.merged[key] = m
                plan.to_follower.append(Op(table, row_id, m, None))
                continue
            b = {}
        if m is None or t is None:  # deleted on one side
            survivor = t if m is None else m
            if survivor == b:  # the other side did not touch it: the deletion stands
                plan.merged[key] = None
                if m is None:
                    plan.to_follower.append(Op(table, row_id, None, t))
                else:
                    plan.to_leader.append(Op(table, row_id, None, m))
                continue
            # Changed on one side, deleted on the other: the leader's way stands.
            if t is not None:  # the leader deleted it
                plan.merged[key] = None
                plan.to_follower.append(Op(table, row_id, None, t))
                conflict(table, row_id, "deleted", deleted_on=leader, row=t, lost_at=t.get("updated_at"))
            else:  # the other side deleted it: it stays, there too
                plan.merged[key] = m
                plan.to_follower.append(Op(table, row_id, m, None))
                conflict(table, row_id, "deleted", deleted_on=follower, row=m)
            continue
        merged, clashes = _merge_row(b, *(_as_dismissed(b, m, t) if table == "notifications" else (m, t)))
        plan.merged[key] = merged
        if merged != m:
            plan.to_leader.append(Op(table, row_id, merged, m))
        if merged != t:
            plan.to_follower.append(Op(table, row_id, merged, t))
        if clashes:
            joinable = (text_columns or {}).get(table, frozenset())
            for col, values in clashes.items():
                values["text"] = col in joinable
            conflict(table, row_id, "field", columns=clashes, row=merged, lost_at=t.get("updated_at"))

    _renumber(plan, base, lead, other, event_id=event_id, now=now)
    _settle_slots(plan, lead, other, conflict)
    _ask_gps_once(plan, base, lead, other, now=now)
    return plan


def conflict_row(
    table: str,
    row_id: str,
    kind: str,
    *,
    event_id: str,
    leader: str,
    takeover: str,
    now: str,
    lead: Rows,
    other: Rows,
    row: Row | None = None,
    **facts: Any,
) -> Row:
    """An `event_conflicts` row. `row` is the version that did not survive (`field`: the merged one).

    Its id is derived from WHAT clashed and in which takeover (`takeover`, the lead's `since`),
    not from when it was noticed: a clash whose losing write keeps failing is found again every
    round, and must be the same row each time. The same clash in a later takeover is new – the
    decided one from an earlier outage must not swallow it.
    """
    what = json.dumps(
        [facts.get("columns"), facts.get("deleted_on"), None if kind == "field" else row],
        sort_keys=True,
        default=str,
    )
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"kp-conflict:{takeover}:{table}:{row_id}:{kind}:{what}")),
        "event_id": event_id,
        "table_name": table,
        "row_id": row_id,
        "kind": kind,
        "kept_on": leader,
        "deleted_on": None,
        "columns": None,
        "row": None if kind == "field" else row,
        "subject": _subject(table, row or {}, lead, other),
        "lost_at": None,
        "detected_at": now,
        "resolved_at": None,
        "resolved_by": None,
        "resolution": None,
        **facts,
    }


def _recorded(conflict_id: str, lead: Rows, other: Rows) -> bool:
    """This very clash is already in the list (open or decided) – it is not reported twice."""
    key = (CONFLICTS, conflict_id)
    return key in lead or key in other


def _subject(table: str, row: Row, lead: Rows, other: Rows) -> Row | None:
    """The Einsatz a conflicting row belongs to, for its label: number and address."""
    incident = row if table == "incidents" else None
    if incident is None and row.get("incident_id"):
        key = ("incidents", row["incident_id"])
        incident = lead.get(key) or other.get(key)
    if incident is None:
        return None
    return {
        "incident_id": incident.get("id"),
        "number": incident.get("number"),
        "address": incident.get("location_address"),
    }


def _renumber(plan: Plan, base: Rows, lead: Rows, other: Rows, *, event_id: str, now: str) -> None:
    """An Einsatz the other system created in the gap may carry a number the leader also gave out.

    It gets the next free number on both systems, and a Tagebuch line says so – crews may have
    heard the old one on the radio.
    """
    incidents = {k: r for k, r in plan.merged.items() if k[0] == "incidents" and r is not None}
    from_other = [k for k in incidents if k not in base and k not in lead and k in other]
    if not from_other:
        return
    taken = {r.get("number") for k, r in incidents.items() if k not in from_other}
    for key in sorted(from_other, key=lambda k: incidents[k].get("created_at") or ""):
        row = incidents[key]
        old = row.get("number")
        if old not in taken:
            taken.add(old)
            continue
        new = max(n for n in taken | {old} if isinstance(n, int)) + 1
        taken.add(new)
        row = {**row, "number": new}
        plan.merged[key] = row
        # The insert to the leader now carries the new number; the other system renumbers its own.
        plan.to_leader = [op if (op.table, op.id) != key else Op(op.table, op.id, row, None) for op in plan.to_leader]
        plan.to_follower.append(Op("incidents", key[1], row, other[key]))
        line = _journal_line(
            event_id,
            row["id"],
            f"Einsatz {old} heisst jetzt {new}: beide Systeme hatten während der Trennung die Nummer {old} vergeben.",
            now,
        )
        plan.merged[("journal_entries", line["id"])] = line
        plan.to_leader.append(Op("journal_entries", line["id"], line, None))
        plan.to_follower.append(Op("journal_entries", line["id"], line, None))


Conflict = Callable[..., None]


def _settle_slots(plan: Plan, lead: Rows, other: Rows, conflict: Conflict) -> None:
    """Two rows the systems put into the same one-per-something slot in the gap. Both stay.

    The phone adds a stop as an Auftrag's first, the box does too (`uq_incidents_group_position_active`);
    each names an Einsatzleiter for the same Einsatz (`uq_…_single_leader`). Neither is a copy of
    the other, so neither is deleted: the leader's row keeps the slot, the other stop moves to the
    Auftrag's next free place, the other leader stays in the crew – and that one is a conflict.
    """
    for key, row in _slot_losers(plan, lead, "incidents", _stop_slot):
        group = [
            r for k, r in plan.merged.items() if k[0] == "incidents" and r and r.get("group_id") == row["group_id"]
        ]
        free = 1 + max(r.get("group_position") or 0 for r in group)
        _replace(plan, lead, other, key, {**row, "group_position": free})
    for table, parent in (("incident_assignments", "incident_id"), ("incident_group_assignments", "incident_group_id")):
        for key, row in _slot_losers(plan, lead, table, partial(_leader_slot, parent=parent)):
            fixed = {**row, "is_leader": False}
            _replace(plan, lead, other, key, fixed)
            conflict(
                table, key[1], "field", columns={"is_leader": {"kept": False, "lost": True, "text": False}}, row=fixed
            )


def _stop_slot(row: Row) -> Any:
    return (
        (row["group_id"], row.get("group_position")) if row.get("group_id") and row.get("deleted_at") is None else None
    )


def _leader_slot(row: Row, parent: str) -> Any:
    return row.get(parent) if row.get("is_leader") and row.get("unassigned_at") is None else None


def _slot_losers(plan: Plan, lead: Rows, table: str, slot: Callable[[Row], Any]) -> list[tuple[Key, Row]]:
    """The merged rows of `table` that find their slot taken: the leader's version holds it first."""
    rows = [(k, r) for k, r in plan.merged.items() if k[0] == table and r is not None and slot(r) is not None]
    rows.sort(key=lambda kr: (kr[0] not in lead or slot(lead[kr[0]]) != slot(kr[1]), kr[0][1]))
    held: set[Any] = set()
    losers = []
    for key, row in rows:
        if slot(row) in held:
            losers.append((key, row))
        held.add(slot(row))
    return losers


# The bell's GPS questions («Zu erledigen», services/notification_service.create_gps_todo).
GPS_TODOS = frozenset({"gps_arrival", "gps_release"})


def _ask_gps_once(plan: Plan, base: Rows, lead: Rows, other: Rows, *, now: str) -> None:
    """One GPS question both systems raised in the seconds before their lead rows agreed.

    Each system keeps one open row per Ereignis, type and `params.key` (`create_gps_todo`), but
    sees only its own, so both may ask. The copy that stays: one both systems hold or that is
    agreed (in the shadow), else the leader's; the lower id among equals.

    - A copy held by one side alone is deleted there.
    - A copy both hold is closed on both instead, like the bell's own auto-resolve (`dismissed`,
      no `dismissed_by`). Deleted on one side while somebody dismissed it on the other, the next
      round would take the deletion. Copies like this are left from before this rule existed.

    Every op carries the row it expects, so a copy dismissed meanwhile is `changed`; the next
    round finds it dismissed there and closed here, and the operator's dismissal stands
    (`_as_dismissed`). Only open rows count; a dismissed one is never touched.
    """

    def shared(key: Key) -> bool:
        return key in base or (key in lead and key in other)

    asked: set[tuple[Any, ...]] = set()
    rows = sorted(
        (
            (k, r)
            for k, r in plan.merged.items()
            if k[0] == "notifications"
            and r is not None
            and r.get("type") in GPS_TODOS
            and not r.get("dismissed")
            and (r.get("params") or {}).get("key")
        ),
        key=lambda kr: (not shared(kr[0]), kr[0] not in lead, kr[0][1]),
    )
    for key, row in rows:
        question = (row.get("event_id"), row["type"], row["params"]["key"])
        if question in asked:
            closed = {**row, "dismissed": True, "dismissed_at": now, "dismissed_by": None}
            _replace(plan, lead, other, key, closed if shared(key) else None)
        asked.add(question)


def _replace(plan: Plan, lead: Rows, other: Rows, key: Key, row: Row | None) -> None:
    """`row` (None: gone) is now the agreed version of `key`: each side gets exactly one op for it, if any."""
    plan.merged[key] = row
    plan.to_leader = _retarget(plan.to_leader, key, row, lead.get(key))
    plan.to_follower = _retarget(plan.to_follower, key, row, other.get(key))


def _retarget(ops: list[Op], key: Key, row: Row | None, current: Row | None) -> list[Op]:
    kept = [op for op in ops if (op.table, op.id) != key]
    return kept if current == row else [*kept, Op(key[0], key[1], row, current)]


def _journal_line(event_id: str, incident_id: str | None, text: str, now: str) -> Row:
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"kp-journal:{incident_id}:{text}")),
        "event_id": event_id,
        "incident_id": incident_id,
        "kind": "incident",
        "text": text,
        "data": None,
        "occurred_at": now,
        "created_at": now,
        "author_name": "Synchronisation",
        "created_by": None,
        "corrects_id": None,
        "client_id": None,
        "source_key": None,
    }


# --- writing (both systems) ------------------------------------------------------------------


async def lock_ereignis(conn: asyncpg.Connection, *event_ids: uuid.UUID | str | None) -> None:
    """``crud.locking.lock_ereignis`` for a bare asyncpg connection (the sidecar, the box's
    routes): the Ereignis locks, sorted, to the end of the transaction – before any other lock."""
    for key in ereignis_lock_keys(event_ids):
        await conn.execute(LOCK_SQL, key)


class OpRefusedError(Exception):
    """An op that would write outside its Ereignis – never applied, on either system."""


async def apply_ops(
    conn: asyncpg.Connection, tables: dict[str, Table], event_id: uuid.UUID, ops: list[Op]
) -> list[str]:
    """Apply ops in the caller's transaction, each in its own savepoint. One result per op:

    - `ok`: written (or a delete that found nothing to delete);
    - `changed`: the target no longer holds `expected` – the next round reads again;
    - `held`: a key it needs is not there yet (the roster has not mirrored, a swap of positions),
      or this side's schema refuses the row (logged, not retried within the call);
    - `duplicate`: a new row is a copy of a different row – the same thing twice (`SAME_THING`);
      a new row that clashes on any other unique index is `held`, never a duplicate;
    - `refused`: unknown table, or a row of another Ereignis.

    Ops that fail on a missing key are retried until a pass gets nowhere, so parents may come
    after their children in the list.

    Each op takes the Ereignis lock first (`lock_ereignis`), in its own transaction: on the box
    that is a savepoint of the round's transaction, which holds the lock from its first op on;
    on the hosted board (`POST /api/standby/sync`) each op is a transaction of its own, so a
    batch holds no row – a person an attendance row key-shares – while the next op waits.
    """
    results: list[str] = ["refused"] * len(ops)
    todo = list(range(len(ops)))
    while todo:
        again: list[int] = []
        for i in todo:
            op = ops[i]
            table = tables.get(op.table)
            if table is None:
                continue
            try:
                async with conn.transaction():
                    await lock_ereignis(conn, event_id)
                    results[i] = await _apply_one(conn, table, event_id, op)
            except OpRefusedError:
                results[i] = "refused"
            except asyncpg.ForeignKeyViolationError:
                results[i] = "held"
                again.append(i)
            except asyncpg.UniqueViolationError as exc:
                copy = op.expected is None and exc.constraint_name in SAME_THING
                results[i] = "duplicate" if copy else "held"
                again.append(i)
            except (asyncpg.IntegrityConstraintViolationError, asyncpg.DataError) as exc:
                # A row this side's schema will not take (a CHECK or NOT NULL the other
                # version does not have): it stays pending and is named, instead of failing
                # the whole batch – and with it the Ereignis's sync – every round.
                results[i] = "held"
                logger.warning("standby sync: %s/%s cannot be written here yet: %s", op.table, op.id, exc)
        if len(again) == len(todo):
            break
        todo = again
    return results


async def _apply_one(conn: asyncpg.Connection, table: Table, event_id: uuid.UUID, op: Op) -> str:
    name = table.name
    current_raw = await conn.fetchval(
        f"SELECT {table.row_sql}::text FROM public.{name} r WHERE r.{table.key} = $1::uuid FOR UPDATE",  # noqa: S608
        op.id,
    )
    current = json.loads(current_raw) if current_raw else None
    if current is not None and not await _belongs(conn, table, event_id, op.id):
        raise OpRefusedError
    if op.row is None:
        if current is None:
            return "ok"
        if current != op.expected:
            return "changed"
        await conn.execute(f"DELETE FROM public.{name} WHERE {table.key} = $1::uuid", op.id)  # noqa: S608  # nosec B608 – table and columns from event_tables(), not from the op
        return "ok"
    if current != op.expected:
        return "changed"
    columns = [c for c in table.columns if c in op.row]
    names = ", ".join(f'"{c}"' for c in columns)
    payload = json.dumps(op.row)
    if current is None:
        await conn.execute(
            f"INSERT INTO public.{name} ({names}) SELECT {names} FROM jsonb_populate_record(NULL::public.{name}, $1::jsonb)",  # noqa: S608  # nosec B608 – table and columns from event_tables(), not from the op
            payload,
        )
    else:
        sets = ", ".join(f'"{c}" = s."{c}"' for c in columns if c != table.key)
        await conn.execute(
            f"UPDATE public.{name} t SET {sets} FROM jsonb_populate_record(NULL::public.{name}, $1::jsonb) s "  # noqa: S608  # nosec B608 – table and columns from event_tables(), not from the op
            f"WHERE t.{table.key} = $2::uuid",
            payload,
            op.id,
        )
    if not await _belongs(conn, table, event_id, op.id):
        raise OpRefusedError
    return "ok"


async def _belongs(conn: asyncpg.Connection, table: Table, event_id: uuid.UUID, row_id: str) -> bool:
    found: bool = await conn.fetchval(
        f"SELECT EXISTS (SELECT 1 FROM public.{table.name} r WHERE r.{table.key} = $2::uuid AND {table.where})",  # noqa: S608
        event_id,
        row_id,
    )
    return found


# --- one round ---------------------------------------------------------------------------------


Push = Callable[[uuid.UUID, list[Op], int], Awaitable[list[str]]]


@dataclass
class RoundResult:
    """What one round did for one Ereignis – the sidecar's report and the band's numbers."""

    leader: str
    pending: int
    reached: bool
    written_here: int = 0
    written_there: int = 0
    conflicts: int = 0
    held: list[str] = field(default_factory=list)


class LeadMovedError(Exception):
    """The hosted board's takeover row changed between reading and writing – read again."""


async def pending_changes(local: asyncpg.Connection, tables: dict[str, Table], event_id: uuid.UUID) -> int:
    """How many rows the box changed that the hosted board does not have yet."""
    mine, agreed = await table_hashes(local, tables, event_id), await shadow_hashes(local, event_id)
    changed = [t for t in tables if t != LEADS and mine.get(t, "") != agreed.get(t, "")]
    if not changed:
        return 0
    base = await shadow_rows(local, event_id, changed)
    rows: Rows = {}
    for name in changed:
        rows.update((await fetch_rows(local, tables[name], event_id))[0])
    return sum(1 for k in set(base) | set(rows) if base.get(k) != rows.get(k))


async def sync_event(
    local: asyncpg.Connection,
    remote: asyncpg.Connection,
    push: Push,
    event_id: uuid.UUID,
) -> RoundResult:
    """One round for one Ereignis: read both, merge, write both, remember what was agreed.

    `remote` reads the hosted database (read-only is enough); `push` sends ops to the hosted
    board and returns one result per op (`POST /api/standby/sync`). Both connections must
    run in UTC, so timestamps compare as text.
    """
    tables = await event_tables(local)
    now = datetime.now(UTC).isoformat()
    async with remote.transaction(isolation="repeatable_read", readonly=True):
        theirs_hash = await table_hashes(remote, tables, event_id)
        mine_hash, agreed_hash = await table_hashes(local, tables, event_id), await shadow_hashes(local, event_id)
        changed = [
            t
            for t in tables
            # The conflict list is always read: a clash found again must find its own row. The
            # bell too: a GPS question both sides hold twice, agreed long ago, is closed once
            # (`_ask_gps_once`) – unchanged, it would never be looked at.
            if t in (LEADS, CONFLICTS, "notifications")
            or not (theirs_hash.get(t, "") == mine_hash.get(t, "") == agreed_hash.get(t, ""))
        ]
        base = await shadow_rows(local, event_id, changed)
        mine: Rows = {}
        mine_raw: dict[Key, str] = {}
        theirs: Rows = {}
        for name in changed:
            rows, raw = await fetch_rows(local, tables[name], event_id)
            mine.update(rows)
            mine_raw.update(raw)
            if name == LEADS or theirs_hash.get(name, "") != agreed_hash.get(name, ""):
                theirs.update((await fetch_rows(remote, tables[name], event_id))[0])
            else:  # unchanged on the hosted side since the last agreement
                theirs.update({k: v for k, v in base.items() if k[0] == name})

    lead_key = (LEADS, str(event_id))
    lead = settle_lead(mine.get(lead_key), theirs.get(lead_key))
    leader = lead["holder"] if lead else HOSTED
    takeover = str(lead["since"]) if lead else ""
    lead_rows, other_rows = (mine, theirs) if leader == STANDBY else (theirs, mine)
    plan = merge(
        base,
        lead_rows,
        other_rows,
        event_id=str(event_id),
        leader=leader,
        takeover=takeover,
        now=now,
        text_columns={t.name: t.text for t in tables.values()},
    )
    follower = HOSTED if leader == STANDBY else STANDBY
    pending_before = sum(1 for k in set(base) | set(mine) if k[0] != LEADS and base.get(k) != mine.get(k))
    # The lead goes first in each system's first batch; on the hosted side it must land, or the
    # hosted board took the Ereignis meanwhile and everything else was planned on a wrong leader.
    lead_ops = {
        STANDBY: [Op(LEADS, str(event_id), lead, mine.get(lead_key))] if lead and mine.get(lead_key) != lead else [],
        HOSTED: [Op(LEADS, str(event_id), lead, theirs.get(lead_key), required=True)]
        if lead and theirs.get(lead_key) != lead
        else [],
    }
    outcome: list[tuple[str, Op, str]] = []

    async def write(side: str, ops: list[Op]) -> list[str]:
        batch = [*lead_ops[side], *ops]
        lead_ops[side] = []
        if side == HOSTED:
            if not batch and leader == HOSTED:
                return []  # the heartbeat only matters while the box leads; a taken-back one stays quiet
            results = await push(event_id, batch, pending_before)
            if batch and batch[0].required and results[0] != "ok":
                raise LeadMovedError
        else:
            async with local.transaction():
                results = await apply_ops(local, tables, event_id, batch)
        outcome.extend((side, op, r) for op, r in zip(batch, results, strict=True))
        return results[len(batch) - len(ops) :]

    # The leader is written first. A new row from the other side that is a copy of one the
    # leader has (the same Schadenplatz-Rapport twice, `SAME_THING`) becomes a conflict, and is
    # removed where it came from. Nothing else is ever removed for a clash.
    results = await write(leader, plan.to_leader)
    extra_leader: list[Op] = []
    extra_follower: list[Op] = []
    duplicates: set[Key] = set()
    for op, result in zip(plan.to_leader, results, strict=True):
        if result != "duplicate" or op.table == CONFLICTS or op.row is None:
            continue
        row = conflict_row(
            op.table,
            op.id,
            "duplicate",
            event_id=str(event_id),
            leader=leader,
            takeover=takeover,
            now=now,
            lead=lead_rows,
            other=other_rows,
            row=op.row,
        )
        duplicates.add((op.table, op.id))
        plan.merged[(op.table, op.id)] = None
        extra_follower.append(Op(op.table, op.id, None, op.row))
        if _recorded(row["id"], lead_rows, other_rows):
            continue  # found again because its copy could not be removed yet
        plan.merged[(CONFLICTS, row["id"])] = row
        plan.conflicts += 1
        extra_leader.append(Op(CONFLICTS, row["id"], row, None))
        extra_follower.append(Op(CONFLICTS, row["id"], row, None))
    if extra_leader:
        await write(leader, extra_leader)
    await write(follower, [*plan.to_follower, *extra_follower])

    # A duplicate the leader refused is settled once its copy is gone on the other side.
    unsettled = [
        (side, op, r)
        for side, op, r in outcome
        if r != "ok" and not (side == leader and (op.table, op.id) in duplicates)
    ]
    failed = {(op.table, op.id) for _, op, _ in unsettled}

    # What both now hold is agreed; what failed keeps its old agreement and comes up again.
    async with local.transaction():
        for key, agreed in plan.merged.items():
            if key in failed or key[0] == LEADS or base.get(key) == agreed:
                continue
            if agreed is None:
                await local.execute("DELETE FROM standby.shadow WHERE tbl = $1 AND id = $2::uuid", *key)
                continue
            text = mine_raw.get(key) if mine.get(key) == agreed else json.dumps(agreed)
            await local.execute(
                """
                INSERT INTO standby.shadow (event_id, tbl, id, row) VALUES ($1, $2, $3::uuid, $4::jsonb)
                ON CONFLICT (tbl, id) DO UPDATE SET row = EXCLUDED.row
                """,
                event_id,
                key[0],
                key[1],
                text,
            )
    return RoundResult(
        leader=leader,
        pending=len({k for k in failed if k[0] != LEADS}),
        reached=True,
        written_here=sum(1 for side, _, r in outcome if side == STANDBY and r == "ok"),
        written_there=sum(1 for side, _, r in outcome if side == HOSTED and r == "ok"),
        conflicts=plan.conflicts,
        held=[f"{op.table}/{op.id}: {r}" for _, op, r in unsettled],
    )
