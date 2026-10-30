"""Tells open boards to reload when the standby mirror has applied something new.

Replicated rows land in the database without passing through this backend, so none of the
usual WebSocket pushes go out – and a board on a live socket does not poll. This loop watches
how far the subscription has got (`pg_stat_subscription.received_lsn`) and, when it moves,
sends the generic updates a board already reloads on. Only on `DEPLOYMENT_ROLE=standby`.
"""

import asyncio
import contextlib

from sqlalchemy import text

from ..database import async_session_maker
from ..logging_config import get_logger
from ..standby import SUBSCRIPTION
from ..websocket_manager import broadcast_group_update, broadcast_incident_update, broadcast_personnel_update

logger = get_logger(__name__)

INTERVAL_SECONDS = 2.0
_task: asyncio.Task[None] | None = None


async def _watch() -> None:
    last: str | None = None
    while True:
        try:
            async with async_session_maker() as db:
                position = await db.scalar(
                    text("SELECT received_lsn::text FROM pg_stat_subscription WHERE subname = :name AND relid IS NULL"),
                    {"name": SUBSCRIPTION},
                )
            if position is not None and position != last:
                if last is not None:
                    await broadcast_incident_update({}, "refresh")
                    await broadcast_group_update({}, "refresh")
                    await broadcast_personnel_update({}, "refresh")
                last = position
        except Exception as exc:  # a failed probe must never end the loop
            logger.warning(f"Standby watch probe failed: {exc}")
        await asyncio.sleep(INTERVAL_SECONDS)


def start_standby_watch() -> None:
    """Start the loop (once). Called from the lifespan on a standby box only."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_watch())


async def stop_standby_watch() -> None:
    """Cancel the loop on shutdown."""
    global _task
    if _task is not None:
        _task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _task
        _task = None
