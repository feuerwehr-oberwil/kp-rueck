"""The share links of an Ereignis – check-in, viewer, alarm intake – and how to take one back.

A share link is a signed token with an expiry. Without more, a leaked link works until it
expires (the alarm link: 30 days), and the only way to stop it was a new SECRET_KEY, which
ends every link, Reko form and Feld device of every Ereignis. So each Ereignis keeps one
generation number per kind of link:

- `issue` signs a token that carries the current generation;
- `event_of` opens the Ereignis only for a token of the current generation;
- `revoke` moves the number on. Every link of that kind issued before is dead, at once.

Every route that accepts one of these links asks `event_of`, never `tokens.link_claims` alone.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from ..models import Event
from .tokens import LinkKind, generate_link_token, link_claims

_GENERATION: dict[LinkKind, InstrumentedAttribute[int]] = {
    "checkin": Event.checkin_link_generation,
    "viewer": Event.viewer_link_generation,
    "alarm": Event.alarm_link_generation,
}


async def issue(db: AsyncSession, kind: LinkKind, event_id: UUID) -> str | None:
    """A new link token of the current generation. None when the Ereignis does not exist."""
    generation = await db.scalar(select(_GENERATION[kind]).where(Event.id == event_id))
    if generation is None:
        return None
    return generate_link_token(kind, event_id, generation)


async def event_of(db: AsyncSession, kind: LinkKind, token: str) -> UUID | None:
    """The Ereignis this link opens. None when it is forged, expired, of another kind or
    revoked, and when its Ereignis no longer exists (a deleted Ereignis has no generation left
    to compare, so its links open nothing)."""
    claims = link_claims(token, kind)
    if claims is None:
        return None
    current = await db.scalar(select(_GENERATION[kind]).where(Event.id == claims.event_id))
    return claims.event_id if current == claims.generation else None


# Generations count seconds from here, so the number fits the Integer column for decades.
_GENERATION_EPOCH = datetime(2026, 1, 1, tzinfo=UTC)


def _generation_now() -> int:
    return int((datetime.now(UTC) - _GENERATION_EPOCH).total_seconds())


async def revoke(db: AsyncSession, kind: LinkKind, event_id: UUID) -> bool:
    """End every link of this kind issued so far for this Ereignis. False: no such Ereignis.

    The new generation is taken from the clock (and is at least one more than before), not
    counted up by one. A standby box and the hosted board can both revoke while they are
    apart: counted, both would land on the same number, and the link one of them issued after
    its revoke would survive the other's. From the clock the two numbers differ, the sync
    keeps the higher (standby_sync `ONLY_GROWS`), and the links of both are dead.
    """
    column = _GENERATION[kind]
    revoked = await db.scalar(
        update(Event)
        .where(Event.id == event_id)
        .values({column: func.greatest(column + 1, _generation_now())})
        .returning(Event.id)
    )
    return revoked is not None
