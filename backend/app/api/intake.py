"""Public alarm-intake API endpoints.

Token-gated alarm creation for phone operators / walk-ins who have no login and
no knowledge of the rest of the system. An editor generates a per-event link
(``/intake/generate-link``); anyone with the link can read the event context and
create alarms via ``?token=``. Created alarms are flagged ``source="intake"`` so
operators can verify them on the board.

**Two doors, not one.** The event token (``?token=``) is the intake link itself:
long-lived, shared, and worth exactly one thing — creating a new alarm in that
event. It never names an incident, so it must never be enough to read or change
one. Reading back and correcting a Meldung therefore takes a *second* token,
minted by the create call and naming that single incident (see
``INTAKE_RECEIPT_FORM_TYPE`` below). Both are required on the two follow-up
endpoints, which is what keeps a bookmarked intake link from becoming a way to
browse or rewrite everybody else's reports.
"""

import logging
import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth.dependencies import CurrentEditor
from ..config import settings
from ..crud import events as events_crud
from ..crud import feld as feld_crud
from ..crud import incidents as crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..schemas.incidents import IncidentBase, IncidentPriority, IncidentType
from ..services import incident_display
from ..services.audit import log_action
from ..services.tokens import (
    generate_alarm_token,
    generate_form_token,
    validate_alarm_token,
    validate_form_token,
)
from ..websocket_manager import broadcast_incident_update
from .incidents import trigger_sync_background

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/intake", tags=["intake"])

#: Form-token flavour for the receipt. Deliberately its own string: the reko
#: form's token is checked with ``form_type="reko"``, so a receipt cannot be
#: replayed against the Reko door and vice versa.
INTAKE_RECEIPT_FORM_TYPE = "intake_receipt"

#: How long a receipt stays good for. Far shorter than the 30-day intake link:
#: the only thing it is for is the minutes between "Alarm ist beim KP" and the
#: KP disponiert it, and the edit window closes on the disposition anyway. Long
#: enough that a phone left face-down through a long call still works, short
#: enough that a URL in a browser history is inert by the next shift.
INTAKE_RECEIPT_VALID_HOURS = 12


@router.post("/generate-link", response_model=dict)
async def generate_alarm_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for alarm intake"),
) -> dict[str, str]:
    """
    Generate a public alarm-intake link with QR code (editor only).

    Returns a shareable link scoped to a specific event. Anyone with the link can
    create alarms without logging in. Long-lived (30 days) for the phone desk.
    """
    token = generate_alarm_token(event_id)
    link = f"/alarm?token={token}"

    base_url = str(request.base_url).rstrip("/")

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend generates the QR code from this
    }


