"""Which system works on an Ereignis: the hosted board, or a standby box that took it offline.

An Ereignis a standby box took offline is synced both ways (app/standby_sync.py), and
``event_leads`` says which side works on it. What a system raises by itself – GPS questions,
bell rows – it raises only where it leads, or both would raise the same thing.
"""

import uuid
from collections.abc import Callable

from sqlalchemy import column, select, table, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..environment import ROLE_STANDBY, deployment_role
from ..models import Event, EventLead

# app/standby.py's list of Ereignisse a standby box has taken offline.
_DETACHED_EVENTS = table("detached_events", column("event_id"), schema="standby")


async def system_leads(db: AsyncSession) -> Callable[[uuid.UUID], bool]:
    """Whether this system leads an Ereignis – read once, asked per Ereignis.

    A standby box leads only Ereignisse it also took out of the mirror stream
    (``standby.detached_events``); every other one is the hosted board's, which leads all
    Ereignisse no box leads. A box whose sidecar has not created ``standby.detached_events`` yet
    (first boot) leads nothing.
    """
    led_by_box = set(await db.scalars(select(EventLead.event_id).where(EventLead.holder == "standby")))
    if deployment_role() != ROLE_STANDBY:
        return lambda event_id: event_id not in led_by_box
    if await db.scalar(text("SELECT to_regclass('standby.detached_events')")) is None:
        return lambda _event_id: False
    mine = led_by_box & set(await db.scalars(select(_DETACHED_EVENTS.c.event_id)))
    return lambda event_id: event_id in mine


async def box_leads_locked(db: AsyncSession, event_id: uuid.UUID) -> bool:
    """On a standby box: whether it leads the Ereignis, with the lead row share-locked until the
    next commit – for a writer that must not write after a takeover moved the lead.

    Locked and read in one query: a takeover committed between a separate lock and read would
    leave the writes unlocked. No such row – mirrored, taken back, or a takeover not committed
    yet – means «not leading». The Ereignis row is key-shared first, the lock every row the
    writer inserts takes through its foreign key anyway: a permanent delete of the Ereignis
    (its row, then the lead row by cascade) waits for the writer instead of deadlocking with it.
    """
    if await db.scalar(text("SELECT to_regclass('standby.detached_events')")) is None:
        return False
    await db.execute(select(Event.id).where(Event.id == event_id).with_for_update(key_share=True))
    led = await db.scalar(
        select(EventLead.event_id)
        .join(_DETACHED_EVENTS, _DETACHED_EVENTS.c.event_id == EventLead.event_id)
        .where(EventLead.event_id == event_id, EventLead.holder == "standby")
        .with_for_update(read=True, of=EventLead)
    )
    return led is not None
