"""Holds rule 1 of the row locks (docs/BACKEND.md «Row locks») on every request a test makes.

The `client` fixture arms it on `db_session` for each request. While armed it records a
violation when the request

- flushes a new, changed or deleted row of an Ereignis whose lock (`crud.locking.lock_ereignis`)
  it has not taken,
- locks (FOR UPDATE) or bulk-writes a table of Ereignis rows before any Ereignis lock, or
- takes an Ereignis lock after a row lock or write.

One out of order is safe by itself: `lock_ereignis` only tries it.

Rows of an Ereignis are the tables with a key to `events`, `incidents`, `incident_groups`,
`reko_reports` or `notifications` (and `events` itself), less `_NOT_OF_AN_EREIGNIS`.
A new Ereignis' own rows need no lock: nobody else can see them before the commit.
"""

import traceback
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import Result, Table, event, inspect, select
from sqlalchemy.orm import ORMExecuteState, Session, SessionTransaction, UOWTransaction

from app.crud.locking import LOCK_EREIGNIS, TRY_LOCK_EREIGNIS, is_within
from app.database import Base
from app.ereignis_lock import ereignis_lock_key
from app.models import Event, Incident, IncidentGroup, Notification, RekoReport

# A guest belongs to an Ereignis by its key, but a person row is a resource (rule 2), and a
# print job is a queue entry that only points at a card.
_NOT_OF_AN_EREIGNIS = frozenset({"personnel", "print_jobs"})
_PARENTS = ("events", "incidents", "incident_groups", "reko_reports", "notifications")


def _ereignis_tables() -> dict[str, list[tuple[str, str]]]:
    """Per table of Ereignis rows: its (column, parent table) keys that lead to the Ereignis."""
    tables: dict[str, list[tuple[str, str]]] = {"events": [("id", "events")]}
    for table in Base.metadata.sorted_tables:
        if table.name in _NOT_OF_AN_EREIGNIS or table.name == "events":
            continue
        links = [
            (fk.parent.name, fk.column.table.name) for fk in table.foreign_keys if fk.column.table.name in _PARENTS
        ]
        if links:
            tables[table.name] = links
    return tables


EREIGNIS_TABLES = _ereignis_tables()


def _where() -> str:
    """The innermost app frames: where a violation happened. The ORM runs in a greenlet whose
    parent holds the async frames of the caller."""
    import greenlet

    frames: list[traceback.FrameSummary] = []
    current: greenlet.greenlet | None = greenlet.getcurrent()
    while current is not None:
        frame = current.gr_frame if current is not greenlet.getcurrent() else None
        frames += traceback.extract_stack(frame) if frame is not None else traceback.extract_stack()
        current = current.parent
    mine = [f for f in frames if "/backend/app/" in f.filename]
    return " < ".join(f"{f.filename.split('/backend/app/')[-1]}:{f.lineno}" for f in reversed(mine[-4:]))


@dataclass
class _Request:
    held: dict[int, SessionTransaction] = field(default_factory=dict)  # key → where it was taken
    created: set[uuid.UUID] = field(default_factory=set)  # Ereignisse this request inserts
    locked_rows: bool = False
    violations: list[str] = field(default_factory=list)


def _event_of(session: Session, parent: str, row_id: uuid.UUID) -> uuid.UUID | None:
    """The Ereignis of a parent row, from the session if it is there, else from the database."""
    if parent == "events":
        return row_id
    model = {
        "incidents": Incident,
        "incident_groups": IncidentGroup,
        "reko_reports": RekoReport,
        "notifications": Notification,
    }[parent]
    obj = session.identity_map.get((model, (row_id,), None))  # type: ignore[call-overload]
    with session.no_autoflush:
        if parent in ("incidents", "incident_groups"):
            return obj.event_id if obj is not None else session.scalar(select(model.event_id).where(model.id == row_id))
        if parent == "reko_reports":
            incident_id = (
                obj.incident_id
                if obj is not None
                else session.scalar(select(RekoReport.incident_id).where(RekoReport.id == row_id))
            )
            return _event_of(session, "incidents", incident_id) if incident_id else None
        row = session.execute(
            select(Notification.event_id, Notification.incident_id).where(Notification.id == row_id)
        ).first()
        if row is None:
            return None
        return row.event_id or (_event_of(session, "incidents", row.incident_id) if row.incident_id else None)


def _events_of_object(session: Session, obj: object) -> set[uuid.UUID]:
    """Every Ereignis a flushed object belongs to, before and after its change."""
    state = inspect(obj)
    table = state.mapper.local_table
    if not isinstance(table, Table) or table.name not in EREIGNIS_TABLES:
        return set()
    found: set[uuid.UUID] = set()
    for column, parent in EREIGNIS_TABLES[table.name]:
        attr = state.mapper.get_property_by_column(table.c[column]).key
        history = state.attrs[attr].history
        for value in (*history.added, *history.unchanged, *history.deleted):
            if value is not None:
                event_id = _event_of(session, parent, value)
                if event_id is not None:
                    found.add(event_id)
    return found


