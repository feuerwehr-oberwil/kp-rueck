"""Einsatztagebuch — the per-Ereignis journal log (idea R8, 08.10.2026).

ONE funnel for the automatic rows: a ``before_flush`` hook on every ORM session. It looks
at what the flush is about to write and adds a ``JournalEntry`` for each fact worth
keeping, in the same transaction. That is the whole point of doing it here rather than at
the call sites: a status change happens in a dozen places (the board, /feld, the GPS
automation, the training simulator, Aufträge …), a release in more, and a journal that
depends on every one of them remembering a second write is a journal with holes.

What counts as a fact (and what deliberately does not — the log must stay readable):

* an Einsatz created / deleted / restored / merged / unmerged (`incident`)
* every status transition (`status`)
* a resource assigned to / released from an Einsatz (`assignment`) — the Einsatz's own
  crew, vehicles, material; an Auftrag's shared resources are not (same as the PDF always did)
* a Meldung from the field and the KP's Meldung an den Trupp (`message`)
* a Reko report filed — drafts are not (`reko`)
* a Divera alarm sent (`alarm`)
* the field facts, each from the ONE row that records it once (`field`): arrival on the
  Schadenplatz, «Einsatz beendet», pickup needed / done (their audit rows, set AND
  cleared), the Schadenplatz-Rapport filed, the Reko arriving (the report's `arrived_at`).

NOT the bell. A notification is a reminder the board rebuilds and de-duplicates as it
sees fit (`vehicle_arrived` is re-derived on every poll with a 30-minute window); a
permanent record built from it repeats lines and misses the second vehicle. The nags
(overdue, no personnel, missing location …) were never facts anyway.

Manual lines and their corrections come from the API (`api/journal.py`), never from here.

⚠️ The hook must never fail the board write it rides on: every fact is wrapped, and a
problem is logged and skipped. A missing journal line is bad; a status change that cannot
be saved at 03:00 because of the journal is worse. What it missed, the boot-time backfill
(`services/journal_backfill.py`) adds — it writes the same rows under the same
`source_key`, so it only ever fills gaps.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import event, inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from ..models import (
    AuditLog,
    Incident,
    IncidentAssignment,
    IncidentFieldMessage,
    JournalEntry,
    Material,
    Personnel,
    RekoReport,
    StatusTransition,
    User,
    Vehicle,
)
from ..schemas.journal import JournalEntryOut

logger = logging.getLogger(__name__)

#: Field facts recorded from their audit row: written once per human (or GPS) report,
#: set AND cleared — unlike the bell entry, which only exists for the set.
FIELD_AUDIT_ACTIONS: frozenset[str] = frozenset(
    {
        "field_arrived",
        "field_arrived_cleared",
        "field_complete",
        "field_complete_cleared",
        "field_pickup_requested",
        "field_pickup_cleared",
        "rapport_submitted",
    }
)

#: A request from the field (R13) changing state – in Arbeit, erledigt, wieder offen. The row
#: says which (``data.type`` = ``field_request_<to>``, the same labels table as the other
#: field facts) and what (``text`` = the request's German one-line label).
REQUEST_AUDIT_ACTIONS: frozenset[str] = frozenset({"field_request_status"})

#: A request moved with a merge (R2 × R13): «Anfrage übernommen von …» on the card that
#: got it, «Anfrage zurück von …» when «Trennen» hands it back (services/merge_requests).
REQUEST_MOVED_ACTIONS: frozenset[str] = frozenset({"field_request_moved"})
REQUEST_STATES: frozenset[str] = frozenset({"open", "in_progress", "done"})

#: Lifecycle actions on an Einsatz → the `data.action` the row carries. `merge` sits on
#: the card a duplicate report went into, `merged_into` on the report, `unmerge` on both
#: (services/duplicates, R2). Listed even before that code is on main: an action nobody
#: writes costs nothing here, a missed one costs a line in the record.
INCIDENT_AUDIT_ACTIONS: dict[str, str] = {
    "delete": "deleted",
    "restore": "restored",
    "merge": "merge",
    "merged_into": "merged_into",
    "unmerge": "unmerge",
}

#: Every audit action that is a journal fact (incident-scoped only).
JOURNAL_AUDIT_ACTIONS: frozenset[str] = frozenset(
    {
        "field_message",
        "divera_alarm",
        *FIELD_AUDIT_ACTIONS,
        *REQUEST_AUDIT_ACTIONS,
        *REQUEST_MOVED_ACTIONS,
        *INCIDENT_AUDIT_ACTIONS,
    }
)

#: The category a filter chip groups kinds under. Mirrors `frontend/lib/journal.ts`.
KIND_CATEGORY: dict[str, str] = {
    "manual": "manual",
    "message": "field",
    "field": "field",
    "reko": "field",
    "status": "status",
    "incident": "status",
    "alarm": "status",
    "assignment": "resources",
}

#: A polling reader resumes from `seq`, but `seq` is handed out at INSERT, not at commit:
#: a long transaction (a completion releasing a whole crew) can commit row 100 after row
#: 101 is already read. So every read past a cursor also returns what was written in the
#: last `OVERLAP` — the client merges by id, the late row lands. A transaction open longer
#: than this is not something the board does.
OVERLAP = timedelta(seconds=120)

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _now() -> datetime:
    return datetime.now(UTC)


def ms(dt: datetime) -> int:
    """Milliseconds since the epoch, exactly — the same integer the backfill's
    `floor(extract(epoch FROM ts) * 1000)` computes in Postgres (numeric since PG 14)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return (dt - _EPOCH) // timedelta(milliseconds=1)


