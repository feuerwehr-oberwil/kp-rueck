"""The share links of an Ereignis – check-in, viewer, alarm intake – and how to take one back.

A share link is a signed token with an expiry. Without more, a leaked link works until it
expires (the alarm link: 30 days), and the only way to stop it was a new SECRET_KEY, which
ends every session. So each Ereignis keeps one generation number per kind of link:

- `issue` signs a token that carries the current generation;
- `event_of` opens the Ereignis only for a token of the current generation;
- `revoke` adds one. Every link of that kind issued before is dead, at once.

Every route that accepts one of these links asks `event_of`, never `tokens.link_claims` alone.
"""

from uuid import UUID

from sqlalchemy import select, update
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
    """The Ereignis this link opens. None when it is forged, expired, of another kind or revoked.

    A token of an Ereignis that no longer exists still names it: the caller answers «not found»
    as before.
    """
    claims = link_claims(token, kind)
    if claims is None:
        return None
    current = await db.scalar(select(_GENERATION[kind]).where(Event.id == claims.event_id))
    if current is not None and current != claims.generation:
        return None
    return claims.event_id


async def revoke(db: AsyncSession, kind: LinkKind, event_id: UUID) -> bool:
    """End every link of this kind issued so far for this Ereignis. False: no such Ereignis."""
    column = _GENERATION[kind]
    revoked = await db.scalar(
        update(Event).where(Event.id == event_id).values({column: column + 1}).returning(Event.id)
    )
    return revoked is not None