def _statement_tables(orm_state: ORMExecuteState) -> set[str]:
    statement = orm_state.statement
    if orm_state.is_select:
        return {t.name for t in statement.get_final_froms() if isinstance(t, Table)}  # type: ignore[attr-defined]
    table = getattr(statement, "table", None)
    return {table.name} if isinstance(table, Table) else set()


@contextmanager
def armed(sync_session: Session) -> Iterator[list[str]]:
    """Check rule 1 on `sync_session` while the block runs; yields the violations found."""
    request = _Request()

    def on_execute(orm_state: ORMExecuteState) -> Result[Any] | None:
        if orm_state.statement is LOCK_EREIGNIS or orm_state.statement is TRY_LOCK_EREIGNIS:
            key = orm_state.parameters["key"]  # type: ignore[index]
            result = orm_state.invoke_statement().freeze()
            refused = orm_state.statement is TRY_LOCK_EREIGNIS and not result().scalar()
            if key not in request.held and not refused:
                if request.locked_rows:
                    request.violations.append(f"an Ereignis lock after a row lock or write at {_where()}")
                session = orm_state.session
                request.held[key] = session.get_nested_transaction() or session.get_transaction()  # type: ignore[assignment]
            return result()
        is_lock = orm_state.is_select and orm_state.statement._for_update_arg is not None  # type: ignore[attr-defined]
        if not (is_lock or orm_state.is_insert or orm_state.is_update or orm_state.is_delete):
            return None
        request.locked_rows = True
        touched = _statement_tables(orm_state) & EREIGNIS_TABLES.keys()
        if not touched or request.held:
            return None
        # Run it here to see whether it found a row: locking or writing nothing is no violation.
        result = orm_state.invoke_statement()
        if is_lock:
            frozen = result.freeze()
            rows = frozen().all()
            result = frozen()
            # Whole rows tell their Ereignis (an alarm in the inbox has none); ids alone do not.
            objects = [value for row in rows for value in row if hasattr(value, "_sa_instance_state")]
            session = orm_state.session
            found = any(_events_of_object(session, obj) for obj in objects) if objects else bool(rows)
        else:
            found = result.rowcount > 0  # type: ignore[attr-defined]
        if found:
            kind = "FOR UPDATE" if is_lock else "bulk write"
            request.violations.append(f"{kind} on {sorted(touched)} without an Ereignis lock at {_where()}")
        return result

    def before_flush(session: Session, _ctx: UOWTransaction, _instances: object) -> None:
        request.created |= {obj.id for obj in session.new if isinstance(obj, Event)}
        changed = [*session.new, *session.deleted, *(o for o in session.dirty if session.is_modified(o))]
        for obj in changed:
            missing = {
                event_id
                for event_id in _events_of_object(session, obj)
                if event_id not in request.created and ereignis_lock_key(event_id) not in request.held
            }
            if missing:
                request.violations.append(f"{type(obj).__name__} written without its Ereignis lock at {_where()}")
        # A new row nobody else can see yet is no lock another writer could wait for.
        if any(obj not in session.new or _events_of_object(session, obj) for obj in changed):
            request.locked_rows = True

    def after_flush(session: Session, _ctx: UOWTransaction) -> None:
        request.created |= {obj.id for obj in session.new if isinstance(obj, Event)}

    def after_transaction_end(_session: Session, transaction: SessionTransaction) -> None:
        # A commit inside the request ends its transaction (a savepoint's RELEASE does not): its
        # locks go, and an Ereignis it created is everybody's now.
        if transaction.parent is None:
            request.held.clear()
            request.created.clear()
            request.locked_rows = False

    def after_soft_rollback(_session: Session, rolled_back: SessionTransaction) -> None:
        for key in [key for key, taken_in in request.held.items() if is_within(taken_in, rolled_back)]:
            del request.held[key]

    listeners = [
        ("do_orm_execute", on_execute),
        ("before_flush", before_flush),
        ("after_flush", after_flush),
        ("after_transaction_end", after_transaction_end),
        ("after_soft_rollback", after_soft_rollback),
    ]
    for name, fn in listeners:
        event.listen(sync_session, name, fn)
    try:
        yield request.violations
    finally:
        for name, fn in listeners:
            event.remove(sync_session, name, fn)


def report(violations: list[str]) -> None:
    """Fail the test on a violation."""
    if violations:
        raise AssertionError("Ereignis lock rule broken (docs/BACKEND.md «Row locks»):\n" + "\n".join(violations))
