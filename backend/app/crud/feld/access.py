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

import math
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy import func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import execute_dml
from ...models import Event, EventAttendance, FeldCodeAttempt, FeldDeviceClaim, FeldUnlockClaim

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
    await db.flush()
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
    holder had to obtain in the first place, and wrong tries are throttled per
    phone and per address (``record_code_failure``).
    """
    return f"{secrets.randbelow(10000):04d}"


def code_matches(event: Event, code: str) -> bool:
    """Constant-time comparison of a submitted code against the event's.

    Constant time is close to theatre at four digits over a network, but it
    costs one function call and removes the need for the next reader to work
    out whether it matters here.
    """
    # As bytes: compare_digest raises on a str with non-ASCII characters, and this one is typed.
    return secrets.compare_digest((event.feld_code or "").strip().encode(), (code or "").strip().encode())


async def _rotate_code(db: AsyncSession, event: Event) -> None:
    """New digits and outstanding picker grants revoked. No commit."""
    old_code = event.feld_code
    while event.feld_code == old_code:
        event.feld_code = generate_code()
    await _revoke_unlocks(db, event.id)


async def regenerate_code(db: AsyncSession, event: Event) -> str:
    """A fresh code for an event whose old one got around.

    Existing bound phones keep working. Outstanding picker grants are revoked
    so somebody who has not finished naming themselves must enter the new code.
    """
    await lock_event(db, event.id)
    await _rotate_code(db, event)
    await db.flush()
    await db.refresh(event)
    return event.feld_code


# Wrong Feld-Codes per phone and per address: this many are free, then every further one
# locks that phone or address for the next wait – 1, 5, then 15 minutes for good.
FREE_CODE_TRIES = 5
CODE_WAITS_SECONDS = (60, 300, 900)


def code_subjects(address: str, device: uuid.UUID | None) -> list[str]:
    """Whom a try counts against: the address always, the phone when it says which it is."""
    return [f"ip:{address}"] + ([f"device:{device}"] if device else [])


async def _attempts(db: AsyncSession, event_id: uuid.UUID, subjects: list[str]) -> list[FeldCodeAttempt]:
    result = await db.execute(
        select(FeldCodeAttempt).where(FeldCodeAttempt.event_id == event_id, FeldCodeAttempt.subject.in_(subjects))
    )
    return list(result.scalars().all())


def _seconds_until(moment: datetime | None, now: datetime) -> int:
    return max(0, math.ceil((moment - now).total_seconds())) if moment else 0


async def code_wait_seconds(db: AsyncSession, event_id: uuid.UUID, subjects: list[str]) -> int:
    """How long these subjects must still wait before trying again (0 = they may try now)."""
    now = datetime.now(UTC)
    return max((_seconds_until(a.locked_until, now) for a in await _attempts(db, event_id, subjects)), default=0)


async def record_code_failure(db: AsyncSession, event_id: uuid.UUID, subjects: list[str]) -> tuple[int, int]:
    """Count one wrong code against each subject. Returns (seconds to wait, tries left).

    The caller holds the event row lock (``lock_event``), so two phones failing at the same
    instant cannot both read 4 and write 5. Flushes; the CALLER commits before the 403/429 it
    raises next, or the count is rolled back with it. The code itself never moves here – a
    guesser must not be able to lock every crew out of the door (rotating is «Neu generieren»).
    """
    now = datetime.now(UTC)
    known = {a.subject: a for a in await _attempts(db, event_id, subjects)}
    wait, left = 0, FREE_CODE_TRIES
    for subject in subjects:
        attempt = known.get(subject) or FeldCodeAttempt(event_id=event_id, subject=subject, failures=0)
        db.add(attempt)
        attempt.failures += 1
        over = attempt.failures - FREE_CODE_TRIES
        if over >= 0:
            attempt.locked_until = now + timedelta(seconds=CODE_WAITS_SECONDS[min(over, len(CODE_WAITS_SECONDS) - 1)])
        wait = max(wait, _seconds_until(attempt.locked_until, now))
        left = min(left, max(0, FREE_CODE_TRIES - attempt.failures))
    await db.flush()
    return wait, left


async def clear_code_failures(db: AsyncSession, event_id: uuid.UUID, subjects: list[str]) -> None:
    """The right code: that phone and that address start over (the next phone on the same
    Wi-Fi must not carry the fumbles of the one before)."""
    await db.execute(
        delete(FeldCodeAttempt).where(FeldCodeAttempt.event_id == event_id, FeldCodeAttempt.subject.in_(subjects))
    )


async def create_claim(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID) -> FeldDeviceClaim:
    """Record the device that just named itself, and return its row."""
    # Board-issued Reko links use this helper too, so they share the ordering
    # with logout-all even though they do not go through the picker exchange.
    await lock_event(db, event_id)
    claim = FeldDeviceClaim(event_id=event_id, personnel_id=personnel_id)
    db.add(claim)
    await db.flush()
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
    await db.flush()
    return int(result.rowcount or 0)


async def revoke_claim(db: AsyncSession, claim_id: uuid.UUID, event_id: uuid.UUID, personnel_id: uuid.UUID) -> None:
    """Log out one phone without changing any other device's access."""
    await db.execute(
        update(FeldDeviceClaim)
        .where(
            FeldDeviceClaim.id == claim_id,
            FeldDeviceClaim.event_id == event_id,
            FeldDeviceClaim.personnel_id == personnel_id,
            FeldDeviceClaim.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    await db.flush()


async def own_attendance(db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID) -> EventAttendance | None:
    """This person's attendance row at this Ereignis (or None) – `/feld` reads its plan
    («Ich bin da bis …») from it besides `checked_in`."""
    result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id,
            EventAttendance.personnel_id == personnel_id,
        )
    )
    return result.scalar_one_or_none()


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
