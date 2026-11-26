"""Divera inbound intake: type/priority inference, the webhook secret, the pool broadcast.

Shared by the webhook endpoints, the polling fallback and every attach
(``services/alarm_attach.py``) so all ingest paths derive the same incident from an emergency.

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
from collections.abc import Sequence
from typing import Any

from fastapi import Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..alarm_keywords import (
    FALLBACK_CATEGORY,
    HIGH_PRIORITY_KEYWORDS,
    KEYWORD_TO_CATEGORY,
    KP_RUECK_WORD_BOUNDED,
)
from ..schemas.incidents import FREE_TEXT_MAX, TITLE_MAX
from ..utils.error_codes import DomainError, ErrorCode
from .settings import get_alarm_webhook_secret

logger = logging.getLogger(__name__)


def _secret_refused() -> DomainError:
    """The one 403 both refusals of ``check_webhook_secret`` raise."""
    return DomainError(
        ErrorCode.ALARM_WEBHOOK_SECRET_INVALID,
        "Webhook-Secret fehlt oder ist falsch",
        status_code=status.HTTP_403_FORBIDDEN,
    )


async def check_webhook_secret(db: AsyncSession, request: Request | None, *, label: str) -> None:
    """Validate the shared inbound-alarm secret, failing closed when none is configured.

    Both inbound alarm endpoints — the provider-neutral POST /api/alarms and the Divera
    adapter — must answer the same way, because they write to the same board. They did not:
    the Divera one guarded with `if webhook_secret:`, so an unconfigured (or emptied) secret
    skipped the check and left an unauthenticated write endpoint open. `alarm_webhook_secret`
    is in the PATCH allowlist, so any editor could reach that state from the settings UI.

    Fail-closed is the only safe direction here: a station that has not configured a secret
    has not authorised anyone to create incidents on its board.

    Both refusals answer the same 403 with ``alarm_webhook_secret_invalid``; only the log
    tells a missing configuration from a wrong secret.
    """
    webhook_secret = await get_alarm_webhook_secret(db)
    if not webhook_secret:
        logger.warning("%s rejected: no alarm_webhook_secret configured", label)
        raise _secret_refused()

    provided = ""
    if request is not None:
        provided = request.query_params.get("secret", "") or request.headers.get("X-Webhook-Secret", "")

    # As bytes: compare_digest raises on a str with non-ASCII characters (a 500, not the 403).
    if not provided or not _secrets.compare_digest(provided.encode(), webhook_secret.encode()):
        logger.warning("%s rejected: invalid or missing secret", label)
        raise _secret_refused()


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


def _einsatzart(title: str | None) -> str:
    """The part of an alarm title the keywords are matched against: up to the first comma.

    fwo-divera titles an alarm «Verunreinigung, Allschwilerstrasse» – Einsatzart, then the
    street (the Gemeinde for Nachbarhilfe) – and street names carry keywords: «Bahnhofstrasse»
    holds BAHN, «Kaibmattweg» holds BMA. A title without a comma is matched whole. There is
    deliberately no whole-title retry when the Einsatzart matches nothing: that retry would
    hand exactly those alarms back to the street names.
    """
    return (title or "").partition(",")[0]


def detect_incident_type(title: str) -> schemas.IncidentType:
    """
    Detect incident type from the Einsatzart of a Divera title (see `_einsatzart`).

    Args:
        title: Divera alarm title (e.g., "FEUER3", "Verunreinigung, Allschwilerstrasse")

    Returns:
        Detected IncidentType, defaults to DIVERSE_EINSAETZE if no match
    """
    title_upper = _einsatzart(title).upper()

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
        title: Incident title (e.g., "Wohnungsbrand", "BMA Schulhaus"); only its Einsatzart
            is read (see `_einsatzart`), so «Wasserschaden, Kaibmattweg 3» is not a BMA
        text: Optional incident description/text

    Returns:
        IncidentPriority.HIGH for critical situations, LOW otherwise
    """
    # Combine the title's Einsatzart and the text for keyword search
    combined = f"{_einsatzart(title)} {text or ''}".upper()

    # The list — grouped and annotated — lives in app/data/alarm_keywords.json, shared with
    # kp-front. Any match makes the alarm HIGH, so order carries no meaning here.
    for keyword in HIGH_PRIORITY_KEYWORDS:
        if _keyword_in(keyword, combined):
            return schemas.IncidentPriority.HIGH

    # Default to LOW for all other emergencies
    return schemas.IncidentPriority.LOW


