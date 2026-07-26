"""Divera inbound intake: type/priority inference and event auto-attach.

Shared by the webhook endpoint, the polling fallback and the manual attach
endpoints so all ingest paths derive the same incident from an emergency.
"""

import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..crud import divera as divera_crud
from ..crud import events as events_crud
from .audit import log_action

logger = logging.getLogger(__name__)


# Incident type mapping from Divera title keywords to IncidentType enum
INCIDENT_TYPE_MAPPING = {
    "FEUER": schemas.IncidentType.BRANDBEKAEMPFUNG,
    "BRAND": schemas.IncidentType.BRANDBEKAEMPFUNG,
    "HOCHWASSER": schemas.IncidentType.ELEMENTAREREIGNIS,
    "UNWETTER": schemas.IncidentType.ELEMENTAREREIGNIS,
    "STURM": schemas.IncidentType.ELEMENTAREREIGNIS,
    "VU": schemas.IncidentType.STRASSENRETTUNG,
    "VERKEHR": schemas.IncidentType.STRASSENRETTUNG,
    "UNFALL": schemas.IncidentType.STRASSENRETTUNG,
    "THL": schemas.IncidentType.TECHNISCHE_HILFELEISTUNG,
    "TECH": schemas.IncidentType.TECHNISCHE_HILFELEISTUNG,
    "ÖL": schemas.IncidentType.OELWEHR,
    "OELWEHR": schemas.IncidentType.OELWEHR,
    "CHEMIE": schemas.IncidentType.CHEMIEWEHR,
    "STRAHLEN": schemas.IncidentType.STRAHLENWEHR,
    "BAHN": schemas.IncidentType.EINSATZ_BAHNANLAGEN,
    "BMA": schemas.IncidentType.BMA_UNECHTE_ALARME,
    "FEHLALARM": schemas.IncidentType.BMA_UNECHTE_ALARME,
    "DIENST": schemas.IncidentType.DIENSTLEISTUNGEN,
    "TIER": schemas.IncidentType.GERETTETE_TIERE,
}


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
    return schemas.IncidentType.DIVERSE_EINSAETZE


# Short/generic keywords that are substrings of harmless everyday words
# ("GASSE", "LIFTECH", ...) must match as standalone words. Only LETTERS count
# as word characters — digits/dashes still delimit ("FEUER3", "THL-VU" match).
_WORD_BOUNDED_KEYWORDS = {"GAS", "VU", "LIFT"}
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

    # HIGH priority keywords - life-threatening or critical situations
    high_priority_keywords = [
        # Fire emergencies
        "BRAND",
        "FEUER",
        "FEUERALARM",
        "VOLLBRAND",
        "RAUCH",
        "FLAMMEN",
        # Building fire alarms
        "BMA",
        "BRANDMELDEANLAGE",
        "BRANDMELDER",
        "RAUCHMELDER",
        # Person in danger / rescue (specific phrases to avoid false positives)
        "PERSON IN",  # Person in Lift, Person in Gefahr
        "PERSON IM",  # Person im Wasser
        "EINGEKLEMMT",
        "EINGESCHLOSSEN",
        "ABSTURZ",  # Person abgestürzt
        "VERMISST",
        "BEWUSSTLOS",
        "VERLETZT",
        # Traffic accidents with people
        "VU",  # Verkehrsunfall
        "VERKEHRSUNFALL",
        # Gas / Chemical hazards
        "GAS",
        "GASGERUCH",
        "GASAUSTRITT",
        "GASLECK",
        "CHEMIE",
        "CHEMIKALIEN",
        "GEFAHRGUT",
        "GEFAHRSTOFF",
        # Medical emergencies
        "MED USTÜ",  # Medizinische Unterstützung
        "MED.",  # Med. Notfall
        "MEDIZINISCH",
        "REANIMATION",
        "NOTARZT",
        "RETTUNGSDIENST",
        # Explosions
        "EXPLOSION",
        "DETONATION",
        # Building collapse
        "EINSTURZ",
        "EINGESTÜRZT",
        # Lift/elevator emergencies
        "LIFT",
        "AUFZUG",
        "FAHRSTUHL",
    ]

    for keyword in high_priority_keywords:
        if _keyword_in(keyword, combined):
            return schemas.IncidentPriority.HIGH

    # Default to LOW for all other emergencies
    return schemas.IncidentPriority.LOW


def incident_create_from_emergency(emergency: models.DiveraEmergency, event_id) -> schemas.IncidentCreate:
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
        status=schemas.IncidentStatus.EINGEGANGEN,
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
    emergency_data: dict, incident_data: dict | None = None, source: str | None = None
):
    """Broadcast a new pool emergency (and its auto-attached incident, if any)."""
    from ..websocket_manager import broadcast_incident_update, broadcast_message

    message = {
        "type": "divera_emergency_received",
        "emergency": emergency_data,
        "auto_attached": incident_data is not None,
    }
    if source:
        message["source"] = source
    await broadcast_message(message)
    if incident_data is not None:
        await broadcast_incident_update(incident_data, "create")
