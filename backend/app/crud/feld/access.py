"""The door: the Feld-Code, and the devices that came through it.

Three steps, and each one hands out a strictly stronger token than the last
(``services/tokens.FeldTokenClaims``):

1. the poster QR carries a **link** token, which opens nothing;
2. entering the Feld-Code exchanges it for an **unlocked** token, good only for
   reading the person picker;
3. picking your own name exchanges that for a **bound** token, which speaks for
   exactly one person and for no one else.

Step 2 is what makes a forwarded link or a three-week-old Einsatzzettel harmless,
and step 3 is what stops a shared device from acting as a colleague. Neither is
proof of identity — somebody may still deliberately pick the wrong name — and
that is the stated, accepted trust assumption of a brigade (decision 2).
"""

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import func as sa_func
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import Event, FeldDeviceClaim


def generate_code() -> str:
    """Four digits, uniformly random, leading zeros kept.

    ``secrets`` rather than ``random`` — this is a credential, however short.
    Four is enough because the code never stands alone: it gates a link the
    holder had to obtain in the first place, and the endpoint is rate limited.
    """
    return f"{secrets.randbelow(10000):04d}"


def code_matches(event: Event, code: str) -> bool:
    """Constant-time comparison of a submitted code against the event's.

    Constant time is close to theatre at four digits over a network, but it
    costs one function call and removes the need for the next reader to work
    out whether it matters here.
    """
    return secrets.compare_digest((event.feld_code or "").strip(), (code or "").strip())


async def regenerate_code(db: AsyncSession, event: Event) -> str:
    """A fresh code for an event whose old one got around.

    Deliberately does **not** touch existing claims: everyone already in the
    field keeps working, and only new devices need the new digits (decision 30).
    Throwing people out is ``revoke_all_claims`` and nothing else.
    """
    event.feld_code = generate_code()
    await db.commit()
    await db.refresh(event)
    return event.feld_code


async def create_claim(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID) -> FeldDeviceClaim:
    """Record the device that just named itself, and return its row."""
    claim = FeldDeviceClaim(event_id=event_id, personnel_id=personnel_id)
    db.add(claim)
    await db.commit()
    await db.refresh(claim)
    return claim


async def claim_is_live(db: AsyncSession, claim_id: uuid.UUID, event_id: uuid.UUID) -> bool:
    """Is the claim behind this bound token still good?

    Checked on every bound request — this is the recall a JWT cannot do by
    itself. The ``event_id`` is part of the lookup so a claim from one Ereignis
    can never authorise a request against another.
    """
    result = await db.execute(
        select(FeldDeviceClaim.id)
        .where(
            FeldDeviceClaim.id == claim_id,
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.revoked_at.is_(None),
        )
        .limit(1)
    )
    return result.first() is not None


async def live_device_count(db: AsyncSession, event_id: uuid.UUID) -> int:
    """How many devices currently hold a working bound token.

    What the board shows next to the code. Decision 28 chose *visible* sharing
    over a hard cap: a number the KP can react to beats an endpoint that starts
    refusing real firefighters on the one night they need it.
    """
    result = await db.execute(
        select(sa_func.count())
        .select_from(FeldDeviceClaim)
        .where(
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.revoked_at.is_(None),
        )
    )
    return int(result.scalar() or 0)


async def revoke_all_claims(db: AsyncSession, event_id: uuid.UUID) -> int:
    """The emergency brake: every bound token for this event stops working.

    For a lost phone, or a code that ended up somewhere public. Everyone in the
    field re-enters the code — which is why this is a separate, counted,
    explicitly confirmed action and not a side effect of regenerating the code.
    Returns how many devices were affected, so the UI can say so.
    """
    result = await db.execute(
        update(FeldDeviceClaim)
        .where(
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()
    return int(result.rowcount or 0)
