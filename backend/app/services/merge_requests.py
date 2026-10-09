"""Field requests follow a merge (R2 × R13, owner decision 09.10.2026).

A duplicate card used to be unmergeable as soon as the field had asked for
anything on it — «Material nötig», «Verstärkung», a message, an Abholung —
because merging hid the card and everything hanging off it. The owner's call:
the requests MOVE. They are the same Schadenplatz's requests, so they belong on
the card that survives:

* every request of the losing card (any kind, any state, with its whole
  history: who asked, «gesehen», «in Arbeit», «erledigt») moves to the
  surviving card, and its bell entries move with it — the sidebar and the
  card show them where the work now is;
* each move is audited on the surviving card (``field_request_moved``), which
  the journal turns into «Anfrage übernommen von …»;
* the crew's `/feld` view follows through the visibility union, which maps a
  merged card to the one it went into (``crud/feld/visibility.py``).

**One open Abholung per Einsatz** (the partial unique index says so, and two
pickups for one address would send two cars). When both cards have one open,
the surviving card's stays open and the losing card's is closed — «erledigt»
by the merge, with the operator's name — and its note is appended to the
surviving one's (``Abholung: 2 Personen + 3 Personen beim Bach``), so nobody
waiting is forgotten. That is the safe option: no row is deleted, no note is
lost, and the crew sees one Abholung that covers them. When only the losing
card has one, the flag (note, since-when, by-whom) is copied onto the
surviving card and the work item moves with it.

**«Trennen» moves everything back** — every request and bell entry the merge
moved that still sits on the surviving card. A closed duplicate Abholung is
reopened if the joint one is still open; if the joint one was handled in the
meantime, both crews were collected and it stays closed (its flag is cleared).
A copied Abholung goes back open if it still is open; one the KP handled on
the surviving card goes back closed, and the losing card's flag is cleared.
The audit row of the merge carries only ids and which case applied — no note
text (PII); anything the undo needs is still on the two cards.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..crud.feld.requests import (
    OPEN_STATUSES,
    close_request,
    dismiss_linked_notification,
    dismiss_pickup_bells,
    user_display,
)
from .audit import log_action

MOVED_ACTION = "field_request_moved"

#: How the merge joined two open Abholungen: the surviving card's note, this, the losing one's.
PICKUP_NOTE_JOIN = " + "


def _joined_pickup_note(target_note: str | None, report_note: str | None) -> str | None:
    if not report_note:
        return target_note
    if not target_note:
        return report_note
    return f"{target_note}{PICKUP_NOTE_JOIN}{report_note}"


async def _requests_of(db: AsyncSession, incident_id: uuid.UUID) -> list[models.FieldRequest]:
    result = await db.execute(
        select(models.FieldRequest)
        .where(models.FieldRequest.incident_id == incident_id)
        .order_by(models.FieldRequest.created_at)
        .with_for_update()
    )
    return list(result.scalars().all())


async def _open_pickup_rows(db: AsyncSession, incident_id: uuid.UUID) -> list[models.FieldRequest]:
    result = await db.execute(
        select(models.FieldRequest).where(
            models.FieldRequest.incident_id == incident_id,
            models.FieldRequest.kind == "pickup",
            models.FieldRequest.status.in_(OPEN_STATUSES),
        )
    )
    return list(result.scalars().all())


async def _audit_move(
    db: AsyncSession,
    row: models.FieldRequest,
    *,
    to_incident: models.Incident,
    from_incident: models.Incident,
    reason: str,
    user: models.User | None,
    request: Request | None,
) -> None:
    await log_action(
        db=db,
        action_type=MOVED_ACTION,
        resource_type="incident",
        resource_id=to_incident.id,
        user=user,
        changes={
            "request_id": str(row.id),
            "kind": row.kind,
            "label": row.label,
            "status": row.status,
            "from_incident_id": str(from_incident.id),
            "to_incident_id": str(to_incident.id),
            "reason": reason,
        },
        request=request,
    )


async def move_requests_in(
    db: AsyncSession,
    *,
    report: models.Incident,
    target: models.Incident,
    user: models.User | None,
    request: Request | None = None,
) -> dict[str, Any]:
    """Move the losing card's requests and bell entries onto the surviving card.

    Returns what the merge audit row has to remember for «Trennen» (ids and the
    Abholung case only). The caller holds both rows locked and flushes/commits.
    """
    rows = await _requests_of(db, report.id)
    now = datetime.now(UTC)
    name = user_display(user)

    target_open_pickup = (await _open_pickup_rows(db, target.id)) or None
    pickup_case: str | None = None
    copied_pickup_id: str | None = None
    moved_ids: list[str] = []
    closed_pickup_ids: list[str] = []

    for row in rows:
        open_pickup = row.kind == "pickup" and row.status in OPEN_STATUSES
        if open_pickup and (target_open_pickup or target.pickup_needed):
            # Both cards wait for a car: ONE Abholung. The surviving card's stays
            # open, carrying both notes; this one is answered by the merge.
            pickup_case = "joined"
            joined = _joined_pickup_note(target.pickup_note, report.pickup_note)
            target.pickup_note = joined
            for open_row in target_open_pickup or []:
                open_row.text = joined
            close_request(row, user=user, name=name, now=now)
            await dismiss_linked_notification(db, row, user, now)
            closed_pickup_ids.append(str(row.id))
            await log_action(
                db=db,
                action_type="field_request_status",
                resource_type="incident",
                resource_id=report.id,
                user=user,
                changes={
                    "request_id": str(row.id),
                    "kind": row.kind,
                    "label": row.label,
                    "from": "open",
                    "to": "done",
                    "reason": "merged_into_open_pickup",
                },
                request=request,
            )
        elif open_pickup:
            # Only the losing card waits: the surviving card now does.
            pickup_case = "copied"
            copied_pickup_id = str(row.id)
            target.pickup_needed = True
            target.pickup_note = report.pickup_note
            target.pickup_requested_at = report.pickup_requested_at or row.created_at
            target.pickup_requested_by = report.pickup_requested_by

        row.incident_id = target.id
        moved_ids.append(str(row.id))
        await _audit_move(db, row, to_incident=target, from_incident=report, reason="merge", user=user, request=request)

    if pickup_case == "joined":
        # The duplicate's «Abholung nötig» bells are answered by the joint Abholung —
        # dismissed here, BEFORE they move, so the surviving card's own stay up.
        await dismiss_pickup_bells(db, report.id, user, now)

    # The bell follows the work: every announcement of the losing card now points
    # at the card it went into, so «Öffnen» from the sidebar lands on a live card.
    notification_ids = (
        (
            await db.execute(
                update(models.Notification)
                .where(models.Notification.incident_id == report.id)
                .values(incident_id=target.id)
                .returning(models.Notification.id)
            )
        )
        .scalars()
        .all()
    )
    await db.flush()
    return {
        "moved_request_ids": moved_ids,
        "closed_pickup_ids": closed_pickup_ids,
        "moved_notification_ids": [str(n) for n in notification_ids],
        "pickup_case": pickup_case,
        "copied_pickup_id": copied_pickup_id,
    }


async def move_requests_back(
    db: AsyncSession,
    *,
    report: models.Incident,
    target: models.Incident,
    merge_changes: dict[str, Any],
    user: models.User | None,
    request: Request | None = None,
) -> int:
    """«Trennen»: what the merge moved goes back to the card it came from.

    Only rows (and bell entries) that still sit on the surviving card move —
    one an operator moved on by hand since is left where it is. Returns how
    many requests went back. The caller flushes/commits.
    """
    moved = [uuid.UUID(i) for i in merge_changes.get("moved_request_ids") or []]
    closed = {uuid.UUID(i) for i in merge_changes.get("closed_pickup_ids") or []}
    if not moved and not merge_changes.get("moved_notification_ids"):
        return 0

    rows: list[models.FieldRequest] = []
    if moved:
        result = await db.execute(
            select(models.FieldRequest)
            .where(models.FieldRequest.id.in_(moved), models.FieldRequest.incident_id == target.id)
            .with_for_update()
        )
        rows = list(result.scalars().all())

    for row in rows:
        # Back on its own card FIRST: the queries below autoflush, and a duplicate
        # Abholung reopened while still on the surviving card would be its second
        # open one (uq_field_requests_open_pickup).
        row.incident_id = report.id
        if row.id in closed:
            # The duplicate Abholung the merge answered. Still waiting together?
            # Then it is open again on its own card. Collected meanwhile? Then
            # it stays answered and the losing card's flag goes with it.
            joint_still_open = bool(await _open_pickup_rows(db, target.id)) and target.pickup_needed
            if joint_still_open and report.pickup_needed:
                row.status = "open"
                row.done_at = None
                row.done_by_user_id = None
                row.done_by_name = None
                # The joint note loses the half that belonged to this card — only
                # if it still reads exactly what the merge wrote.
                own = report.pickup_note
                if own and target.pickup_note and target.pickup_note.endswith(f"{PICKUP_NOTE_JOIN}{own}"):
                    target.pickup_note = target.pickup_note[: -len(f"{PICKUP_NOTE_JOIN}{own}")] or None
                    for open_row in await _open_pickup_rows(db, target.id):
                        open_row.text = target.pickup_note
            else:
                _clear_pickup_flag(report)
        elif str(row.id) == merge_changes.get("copied_pickup_id"):
            if row.status in OPEN_STATUSES:
                # Still waiting: the surviving card stops waiting for them, unless
                # it has its own open Abholung by now (then that one stays).
                others = [r for r in await _open_pickup_rows(db, target.id) if r.id != row.id]
                if not others:
                    _clear_pickup_flag(target)
            else:
                # Handled on the surviving card while merged: it is handled for
                # the card it came from too.
                _clear_pickup_flag(report)
        await _audit_move(
            db, row, to_incident=report, from_incident=target, reason="unmerge", user=user, request=request
        )

    notification_ids = [uuid.UUID(i) for i in merge_changes.get("moved_notification_ids") or []]
    if notification_ids:
        await db.execute(
            update(models.Notification)
            .where(models.Notification.id.in_(notification_ids), models.Notification.incident_id == target.id)
            .values(incident_id=report.id)
        )
    await db.flush()
    return len(rows)


def _clear_pickup_flag(incident: models.Incident) -> None:
    incident.pickup_needed = False
    incident.pickup_note = None
    incident.pickup_requested_at = None
    incident.pickup_requested_by = None
