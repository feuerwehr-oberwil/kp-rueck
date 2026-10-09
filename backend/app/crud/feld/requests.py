"""Workable requests from the field (R13) — the state behind every Meldung.

Until this module a crew's «Material nötig» was a bell entry plus an audit row,
and the only "handling" it could get was somebody dismissing the bell — which
also erased it from every surface but the thread in the detail. A
``FieldRequest`` row is what the card, the detail and the notification sidebar
read now, and its ``status`` is the single answer to «hat das jemand erledigt?»:

    open ──► in_progress (optional) ──► done          (and back to open)

* **Seen ≠ handled.** Dismissing the bell entry stamps ``seen_at`` — the crew
  reads «Vom KP gesehen» — and leaves the request open on the card and in the
  sidebar. Only ``done`` takes it off them.
* **Handled ⇒ seen.** Setting ``in_progress`` or ``done`` stamps ``seen_at`` too,
  and ``done`` dismisses the bell entry, so the sidebar never shows a handled
  request as an unread notification.
* **The Abholung keeps its flag.** ``Incident.pickup_needed`` stays what the map,
  the Restliste, the wall display and the PDF read; the ``pickup`` row is its
  work item and is opened and closed ONLY through ``record_pickup`` — so «erledigt»
  in the sidebar and «Abholung disponiert» on the chip are one action.

Writers are called from both doors (decision 28), like the rest of this package.
"""

import uuid
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import FieldRequest, Incident, Notification, User
from ...services.audit import log_action

OPEN_STATUSES: tuple[str, ...] = ("open", "in_progress")

# What may follow what. «erledigt» goes back only through an explicit
# «Wieder öffnen» (→ offen), never straight to «in Arbeit».
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "open": frozenset({"in_progress", "done"}),
    "in_progress": frozenset({"open", "done"}),
    "done": frozenset({"open"}),
}


class RequestConflictError(Exception):
    """The request is not in a state this change can start from (the API answers 409)."""

    def __init__(self, current: str) -> None:
        super().__init__(current)
        self.current = current


def user_display(user: User | None) -> str | None:
    """The name a request shows for the operator who worked it."""
    if user is None:
        return None
    return (user.display_name or user.username)[:100]


async def open_requests_for_incidents(
    db: AsyncSession, incident_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[FieldRequest]]:
    """Open + «in Arbeit» requests per incident, oldest first — one query per board load."""
    if not incident_ids:
        return {}
    result = await db.execute(
        select(FieldRequest)
        .where(FieldRequest.incident_id.in_(incident_ids), FieldRequest.status.in_(OPEN_STATUSES))
        .order_by(FieldRequest.created_at)
    )
    out: dict[uuid.UUID, list[FieldRequest]] = {}
    for row in result.scalars().all():
        out.setdefault(row.incident_id, []).append(row)
    return out


async def requests_for_incidents(
    db: AsyncSession,
    incident_ids: list[uuid.UUID],
    *,
    include_pickup: bool = True,
) -> dict[uuid.UUID, list[FieldRequest]]:
    """Every request per incident, any state, oldest first."""
    if not incident_ids:
        return {}
    query = select(FieldRequest).where(FieldRequest.incident_id.in_(incident_ids))
    if not include_pickup:
        query = query.where(FieldRequest.kind != "pickup")
    result = await db.execute(query.order_by(FieldRequest.created_at))
    out: dict[uuid.UUID, list[FieldRequest]] = {}
    for row in result.scalars().all():
        out.setdefault(row.incident_id, []).append(row)
    return out


