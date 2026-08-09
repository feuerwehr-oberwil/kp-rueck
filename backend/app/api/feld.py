"""`/feld` — the login-less field surface (plan 25).

One global QR per Ereignis; everyone in the field finds themselves in a list and
sees exactly their own Schadenplätze. Phase 0 is the door only: the picker, the
list, and the Einsatzleiter briefing on every row. Nothing here writes.

**Authorization is two-step on every single endpoint** and neither step is
optional:

1. ``validate_feld_token`` turns the link's token into an event id, else 401.
   A ``checkin`` / ``viewer`` / ``reko_dashboard`` / ``alarm`` token does not
   open this door.
2. The caller's personnel row must have an ``incident_assignments`` row for an
   incident in that event — active **or already released** — else 403. This is
   decision 4 ("visibility is only mine") and it lives in ``crud/feld.py``, not
   in the UI.

Privacy (§9): neither a token nor any owner field may be interpolated into a log
line here. The field surface is the first place kp-rueck touches citizen PII.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..crud import events as events_crud
from ..crud import feld as crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Event, Incident, Personnel
from ..services.settings import FELD_MESSAGE_CHIPS_KEY, get_setting_value, parse_message_chips
from ..services.tokens import generate_feld_token, validate_feld_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feld", tags=["feld"])


async def require_feld_event(
    token: str = Query(..., description="Access token from the generated /feld link"),
) -> uuid.UUID:
    """Step 1: the token must be a valid, unexpired `feld` token."""
    event_id = validate_feld_token(token)
    if event_id is None:
        raise HTTPException(status_code=401, detail="Ungültiger oder abgelaufener Zugriffscode")
    return event_id


FeldEventId = Annotated[uuid.UUID, Depends(require_feld_event)]


async def _load_event(db: AsyncSession, event_id: uuid.UUID) -> Event:
    """The event the token names, or 404."""
    event = await events_crud.get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Ereignis nicht gefunden")
    return event


async def require_feld_person(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
) -> Personnel:
    """Step 2, person-scoped: this person must have an assignment in this event.

    An unknown personnel id gets the same 403 as a known-but-unassigned one —
    a public token must not become a way to probe which UUIDs exist.
    """
    if not await crud.person_has_event_assignment(db, event_id, personnel_id):
        raise HTTPException(
            status_code=403,
            detail="Für diese Person ist in diesem Ereignis keine Einsatzstelle erfasst.",
        )
    result = await db.execute(select(Personnel).where(Personnel.id == personnel_id))
    person = result.scalar_one_or_none()
    if person is None:
        # Only reachable if the personnel row vanished between the two queries.
        raise HTTPException(
            status_code=403,
            detail="Für diese Person ist in diesem Ereignis keine Einsatzstelle erfasst.",
        )
    return person


@router.post("/generate-link", response_model=dict)
async def generate_feld_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for the field surface"),
) -> dict[str, str]:
    """
    Generate the `/feld` link with QR code (editor only).

    One global link per Ereignis — no per-incident and no per-vehicle links.
    Long-lived (30 days), because it goes on a printed poster.
    """
    token = generate_feld_token(event_id)
    link = f"/feld?token={token}"

    base_url = str(request.base_url).rstrip("/")

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend generates the QR code from this
    }


@router.get("/personnel", response_model=schemas.FeldPersonnelListResponse)
@limiter.limit(RateLimits.FELD)
async def list_feld_personnel(
    request: Request,
    event_id: FeldEventId,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldPersonnelListResponse:
    """
    The person picker: everyone with an assignment in this event.

    Token only — no login. Deliberately not the roster: a person with no
    assignment has nothing to file, and listing them would produce an empty page
    with no explanation instead of the "melde dich beim KP" sentence.
    """
    event = await _load_event(db, event_id)
    personnel = await crud.get_feld_personnel_for_event(db, event_id)

    return schemas.FeldPersonnelListResponse(
        personnel=[schemas.FeldPersonnel(**p) for p in personnel],
        event_id=event.id,
        event_name=event.name,
    )


@router.get("/assignments/{personnel_id}", response_model=schemas.FeldAssignmentsResponse)
@limiter.limit(RateLimits.FELD)
async def get_feld_assignments(
    request: Request,
    personnel_id: uuid.UUID,
    event_id: FeldEventId,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldAssignmentsResponse:
    """
    "Meine Einsatzstellen" — this person's Schadenplätze in this event.

    Each row carries the rapport state, the two field timestamps, and the
    Einsatzleiter of that incident (decision 22): the EL is briefed before any
    form opens, never enforced.
    """
    event = await _load_event(db, event_id)
    person = await require_feld_person(db, event_id, personnel_id)

    assignments = await crud.get_feld_assignments_for_personnel(db, event_id, personnel_id)
    chips = parse_message_chips(await get_setting_value(db, FELD_MESSAGE_CHIPS_KEY))

    return schemas.FeldAssignmentsResponse(
        personnel_id=person.id,
        personnel_name=person.name,
        personnel_role=person.role,
        event_id=event.id,
        event_name=event.name,
        assignments=[schemas.FeldAssignment(**a) for a in assignments],
        message_chips=chips,
    )


# ============================================
# The four field actions (phase 1)
# ============================================
#
# All four run BOTH authorization steps and all four take `request: Request` —
# without that parameter slowapi's decorator silently does nothing, which on a
# public token-gated write path is the failure you never notice.
#
# None of them writes `incident_assignments`. That is asserted in the tests, not
# left to review: it is the boundary that keeps `/feld` out of the board's
# conflict model.


async def _authorized_incident(
    db: AsyncSession,
    event_id: uuid.UUID,
    personnel_id: uuid.UUID,
    incident_id: uuid.UUID,
) -> tuple[Incident, Personnel]:
    """Both steps at once, for the incident-scoped writes.

    The person check runs first so an unassigned caller gets the same 403
    whether or not the incident exists — a public token must not become a way to
    probe the board.
    """
    person = await require_feld_person(db, event_id, personnel_id)
    incident = await crud.get_authorized_incident(db, event_id, personnel_id, incident_id)
    if incident is None:
        raise HTTPException(
            status_code=403,
            detail="Diese Einsatzstelle ist dir nicht zugeteilt.",
        )
    return incident, person


def _actor(person: Personnel) -> crud.FieldActor:
    """A `/feld` write is always a field write — never a user (decision 28)."""
    return crud.FieldActor(personnel_id=person.id, personnel_name=person.name)


@router.post("/incidents/{incident_id}/arrived", response_model=schemas.FieldReportState)
@limiter.limit(RateLimits.FELD)
async def report_arrived(
    request: Request,
    incident_id: uuid.UUID,
    event_id: FeldEventId,
    personnel_id: uuid.UUID = Query(..., description="Who is reporting"),
    db: AsyncSession = Depends(get_db),
) -> schemas.FieldReportState:
    """
    "Angekommen" — the crew is at the Schadenplatz.

    Upserts the Schadenplatz-Rapport row (that is why `is_draft` defaults to
    True: a row exists long before any form does) and stamps `arrived_at`.

    **Idempotent.** A second tap does nothing — a crew re-opening the page and
    hitting the big button again must not move a timestamp the KP has acted on.
    """
    incident, person = await _authorized_incident(db, event_id, personnel_id, incident_id)
    await crud.record_arrival(
        db,
        incident,
        actor=_actor(person),
        at=datetime.now(UTC),
        only_if_unset=True,
        request=request,
    )
    return schemas.FieldReportState(**await crud.field_report_state(db, incident))


@router.post("/incidents/{incident_id}/complete", response_model=schemas.FieldReportState)
@limiter.limit(RateLimits.FELD)
async def report_field_complete(
    request: Request,
    incident_id: uuid.UUID,
    event_id: FeldEventId,
    personnel_id: uuid.UUID = Query(..., description="Who is reporting"),
    db: AsyncSession = Depends(get_db),
) -> schemas.FieldReportState:
    """
    "Einsatz beendet" — the crew has finished here.

    Stamps `field_complete_reported_at` + `field_complete_reported_by` and
    **does not change `Incident.status`**: closing a Schadenplatz stays the
    operator's decision, which is the rule the column's own comment states.

    The client asks the Abholung follow-up ("Kommt ihr selbst zurück?")
    immediately afterwards and sends the answer to `/pickup` — deliberately a
    second call, so the *beendet* report reaches the KP even if the crew walks
    away from the question.
    """
    incident, person = await _authorized_incident(db, event_id, personnel_id, incident_id)
    await crud.record_field_complete(
        db,
        incident,
        actor=_actor(person),
        at=datetime.now(UTC),
        only_if_unset=True,
        request=request,
    )
    return schemas.FieldReportState(**await crud.field_report_state(db, incident))


@router.post("/incidents/{incident_id}/pickup", response_model=schemas.FieldReportState)
@limiter.limit(RateLimits.FELD)
async def report_pickup(
    request: Request,
    incident_id: uuid.UUID,
    payload: schemas.FeldPickupRequest,
    event_id: FeldEventId,
    personnel_id: uuid.UUID = Query(..., description="Who is reporting"),
    db: AsyncSession = Depends(get_db),
) -> schemas.FieldReportState:
    """
    "Abholung nötig" / "abgeholt" (decision 24).

    `needed=true` is the *"Wir müssen abgeholt werden"* half of the follow-up
    that "Einsatz beendet" asks; `needed=false` is *"Wir fahren selbst"* and,
    later, the crew tapping *abgeholt*.

    Not a status: a Schadenplatz can be finished and still have three people
    standing in the rain, which is precisely why the flag outlives the card
    moving to `complete`.
    """
    incident, person = await _authorized_incident(db, event_id, personnel_id, incident_id)
    await crud.record_pickup(
        db,
        incident,
        actor=_actor(person),
        needed=payload.needed,
        note=payload.note,
        request=request,
    )
    return schemas.FieldReportState(**await crud.field_report_state(db, incident))


@router.post("/incidents/{incident_id}/message", status_code=204)
@limiter.limit(RateLimits.FELD)
async def report_message(
    request: Request,
    incident_id: uuid.UUID,
    payload: schemas.FeldMessageRequest,
    event_id: FeldEventId,
    personnel_id: uuid.UUID = Query(..., description="Who is reporting"),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Freitext-Meldung an den KP — a configurable chip or a typed sentence.

    Becomes a `field_message` notification (how the KP sees it now) **and** an
    audit-log entry (how it survives into the Journal once somebody dismisses
    the bell). The chips themselves are station config, not translation — see
    `feld.message_chips` in `services/settings.py`.
    """
    incident, person = await _authorized_incident(db, event_id, personnel_id, incident_id)
    await crud.record_field_message(
        db,
        incident,
        actor=_actor(person),
        message=payload.message,
        request=request,
    )
