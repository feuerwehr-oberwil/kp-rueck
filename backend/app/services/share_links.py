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

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from ..crud.locking import lock_ereignis
from ..environment import ROLE_STANDBY, deployment_role
from ..models import Event
from ..standby_sync import HOSTED, LINK_REVOKE_STEP, STANDBY
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
    to compare, so its links open nothing).

    A write through the link holds the Ereignis lock already (``crud.locking.lock_request_ereignisse``
    reads the ``token``), and so do `revoke` and a delete of the Ereignis: neither can run
    between this check and the write."""
    claims = link_claims(token, kind)
    if claims is None:
        return None
    current = await db.scalar(select(_GENERATION[kind]).where(Event.id == claims.event_id))
    return claims.event_id if current == claims.generation else None


async def revoke(db: AsyncSession, kind: LinkKind, event_id: UUID) -> bool:
    """End every link of this kind issued so far for this Ereignis. False: no such Ereignis.

    The number holds two counters, one for the hosted board and one for a standby box
    (standby_sync `LINK_REVOKE_STEP`); a revoke raises the counter of the system it runs on.
    Both can revoke while they are apart: the sync takes the higher of each counter, so after
    it no link issued on either side before either revoke matches any more.
    """
    step = LINK_REVOKE_STEP[STANDBY if deployment_role() == ROLE_STANDBY else HOSTED]
    # Under the Ereignis lock (`crud.locking.lock_ereignis`): a write in flight through a link
    # of this Ereignis holds it too, so the revoke waits for it.
    await lock_ereignis(db, event_id)
    column = _GENERATION[kind]
    revoked = await db.scalar(
        update(Event).where(Event.id == event_id).values({column: column + step}).returning(Event.id)
    )
    return revoked is not None