@router.get("/context", response_model=dict)
async def get_intake_context(
    token: str = Query(..., description="Access token from generated link"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Get minimal event context for the public intake form.

    No authentication required — uses token validation. Lets the page show
    "Alarm erfassen — {event name}" and gate on load.
    """
    event_id = validate_alarm_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    event = await events_crud.get_event_by_id(db, event_id)
    if not event or event.archived_at is not None:
        raise HTTPException(status_code=404, detail="Event not found")

    return {
        "event": {
            "id": str(event.id),
            "name": event.name,
            "training_flag": event.training_flag,
        }
    }


@router.post("/alarm", response_model=dict, status_code=status.HTTP_201_CREATED)
@limiter.limit(RateLimits.INTAKE)
async def create_intake_alarm(
    incident: schemas.PublicIncidentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    token: str = Query(..., description="Access token from generated link"),
) -> dict[str, str]:
    """
    Create an alarm from the public intake form (no authentication, token only).

    Validates the token, enforces the demo cap, creates the incident flagged as
    intake, then broadcasts and syncs exactly like the authenticated create path.
    """
    event_id = validate_alarm_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Verify event exists and is active
    event = await events_crud.get_event_by_id(db, event_id)
    if not event or event.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Demo mode: cap incidents per event at 50 (same as the authenticated create path)
    if settings.demo_mode:
        count_result = await db.execute(
            select(sa_func.count()).select_from(models.Incident).where(models.Incident.event_id == event_id)
        )
        event_incidents = count_result.scalar() or 0
        if event_incidents >= 50:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo-Modus: Maximale Anzahl Einsätze (50) erreicht. Die Demo wird regelmässig zurückgesetzt.",
            )

    new_incident = await crud.create_public_incident(
        db=db,
        event_id=event_id,
        incident=incident,
        request=request,
    )

    # Trigger immediate sync in background (event-based sync)
    background_tasks.add_task(trigger_sync_background)

    # Broadcast WebSocket update so the board updates live
    incident_response = await incident_display.incident_with_display(db, new_incident)
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    return {
        "id": str(new_incident.id),
        # The receipt: what lets THIS caller read back and correct THIS alarm,
        # and nothing else. Handed out once, at the only moment the server can
        # be sure who reported it — there is no login here to ask later.
        "receipt_token": generate_form_token(
            str(new_incident.id),
            INTAKE_RECEIPT_FORM_TYPE,
            expires_hours=INTAKE_RECEIPT_VALID_HOURS,
        ),
    }


# ============================================
# The receipt: read back, and correct
# ============================================
#
# `/feld` lets a crew fix a Meldung they sent in themselves until the KP
# disponiert it (`api/feld.py::correct_own_report`). A walk-in or a phone desk
# had no such thing: the intake API answered `{id}` and stopped, so a wrong
# house number was only fixable by radio. These two endpoints are that same
# window, with the same rule and the same shape of authorization — narrower,
# because there is no person here to bind to.


#: What marks a line in «Notizen» as having come from the reporter after the
#: fact. Everything the create call wrote is the reporter's; everything an
#: operator has typed since is not — and the two now share the column, so the
#: later arrivals say who they are.
INTAKE_NOTE_PREFIX = "Nachtrag Melder: "


def append_reporter_note(existing: str | None, addition: str) -> str | None:
    """«Notizen» grows from this door; it is never overwritten through it.

    The read half deliberately withholds ``internal_notes`` because an operator
    may have typed into that column since the call — so a correction that *set*
    it would be a blind write over content the caller is not even allowed to
    see, silently, with neither side told. Appending keeps the one legitimate
    reason to touch the column (the reporter fixing their own Hinweis) without
    ever costing the operator a word, and it is what a correction over the radio
    does anyway: you send a Nachtrag, you do not un-say what the KP already read.

    Empty text is *not* a clear: a public caller has no way to empty this column.
    A note that already stands in the column *as its own entry* is dropped, which
    is what makes a double tap – or an older page that resends its whole draft –
    add nothing. Entry-exact, not substring: a short genuine Nachtrag («12») must
    not be swallowed just because those two characters occur somewhere inside an
    existing line.
    """
    text = addition.strip()
    if not text:
        return existing
    if not existing:
        return text
    # The column is the original note followed by prefixed Nachträge, so splitting
    # on the prefix recovers the entries a resend could duplicate. Only an exact
    # entry match dedups; everything else is new information and appends.
    entries = existing.split(f"\n{INTAKE_NOTE_PREFIX}")
    if text in entries:
        return existing
    return f"{existing}\n{INTAKE_NOTE_PREFIX}{text}"


class IntakeAlarmUpdate(BaseModel):
    """A correction to an alarm that has not been disponiert yet.

    Field-for-field ``FeldIncidentUpdate`` (`schemas/feld.py`), including its
    semantics: every field is optional, ``None`` means *unchanged* rather than
    *clear it*, and clearing a text field is done with ``""``. The phone sends
    the whole form back and a Meldung whose Meldungstext was fixed must not lose
    its address to an omitted key.

    The two coordinates cannot play by that rule — there is no ``""`` for a
    Numeric column, so ``None`` has to carry both meanings and the payload's
    ``model_fields_set`` tells them apart: a coordinate field *sent* as null
    clears it (the caller un-pins a wrong map pin), a field *omitted* leaves it
    untouched.

    ``internal_notes`` is the one exception to "the field is the value": it is
    *appended* to «Notizen» rather than assigned (see ``append_reporter_note``),
    because that column is shared with the operator and the read half does not
    hand it back.

    The validators are ``PublicIncidentCreate``'s, not ``FeldIncidentUpdate``'s:
    this is the same login-less door the create path is, so the same 2000-char
    cap on the two free-text columns applies on the way back in.

    No ``status`` and no operator flags — this is the reporter's own words, not
    a second way onto the board.
    """

    title: str | None = None
    type: IncidentType | None = None
    priority: IncidentPriority | None = None
    location_address: str | None = None
    location_lat: str | Decimal | None = None
    location_lng: str | Decimal | None = None
    description: str | None = None  # «Meldung»
    internal_notes: str | None = None  # «Notizen» — appended, never replaced
    contact: str | None = None
    contact_phone: str | None = None

    # Same `__func__` unwrap as PublicIncidentCreate — see the note there.
    _validate_title = field_validator("title")(IncidentBase.validate_title.__func__)  # type: ignore[attr-defined]
    _validate_lat = field_validator("location_lat")(IncidentBase.validate_latitude.__func__)  # type: ignore[attr-defined]
    _validate_lng = field_validator("location_lng")(IncidentBase.validate_longitude.__func__)  # type: ignore[attr-defined]
    _validate_description = field_validator("description")(IncidentBase.validate_description.__func__)  # type: ignore[attr-defined]
    _validate_notes = field_validator("internal_notes")(IncidentBase.validate_description.__func__)  # type: ignore[attr-defined]


async def _authorized_intake_report(
    db: AsyncSession,
    token: str,
    receipt: str,
    incident_id: uuid.UUID,
) -> models.Incident:
    """Both doors, for the two receipt endpoints.

    1. The intake link must still be valid and name an event — an expired or
       revoked link stops working here exactly as it does for creating.
    2. That event must still exist and be open. The create path 404s on an
       archived Ereignis; a receipt into the same archived Ereignis has to stop
       too, or the board's "this Lage is closed" holds for new alarms and not
       for corrections to the ones already on it. Refused as the same 403 as
       everything else here rather than the create path's 404: this pair must
       not answer *why* it said no.
    3. The receipt must be a live form token *for this incident*. This is the
       narrow sentence that replaces `/feld`'s "you are the person this row says
       reported it": the event token names no incident and can therefore never
       stand in for it.
    4. The incident must be the one it claims to be: in the token's event, not
       deleted, and ``source='intake'``.

    Every refusal past step 1 is the same 403 with the same wording, whether the
    Ereignis is archived, the incident exists, belongs to another Ereignis, or
    was created some other way. A public token must not become a way to probe
    the board.
    """
    event_id = validate_alarm_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    denied = HTTPException(status_code=403, detail="Diese Meldung ist nicht deine.")

    event = await events_crud.get_event_by_id(db, event_id)
    if event is None or event.archived_at is not None:
        raise denied

    if not validate_form_token(receipt, str(incident_id), INTAKE_RECEIPT_FORM_TYPE):
        raise denied

    incident = await db.get(models.Incident, incident_id)
    if (
        incident is None
        or incident.event_id != event_id
        or incident.deleted_at is not None
        or incident.source != "intake"
    ):
        raise denied
    return incident


async def _never_left_the_window(db: AsyncSession, incident: models.Incident) -> bool:
    """Has this card stayed inside the editable phases its whole life?

    Stricter than `report_is_editable`, and deliberately so. That rule is
    *stateful* — it asks "is a crew committed to this address right now?" — so
    an operator dragging a disponierte Karte back to «Eingegangen» reopens the
    reporter's window for the rest of the receipt's 12 h. By then the Meldung
    may carry operator edits, and `description` is assign-semantics: the phone
    sends its whole cached form back, so a stale tab pressing «Korrektur
    senden» would replace the operator's refined text with the reporter's
    original sentence, silently. «Notizen» is safe (it appends, see
    `append_reporter_note`); this closes the same hole one column over.

    Reko does not count as leaving: a caller still typing while the Trupp is
    looking is adding information, which is the point. Only a card that has
    genuinely been committed to at some point stops being the reporter's.
    """
    left = await db.execute(
        select(models.StatusTransition.id)
        .where(
            models.StatusTransition.incident_id == incident.id,
            models.StatusTransition.to_status.notin_(feld_crud.EDITABLE_STATUSES),
        )
        .limit(1)
    )
    return left.scalar_one_or_none() is None


async def _receipt_state(db: AsyncSession, incident: models.Incident) -> dict[str, Any]:
    """What the receipt is allowed to know: has anybody been sent, and may I still fix it?

    **Deliberately carries no content.** The reporter's own words are already on
    the reporter's own screen — echoing them back would mean echoing the column
    as it stands *now*, and an operator may have typed into «Notizen» in the
    meantime. So this answers the two questions the paper receipt cannot, plus
    the one fact a reporter actually wants from the board's side: which vehicles
    are on it. ``editable`` is the server's own answer (shared with `/feld`, via
    ``report_is_editable``) so the page never has to know the status vocabulary.
    """
    vehicle_rows = await db.execute(
        select(models.Vehicle.name)
        .join(models.IncidentAssignment, models.IncidentAssignment.resource_id == models.Vehicle.id)
        .where(
            models.IncidentAssignment.incident_id == incident.id,
            models.IncidentAssignment.resource_type == "vehicle",
            models.IncidentAssignment.unassigned_at.is_(None),
        )
        .order_by(models.Vehicle.display_order, models.Vehicle.name)
    )
    return {
        "id": str(incident.id),
        "status": incident.status,
        # Both halves, so the button on the page and the 409 below never disagree.
        "editable": feld_crud.report_is_editable(incident) and await _never_left_the_window(db, incident),
        "vehicles": [name for (name,) in vehicle_rows.all()],
    }


@router.get("/alarm/{incident_id}", response_model=dict)
# FELD, not INTAKE: this one is *polled*, and INTAKE's 10/minute is sized for a
# human filling in a form. A station NATs every phone behind one address, so two
# open receipts (3/minute each) plus a live call would spend the budget on
# nothing but status reads and 429 the alarm that matters. Same reasoning, same
# number as the `/feld` surface, which polls for the same reason. The write half
# below and the create call keep INTAKE.
@limiter.limit(RateLimits.FELD)
async def get_intake_alarm_state(
    request: Request,
    incident_id: uuid.UUID,
    token: str = Query(..., description="Access token from generated link"),
    receipt: str = Query(..., description="Receipt token from the create response"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Has the KP picked this up yet? — the receipt's live half.

    The page polls this while the receipt is on screen, which is the whole
    reason «Beim KP – noch nicht disponiert» can turn into «Disponiert · TLF 1»
    without a phone call.
    """
    incident = await _authorized_intake_report(db, token, receipt, incident_id)
    return await _receipt_state(db, incident)


@router.put("/alarm/{incident_id}", response_model=dict)
@limiter.limit(RateLimits.INTAKE)
async def correct_intake_alarm(
    request: Request,
    incident_id: uuid.UUID,
    payload: IntakeAlarmUpdate,
    background_tasks: BackgroundTasks,
    token: str = Query(..., description="Access token from generated link"),
    receipt: str = Query(..., description="Receipt token from the create response"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Fix an alarm you just phoned in, before the KP disponiert it.

    The window `/feld` gives a crew (`crud.feld.report_is_editable`): while the
    card sits in «Eingegangen» nobody has been sent anywhere and the address is
    still the reporter's to correct. The moment it is disponiert a squad is
    driving to that address, the window shuts, and the correction goes over the
    radio — the 409 says so in as many words.

    Here it shuts *for good*: unlike `/feld`, an un-dispatch does not reopen it
    (`_never_left_the_window`), because by then the Meldung may carry operator
    edits this endpoint would overwrite.
    """
    incident = await _authorized_intake_report(db, token, receipt, incident_id)
    if not feld_crud.report_is_editable(incident) or not await _never_left_the_window(db, incident):
        raise HTTPException(
            status_code=409,
            detail="Der KP hat diese Meldung bereits übernommen. Änderungen bitte per Funk.",
        )

    before = {
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "location_address": incident.location_address,
        # str, not Decimal — the audit column is JSON, and a cleared pin must be
        # readable in the trail as coordinates that went away.
        "location_lat": str(incident.location_lat) if incident.location_lat is not None else None,
        "location_lng": str(incident.location_lng) if incident.location_lng is not None else None,
        "description": incident.description,
        "internal_notes": incident.internal_notes,
    }
    old_address = incident.location_address

    if payload.type is not None:
        incident.type = payload.type
    if payload.priority is not None:
        incident.priority = payload.priority
    if payload.description is not None:
        incident.description = payload.description or None
    # Appended, never assigned — «Notizen» is shared with the operator and the
    # read half withholds it, so a set here would be a blind overwrite.
    if payload.internal_notes is not None:
        incident.internal_notes = append_reporter_note(incident.internal_notes, payload.internal_notes)
    if payload.location_address is not None:
        incident.location_address = payload.location_address or None
    # The validator hands a coordinate over as a string; the column is Numeric,
    # so the conversion happens here rather than at the driver, and it goes
    # through str/Decimal rather than float to keep the exact digits. Presence
    # is read off `model_fields_set`, not the value: an explicit null clears the
    # coordinate (the caller un-pins a wrong map pin), an omitted key leaves it —
    # see the schema docstring.
    if "location_lat" in payload.model_fields_set:
        incident.location_lat = Decimal(payload.location_lat) if payload.location_lat is not None else None
    if "location_lng" in payload.model_fields_set:
        incident.location_lng = Decimal(payload.location_lng) if payload.location_lng is not None else None
    if payload.contact is not None:
        incident.contact = payload.contact or None
    if payload.contact_phone is not None:
        incident.contact_phone = payload.contact_phone or None
    # The title follows the address when it WAS the address: the intake form
    # titles an alarm with the street it is at, so correcting the street and
    # leaving «Hauptstrasse 12» on the card would hide the correction exactly
    # where it is read.
    if payload.title is not None and payload.title.strip():
        incident.title = payload.title.strip()
    elif payload.location_address is not None and incident.title == old_address:
        incident.title = incident.location_address or incident.title

    await log_action(
        db=db,
        action_type="update",
        resource_type="incident",
        resource_id=incident.id,
        user=None,
        changes={
            "before": before,
            "after": {
                "title": incident.title,
                "type": incident.type,
                "priority": incident.priority,
                "location_address": incident.location_address,
                "location_lat": str(incident.location_lat) if incident.location_lat is not None else None,
                "location_lng": str(incident.location_lng) if incident.location_lng is not None else None,
                "description": incident.description,
                # Same keys before and after, so a Nachtrag in «Notizen» is
                # readable as one in the trail rather than as a column that
                # changed for no recorded reason.
                "internal_notes": incident.internal_notes,
            },
            "source": "intake",
        },
        request=request,
    )
    await db.commit()
    await db.refresh(incident)

    # The board is looking at this card right now — a correction that only lands
    # on the next poll is a correction the operator reads too late.
    background_tasks.add_task(broadcast_incident_update, {"id": str(incident.id), "status": incident.status}, "update")

    return await _receipt_state(db, incident)
