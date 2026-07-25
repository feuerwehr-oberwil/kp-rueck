"""Who decided, and what they decided.

The one module in ``app/telemetry/`` that is NOT vendored byte-for-byte from kp-front: consent
has to live wherever a given app already keeps deployment state, and the two apps keep it
differently (kp-front has a `deployment_config` singleton, this one has a key/value `settings`
table). Everything either app actually *sends* — scrub, envelope, outbox, forwarder — is
identical and checked by ``tests/test_telemetry_vendored.py``. The glue is allowed to differ;
the payload is not.

Consent lives on the deployment, not on the device. The Feuerwehr is the data controller, not
whoever happens to be logged in, so this sits behind the **admin** role — deliberately NOT in
``DEFAULT_SETTINGS``, because the generic ``PATCH /api/settings/{key}`` endpoint is open to any
editor and its allow-list is what keeps this key out of reach.

The background channel needs that switch. The manual "Problem melden" channel does not: the
operator reads the full payload and presses send, and pressing send IS the consent.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Setting

logger = logging.getLogger("kp.telemetry")

CONSENT_KEY = "telemetry.consent"
INSTALL_ID_KEY = "telemetry.install_id"

# 'off' and a missing row are the same thing; a missing row is what every existing deployment
# upgrades into, which is what makes "off unless switched on" true without any code running.
CONSENT_OFF = "off"
CONSENT_ERRORS = "errors"
VALID_CONSENT = {CONSENT_OFF, CONSENT_ERRORS}


def env_allows_outbound() -> bool:
    """The deployer's kill switch, which outranks anything an admin clicks.

    ``KP_TELEMETRY_ENABLED=0`` (or an empty DSN) means this process will not talk to an
    ingest, full stop. A station whose IT policy is set centrally can enforce it in the
    compose file instead of trusting that nobody ticks a box later.
    """
    return bool(settings.telemetry_enabled and settings.telemetry_dsn)


async def _get(db: AsyncSession, key: str) -> str | None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    return row.value if row else None


async def _set(db: AsyncSession, key: str, value: str) -> None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value


async def get_consent(db: AsyncSession) -> str:
    """Current background-channel consent. Anything unrecognised reads as off (fail-closed)."""
    if not env_allows_outbound():
        return CONSENT_OFF
    value = await _get(db, CONSENT_KEY)
    return value if value in VALID_CONSENT else CONSENT_OFF


async def is_decided(db: AsyncSession) -> bool:
    """Has anyone ever actually answered the question?

    A missing row and 'off' behave identically — both send nothing — but they are not the same
    state to a human, and conflating them is how opt-in quietly becomes opt-out-by-neglect. No
    row means nobody was ever asked, so the admin surface asks once, with nothing preselected.
    """
    return (await _get(db, CONSENT_KEY)) in VALID_CONSENT


async def set_consent(db: AsyncSession, value: str) -> str:
    """Record an admin's decision. Returns what was actually stored."""
    if value not in VALID_CONSENT:
        raise ValueError(f"telemetry consent must be one of {sorted(VALID_CONSENT)}")
    await _set(db, CONSENT_KEY, value)
    logger.info("telemetry consent set to %s", value)
    return value


async def get_install_id(db: AsyncSession, *, mint: bool = False) -> str | None:
    """The random per-install id, minted lazily on first send.

    Lazily, because an instance that never opts in should not carry an identifier for a thing
    it never did. Not derived from the hostname, the config or the DB: it identifies reports as
    same-origin and nothing else.
    """
    existing = await _get(db, INSTALL_ID_KEY)
    if existing:
        return existing
    if not mint:
        return None
    new_id = str(uuid.uuid4())
    await _set(db, INSTALL_ID_KEY, new_id)
    logger.info("telemetry install id minted: %s", new_id)
    return new_id


async def regenerate_install_id(db: AsyncSession) -> str:
    """Cut the link to everything sent so far.

    The self-service half of a deletion request: reports we already hold keep the old id, and
    nothing sent from now on can be joined to them. See PRIVACY.md for the other half.
    """
    new_id = str(uuid.uuid4())
    await _set(db, INSTALL_ID_KEY, new_id)
    logger.info("telemetry install id regenerated")
    return new_id
