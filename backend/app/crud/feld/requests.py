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


async def get_request(db: AsyncSession, incident_id: uuid.UUID, request_id: uuid.UUID) -> FieldRequest | None:
    """One request, scoped to its incident so an id from another card is a 404."""
    result = await db.execute(
        select(FieldRequest).where(FieldRequest.id == request_id, FieldRequest.incident_id == incident_id)
    )
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
    request: Request | None = None,
) -> bool:
    """The KP working a request. Returns False when nothing changed.

    Not for ``pickup`` → done: that one goes through ``record_pickup`` (the API
    routes it there) so the flag and its work item cannot disagree.
    """
    if row.status == status:
        return False
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
