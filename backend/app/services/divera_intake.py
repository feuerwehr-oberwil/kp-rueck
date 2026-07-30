"""Divera inbound intake: type/priority inference and event auto-attach.

Shared by the webhook endpoint, the polling fallback and the manual attach
endpoints so all ingest paths derive the same incident from an emergency.

The keyword vocabulary is not a literal here any more. It lives in
``app/data/alarm_keywords.json``, vendored byte-for-byte from kp-front and pinned by
checksum on both sides — the same mechanism as ``app/telemetry/``, and for the same reason:
``docs/RUNNING-BOTH.md`` promises self-hosters no shared library and no runtime coupling, so
the copies stay copies and a test compares them. Before that, both products carried the same
two tables by hand and nothing compared them; ``GASLECK`` existed here and not there.

Nothing in that file is Divera's — the words are German fire-service words and the categories
are the FKS Schadenkategorien; Divera is one way they arrive. It was named
``divera_keywords.json`` until 2026-08-02 and was renamed for that reason.

The *matcher* below stays ours. kp-front matches every keyword as a plain substring; this
module requires letter boundaries for a few ambiguous ones. That difference is real and is
recorded in the shared file rather than quietly settled — see ``known_matcher_divergence``.
"""

import logging
import re
import secrets as _secrets
import uuid
from typing import Any

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..alarm_keywords import (
    FALLBACK_CATEGORY,
    HIGH_PRIORITY_KEYWORDS,
    KEYWORD_TO_CATEGORY,
    KP_RUECK_WORD_BOUNDED,
)
from ..crud import divera as divera_crud
from ..crud import events as events_crud
from .audit import log_action
from .settings import get_alarm_webhook_secret

logger = logging.getLogger(__name__)


async def check_webhook_secret(db: AsyncSession, request: Request | None, *, label: str) -> None:
    """Validate the shared inbound-alarm secret, failing closed when none is configured.

    Both inbound alarm endpoints — the provider-neutral POST /api/alarms and the Divera
    adapter — must answer the same way, because they write to the same board. They did not:
    the Divera one guarded with `if webhook_secret:`, so an unconfigured (or emptied) secret
    skipped the check and left an unauthenticated write endpoint open. `alarm_webhook_secret`
    is in the PATCH allowlist, so any editor could reach that state from the settings UI.

    Fail-closed is the only safe direction here: a station that has not configured a secret
    has not authorised anyone to create incidents on its board.
    """
    webhook_secret = await get_alarm_webhook_secret(db)
    if not webhook_secret:
        logger.warning("%s rejected: no alarm_webhook_secret configured", label)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    provided = ""
    if request is not None:
        provided = request.query_params.get("secret", "") or request.headers.get("X-Webhook-Secret", "")

    if not provided or not _secrets.compare_digest(provided, webhook_secret):
        logger.warning("%s rejected: invalid or missing secret", label)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)


def _incident_type(category: str) -> schemas.IncidentType:
    """Resolve a shared category key to our enum, degrading if it is one we don't know yet.

    kp-front may add a category to the shared file before this side grows a matching enum
    member. Refusing to import would take the alarm intake down over a category nobody has
    ever dispatched; filing it under DIVERSE_EINSAETZE until someone looks does not. The loud
    half of that trade is in tests/test_services/test_alarm_keywords.py, which fails the
    build on exactly this condition.
    """
    try:
        return schemas.IncidentType(category)
    except ValueError:
        logger.warning("divera keywords: no IncidentType for category %r — using the fallback", category)
        return schemas.IncidentType(FALLBACK_CATEGORY)


# Divera title keyword → IncidentType. Derived from the shared vocabulary, not retyped, so it
# cannot drift from kp-front's copy unnoticed. Order matters: first hit in the title wins.
INCIDENT_TYPE_MAPPING = {keyword: _incident_type(category) for keyword, category in KEYWORD_TO_CATEGORY}

def detect_incident_type(title: str) -> schemas.IncidentType:
    """
    Detect incident type from Divera title.

    Args:
        title: Divera alarm title (e.g., "FEUER3", "THL-VERKEHR")

    Returns:
        Detected IncidentType, defaults to DIVERSE_EINSAETZE if no match
    """
    title_upper = title.upper()

    for keyword, incident_type in INCIDENT_TYPE_MAPPING.items():
        if keyword in title_upper:
            return incident_type

    # Default fallback
    return _incident_type(FALLBACK_CATEGORY)


# Short/generic keywords that are substrings of harmless everyday words
# ("GASSE", "LIFTECH", ...) must match as standalone words. Only LETTERS count
# as word characters — digits/dashes still delimit ("FEUER3", "THL-VU" match).
# The set itself lives in the shared file, so kp-front can see what we do differently.
_WORD_BOUNDED_KEYWORDS = KP_RUECK_WORD_BOUNDED
_LETTER = "A-ZÄÖÜ"


def _keyword_in(keyword: str, text: str) -> bool:
    """Whether `keyword` occurs in `text` (both uppercase).

    Ambiguous short keywords are matched with letter boundaries so "GAS"
    doesn't fire on "GASSE"; everything else stays a plain substring match so
    compounds like "VOLLBRANDMELDUNG" keep matching.
    """
    if keyword in _WORD_BOUNDED_KEYWORDS:
        return re.search(rf"(?<![{_LETTER}]){re.escape(keyword)}(?![{_LETTER}])", text) is not None
    return keyword in text


