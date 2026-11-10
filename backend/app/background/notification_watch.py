"""Evaluates the notification rules on a clock, not only when a board asks.

The rules (Einsatz too long in a status, no Mannschaft, Dienstzeit, a vehicle arrived, storage)
are evaluated inside `GET /notifications/`. A board on a live socket does not poll that – it
fetches when a `notification_update` arrives – so with every socket up nothing evaluated the
rules, and an overdue Einsatz raised its alert only when something unrelated made a board
fetch. This loop runs the same evaluation once a minute for every open Ereignis and, when the
list changed, sends the `notification_update` the boards already reload on.

Not on a standby box: the evaluation writes rows, and a mirror's rows come from the hosted board.
"""

import asyncio
import contextlib
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..database import async_session_maker
from ..logging_config import get_logger
from ..models import Event
from ..services import notification_service
from ..websocket_manager import broadcast_notification_update

logger = get_logger(__name__)

INTERVAL_SECONDS = 60.0
_task: asyncio.Task[None] | None = None

#: What each open Ereignis's list looked like after the last tick – (id, dismissed, message),
#: so a new row, a resolved one and a text kept up to date in place (Dienstzeit) all count.
Fingerprint = frozenset[tuple[UUID, bool, str]]
_seen: dict[UUID, Fingerprint] = {}


async def evaluate_open_events(session_maker: async_sessionmaker[AsyncSession] | None = None) -> list[UUID]:
    """One tick. Returns the Ereignisse whose list changed since the tick before (and were told).

    `session_maker` is for tests; the loop uses the app's own.
    """
    maker = async_session_maker if session_maker is None else session_maker
    async with maker() as db:
        event_ids = list(await db.scalars(select(Event.id).where(Event.archived_at.is_(None))))
    for gone in set(_seen) - set(event_ids):
        del _seen[gone]

    changed: list[UUID] = []
    for event_id in event_ids:
        try:
            # One session and one commit per Ereignis: a failure in one leaves the others alone.
            async with maker() as db:
                notifications = await notification_service.evaluate_notifications(db, event_id)
                fingerprint: Fingerprint = frozenset((n.id, n.dismissed, n.message) for n in notifications)
                await db.commit()  # this loop owns the transaction – there is no request to commit it
        except Exception:
            logger.exception("Notification evaluation failed for Ereignis %s", event_id)
            continue
        before = _seen.get(event_id)
        _seen[event_id] = fingerprint
        # The first look after a start has nothing to compare with; boards fetch on connect anyway.
        if before is not None and before != fingerprint:
            changed.append(event_id)
            await broadcast_notification_update({"event_id": str(event_id)}, "refresh")
    return changed


async def _watch() -> None:
    while True:
        await asyncio.sleep(INTERVAL_SECONDS)
        try:
            await evaluate_open_events()
        except Exception:  # a failed tick must never end the loop
            logger.exception("Notification watch tick failed")


def start_notification_watch() -> None:
    """Start the loop (once). Called from the lifespan, except on a standby box."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_watch())


async def stop_notification_watch() -> None:
    """Cancel the loop on shutdown."""
    global _task
    if _task is not None:
        _task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _task
        _task = None
    _seen.clear()
