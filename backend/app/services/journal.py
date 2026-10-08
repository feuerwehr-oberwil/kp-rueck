"""Einsatztagebuch — the per-Ereignis journal log (idea R8, 08.10.2026).

ONE funnel for the automatic rows: a ``before_flush`` hook on every ORM session. It looks
at what the flush is about to write and adds a ``JournalEntry`` for each fact worth
keeping, in the same transaction. That is the whole point of doing it here rather than at
the call sites: a status change happens in a dozen places (the board, /feld, the GPS
automation, the training simulator, Aufträge …), a release in more, and a journal that
depends on every one of them remembering a second write is a journal with holes.

What counts as a fact (and what deliberately does not — the log must stay readable):

* an Einsatz created / deleted / restored (`incident`)
* every status transition (`status`)
* a resource assigned to / released from an Einsatz (`assignment`) — the Einsatz's own
  crew, vehicles, material; an Auftrag's shared resources are not (same as the PDF always did)
* a Meldung from the field and the KP's Meldung an den Trupp (`message`)
* a Reko report filed — drafts are not (`reko`)
* a Divera alarm sent (`alarm`)
* the field notifications that say something HAPPENED: arrived, done, pickup, vehicle on
  scene / back, Rapport filed (`field`). The nags (overdue, no personnel, missing
  location …) are the bell's business, not the record's.

Manual lines and their corrections come from the API (`api/journal.py`), never from here.

⚠️ The hook must never fail the board write it rides on: every fact is wrapped, and a
problem is logged and skipped. A missing journal line is bad; a status change that cannot
be saved at 03:00 because of the journal is worse.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import event, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from ..models import (
    AuditLog,
    Incident,
    IncidentAssignment,
    IncidentFieldMessage,
    JournalEntry,
    Material,
    Notification,
    Personnel,
    RekoReport,
    StatusTransition,
    User,
    Vehicle,
)
from ..schemas.journal import JournalEntryOut

logger = logging.getLogger(__name__)

#: Bell entries that report an event on the ground. The rest of the notification types
#: are reminders the board raises about itself and would only be noise in a record.
#: `field_message` is NOT here: the Meldung is recorded from its audit row, which carries
#: the crew member's name and the bare text.
JOURNAL_NOTIFICATION_TYPES: frozenset[str] = frozenset(
    {"field_arrived", "field_complete", "field_pickup", "reko_arrived", "vehicle_arrived", "rapport_submitted"}
)

#: Audit rows that are journal facts (incident-scoped only).
JOURNAL_AUDIT_ACTIONS: frozenset[str] = frozenset({"field_message", "divera_alarm", "delete", "restore"})

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

MANUAL_TEXT_MAX = 2000


def _now() -> datetime:
    return datetime.now(UTC)


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

    def assignment(self, obj: IncidentAssignment, action: str, at: datetime | None) -> None:
        if obj.id is None:
            obj.id = uuid.uuid4()
        at = at or _now()
        stamp = int(at.timestamp() * 1000)
        self.add(
            key=f"{'assign' if action == 'assigned' else 'unassign'}:{obj.id}:{stamp}",
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
        if obj.action_type == "field_message":
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
                author_name=changes.get("personnel_name") or self.user_name(obj.user_id),
                created_by=obj.user_id,
            )
        elif obj.action_type == "divera_alarm":
            recipients = changes.get("recipients")
            self.add(
                key=key,
                kind="alarm",
                incident=incident,
                occurred_at=obj.timestamp,
                data={"recipients": len(recipients) if isinstance(recipients, list) else None},
                author_name=self.user_name(obj.user_id),
                created_by=obj.user_id,
            )
        else:
            self.add(
                key=key,
                kind="incident",
                incident=incident,
                occurred_at=obj.timestamp,
                data={"action": "deleted" if obj.action_type == "delete" else "restored", "title": incident.title},
                author_name=self.user_name(obj.user_id),
                created_by=obj.user_id,
            )

    def reko(self, obj: RekoReport) -> None:
        if obj.id is None:
            obj.id = uuid.uuid4()
        author = None
        if obj.submitted_by_personnel_id:
            person = self.session.get(Personnel, obj.submitted_by_personnel_id)
            author = person.name if person else None
        author = author or self.user_name(obj.created_by_user_id)
        submitted = obj.submitted_at or _now()
        self.add(
            key=f"reko:{obj.id}:{int(submitted.timestamp() * 1000)}",
            kind="reko",
            incident=self.incident(obj.incident_id, obj.incident),
            occurred_at=submitted,
            text=(obj.summary_text or "").strip() or None,
            data={"relevant": obj.is_relevant},
            author_name=author,
        )

    def notification(self, obj: Notification) -> None:
        if obj.type not in JOURNAL_NOTIFICATION_TYPES:
            return
        if obj.id is None:
            obj.id = uuid.uuid4()
        self.add(
            key=f"notification:{obj.id}",
            kind="field",
            incident=self.incident(obj.incident_id),
            event_id=obj.event_id,
            occurred_at=obj.created_at,
            text=obj.message,
            data={"type": obj.type},
        )


def entry_out(entry: JournalEntry, incident_title: str | None) -> JournalEntryOut:
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
    """Rows of one Ereignis with seq > since_seq, oldest seq first — the ONE read of the
    log, for the drawer and for the PDF's Einsatztagebuch alike."""
    result = await db.execute(
        select(JournalEntry, Incident.title)
        .outerjoin(Incident, Incident.id == JournalEntry.incident_id)
        .where(JournalEntry.event_id == event_id, JournalEntry.seq > since_seq)
        .order_by(JournalEntry.seq.asc())
    )
    return [entry_out(entry, title) for entry, title in result.all()]


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
                elif isinstance(obj, Notification):
                    c.notification(obj)
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
                        c.assignment(obj, "assigned", None)
                elif isinstance(obj, RekoReport):
                    change = _changed(obj, "is_draft")
                    if change is not None and change[0] is True and change[1] is False:
                        c.reko(obj)
        except Exception:
            logger.exception("journal: could not record change of %s", type(obj).__name__)


@event.listens_for(Session, "before_flush")
def _journal_before_flush(session: Session, _flush_context: Any, _instances: Any) -> None:
    if session.info.get("journal_disabled"):
        return
    _collect(session)