def infer_priority_from_text(title: str, text: str | None = None) -> schemas.IncidentPriority:
    """
    Infer incident priority from title and text content.

    HIGH priority keywords indicate life-threatening or critical situations:
    - Fire/Brand emergencies
    - BMA (building fire alarms)
    - Person rescue situations
    - Gas leaks
    - Chemical hazards
    - Medical emergencies

    Everything else defaults to LOW. Only life-threatening situations are HIGH.

    Args:
        title: Incident title (e.g., "Wohnungsbrand", "BMA Schulhaus")
        text: Optional incident description/text

    Returns:
        IncidentPriority.HIGH for critical situations, LOW otherwise
    """
    # Combine title and text for keyword search
    combined = f"{title} {text or ''}".upper()

    # The list — grouped and annotated — lives in app/data/alarm_keywords.json, shared with
    # kp-front. Any match makes the alarm HIGH, so order carries no meaning here.
    for keyword in HIGH_PRIORITY_KEYWORDS:
        if _keyword_in(keyword, combined):
            return schemas.IncidentPriority.HIGH

    # Default to LOW for all other emergencies
    return schemas.IncidentPriority.LOW


def incident_create_from_emergency(emergency: models.DiveraEmergency, event_id: uuid.UUID) -> schemas.IncidentCreate:
    """Derive the IncidentCreate payload for attaching an emergency to an event."""
    return schemas.IncidentCreate(
        event_id=event_id,
        title=emergency.title,
        type=detect_incident_type(emergency.title),
        priority=infer_priority_from_text(emergency.title, emergency.text),
        location_address=emergency.address,
        location_lat=str(emergency.latitude) if emergency.latitude else None,
        location_lng=str(emergency.longitude) if emergency.longitude else None,
        description=emergency.text,
        status=schemas.IncidentStatus.INCOMING,
    )


async def try_auto_attach(db: AsyncSession, emergency: models.DiveraEmergency) -> models.Incident | None:
    """Attach a fresh emergency to the newest active event with auto-attach on.

    Only real emergencies attach to real events: simulated training alarms are
    skipped entirely (trainees attach them by hand — that's the exercise), and
    training events never receive auto-attached incidents. Returns the created
    incident, or None when no event wants auto-attach.

    Never raises: a failed auto-attach must not fail the webhook ACK back to
    Divera — the emergency is already stored and stays manually attachable.
    """
    try:
        return await _auto_attach(db, emergency)
    except Exception:
        logger.exception("Auto-attach failed for Divera emergency %s", emergency.divera_id)
        # Leave the session usable for the caller's response handling. The
        # rollback expires loaded attributes, so re-load the emergency before
        # the caller serializes it (sync attribute access on an expired object
        # would blow up in the async session).
        try:
            await db.rollback()
            await db.refresh(emergency)
        except Exception:  # noqa: S110 — already on the error path; a failed rollback changes nothing
            pass
        return None


async def _auto_attach(db: AsyncSession, emergency: models.DiveraEmergency) -> models.Incident | None:
    if emergency.is_training or emergency.attached_to_event_id is not None:
        return None

    event = (
        await db.execute(
            select(models.Event)
            .where(models.Event.auto_attach_divera.is_(True))
            .where(models.Event.training_flag.is_(False))
            .where(models.Event.archived_at.is_(None))
            .order_by(models.Event.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if event is None:
        return None

    data = incident_create_from_emergency(emergency, event.id)
    incident = models.Incident(
        **data.model_dump(),
        created_by=None,
        # Alarm provenance flows onto the board card
        source=emergency.source or "divera",
        source_ref=emergency.source_id,
    )
    db.add(incident)
    await db.flush()

    # System action — no user; the audit trail still shows where it came from.
    await log_action(
        db=db,
        action_type="create",
        resource_type="incident",
        resource_id=incident.id,
        user=None,
        changes={"created": data.model_dump(mode="json"), "auto_attach_divera": True},
    )
    await events_crud.update_event_activity(db, event.id)
    await db.commit()
    await db.refresh(incident)

    await divera_crud.attach_emergency_to_event(
        db=db, emergency_id=emergency.id, event_id=event.id, incident_id=incident.id
    )

    logger.info(
        "Divera emergency %s auto-attached to event %s (incident %s)",
        emergency.divera_id,
        event.id,
        incident.id,
    )
    return incident


async def broadcast_emergency_received(
    emergency_data: dict[str, Any], incident_data: dict[str, Any] | None = None, source: str | None = None
) -> None:
    """Broadcast a new pool emergency (and its auto-attached incident, if any)."""
    from ..websocket_manager import broadcast_incident_update, broadcast_message

    message: dict[str, Any] = {
        "type": "divera_emergency_received",
        "emergency": emergency_data,
        "auto_attached": incident_data is not None,
    }
    if source:
        message["source"] = source
    await broadcast_message(message)
    if incident_data is not None:
        await broadcast_incident_update(incident_data, "create")