def _parse(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _user_name(user: User | None) -> str | None:
    if user is None:
        return None
    return (user.display_name or user.username or "")[:100] or None


def resource_display_name(session: Session, resource_type: str, resource_id: uuid.UUID) -> str:
    """The resource as the Einsatztagebuch has always named it: a vehicle with its call sign."""
    if resource_type == "personnel":
        p = session.get(Personnel, resource_id)
        return p.name if p else str(resource_id)
    if resource_type == "vehicle":
        v = session.get(Vehicle, resource_id)
        if not v:
            return str(resource_id)
        return f"{v.name} ({v.radio_call_sign})" if v.radio_call_sign else v.name
    if resource_type == "material":
        m = session.get(Material, resource_id)
        return m.name if m else str(resource_id)
    return str(resource_id)


class _Collector:
    """One flush's worth of journal rows."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.seen: set[str] = session.info.setdefault("journal_seen", set())

    # -- lookups -----------------------------------------------------------------

    def incident(self, incident_id: uuid.UUID | None, rel: Incident | None = None) -> Incident | None:
        if rel is not None:
            return rel
        if incident_id is None:
            return None
        return self.session.get(Incident, incident_id)

    def user_name(self, user_id: uuid.UUID | None) -> str | None:
        return _user_name(self.session.get(User, user_id)) if user_id else None

    def title(self, incident_id: object) -> tuple[str | None, str | None]:
        """(id, title) of another Einsatz named in an audit row, tolerant of junk."""
        if not incident_id:
            return None, None
        try:
            iid = uuid.UUID(str(incident_id))
        except ValueError:
            return None, None
        other = self.session.get(Incident, iid)
        return str(iid), other.title if other else None

    # -- writing -----------------------------------------------------------------

    def add(
        self,
        *,
        key: str,
        kind: str,
        incident: Incident | None,
        event_id: uuid.UUID | None = None,
        occurred_at: datetime | None,
        text: str | None = None,
        data: dict[str, Any] | None = None,
        author_name: str | None = None,
        created_by: uuid.UUID | None = None,
    ) -> None:
        if key in self.seen:
            return
        entry = JournalEntry(
            kind=kind,
            text=text,
            data=data,
            occurred_at=occurred_at or _now(),
            author_name=(author_name or None) and author_name[:100],
            created_by=created_by,
            source_key=key[:120],
        )
        if incident is not None:
            if incident in self.session.deleted:
                entry.incident_id = None
            else:
                # The relationship, not the id: an Einsatz created in this very flush has
                # to be inserted before the row that points at it.
                entry.incident = incident
            if incident.event_id is not None:
                entry.event_id = incident.event_id
            elif incident.event is not None:
                entry.event = incident.event
        if entry.event_id is None and entry.event is None:
            if event_id is None:
                return  # nothing to file it under — an Einsatz always has an Ereignis
            entry.event_id = event_id
        self.seen.add(key)
        self.session.add(entry)

    # -- the facts ---------------------------------------------------------------

    def new_incident(self, obj: Incident) -> None:
        if obj.id is None:
            obj.id = uuid.uuid4()
        self.add(
            key=f"incident:{obj.id}:created",
            kind="incident",
            incident=obj,
            occurred_at=obj.created_at,
            data={"action": "created", "title": obj.title, "source": obj.source or "operator"},
            author_name=self.user_name(obj.created_by),
            created_by=obj.created_by,
        )

    def transition(self, obj: StatusTransition) -> None:
        if obj.id is None:
            obj.id = uuid.uuid4()
        if obj.from_status == obj.to_status:
            return
        self.add(
            key=f"status:{obj.id}",
            kind="status",
            incident=self.incident(obj.incident_id, obj.incident),
            occurred_at=obj.timestamp,
            data={"from_status": obj.from_status, "to_status": obj.to_status},
            author_name=self.user_name(obj.user_id),
            created_by=obj.user_id,
        )

    def assignment(self, obj: IncidentAssignment, action: str, at: datetime) -> None:
        if obj.id is None:
            obj.id = uuid.uuid4()
        self.add(
            key=f"{'assign' if action == 'assigned' else 'unassign'}:{obj.id}:{ms(at)}",
            kind="assignment",
            incident=self.incident(obj.incident_id, obj.incident),
            occurred_at=at,
            data={
                "action": action,
                "resource_type": obj.resource_type,
                "resource_name": resource_display_name(self.session, obj.resource_type, obj.resource_id),
            },
            author_name=self.user_name(obj.assigned_by) if action == "assigned" else None,
            created_by=obj.assigned_by if action == "assigned" else None,
        )

    def kp_message(self, obj: IncidentFieldMessage) -> None:
        if obj.id is None:
            obj.id = uuid.uuid4()
        self.add(
            key=f"kpmsg:{obj.id}",
            kind="message",
            incident=self.incident(obj.incident_id),
            occurred_at=obj.created_at,
            text=obj.message,
            data={"direction": "to_field"},
            author_name=obj.author_name,
            created_by=obj.created_by,
        )

    def audit(self, obj: AuditLog) -> None:
        if obj.resource_type != "incident" or obj.action_type not in JOURNAL_AUDIT_ACTIONS:
            return
        if obj.id is None:
            obj.id = uuid.uuid4()
        incident = self.incident(obj.resource_id)
        if incident is None:
            return
        changes = obj.changes_json or {}
        key = f"audit:{obj.id}"
        action = obj.action_type
        who = self.user_name(obj.user_id)
        if action == "field_message":
            text = str(changes.get("message") or "").strip()
            if not text:
                return
            self.add(
                key=key,
                kind="message",
                incident=incident,
                occurred_at=obj.timestamp,
                text=text,
                # `kp` = typed in the KP from a radio call, `feld` = sent from /feld
                data={"direction": "from_field", "source": changes.get("source")},
                author_name=changes.get("personnel_name") or who,
                created_by=obj.user_id,
            )
        elif action == "divera_alarm":
            recipients = changes.get("recipients")
            self.add(
                key=key,
                kind="alarm",
                incident=incident,
                occurred_at=obj.timestamp,
                data={"recipients": len(recipients) if isinstance(recipients, list) else None},
                author_name=who,
                created_by=obj.user_id,
            )
        elif action in REQUEST_AUDIT_ACTIONS:
            to = changes.get("to")
            if to not in REQUEST_STATES:
                return
            self.add(
                key=key,
                kind="field",
                incident=incident,
                occurred_at=obj.timestamp,
                text=str(changes.get("label") or "").strip() or None,
                data={"type": f"field_request_{to}", "source": None},
                # always somebody in the KP: the board's buttons, or the completion that closed it
                author_name=who,
                created_by=obj.user_id,
            )
        elif action in REQUEST_MOVED_ACTIONS:
            moved_data: dict[str, Any] = {
                "type": "field_request_returned" if changes.get("reason") == "unmerge" else "field_request_moved",
                "source": None,
            }
            moved_from = changes.get("from_incident_id")
            if moved_from:
                moved_data["other_incident_id"], moved_data["other_title"] = self.title(moved_from)
            self.add(
                key=key,
                kind="field",
                incident=incident,
                occurred_at=obj.timestamp,
                text=str(changes.get("label") or "").strip() or None,
                data=moved_data,
                author_name=who,
                created_by=obj.user_id,
            )
        elif action in FIELD_AUDIT_ACTIONS:
            self.add(
                key=key,
                kind="field",
                incident=incident,
                # an arrival radioed in five minutes late happened five minutes ago
                occurred_at=_parse(changes.get("arrived_at"))
                or _parse(changes.get("field_complete_reported_at"))
                or obj.timestamp,
                text=(str(changes["pickup_note"]).strip() or None) if changes.get("pickup_note") else None,
                data={"type": action, "source": self._field_source(obj, changes)},
                author_name=who if changes.get("source") == "kp" else None,
                created_by=obj.user_id,
            )
        else:
            data: dict[str, Any] = {"action": INCIDENT_AUDIT_ACTIONS[action], "title": incident.title}
            if action == "merge":
                other = changes.get("merged_incident_id")
            elif action == "merged_into":
                other = changes.get("target_incident_id")
            elif action == "unmerge":
                merged = changes.get("merged_incident_id")
                other = changes.get("target_incident_id") if str(merged) == str(incident.id) else merged
            else:
                other = None
            if other:
                data["other_incident_id"], data["other_title"] = self.title(other)
            self.add(
                key=key,
                kind="incident",
                incident=incident,
                occurred_at=obj.timestamp,
                data=data,
                author_name=who,
                created_by=obj.user_id,
            )

    @staticmethod
    def _field_source(obj: AuditLog, changes: dict[str, Any]) -> str | None:
        from .gps_automation import GPS_SYSTEM_USER_ID  # lazy: gps_automation imports crud

        if obj.user_id == GPS_SYSTEM_USER_ID:
            return "gps"
        source = changes.get("source")
        return source if isinstance(source, str) else None

    def reko(self, obj: RekoReport) -> None:
        if obj.id is None:
            obj.id = uuid.uuid4()
        if obj.submitted_at is None:
            # stamp it here, so the row's key and the column agree (see journal_backfill)
            obj.submitted_at = _now()
        author = None
        if obj.submitted_by_personnel_id:
            person = self.session.get(Personnel, obj.submitted_by_personnel_id)
            author = person.name if person else None
        author = author or self.user_name(obj.created_by_user_id)
        self.add(
            key=f"reko:{obj.id}:{ms(obj.submitted_at)}",
            kind="reko",
            incident=self.incident(obj.incident_id, obj.incident),
            occurred_at=obj.submitted_at,
            text=(obj.summary_text or "").strip() or None,
            data={"relevant": obj.is_relevant},
            author_name=author,
        )

    def reko_arrival(self, obj: RekoReport, old: datetime | None, new: datetime | None) -> None:
        """The Reko reached the Schadenplatz — from `/reko` or radioed in by the KP — or
        that arrival was cleared as mis-heard. The report's own column, once per change."""
        if obj.id is None:
            obj.id = uuid.uuid4()
        if new is not None:
            self.add(
                key=f"reko_arrived:{obj.id}:{ms(new)}",
                kind="field",
                incident=self.incident(obj.incident_id, obj.incident),
                occurred_at=new,
                data={"type": "reko_arrived", "source": "kp" if obj.arrived_reported_by_user_id else "feld"},
                author_name=self.user_name(obj.arrived_reported_by_user_id),
            )
        elif old is not None:
            now = _now()
            self.add(
                key=f"reko_arrived_cleared:{obj.id}:{ms(now)}",
                kind="field",
                incident=self.incident(obj.incident_id, obj.incident),
                occurred_at=now,
                data={"type": "reko_arrived_cleared"},
            )


def _changed(obj: Any, attr: str) -> tuple[Any, Any] | None:
    """(old, new) when `attr` changed in this flush, else None."""
    hist = inspect(obj).attrs[attr].history
    if not hist.added:
        return None
    old = hist.deleted[0] if hist.deleted else None
    new = hist.added[0]
    return (old, new) if old != new else None


def _collect(session: Session) -> None:
    c = _Collector(session)
    for obj in list(session.new):
        if isinstance(obj, JournalEntry):
            continue
        try:
            with session.no_autoflush:
                if isinstance(obj, Incident):
                    c.new_incident(obj)
                elif isinstance(obj, StatusTransition):
                    c.transition(obj)
                elif isinstance(obj, IncidentAssignment):
                    if obj.assigned_at is None:
                        # stamped here so the key and the column agree (see journal_backfill)
                        obj.assigned_at = _now()
                    c.assignment(obj, "assigned", obj.assigned_at)
                    if obj.unassigned_at is not None:
                        c.assignment(obj, "unassigned", obj.unassigned_at)
                elif isinstance(obj, IncidentFieldMessage):
                    c.kp_message(obj)
                elif isinstance(obj, AuditLog):
                    c.audit(obj)
                elif isinstance(obj, RekoReport):
                    if not obj.is_draft:
                        c.reko(obj)
                    if obj.arrived_at is not None:
                        c.reko_arrival(obj, None, obj.arrived_at)
        except Exception:  # never fail the board write — see module docstring
            logger.exception("journal: could not record %s", type(obj).__name__)

    for obj in list(session.dirty):
        try:
            with session.no_autoflush:
                if isinstance(obj, IncidentAssignment):
                    change = _changed(obj, "unassigned_at")
                    if change is None:
                        continue
                    old, new = change
                    if new is not None and old is None:
                        c.assignment(obj, "unassigned", new)
                    elif new is None and old is not None:
                        # a release taken back (undo, reopen) — the resource is on it again
                        c.assignment(obj, "assigned", _now())
                elif isinstance(obj, RekoReport):
                    change = _changed(obj, "is_draft")
                    if change is not None and change[0] is True and change[1] is False:
                        c.reko(obj)
                    arrival = _changed(obj, "arrived_at")
                    if arrival is not None:
                        c.reko_arrival(obj, arrival[0], arrival[1])
        except Exception:
            logger.exception("journal: could not record change of %s", type(obj).__name__)


@event.listens_for(Session, "before_flush")
def _journal_before_flush(session: Session, _flush_context: Any, _instances: Any) -> None:
    if session.info.get("journal_disabled"):
        return
    _collect(session)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def entry_out(entry: JournalEntry, incident_title: str | None, incident_deleted: bool = False) -> JournalEntryOut:
    """A row as the API and the PDF read it."""
    title = incident_title
    if title is None and entry.data:
        # an Einsatz that has since been purged: the title the row was written with
        title = entry.data.get("title")
    return JournalEntryOut(
        id=entry.id,
        seq=entry.seq,
        event_id=entry.event_id,
        incident_id=entry.incident_id,
        incident_title=title,
        incident_deleted=incident_deleted or (entry.incident_id is None and title is not None),
        kind=entry.kind,
        category=KIND_CATEGORY.get(entry.kind, "status"),
        text=entry.text,
        data=entry.data,
        occurred_at=entry.occurred_at,
        created_at=entry.created_at,
        author_name=entry.author_name,
        corrects_id=entry.corrects_id,
    )


async def journal_rows(db: AsyncSession, event_id: uuid.UUID, since_seq: int = 0) -> list[JournalEntryOut]:
    """Rows of one Ereignis with seq > since_seq — plus, past a cursor, everything written
    in the last `OVERLAP` (see there) — oldest seq first. The ONE read of the log, for the
    drawer and for the PDF's Einsatztagebuch alike."""
    q = (
        select(JournalEntry, Incident.title, Incident.deleted_at)
        .outerjoin(Incident, Incident.id == JournalEntry.incident_id)
        .where(JournalEntry.event_id == event_id)
        .order_by(JournalEntry.seq.asc())
    )
    if since_seq > 0:
        q = q.where(or_(JournalEntry.seq > since_seq, JournalEntry.created_at >= _now() - OVERLAP))
    result = await db.execute(q)
    return [entry_out(entry, title, deleted_at is not None) for entry, title, deleted_at in result.all()]


def merged_into(rows: list[JournalEntryOut]) -> dict[uuid.UUID, str]:
    """Einsätze that were merged into another one and not unmerged since → the title of the
    card they went into. Read from the log itself, so it holds for whatever the board's
    model says about merges today."""
    out: dict[uuid.UUID, str] = {}
    for row in sorted(rows, key=lambda r: r.seq):
        if row.kind != "incident" or row.incident_id is None or not row.data:
            continue
        action = row.data.get("action")
        if action == "merged_into":
            out[row.incident_id] = str(row.data.get("other_title") or "")
        elif action == "unmerge" or action == "restored":
            out.pop(row.incident_id, None)
    return out