async def get_request(
    db: AsyncSession, incident_id: uuid.UUID, request_id: uuid.UUID, *, lock: bool = False
) -> FieldRequest | None:
    """One request, scoped to its incident so an id from another card is a 404.

    ``lock`` takes the row (``FOR UPDATE``) for a state change: two operators
    pressing «Erledigt» and «In Arbeit» at once are applied one after the other,
    and the second one sees the first one's state.
    """
    query = select(FieldRequest).where(FieldRequest.id == request_id, FieldRequest.incident_id == incident_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def open_pickup_request(db: AsyncSession, incident_id: uuid.UUID) -> FieldRequest | None:
    """The work item of the incident's open Abholung, if there is one."""
    result = await db.execute(
        select(FieldRequest)
        .where(
            FieldRequest.incident_id == incident_id,
            FieldRequest.kind == "pickup",
            FieldRequest.status.in_(OPEN_STATUSES),
        )
        .order_by(FieldRequest.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def dismiss_linked_notification(db: AsyncSession, row: FieldRequest, user: User | None, now: datetime) -> bool:
    """Handling a request takes its bell entry with it. True when one was dismissed."""
    if row.notification_id is None:
        return False
    result = await db.execute(
        update(Notification)
        .where(Notification.id == row.notification_id, Notification.dismissed.is_(False))
        .values(dismissed=True, dismissed_at=now, dismissed_by=user.id if user else None)
    )
    return bool(getattr(result, "rowcount", 0))


async def dismiss_pickup_bells(db: AsyncSession, incident_id: uuid.UUID, user: User | None, now: datetime) -> int:
    """Every still-open «Abholung nötig» bell of this incident — a note edit adds one each.

    Called when the Abholung is closed: the request is answered, so none of its
    announcements may linger in the bell. The caller commits.
    """
    result = await db.execute(
        update(Notification)
        .where(
            Notification.incident_id == incident_id,
            Notification.type == "field_pickup",
            Notification.dismissed.is_(False),
            Notification.created_at <= now,
        )
        .values(dismissed=True, dismissed_at=now, dismissed_by=user.id if user else None)
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def open_pickup_requests(db: AsyncSession, incident_id: uuid.UUID) -> list[FieldRequest]:
    """All open Abholung work items — normally one (the partial unique index says at most one)."""
    result = await db.execute(
        select(FieldRequest).where(
            FieldRequest.incident_id == incident_id,
            FieldRequest.kind == "pickup",
            FieldRequest.status.in_(OPEN_STATUSES),
        )
    )
    return list(result.scalars().all())


def close_request(row: FieldRequest, *, user: User | None, name: str | None, now: datetime) -> None:
    """Stamp ``done`` with who/when — the fields only, the caller commits."""
    row.status = "done"
    row.done_at = now
    row.done_by_user_id = user.id if user else None
    row.done_by_name = name
    row.seen_at = row.seen_at or now


async def set_request_status(
    db: AsyncSession,
    incident: Incident,
    row: FieldRequest,
    *,
    status: str,
    user: User,
    expected: str | None = None,
    request: Request | None = None,
) -> bool:
    """The KP working a request. Returns False when nothing changed.

    Allowed: offen ⇄ in Arbeit, either → erledigt, and erledigt → offen (the
    explicit «Wieder öffnen»). Anything else — erledigt → in Arbeit, typically a
    second operator acting on a stale screen — raises ``RequestConflictError``.
    ``expected`` is the state the client last saw; a mismatch is the same
    conflict. Load ``row`` with ``get_request(..., lock=True)``.

    Not for the OPEN Abholung → done: that one goes through ``record_pickup``
    (the API routes it there) so the flag and its work item cannot disagree.
    """
    if expected is not None and row.status != expected:
        raise RequestConflictError(row.status)
    if row.status == status:
        return False
    if status not in ALLOWED_TRANSITIONS.get(row.status, frozenset()):
        raise RequestConflictError(row.status)
    now = datetime.now(UTC)
    previous = row.status
    dismissed = False
    if status == "in_progress":
        row.status = "in_progress"
        row.in_progress_at = now
        row.in_progress_by_name = user_display(user)
        row.seen_at = row.seen_at or now
        row.done_at = None
        row.done_by_user_id = None
        row.done_by_name = None
    elif status == "done":
        close_request(row, user=user, name=user_display(user), now=now)
        dismissed = await dismiss_linked_notification(db, row, user, now)
    else:  # back to open — a mis-click on «erledigt» must be undoable
        row.status = "open"
        row.in_progress_at = None
        row.in_progress_by_name = None
        row.done_at = None
        row.done_by_user_id = None
        row.done_by_name = None

    await log_action(
        db=db,
        action_type="field_request_status",
        resource_type="incident",
        resource_id=incident.id,
        user=user,
        changes={
            "request_id": str(row.id),
            "kind": row.kind,
            "label": row.label,
            "from": previous,
            "to": status,
        },
        request=request,
    )
    await db.commit()
    await db.refresh(row)

    if dismissed:
        from ...websocket_manager import broadcast_notification_update

        await broadcast_notification_update(
            {"id": str(row.notification_id), "incident_id": str(incident.id)}, "dismiss"
        )
    return True


async def mark_seen_by_notification(db: AsyncSession, notification_id: uuid.UUID, now: datetime) -> int:
    """Dismissing a bell entry is the KP saying «gesehen» — never «erledigt».

    Called from ``notification_service.dismiss_notification``; the caller commits.
    """
    result = await db.execute(
        update(FieldRequest)
        .where(FieldRequest.notification_id == notification_id, FieldRequest.seen_at.is_(None))
        .values(seen_at=now)
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def close_messages_on_completion(
    db: AsyncSession, incident: Incident, *, user: User, request: Request | None = None
) -> int:
    """Completing a Schadenplatz closes its open Meldungen (owner decision, R13 review).

    Only ``kind='message'`` — a sentence the crew sent has nothing left to work
    once the KP closes the place. Material, Verstärkung and Abholung stay: a
    pump nobody brought or a crew still waiting is exactly what must not vanish
    with the card. Each closed row gets its own audit entry. The caller commits.
    """
    result = await db.execute(
        select(FieldRequest).where(
            FieldRequest.incident_id == incident.id,
            FieldRequest.kind == "message",
            FieldRequest.status.in_(OPEN_STATUSES),
        )
    )
    rows = list(result.scalars().all())
    now = datetime.now(UTC)
    for row in rows:
        previous = row.status
        close_request(row, user=user, name=user_display(user), now=now)
        await dismiss_linked_notification(db, row, user, now)
        await log_action(
            db=db,
            action_type="field_request_status",
            resource_type="incident",
            resource_id=incident.id,
            user=user,
            changes={
                "request_id": str(row.id),
                "kind": row.kind,
                "label": row.label,
                "from": previous,
                "to": "done",
                "reason": "incident_completed",
            },
            request=request,
        )
    return len(rows)