def _sender_hint(emergency: models.DiveraEmergency, key: str) -> str | None:
    """Read a `type`/`priority` hint the generic sender supplied, if it sent one.

    Generic alarms (`POST /api/alarms`) keep their whole payload in `raw_payload_json`, so
    these need no columns of their own. Divera's raw payload uses different keys, so it never
    matches here and keeps using the inference — which is what it did before.
    """
    payload = emergency.raw_payload_json
    if not isinstance(payload, dict):
        return None
    value = payload.get(key)
    return value.strip().lower() if isinstance(value, str) and value.strip() else None


def _rejoin(lines: Sequence[str]) -> str | None:
    """Put kept lines back together — a removed line must not leave a hole behind.

    Blank runs collapse, and a text left with nothing becomes None rather than
    whitespace, so the card shows no description instead of an empty-looking one.
    """
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() or None


def _needles(prefixes: Sequence[str]) -> list[str]:
    """The configured prefixes, blanks dropped — an operator types into a Textarea."""
    return [p.strip() for p in prefixes if p.strip()]


def _starts_with(line: str, prefix: str) -> bool:
    """Does this (leading-whitespace-tolerant) line begin with `prefix`, ignoring case?"""
    return line[: len(prefix)].casefold() == prefix.casefold()


def filter_description_lines(text: str | None, prefixes: Sequence[str]) -> str | None:
    """Drop whole lines from an alarm text — the station's configured standing lines.

    Divera lets a brigade prepend boilerplate to every alarm ("Ausrückeordnung: 1. TLF →
    2. PIO"). It is identical on every emergency, so on the board it is noise that crowds
    out the line that actually says what happened.

    Matching is per line, on the line's start, case-insensitive and tolerant of leading
    whitespace — an operator types the prefix into a Textarea, not a regex.

    The prefixes are configuration (`alarm.description_filter_prefixes`) and ship EMPTY:
    the vocabulary is the brigade's, so an install that configures nothing filters
    nothing, and the next standing line the dispatch system grows costs a settings edit
    rather than a release.
    """
    if not text:
        return None
    needles = _needles(prefixes)
    if not needles:
        return text

    kept = [line for line in text.splitlines() if not any(_starts_with(line.lstrip(), n) for n in needles)]
    return _rejoin(kept)


def strip_description_labels(text: str | None, prefixes: Sequence[str]) -> str | None:
    """Strip a leading label off a line while KEEPING the line.

    The sibling of `filter_description_lines`: that one removes the whole line, this one
    removes only the label in front of it. Divera labels the dispatch text it sends
    ("Meldung: Wasser dringt ein") while our own UI already puts a «Meldung» heading above
    that field, so without this the card reads the word twice.

    Per line, case-insensitive, tolerant of leading whitespace, like the drop list. The
    label and any whitespace directly behind it go; the remainder stays. A line left with
    nothing behind its label is dropped — a label alone is not content.

    Configuration (`alarm.description_label_prefixes`), shipped EMPTY.
    """
    if not text:
        return None
    needles = _needles(prefixes)
    if not needles:
        return text

    kept: list[str] = []
    for line in text.splitlines():
        stripped = line.lstrip()
        label = next((n for n in needles if _starts_with(stripped, n)), None)
        if label is None:
            kept.append(line)
            continue
        remainder = stripped[len(label) :].lstrip()
        # A label with nothing behind it ("Meldung:") is not content — drop the line.
        if remainder:
            kept.append(remainder)
    return _rejoin(kept)


