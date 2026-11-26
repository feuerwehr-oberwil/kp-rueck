"""Which system works on an Ereignis: the hosted board, or a standby box that took it offline.

An Ereignis a standby box took offline is synced both ways (app/standby_sync.py), and
``event_leads`` says which side works on it. What a system raises by itself – GPS questions,
bell rows – it raises only where it leads, or both would raise the same thing.
"""

import uuid
from collections.abc import Callable

from sqlalchemy import column, select, table
from sqlalchemy.ext.asyncio import AsyncSession

from ..environment import ROLE_STANDBY, deployment_role
from ..models import EventLead

# app/standby.py's list of Ereignisse a standby box has taken offline.
_DETACHED_EVENTS = table("detached_events", column("event_id"), schema="standby")


async def system_leads(db: AsyncSession) -> Callable[[uuid.UUID], bool]:
    """Whether this system leads an Ereignis – read once, asked per Ereignis.

    A standby box leads only Ereignisse it also took out of the mirror stream
    (``standby.detached_events``); every other one is the hosted board's, which leads all
    Ereignisse no box leads.
    """
    led_by_box = set(await db.scalars(select(EventLead.event_id).where(EventLead.holder == "standby")))
    if deployment_role() != ROLE_STANDBY:
        return lambda event_id: event_id not in led_by_box
    mine = led_by_box & set(await db.scalars(select(_DETACHED_EVENTS.c.event_id)))
    return lambda event_id: event_id in mine
