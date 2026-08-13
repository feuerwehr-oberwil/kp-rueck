"""`/feld` — the login-less field surface (plan 25).

One global QR per Ereignis; everyone in the field finds themselves in a list and
sees exactly their own Schadenplätze. Phase 0 is the door only: the picker, the
list, and the Einsatzleiter briefing on every row. Nothing here writes.

**Authorization is two-step on every single endpoint** and neither step is
optional:

1. ``validate_feld_token`` turns the link's token into its claims, else 401.
   A ``checkin`` / ``viewer`` / ``reko_dashboard`` / ``alarm`` token does not
   open this door.
2. The caller's personnel row must have an ``incident_assignments`` row for an
   incident in that event — active **or already released** — else 403. This is
   decision 4 ("visibility is only mine") and it lives in ``crud/feld.py``, not
   in the UI.

What step 2 is and is not: it decides *which Schadenplätze* a given person may
see, and it is why a crew's list is their own. It is **not** proof of identity.
On an unbound (event-scoped) token the caller names the person themselves, and
`GET /feld/personnel` hands every holder of the link the whole picker — that is
the design (one global QR, everyone finds themselves in a list), and it means
such a link is a credential for the *event*: it can read, and write as, any crew
in it. A token minted with a ``personnel_id`` closes exactly that gap — step 2
then also refuses any other person — but nothing mints one today, because
neither the poster QR nor the Einsatzzettel slip knows who will drive.

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
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Event, Incident, Personnel, SchadenplatzReport
from ..services.photo_storage import photo_storage
from ..services.settings import FELD_MESSAGE_CHIPS_KEY, get_setting_value, parse_message_chips
from ..services.tokens import FeldTokenClaims, generate_feld_token, validate_feld_token

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
) -> Personnel:
    """Step 2, person-scoped: this person must have an assignment in this event.

    A person-bound token may only ever act as its own person — same 403, so a
    personal link cannot be turned into an event-wide one by editing the id in
    the URL. An unknown personnel id gets that same 403 as a known-but-unassigned
    one: a public token must not become a way to probe which UUIDs exist.
    """
    if claims.personnel_id is not None and claims.personnel_id != personnel_id:
        raise HTTPException(
            status_code=403,
            detail="Für diese Person ist in diesem Ereignis keine Einsatzstelle erfasst.",
        )
    if not await crud.person_has_event_assignment(db, claims.event_id, personnel_id):
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
    claims: FeldClaims,
    db: AsyncSession = Depends(get_db),
) -> schemas.FeldPersonnelListResponse:
    """
    The person picker: everyone with an assignment in this event.

    Token only — no login. Deliberately not the roster: a person with no
    assignment has nothing to file, and listing them would produce an empty page
    with no explanation instead of the "melde dich beim KP" sentence.
    """
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
    person = await require_feld_person(db, claims, personnel_id)

    assignments = await crud.get_feld_assignments_for_personnel(db, claims.event_id, personnel_id)
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
    claims: FeldTokenClaims,
    personnel_id: uuid.UUID,
    incident_id: uuid.UUID,
) -> tuple[Incident, Personnel]:
    """Both steps at once, for the incident-scoped writes.

    The person check runs first so an unassigned caller gets the same 403
    whether or not the incident exists — a public token must not become a way to
    probe the board.
    """
    person = await require_feld_person(db, claims, personnel_id)
    incident = await crud.get_authorized_incident(db, claims.event_id, personnel_id, incident_id)
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
    await crud.record_pickup(
        db,
        incident,
        actor=_actor(person),
        needed=payload.needed,
        note=payload.note,
        request=request,
    )
    return schemas.FieldReportState(**await crud.field_report_state(db, incident))


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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
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
    incident, person = await _authorized_incident(db, claims, personnel_id, incident_id)
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
    incident, _person = await _authorized_incident(db, claims, personnel_id, incident_id)

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