def clean_description(
    text: str | None,
    *,
    drop_prefixes: Sequence[str] = (),
    label_prefixes: Sequence[str] = (),
) -> str | None:
    """The operator-facing description of an inbound alarm: drop lines, then strip labels.

    THE ORDER IS LOAD-BEARING. Divera's two labelled lines arrive as

        Meldung: -
        Ausrückeordnung: 1. TLF → 2. PIO

    when the Alarmzentrale sent no text. Dropping `Meldung: -` (a drop-list entry) before
    the label strip leaves nothing; stripping labels first would turn that same line into a
    bare "-" that no drop rule can name any more — exactly the noise this removes.
    """
    return strip_description_labels(filter_description_lines(text, drop_prefixes), label_prefixes)


def _fit(text: str, limit: int) -> str:
    """`text` stripped and cut to `limit` characters; a cut ends in «…»."""
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _card_pin(emergency: models.DiveraEmergency) -> tuple[str | None, str | None]:
    """The card's coordinates: both axes or none.

    Divera sends `0, 0` for an alarm without a location, so that pair is no pin; one zero axis
    is a real coordinate. Half a pair (a native Divera payload may carry one axis) gives a card
    without a pin – the card refuses half a pair, and the alarm must not stick in the pool.
    """
    lat, lng = emergency.latitude, emergency.longitude
    if lat is None or lng is None or (lat == 0 and lng == 0):
        return None, None
    return str(lat), str(lng)


def incident_create_from_emergency(
    emergency: models.DiveraEmergency,
    event_id: uuid.UUID,
    *,
    description_filter_prefixes: Sequence[str] = (),
    description_label_prefixes: Sequence[str] = (),
) -> schemas.IncidentCreate:
    """Derive the IncidentCreate payload for attaching an emergency to an event.

    A sender that names `type`/`priority` wins over our keyword inference — a Leitstelle
    classifying the call knows more than our title matcher does. An unrecognised value falls
    back to inference rather than raising: a typo in an optional hint must never cost an alarm.

    The two prefix lists (from `alarm.description_filter_prefixes` and
    `alarm.description_label_prefixes`, both empty unless the station configures them) tidy
    the INCIDENT's description only — see `clean_description` for why the drop list runs
    first. The emergency row keeps `text`/`raw_payload_json` byte-for-byte: that is the
    provenance record of what the Leitstelle actually sent, and it stays answerable even
    after the board copy is trimmed. Priority inference below reads the raw text for the
    same reason.

    The intake contract takes a 255-character title and 5000 characters of text, the card
    `TITLE_MAX` / `FREE_TEXT_MAX`: the card copy is cut to fit (`_fit`), so an alarm the
    contract accepts always reaches the board, and the pool row keeps every character.
    """
    type_hint = _sender_hint(emergency, "type")
    priority_hint = _sender_hint(emergency, "priority")

    incident_type = (
        schemas.IncidentType(type_hint)
        if type_hint in {t.value for t in schemas.IncidentType}
        else detect_incident_type(emergency.title)
    )
    priority = (
        schemas.IncidentPriority(priority_hint)
        if priority_hint in {p.value for p in schemas.IncidentPriority}
        else infer_priority_from_text(emergency.title, emergency.text)
    )

    description = clean_description(
        emergency.text,
        drop_prefixes=description_filter_prefixes,
        label_prefixes=description_label_prefixes,
    )
    lat, lng = _card_pin(emergency)
    return schemas.IncidentCreate(
        event_id=event_id,
        title=_fit(emergency.title, TITLE_MAX),
        type=incident_type,
        priority=priority,
        location_address=emergency.address,
        location_lat=lat,
        location_lng=lng,
        description=_fit(description, FREE_TEXT_MAX) if description else description,
        status=schemas.IncidentStatus.INCOMING,
    )


async def broadcast_emergency_received(
    emergency_data: dict[str, Any], *, auto_attached: bool = False, source: str | None = None
) -> None:
    """Tell the boards about a new pool alarm. An auto-attached card announces itself
    (``alarm_attach.attach``); ``auto_attached`` only tells the pool toast."""
    from ..websocket_manager import broadcast_message

    message: dict[str, Any] = {
        "emergency": emergency_data,
        "auto_attached": auto_attached,
    }
    if source:
        message["source"] = source
    await broadcast_message("divera_emergency_received", message)
