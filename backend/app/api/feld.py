"""`/feld` — the login-less field surface (plan 25).

One global QR per Ereignis; everyone in the field finds themselves in a list and
sees exactly their own Schadenplätze. Phase 0 is the door only: the picker, the
list, and the Einsatzleiter briefing on every row. Nothing here writes.

**Authorization is two-step on every single endpoint** and neither step is
optional:

1. ``validate_feld_token`` turns the link's token into its claims, else 401.
   A ``checkin`` / ``viewer`` / ``reko_dashboard`` / ``alarm`` token does not
   open this door.
2. The event must hold something for the caller's personnel row, else 403. This
   is decision 4 ("visibility is only mine") and it lives in
   ``crud/feld/visibility.py``, not in the UI.

   Since plan 26 that is a **union of four sources** — an own assignment (active
   or already released), a Reko auftrag, a vehicle they drive while it is
   assigned, or the Magazin function where material is still out. A driver holds
   no personnel row at all, which is exactly why the old single-source rule
   could not see them.

   Some writes narrow it further: only a ``crew`` claim may file a
   Schadenplatz-Rapport, and only a ``crew`` claim may end the Einsatz or ask
   for an Abholung. That is enforced at the door via ``sources=``, not by
   hiding a section in the UI.

**Step 0, since plan 26: the Feld-Code.** The poster QR and the Einsatzzettel
carry a *link* token, which opens nothing at all. `POST /unlock` trades it plus
the four digits for an *unlocked* token (good only for the picker), and
`POST /claim` trades that for a *bound* one when somebody names themselves. From
there the token carries a ``personnel_id`` the server enforces, so a device
cannot act as a colleague, and a ``claim_id`` so it can be logged out again —
a JWT is otherwise impossible to recall.

What none of this is: proof of identity. Somebody may still pick the wrong name
off the picker, and the accepted answer is that the brigade is trusted
(decision 2). What it *does* buy is that holding the link is no longer enough —
a forwarded URL, or a slip left in a vehicle for three weeks, is inert.

Privacy (§9): neither a token nor any owner field may be interpolated into a log
line here. The field surface is the first place kp-rueck touches citizen PII.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..config import settings
from ..crud import events as events_crud
from ..crud import feld as crud
from ..crud import personnel_checkin as personnel_checkin_crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Event, Incident, Personnel, SchadenplatzReport
from ..services import incident_display
from ..services.photo_storage import photo_storage
from ..services.settings import FELD_MESSAGE_CHIPS_KEY, get_setting_value, parse_message_chips
from ..services.tokens import (
    FeldTokenClaims,
    generate_feld_token,
    generate_form_token,
    validate_feld_token,
)
from ..websocket_manager import broadcast_incident_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feld", tags=["feld"])


async def require_feld_claims(
    token: str = Query(..., description="Access token from the generated /feld link"),
) -> FeldTokenClaims:
    """Step 1: the token must be a valid, unexpired `feld` token.

    Yields the claims, not just the event — a person-bound token has to reach
    step 2, and a dependency that threw the binding away would silently make
    every personal link event-wide again.
    """
    claims = validate_feld_token(token)
    if claims is None:
        raise HTTPException(status_code=401, detail="Ungültiger oder abgelaufener Zugriffscode")
    return claims


FeldClaims = Annotated[FeldTokenClaims, Depends(require_feld_claims)]


async def _load_event(db: AsyncSession, event_id: uuid.UUID) -> Event:
    """The event the token names, or 404."""
    event = await events_crud.get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Ereignis nicht gefunden")
    return event


async def require_feld_person(
    db: AsyncSession,
    claims: FeldTokenClaims,
    personnel_id: uuid.UUID,
    *,
    require_access: bool = True,
) -> Personnel:
    """Step 2, person-scoped: this event must hold something for this person.

    "Something" is the union of the four sources (`crud/feld/visibility.py`), not
    just a personal assignment — a driver and a Magazin person hold none and
    still belong here.

    A person-bound token may only ever act as its own person — same 403, so a
    personal link cannot be turned into an event-wide one by editing the id in
    the URL. An unknown personnel id gets that same 403 as a known-but-unassigned
    one: a public token must not become a way to probe which UUIDs exist.
    """
    # Since decision 18 the binding is mandatory, not optional: a token that
    # names no person may not act as one. An unbound token used to be able to
    # write as any crew in the event — that was the whole hole this closes.
    if claims.personnel_id is None or claims.personnel_id != personnel_id:
        raise HTTPException(
            status_code=403,
            detail="Für diese Person ist in diesem Ereignis keine Einsatzstelle erfasst.",
        )
    # The claim is the recall a JWT cannot do by itself: once the KP has pressed
    # "alle Geräte abmelden", this is where the revoked device finds out.
    if claims.claim_id is None or not await crud.claim_is_live(db, claims.claim_id, claims.event_id):
        raise HTTPException(
            status_code=401,
            detail="Dieses Gerät wurde abgemeldet. Bitte den Code neu eingeben.",
        )
    # `require_access=False` for reading your OWN list. Since the binding became
    # mandatory this check adds nothing there — a bound token can only ask about
    # itself — and refusing it was actively harmful: a crew whose last
    # Schadenplatz was released got a 403 instead of an empty list, and the
    # phone's silent poll (which keeps its rows when a request fails, so a
    # cellar does not blank the page) then showed them a Schadenplatz they no
    # longer had any access to, indefinitely.
    if require_access and not await crud.person_has_event_access(db, claims.event_id, personnel_id):
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


@router.get("/access", response_model=schemas.FeldAccessState)
async def get_feld_access(
    current_user: CurrentEditor,  # Editor only — the code is a credential
    event_id: uuid.UUID = Query(..., description="Event ID"),
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldAccessState:
    """The Feld-Code and how many devices are using it (editor only)."""
    event = await _load_event(db, event_id)
    return schemas.FeldAccessState(
        code=event.feld_code,
        device_count=await crud.live_device_count(db, event.id),
    )


@router.post("/access/regenerate", response_model=schemas.FeldAccessState)
async def regenerate_feld_code(
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID"),
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldAccessState:
    """A new code, for one that got around.

    **Nobody is logged out.** Devices already bound keep their token until the
    Ereignis ends; only new unlocks need the new digits. That is what makes this
    a cheap action — the expensive one is `/access/revoke-devices` below, and
    the two are kept apart precisely so the cheap one is not feared and the
    expensive one is not pressed by mistake (decision 30).
    """
    event = await _load_event(db, event_id)
    code = await crud.regenerate_code(db, event)
    return schemas.FeldAccessState(
        code=code,
        device_count=await crud.live_device_count(db, event.id),
    )


@router.post("/access/revoke-devices", response_model=schemas.FeldAccessState)
async def revoke_feld_devices(
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID"),
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldAccessState:
    """The emergency brake: every bound device for this Ereignis is logged out.

    For a lost phone or a code that ended up somewhere public. Everyone in the
    field types the code again — including the crews currently standing at a
    Schadenplatz — so the UI states the device count before asking.
    """
    event = await _load_event(db, event_id)
    await crud.revoke_all_claims(db, event.id)
    return schemas.FeldAccessState(
        code=event.feld_code,
        device_count=await crud.live_device_count(db, event.id),
    )


@router.post("/unlock", response_model=schemas.FeldUnlockResponse)
@limiter.limit(RateLimits.FELD_UNLOCK)
async def unlock_feld(
    request: Request,
    payload: schemas.FeldUnlockRequest,
    claims: FeldClaims,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldUnlockResponse:
    """Step 2 of the door: trade the link token for an unlocked one.

    The exchange is server-side on purpose (decision 13). A screen that merely
    asked for the code before rendering would be bypassed by anyone who kept the
    URL — the point is that the *link* stops being sufficient.

    Returns the picker in the same response, because the only thing the caller
    can do next is find their own name, and a second round trip on a phone in
    the rain buys nothing.

    Rate limited hard: the limit counts every attempt, but a device unlocks once
    per Ereignis, so the ceiling only ever bites on repeated guessing.
    """
    event = await _load_event(db, claims.event_id)
    if not crud.code_matches(event, payload.code):
        # No hint about length, no "close" — and deliberately the same shape of
        # answer whether the code was wrong or malformed.
        raise HTTPException(status_code=403, detail="Falscher Code")

    personnel = await crud.get_feld_personnel_for_event(db, claims.event_id)
    return schemas.FeldUnlockResponse(
        token=generate_feld_token(claims.event_id, unlocked=True),
        personnel=[schemas.FeldPersonnel(**p) for p in personnel],
        event_id=event.id,
        event_name=event.name,
    )


@router.post("/claim", response_model=schemas.FeldClaimResponse)
@limiter.limit(RateLimits.FELD)
async def claim_feld_person(
    request: Request,
    payload: schemas.FeldClaimRequest,
    claims: FeldClaims,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldClaimResponse:
    """Step 3: the device says who it is, and gets a token bound to that person.

    This is where decision 18 actually happens. From here the token carries a
    ``personnel_id`` the server enforces, so the device cannot act as a
    colleague — no delivery channel, no Divera, no phone numbers needed.

    The person must be someone this event holds something for; claiming an
    arbitrary UUID gets the same 403 as claiming a stranger, so the endpoint is
    not an oracle for which personnel ids exist.
    """
    if not claims.unlocked:
        raise HTTPException(status_code=403, detail="Zuerst den Code eingeben")
    event = await _load_event(db, claims.event_id)
    if not await crud.person_has_event_access(db, event.id, payload.personnel_id):
        raise HTTPException(
            status_code=403,
            detail="Für diese Person ist in diesem Ereignis keine Einsatzstelle erfasst.",
        )

    claim = await crud.create_claim(db, event.id, payload.personnel_id)
    return schemas.FeldClaimResponse(
        token=generate_feld_token(
            event.id,
            personnel_id=payload.personnel_id,
            unlocked=True,
            claim_id=claim.id,
        ),
        personnel_id=payload.personnel_id,
    )


@router.get("/personnel", response_model=schemas.FeldPersonnelListResponse)
@limiter.limit(RateLimits.FELD)
async def list_feld_personnel(
    request: Request,
    claims: FeldClaims,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldPersonnelListResponse:
    """
    The person picker: everyone this event holds something for.

    Needs an **unlocked** token — the picker is the one thing the code buys you
    before you have named yourself, and handing it to a bare link token would
    give the whole roster back to anyone holding a forwarded URL.

    Deliberately not the roster of the brigade: a person the event holds nothing
    for has nothing to do here, and listing them would produce an empty page
    with no explanation instead of the "melde dich beim KP" sentence.

    Since plan 26 this includes drivers and Magazin people, who hold no
    assignment of their own and were therefore invisible to the old query.
    """
    if not claims.unlocked:
        raise HTTPException(status_code=403, detail="Zuerst den Code eingeben")
    event = await _load_event(db, claims.event_id)
    personnel = await crud.get_feld_personnel_for_event(db, claims.event_id)

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
    claims: FeldClaims,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldAssignmentsResponse:
    """
    "Meine Einsatzstellen" — this person's Schadenplätze in this event.

    Each row carries the rapport state, the two field timestamps, and the
    Einsatzleiter of that incident (decision 22): the EL is briefed before any
    form opens, never enforced.
    """
    event = await _load_event(db, claims.event_id)
    person = await require_feld_person(db, claims, personnel_id, require_access=False)

    assignments = await crud.get_feld_assignments_for_personnel(db, claims.event_id, personnel_id)
    chips = parse_message_chips(await get_setting_value(db, FELD_MESSAGE_CHIPS_KEY))
    # One read for the whole list, next to the chips read that is already here.
    home_city = await incident_display.get_home_city(db)

    return schemas.FeldAssignmentsResponse(
        personnel_id=person.id,
        personnel_name=person.name,
        personnel_role=person.role,
        event_id=event.id,
        event_name=event.name,
        assignments=[
            schemas.FeldAssignment(
                **a,
                location_display=incident_display.location_display(a.get("location_address"), home_city),
            )
            for a in assignments
        ],
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
    claims: FeldTokenClaims,
    personnel_id: uuid.UUID,
    incident_id: uuid.UUID,
    *,
    sources: tuple[str, ...] | None = None,
) -> tuple[Incident, Personnel]:
    """Both steps at once, for the incident-scoped writes.

    The person check runs first so an unassigned caller gets the same 403
    whether or not the incident exists — a public token must not become a way to
    probe the board.

    ``sources`` restricts *which kind of claim* is good enough for this write.
    The Schadenplatz-Rapport passes ``RAPPORT_SOURCES``, so a driver or a Reko
    trupp is refused here and not merely shown a page without the form.
    """
    person = await require_feld_person(db, claims, personnel_id)
    incident = await crud.get_authorized_incident(db, claims.event_id, personnel_id, incident_id, sources=sources)
    if incident is None:
        raise HTTPException(
            status_code=403,
            detail="Diese Einsatzstelle ist dir nicht zugeteilt.",
        )
    return incident, person


def _actor(person: Personnel) -> crud.FieldActor:
    """A `/feld` write is always a field write — never a user (decision 28)."""
    return crud.FieldActor(personnel_id=person.id, personnel_name=person.name)


async def _enforce_demo_photo_limits(db: AsyncSession, file: UploadFile) -> None:
    """The demo's photo ceiling, same shape as the Reko form's (`api/reko.py`).

    `/feld` works in the demo on purpose (§8) — it is a feature the demo should
    show — but it is a *public, token-gated* upload path there, which is strictly
    more exposed than the Reko form. So it gets the same 1 MB / 15 photos cap.
    No-op outside the demo.
    """
    if not settings.demo_mode:
        return

    contents = await file.read()
    if len(contents) > 1 * 1024 * 1024:
        raise HTTPException(status_code=403, detail="Demo-Modus: Maximale Dateigrösse 1MB.")
    await file.seek(0)

    result = await db.execute(select(sa_func.coalesce(sa_func.array_length(SchadenplatzReport.photos_json, 1), 0)))
    if sum(row[0] for row in result) >= 15:
        raise HTTPException(status_code=403, detail="Demo-Modus: Maximale Anzahl Fotos (15) erreicht.")


@router.post("/incidents/{incident_id}/arrived", response_model=schemas.FieldReportState)
@limiter.limit(RateLimits.FELD)
async def report_arrived(
    request: Request,
    incident_id: uuid.UUID,
    claims: FeldClaims,
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.ARRIVAL_SOURCES)
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
    claims: FeldClaims,
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.WORK_SOURCES)
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
    claims: FeldClaims,
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.WORK_SOURCES)
    await crud.record_pickup(
        db,
        incident,
        actor=_actor(person),
        needed=payload.needed,
        note=payload.note,
        request=request,
    )
    return schemas.FieldReportState(**await crud.field_report_state(db, incident))


@router.post("/attendance/{personnel_id}", response_model=schemas.PersonnelCheckInResponse)
@limiter.limit(RateLimits.FELD)
async def set_own_attendance(
    request: Request,
    personnel_id: uuid.UUID,
    claims: FeldClaims,
    present: bool = Query(..., description="true = eingecheckt, false = abgerückt"),
    db: AsyncSession = Depends(get_db),
) -> schemas.PersonnelCheckInResponse:
    """Check yourself in or out of the Ereignis (plan 26, decision 10).

    The individual half of `/check-in`, which stays a page in its own right for
    the shared tablet at the door — one device for many people is a different
    product from a page built around a per-device "this phone is Marco" cookie.

    `require_access=False`: checking in is what somebody does *before* the KP
    has given them anything, so requiring an assignment first would refuse
    exactly the people this exists for. The binding still means a device can
    only check ITSELF in.

    Reuses the board's own CRUD, so the roll call is one list however it was
    written — the field surface is not a second attendance record.
    """
    person = await require_feld_person(db, claims, personnel_id, require_access=False)
    event = await _load_event(db, claims.event_id)

    result = (
        await personnel_checkin_crud.check_in_personnel(db, event.id, person.id, None, request)
        if present
        # `allow_assigned`: a crew that is still on a Schadenplatz can still say
        # it has gone home. The board clears the assignment, not the person.
        else await personnel_checkin_crud.check_out_personnel(
            db, event.id, person.id, None, request, allow_assigned=True
        )
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Person nicht gefunden")
    return result


@router.post("/incidents", response_model=schemas.FeldIncidentCreated, status_code=201)
@limiter.limit(RateLimits.INTAKE)
async def report_new_incident(
    request: Request,
    payload: schemas.FeldIncidentCreate,
    claims: FeldClaims,
    personnel_id: uuid.UUID = Query(..., description="Who is reporting"),
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldIncidentCreated:
    """«Neue Meldung» — a Schadenplatz reported from the field (decision 14).

    The reporter is a **known person standing in front of it**, which is the
    whole difference from `/intake/alarm`: no Melder fields to fill in, the
    board gets `source='feld'` with their name on the audit row, and the crew
    can take the job on in the same tap.

    Rate limited with INTAKE rather than FELD: this creates board state from a
    login-less door, and it is the one write here that a bored link-holder
    could use to make a mess.
    """
    person = await require_feld_person(db, claims, personnel_id)
    event = await _load_event(db, claims.event_id)
    incident, mode = await crud.create_field_report(db, event.id, person, payload, request)

    # Same broadcast + sync path as every other create, so the board moves
    # without a refresh and the card is not a ghost until somebody polls.
    await broadcast_incident_update(str(incident.id), "created")

    return schemas.FeldIncidentCreated(incident_id=incident.id, takeover=mode)


@router.post("/incidents/{incident_id}/reko-link", response_model=dict)
@limiter.limit(RateLimits.FELD)
async def mint_reko_link(
    request: Request,
    incident_id: uuid.UUID,
    claims: FeldClaims,
    personnel_id: uuid.UUID = Query(..., description="The person filing"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """A short-lived form token so the Reko form can mount inside `/feld`.

    The alternative was to widen ``validate_form_token`` to accept feld tokens,
    and that is exactly how a token type stops meaning anything (see the photo
    handler below, which makes the same argument). Instead `/feld` runs its own
    two-step and then mints the *existing* per-incident form token — the same
    one `/reko-dashboard` handed out — so neither token type learns about the
    other and the Reko form component is reused unchanged.

    Gated on ``SOURCE_REKO``: only somebody the KP actually gave a Reko auftrag
    may file one. A crew working the Schadenplatz reads the Reko as briefing and
    files a Schadenplatz-Rapport instead.
    """
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=(crud.SOURCE_REKO,))
    token = generate_form_token(str(incident.id), "reko")
    return {
        "incident_id": str(incident.id),
        "token": token,
        "link": f"/reko?incident_id={incident.id}&token={token}&personnel_id={person.id}",
    }


@router.get("/incidents/{incident_id}/rapport", response_model=schemas.SchadenplatzRapport)
@limiter.limit(RateLimits.FELD)
async def get_rapport(
    request: Request,
    incident_id: uuid.UUID,
    claims: FeldClaims,
    personnel_id: uuid.UUID = Query(..., description="Who is filing"),
    db: AsyncSession = Depends(get_db),
) -> schemas.SchadenplatzRapport:
    """
    The Schadenplatz-Rapport, **prefilled if it does not exist yet** (§4).

    A GET that computes and does not write: opening the form must not create a
    row, or "kein Rapport" would stop meaning anything the moment somebody
    looked. The material checklist is re-reconciled against the board on every
    call — a unit assigned after the draft started appears unticked, one the
    board took away keeps its row only if the crew already answered for it.
    """
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.RAPPORT_SOURCES)
    return schemas.SchadenplatzRapport(**await crud.get_rapport(db, incident, actor=_actor(person)))


@router.put("/incidents/{incident_id}/rapport", response_model=schemas.SchadenplatzRapport)
@limiter.limit(RateLimits.FELD)
async def save_rapport(
    request: Request,
    incident_id: uuid.UUID,
    payload: schemas.RapportUpdate,
    claims: FeldClaims,
    personnel_id: uuid.UUID = Query(..., description="Who is filing"),
    db: AsyncSession = Depends(get_db),
) -> schemas.SchadenplatzRapport:
    """
    Upsert the Rapport. `is_draft: true` is the 30 s autosave, `false` files it.

    One row per Schadenplatz (decision 3): whoever files first creates it,
    anyone else assigned amends the same row, and the form shows "zuletzt
    bearbeitet von X" so the next person knows. Filing freezes
    `cost_snapshot_json` — a later board edit cannot change a filed rapport.

    Still writes no assignment. The material checklist records two ticks against
    the board's units; releasing what came back is the board's own one-click
    action (decision 17).
    """
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.RAPPORT_SOURCES)
    return schemas.SchadenplatzRapport(
        **await crud.save_rapport(db, incident, actor=_actor(person), payload=payload, request=request)
    )


@router.post("/incidents/{incident_id}/photos", response_model=schemas.RapportPhotosResponse)
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def upload_photo(
    request: Request,
    incident_id: uuid.UUID,
    claims: FeldClaims,
    personnel_id: uuid.UUID = Query(..., description="Who is uploading"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> schemas.RapportPhotosResponse:
    """
    A photo of the Schadenplatz, onto the Schadenplatz-Rapport.

    Same storage as the Reko form (`services/photo_storage.py`), same files —
    but **the two doors stay separate**, reading included: `GET /api/photos/...`
    is session-authenticated and `/feld` has no session, so the read-back lives
    next to this handler (``serve_feld_photo`` below) behind the same two-step.
    `validate_form_token` is deliberately not widened to accept feld tokens:
    coupling two doors for the sake of one handler is how a token type stops
    meaning anything. This handler runs the ordinary feld two-step like every
    other endpoint here.

    Keeps ``PHOTO_UPLOAD`` rather than the looser ``FELD`` limit — an upload is
    orders of magnitude more expensive than a poll.
    """
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.RAPPORT_SOURCES)
    await _enforce_demo_photo_limits(db, file)
    photos = await crud.add_photo(db, incident, actor=_actor(person), file=file, request=request)
    return schemas.RapportPhotosResponse(
        incident_id=incident.id,
        photos=photos,
        filename=photos[-1] if photos else None,
    )


@router.delete("/incidents/{incident_id}/photos/{filename}", response_model=schemas.RapportPhotosResponse)
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def delete_photo(
    request: Request,
    incident_id: uuid.UUID,
    filename: str,
    claims: FeldClaims,
    personnel_id: uuid.UUID = Query(..., description="Who is deleting"),
    db: AsyncSession = Depends(get_db),
) -> schemas.RapportPhotosResponse:
    """Remove a photo again — the mis-tapped shutter, from the phone that took it."""
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.RAPPORT_SOURCES)
    photos = await crud.remove_photo(db, incident, actor=_actor(person), filename=filename, request=request)
    return schemas.RapportPhotosResponse(incident_id=incident.id, photos=photos)


@router.get("/incidents/{incident_id}/photos/{filename}")
@limiter.limit(RateLimits.FELD)
async def serve_feld_photo(
    request: Request,
    incident_id: uuid.UUID,
    filename: str,
    claims: FeldClaims,
    personnel_id: uuid.UUID = Query(..., description="Who is looking"),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Read a rapport photo back on `/feld` — the crew looking at what it shot.

    `GET /api/photos/{incident}/{file}` (`api/reko.py`) is the board's read path
    and requires a session; `/feld` has none, which is why the phone got a
    broken image where its own photo should be. The answer is NOT to drop the
    credential from that endpoint — a rapport photo can be a citizen's cellar.
    It is the same two-step every other handler in this module runs, so a photo
    is readable exactly by someone who holds the event's link AND is assigned to
    that Schadenplatz.

    ``photos_json`` is checked as well as the disk: the assignment says which
    incident you may look at, the report says which files belong to it. Neither
    alone is enough — `get_photo_path` only proves a file exists on disk under
    that incident's directory.
    """
    incident, _person = await _authorized_incident(db, claims, personnel_id, incident_id, sources=crud.RAPPORT_SOURCES)

    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    report = result.scalar_one_or_none()
    if report is None or filename not in (report.photos_json or []):
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")

    file_path = photo_storage.get_photo_path(incident.id, filename)
    if file_path is None:
        raise HTTPException(status_code=404, detail="Foto nicht gefunden")

    return FileResponse(
        file_path,
        media_type="image/jpeg",
        # `private` and short: the URL carries a token, and a shared cache must
        # never hold a photo that a later, tokenless request could be served.
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/incidents/{incident_id}/message", status_code=204)
@limiter.limit(RateLimits.FELD)
async def report_message(
    request: Request,
    incident_id: uuid.UUID,
    payload: schemas.FeldMessageRequest,
    claims: FeldClaims,
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
    await crud.record_field_message(
        db,
        incident,
        actor=_actor(person),
        message=payload.message,
        request=request,
    )
