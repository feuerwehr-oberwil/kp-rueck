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
from datetime import UTC, datetime, timedelta

from sqlalchemy import func as sa_func
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import execute_dml
from ...models import Event, FeldDeviceClaim, FeldUnlockClaim

FELD_UNLOCK_MINUTES = 5


async def lock_event(db: AsyncSession, event_id: uuid.UUID) -> Event | None:
    """Serialize credential exchanges and revocation for one event."""
    result = await db.execute(
        select(Event).where(Event.id == event_id).with_for_update().execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def create_unlock(db: AsyncSession, event_id: uuid.UUID) -> FeldUnlockClaim:
    """Record the short-lived picker grant after the current code was checked."""
    grant = FeldUnlockClaim(event_id=event_id, expires_at=datetime.now(UTC) + timedelta(minutes=FELD_UNLOCK_MINUTES))
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return grant


async def unlock_is_live(db: AsyncSession, unlock_id: uuid.UUID, event_id: uuid.UUID) -> bool:
    """A picker grant is usable only until consumption, revocation or expiry."""
    result = await db.execute(
        select(FeldUnlockClaim.id).where(
            FeldUnlockClaim.id == unlock_id,
            FeldUnlockClaim.event_id == event_id,
            FeldUnlockClaim.consumed_at.is_(None),
            FeldUnlockClaim.revoked_at.is_(None),
            FeldUnlockClaim.expires_at > datetime.now(UTC),
        )
    )
    return result.first() is not None


async def consume_unlock(db: AsyncSession, unlock_id: uuid.UUID, event_id: uuid.UUID) -> bool:
    """Consume once in the same transaction that creates the device claim."""
    result = await db.execute(
        update(FeldUnlockClaim)
        .where(
            FeldUnlockClaim.id == unlock_id,
            FeldUnlockClaim.event_id == event_id,
            FeldUnlockClaim.consumed_at.is_(None),
            FeldUnlockClaim.revoked_at.is_(None),
            FeldUnlockClaim.expires_at > datetime.now(UTC),
        )
        .values(consumed_at=datetime.now(UTC))
        .returning(FeldUnlockClaim.id)
    )
    return result.first() is not None


async def _revoke_unlocks(db: AsyncSession, event_id: uuid.UUID) -> None:
    """Invalidate outstanding code exchanges without affecting bound phones."""
    await db.execute(
        update(FeldUnlockClaim)
        .where(FeldUnlockClaim.event_id == event_id, FeldUnlockClaim.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


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

    Existing bound phones keep working. Outstanding picker grants are revoked
    so somebody who has not finished naming themselves must enter the new code.
    """
    await lock_event(db, event.id)
    old_code = event.feld_code
    while event.feld_code == old_code:
        event.feld_code = generate_code()
    await _revoke_unlocks(db, event.id)
    await db.commit()
    await db.refresh(event)
    return event.feld_code


async def create_claim(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID) -> FeldDeviceClaim:
    """Record the device that just named itself, and return its row."""
    # Board-issued Reko links use this helper too, so they share the ordering
    # with logout-all even though they do not go through the picker exchange.
    await lock_event(db, event_id)
    claim = FeldDeviceClaim(event_id=event_id, personnel_id=personnel_id)
    db.add(claim)
    await db.commit()
    await db.refresh(claim)
    return claim


async def claim_is_live(db: AsyncSession, claim_id: uuid.UUID, event_id: uuid.UUID, personnel_id: uuid.UUID) -> bool:
    """Is the claim behind this bound token still good?

    Checked on every bound request — this is the recall a JWT cannot do by
    itself. Both event and person must match the stored claim; a signed token
    may not reuse another person's otherwise-live claim row.
    """
    result = await db.execute(
        select(FeldDeviceClaim.id)
        .where(
            FeldDeviceClaim.id == claim_id,
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.personnel_id == personnel_id,
            FeldDeviceClaim.revoked_at.is_(None),
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
    """The emergency brake: bound tokens and outstanding picker grants stop working.

    For a lost phone, or a code that ended up somewhere public. Everyone in the
    field re-enters the code — which is why this is a separate, counted,
    explicitly confirmed action and not a side effect of regenerating the code.
    Returns how many devices were affected, so the UI can say so.
    """
    await lock_event(db, event_id)
    await _revoke_unlocks(db, event_id)
    result = await execute_dml(
        db,
        update(FeldDeviceClaim)
        .where(
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC)),
    )
    await db.commit()
    return int(result.rowcount or 0)


async def revoke_claim(db: AsyncSession, claim_id: uuid.UUID, event_id: uuid.UUID, personnel_id: uuid.UUID) -> None:
    """Log out one phone without changing any other device's access."""
    await db.execute(
        update(FeldDeviceClaim)
        .where(
            FeldDeviceClaim.id == claim_id,
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.personnel_id == personnel_id,
        )
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()


async def is_checked_in(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID) -> bool:
    """Is this person present at this Ereignis?

    The individual half of the roll call, read by `/feld` so the page can offer
    "Einchecken" to somebody who has not, and "Ich rücke ab" to somebody who
    has. Same row the door tablet writes — one attendance record, two ways in.
    """
    from ...models import EventAttendance

    result = await db.execute(
        select(EventAttendance.checked_in).where(
            EventAttendance.event_id == event_id,
            EventAttendance.personnel_id == personnel_id,
        )
    )
    return bool(result.scalar_one_or_none())
