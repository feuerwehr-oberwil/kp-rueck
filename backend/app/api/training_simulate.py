"""Training simulation API: the Übungssteuerung's injects (`/training/events/{id}/simulate/*`).

Each inject writes what a real crew, phone or alarm would – through the same CRUD the real
path uses – so the board cannot tell the exercise from the night. The helpers that build a
simulated filer or Rapport live next to `TrainingGenerator` in `services/training.py`.
"""

import asyncio
import logging
import random
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor
from ..crud import feld as feld_crud
from ..crud import personnel_checkin as checkin_crud
from ..crud import reko as reko_crud
from ..crud.materials import apply_out_of_service
from ..database import after_commit, async_session_maker, get_db
from ..models import (
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    Notification,
    Personnel,
    SchadenplatzReport,
    Vehicle,
)
from ..schemas import (
    DiveraEmergencyResponse,
    FeldIncidentCreate,
    FieldReportUpdate,
    IncidentPriority,
    IncidentResponse,
    IncidentType,
    RekoReportResponse,
    RekoReportUpdate,
    SimulateBulkRapportResponse,
    SimulateCheckinRequest,
    SimulateCheckinResponse,
    SimulateDiveraRequest,
    SimulateFieldCompleteRequest,
    SimulateInjectResponse,
    SimulatePickupRequest,
    SimulateRapportResponse,
    SimulateVehicleBreakdownResponse,
)
from ..services import incident_display, notification_params
from ..services.divera_intake import broadcast_emergency_received
from ..services.tokens import generate_form_token
from ..services.training import (
    file_simulated_rapport,
    generate_training_divera_emergency,
    has_vehicle,
    simulated_filer,
    stranded_pickup_note,
)
from ..services.training_photos import attach_training_photos
from ..services.training_simulation_data import (
    RAPPORT_SIM_PROFILE,
    generate_escalation,
    generate_field_message,
    generate_reinforcement_request,
    generate_reko_report_data,
)
from ..utils.errors import ErrorMessages
from ..websocket_manager import (
    broadcast_incident_update,
    broadcast_personnel_update,
    broadcast_vehicle_update,
)
from .incidents import set_field_report

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training", tags=["training"])


async def _require_training_event(db: AsyncSession, event_id: UUID) -> Event:
    """Shared guard: training endpoints only work on training events."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.EVENT_NOT_FOUND)
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.TRAINING_EVENTS_ONLY)
    return event


async def _get_event_incident(db: AsyncSession, event_id: UUID, incident_id: UUID) -> Incident:
    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id or incident.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.INCIDENT_NOT_IN_EVENT)
    return incident


# One trickle task per event at most; module-level so requests share the guard
# and the task isn't garbage-collected mid-run. In-memory only — a backend
# restart drops pending trickles, which is fine for an exercise aid.
_trickle_tasks: dict[UUID, asyncio.Task[None]] = {}


async def _trickle_checkins(event_id: UUID, people: list[tuple[UUID, str]], window_seconds: float) -> None:
    """Check `people` in one by one at random offsets across the window."""
    offsets = sorted(random.uniform(window_seconds * 0.05, window_seconds) for _ in people)
    elapsed = 0.0
    for (person_id, name), offset in zip(people, offsets, strict=False):
        await asyncio.sleep(max(0.0, offset - elapsed))
        elapsed = offset
        try:
            async with async_session_maker() as db:
                result = await checkin_crud.check_in_personnel(db, event_id, person_id)
                await db.commit()
            if result:
                await broadcast_personnel_update({"id": str(person_id), "name": name, "checked_in": True}, "checkin")
        except Exception as e:
            logger.error("Trickle check-in failed for %s: %s", name, e)


@router.post("/events/{event_id}/simulate/checkin", response_model=SimulateCheckinResponse)
async def simulate_checkin(
    event_id: UUID,
    request: SimulateCheckinRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SimulateCheckinResponse:
    """
    Simulate personnel check-in for a training event.

    Randomly selects unchecked personnel and checks them in — immediately, or
    trickled over ``over_minutes`` so arrivals mirror a real Aufgebot.
    """
    await _require_training_event(db, event_id)

    # Validate count
    count = max(1, min(50, request.count))
    over_minutes = max(0, min(30, request.over_minutes))

    # Get available personnel
    all_personnel = await db.execute(
        select(Personnel).where(Personnel.status != "unavailable").order_by(Personnel.name.asc())
    )
    personnel_list = list(all_personnel.scalars().all())

    # Get already checked-in personnel for this event
    attendance_result = await db.execute(
        select(EventAttendance).where(EventAttendance.event_id == event_id, EventAttendance.checked_in == True)  # noqa: E712
    )
    checked_in_ids = {att.personnel_id for att in attendance_result.scalars().all()}

    # Filter to unchecked personnel
    unchecked = [p for p in personnel_list if p.id not in checked_in_ids]

    # Select random subset
    to_checkin = random.sample(unchecked, min(count, len(unchecked)))

    # Trickle mode: schedule the arrivals and return immediately.
    if over_minutes > 0 and to_checkin:
        existing = _trickle_tasks.get(event_id)
        if existing and not existing.done():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ein gestaffeltes Einchecken läuft bereits",
            )
        people = [(p.id, p.name) for p in to_checkin]
        _trickle_tasks[event_id] = asyncio.create_task(_trickle_checkins(event_id, people, over_minutes * 60.0))
        return SimulateCheckinResponse(
            checked_in=[],
            total_checked_in=len(checked_in_ids),
            total_available=len(personnel_list),
            scheduled=[name for _, name in people],
            trickle_minutes=over_minutes,
        )

    # Check them in
    checked_in_names = []
    for person in to_checkin:
        result = await checkin_crud.check_in_personnel(db, event_id, person.id)
        if result:
            checked_in_names.append(result.name)
            background_tasks.add_task(
                broadcast_personnel_update,
                {"id": str(person.id), "name": person.name, "checked_in": True},
                "checkin",
            )

    return SimulateCheckinResponse(
        checked_in=checked_in_names,
        total_checked_in=len(checked_in_ids) + len(checked_in_names),
        total_available=len(personnel_list),
    )


@router.post("/events/{event_id}/simulate/field-complete/{incident_id}", response_model=IncidentResponse)
async def simulate_field_complete(
    event_id: UUID,
    incident_id: UUID,
    request: Request,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    payload: SimulateFieldCompleteRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> IncidentResponse:
    """Field crew reports the incident finished ("Einsatz beendet") — plus the
    follow-up the field actually gets: *"Kommt ihr selbst zurück?"*

    Informational only: stamps ``field_complete_reported_at`` so the operator
    sees a "Feld meldet: beendet" badge on the card and can decide to close the
    incident. Deliberately does NOT change the status — closing is the
    operator's board action, mimicking the real command-post split.

    This used to write ``incident.field_complete_reported_at`` by hand, which
    meant a training run stamped no provenance and rang no bell — the one thing
    the exercise is supposed to rehearse. It now goes through the **KP-parity
    endpoint** (`POST /api/incidents/{id}/field-report`), so the simulated and
    the real operator path are byte-for-byte the same code, audit entry and
    notification included.

    The Abholung answer (decision 24) is preselected by the situation — a crew
    that walked there or whose vehicle drove on is usually stranded — and the
    Übungsleiter can always override it by sending it explicitly.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    pickup_needed = payload.pickup_needed if payload else None
    pickup_note = payload.pickup_note if payload else None
    if pickup_needed is None:
        rng = random.Random()
        stranded = incident.zu_fuss or not await has_vehicle(db, incident)
        rate = RAPPORT_SIM_PROFILE.pickup_when_stranded if stranded else RAPPORT_SIM_PROFILE.pickup_otherwise
        pickup_needed = rng.random() < rate
        if pickup_needed and pickup_note is None:
            pickup_note = stranded_pickup_note(incident)

    # The parity endpoint, called as an editor — same handler, same CRUD, same
    # provenance rule (the personnel FKs stay NULL for a KP write, decision 28).
    await set_field_report(
        incident_id=incident_id,
        payload=FieldReportUpdate(
            field_complete_reported_at=datetime.now(UTC),
            pickup_needed=pickup_needed,
            pickup_note=pickup_note,
        ),
        request=request,
        db=db,
        current_user=current_user,
    )

    await db.refresh(incident)
    response = await incident_display.incident_with_display(db, incident)
    background_tasks.add_task(broadcast_incident_update, response.model_dump(mode="json"), "update")
    return response


@router.post("/events/{event_id}/simulate/reko-arrived/{incident_id}", response_model=IncidentResponse)
async def simulate_reko_arrived(
    event_id: UUID,
    incident_id: UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> IncidentResponse:
    """Mark the Reko crew as "vor Ort" (arrived on scene) for a training incident.

    This is the first half of the Reko arc — it sets ``arrived_at`` without
    submitting a report, so the conductor console can walk an incident through
    "Reko vor Ort" → "Reko-Meldung" as two separate, realistically-timed steps
    (the one-shot ``simulate_reko`` below still does both at once).
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.EVENT_NOT_FOUND)
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.TRAINING_EVENTS_ONLY)

    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.INCIDENT_NOT_IN_EVENT)

    if incident.status != "reko":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Einsatz muss im Status 'reko' sein (aktuell: '{incident.status}')",
        )

    token = generate_form_token(str(incident_id), "reko")
    await reko_crud.mark_reko_arrived(db, incident_id, token)

    await db.refresh(incident)
    response = await incident_display.incident_with_display(db, incident)
    background_tasks.add_task(broadcast_incident_update, response.model_dump(mode="json"), "update")
    return response


@router.post("/events/{event_id}/simulate/reko/{incident_id}", response_model=RekoReportResponse)
async def simulate_reko(
    event_id: UUID,
    incident_id: UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> RekoReportResponse:
    """
    Simulate a reko report submission for a training incident.

    Marks arrival, generates random report data, and submits it.
    Triggers the same status transitions and notifications as a real submission.
    """
    # Verify event exists and is training
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.EVENT_NOT_FOUND)
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.TRAINING_EVENTS_ONLY)

    # Verify incident belongs to event
    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.INCIDENT_NOT_IN_EVENT)

    if incident.status != "reko":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Einsatz muss im Status 'reko' sein (aktuell: '{incident.status}')",
        )

    # Generate token and mark arrival
    token = generate_form_token(str(incident_id), "reko")
    await reko_crud.mark_reko_arrived(db, incident_id, token)

    # Get or create report
    report = await reko_crud.get_or_create_reko_report(db, incident_id, token)

    # Generate and apply random reko data based on incident type, title and dispatch description.
    # Description carries keyword cues the title alone misses (e.g. "Heizöl im Keller" type=oelwehr
    # → keller subcategory; "Brand Tiefgarage" type=brandbekaempfung → fahrzeug subcategory).
    reko_data = generate_reko_report_data(
        incident.type,
        title=incident.title,
        description=incident.description,
    )
    update_data = RekoReportUpdate(**reko_data)
    updated = await reko_crud.update_reko_report(db, report.id, update_data, submit=True)

    # Attach 0-2 curated scene photos from the bundled offline pool, matched to
    # the incident type. They go through the same PhotoStorageService path real
    # uploads use, so serving/cleanup/deletion behave identically. A missing or
    # stripped pool simply yields a report without photos.
    photo_filenames = await attach_training_photos(incident_id, incident.type, current_photos=updated.photos_json)
    if photo_filenames:
        updated.photos_json = (updated.photos_json or []) + photo_filenames
        await db.flush()
        await db.refresh(updated)

    # Refresh incident to get current state
    await db.refresh(incident)

    # Process post-submission side effects (status transition, priority bump, notification)
    await reko_crud.process_reko_submission(db, incident, updated)

    # Refresh incident again for response
    await db.refresh(incident)

    # Build response
    response_data = RekoReportResponse.model_validate(updated)
    response_data.incident_title = incident.title
    response_data.incident_location = incident.location_address
    response_data.incident_type = incident.type
    response_data.incident_description = incident.description
    response_data.incident_contact = incident.contact

    # Broadcast updates
    incident_response = await incident_display.incident_with_display(db, incident)
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "update")

    return response_data


# ---------------------------------------------------------------------------
# Trainer injects: simulated Divera intake + escalations
# ---------------------------------------------------------------------------


@router.post("/events/{event_id}/simulate/divera", response_model=DiveraEmergencyResponse)
async def simulate_divera_alarm(
    event_id: UUID,
    request: SimulateDiveraRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> DiveraEmergencyResponse:
    """Inject a simulated Divera alarm into the emergency pool.

    Trainees then run the real alarm-intake workflow: alert sound and toast on
    the pool page, review, attach to the exercise. The entry is training-marked
    (ÜBUNG badge), excluded from auto-attach and only attachable to training
    events — it never touches real operations or Divera itself.
    """
    await _require_training_event(db, event_id)

    if request.category and request.category not in ["normal", "critical"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.CATEGORY_INVALID)

    # Same Literal-vs-str gap as in `generate_emergencies`: the check above is the guarantee.
    category = cast(Literal["normal", "critical"] | None, request.category)
    emergency = await generate_training_divera_emergency(db, event_id, category=category)

    response = DiveraEmergencyResponse.model_validate(emergency)
    background_tasks.add_task(broadcast_emergency_received, response.model_dump(mode="json"))
    return response


@router.post("/events/{event_id}/simulate/escalate/{incident_id}", response_model=IncidentResponse)
async def simulate_escalation(
    event_id: UUID,
    incident_id: UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> IncidentResponse:
    """Inject "Lage verschärft sich": the field reports a worsening situation.

    Bumps the incident to high priority, appends the Lagemeldung to the
    description and raises a critical bell notification — the trainee has to
    reassess resources and priorities mid-incident.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    if incident.status == "complete" or incident.completed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Abgeschlossene Einsätze können nicht eskaliert werden",
        )

    text = generate_escalation(incident.type)
    incident.priority = "high"
    incident.description = f"{incident.description or ''}\n\n⚠️ Lagemeldung Feld: {text}".strip()

    message, params = notification_params.training_escalation(incident.title, text)
    db.add(
        Notification(
            type="training_emergency",
            severity="critical",
            message=message,
            params=params,
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
    )
    await db.flush()
    await db.refresh(incident)

    response = await incident_display.incident_with_display(db, incident)
    background_tasks.add_task(broadcast_incident_update, response.model_dump(mode="json"), "update")
    return response


@router.post("/events/{event_id}/simulate/reinforcement/{incident_id}", response_model=SimulateInjectResponse)
async def simulate_reinforcement_request(
    event_id: UUID,
    incident_id: UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> SimulateInjectResponse:
    """Inject "Feld fordert Verstärkung": the crew on scene asks for more.

    Notification only — what (and whether) to send is the trainee's decision
    on the board.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    if incident.status == "complete" or incident.completed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Abgeschlossene Einsätze können keine Verstärkung anfordern",
        )

    request_text = generate_reinforcement_request(incident.type)
    message, params = notification_params.training_reinforcement(incident.title, request_text)
    db.add(
        Notification(
            type="training_emergency",
            severity="warning",
            message=message,
            params=params,
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
    )

    return SimulateInjectResponse(message=message)


# ---------------------------------------------------------------------------
# Schadenplatz-Rapport injects (plan 25, §16)
# ---------------------------------------------------------------------------
#
# All of them run through `crud/feld.py` — the ONE implementation both the
# `/feld` door and the KP-parity endpoints of the incidents router sit on
# (decision 28). A simulator with its own write path is not a rehearsal, and it
# is exactly how the KP path silently loses a field six months later.
#
# The identity differs by inject, and that is deliberate rather than sloppy:
#
# * "Einsatz beendet" calls the KP-parity endpoint as the editor, because the
#   Übungsleiter genuinely sits in the KP — the personnel FK stays NULL and the
#   audit entry carries the user, which is the honest provenance.
# * The Rapport, the Meldung, das Angekommen and die Abholung carry a
#   **simulated field identity** (the Einsatzleiter most of the time, decision
#   22), because "erfasst von Muster Hans (Feld)" versus "im KP erfasst
#   (Funkmeldung)" is one of the things the exercise has to show. A Meldung vom
#   Feld has no KP twin at all, on purpose (§6.1): the KP is its recipient.
#
# With "Angekommen" and the standalone "Abholung" the console can now produce
# all five field reports a real crew can — which is the point: an exercise the
# KP can only half-experience rehearses half a board.


@router.post("/events/{event_id}/simulate/rapport/{incident_id}", response_model=SimulateRapportResponse)
async def simulate_rapport(
    event_id: UUID,
    incident_id: UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> SimulateRapportResponse:
    """Inject "Rapport eingetroffen": one filled and submitted Schadenplatz-Rapport.

    Trains the KP side of plan 25 — the badge, the return list, the Restliste,
    the Einsätze export — without forty phones in the room. The content
    follows ``RAPPORT_SIM_PROFILE``: realistically patchy, because chasing the
    gaps is the skill being trained.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)
    return await file_simulated_rapport(db, incident, current_user=current_user, rng=random.Random(), request=request)


@router.post("/events/{event_id}/simulate/rapport", response_model=SimulateBulkRapportResponse)
async def simulate_rapports_bulk(
    event_id: UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> SimulateBulkRapportResponse:
    """Inject "Rapporte eingetroffen": 80 % of the missing ones arrive at once.

    Twenty-three Schadenplätze would otherwise be twenty-three clicks. The
    remaining fifth is **deliberate and rounded down**, so a gap always stays:
    those are why the Restliste exists, and finding them is the exercise.

    Candidates are the completed Schadenplätze without a *submitted* rapport —
    the same set the Restliste calls "ohne Rapport", drafts included, since a
    draft is somebody who started and walked away rather than a filed rapport.
    """
    await _require_training_event(db, event_id)

    incidents_result = await db.execute(
        select(Incident)
        .where(
            Incident.event_id == event_id,
            Incident.deleted_at.is_(None),
            (Incident.status == "complete") | (Incident.completed_at.isnot(None)),
        )
        .order_by(Incident.created_at)
    )
    incidents = list(incidents_result.scalars().all())

    filed_result = await db.execute(
        select(SchadenplatzReport.incident_id).where(
            SchadenplatzReport.incident_id.in_([i.id for i in incidents]),
            SchadenplatzReport.is_draft.is_(False),
        )
        if incidents
        else select(SchadenplatzReport.incident_id).where(SchadenplatzReport.incident_id.is_(None))
    )
    already_filed = {row[0] for row in filed_result.all()}
    candidates = [incident for incident in incidents if incident.id not in already_filed]

    rng = random.Random()
    covered_count = int(len(candidates) * RAPPORT_SIM_PROFILE.bulk_coverage)
    chosen = set(rng.sample(range(len(candidates)), covered_count)) if covered_count else set()

    rapports = [
        await file_simulated_rapport(db, incident, current_user=current_user, rng=rng, request=request)
        for index, incident in enumerate(candidates)
        if index in chosen
    ]

    skipped = len(candidates) - len(rapports)
    return SimulateBulkRapportResponse(
        candidates=len(candidates),
        covered=len(rapports),
        skipped=skipped,
        rapports=rapports,
        message=(
            f"{len(rapports)} von {len(candidates)} Rapporten erfasst · {skipped} fehlen weiterhin"
            if candidates
            else "Keine abgeschlossenen Einsätze ohne Rapport"
        ),
    )


@router.post("/events/{event_id}/simulate/field-message/{incident_id}", response_model=SimulateInjectResponse)
async def simulate_field_message(
    event_id: UUID,
    incident_id: UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> SimulateInjectResponse:
    """Inject "Meldung vom Feld": a chip or a typed sentence reaches the KP.

    The generic channel, using the station's configurable `feld.message_chips`
    (decision 20). It overlaps "Feld fordert Verstärkung" on purpose — that one
    stays as the specific inject; this one is what a crew actually taps, and it
    lands as a `field_message` notification plus a Journal entry.
    """
    from ..services.settings import FELD_MESSAGE_CHIPS_KEY, get_setting_value, parse_message_chips

    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    rng = random.Random()
    chips = parse_message_chips(await get_setting_value(db, FELD_MESSAGE_CHIPS_KEY))
    text = generate_field_message(incident.type, chips, rng)
    actor = await simulated_filer(db, incident, current_user, rng)

    notification = await feld_crud.record_field_message(db, incident, actor=actor, message=text, request=request)
    return SimulateInjectResponse(message=notification.message if notification else text)


class SimulateFieldReportRequest(BaseModel):
    """The free text of a simulated «Neue Meldung» — what the Trupp says."""

    text: str


class SimulateFieldReportResponse(BaseModel):
    incident_id: UUID
    reported_by: str
    message: str


@router.post(
    "/events/{event_id}/simulate/field-report/{incident_id}",
    response_model=SimulateFieldReportResponse,
)
async def simulate_field_report(
    event_id: UUID,
    incident_id: UUID,
    payload: SimulateFieldReportRequest,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> SimulateFieldReportResponse:
    """Inject «Neue Meldung»: the incident's Trupp reports a fresh emergency.

    Trains the REAL intake path (plan 26 §3, decision 14) — the same
    ``create_field_report`` a crew's phone reaches, so the KP gets a genuine
    ``source='feld'`` Schadenplatz in Eingegangen, the «Meldung vom Feld» bell,
    the audit row with the reporter's name — not a trainer shortcut that plants
    a finished card.

    The reporter is drawn from the chosen incident's crew (leader-weighted, the
    same pick as the rapport inject), because a Meldung's provenance is a known
    firefighter standing in front of the thing. An incident with nobody
    assigned is refused: there is no Trupp to speak.

    The new Schadenplatz inherits the parent's type and address — the crew
    reports what they found where they are standing — and the free text becomes
    the Meldung (``description``), which is what the card prints and the KP
    reads out. Priority stays medium: triaging it is the operator's job.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Meldungstext fehlt")

    actor = await simulated_filer(db, incident, current_user, random.Random())
    if actor.personnel_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dem Einsatz ist kein Trupp zugewiesen – eine Meldung vom Feld braucht eine Person im Feld",
        )
    person = await db.get(Personnel, actor.personnel_id)
    if person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person nicht gefunden")

    feld_payload = FeldIncidentCreate(
        # Field Meldungen are titled with where they are (see crud/feld/melden.py);
        # only a report without an address falls back to the text itself.
        title=(incident.location_address or text)[:200],
        # The columns are plain strings; the str-Enums live in the schema, and
        # pydantic still rejects a value that is not one of them.
        type=IncidentType(incident.type),
        priority=IncidentPriority.MEDIUM,
        location_address=incident.location_address,
        location_lat=incident.location_lat,
        location_lng=incident.location_lng,
        description=text,
    )
    new_incident, _mode = await feld_crud.create_field_report(db, event_id, person, feld_payload, request)

    # Same broadcast as the real /feld endpoint — the card must not be a ghost
    # until somebody polls.
    after_commit(db, broadcast_incident_update, {"id": str(new_incident.id), "status": new_incident.status}, "create")

    return SimulateFieldReportResponse(
        incident_id=new_incident.id,
        reported_by=person.name,
        message=f"Meldung vom Feld: {new_incident.location_address or new_incident.title} ({person.name})",
    )


@router.post("/events/{event_id}/simulate/arrived/{incident_id}", response_model=SimulateInjectResponse)
async def simulate_field_arrived(
    event_id: UUID,
    incident_id: UUID,
    request: Request,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> SimulateInjectResponse:
    """Inject "Angekommen": the crew reports it is on the Schadenplatz.

    The fifth field report, and the last one an exercise could not produce. It
    stamps ``schadenplatz_reports.arrived_at`` through ``crud.feld.record_arrival``
    — the same call the `/feld` button and the KP-parity endpoint make — so the
    KP sees the arrival badge, the bell entry and the Rapport row exactly as it
    would in an Ernstfall.

    ``only_if_unset=True``, the same as the field tap: a second click never
    moves a time the KP has already acted on, and the arrival the GPS automation
    stamped keeps its own provenance.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    actor = await simulated_filer(db, incident, current_user, random.Random())
    changed = await feld_crud.record_arrival(
        db,
        incident,
        actor=actor,
        at=datetime.now(UTC),
        only_if_unset=True,
        request=request,
    )

    place = incident.location_address or incident.title
    if not changed:
        return SimulateInjectResponse(message=f"Angekommen war bereits gemeldet: {place}")
    return SimulateInjectResponse(message=f"Angekommen: {place}{actor.suffix}")


@router.post("/events/{event_id}/simulate/pickup/{incident_id}", response_model=SimulateInjectResponse)
async def simulate_pickup(
    event_id: UUID,
    incident_id: UUID,
    request: Request,
    current_user: CurrentEditor,
    payload: SimulatePickupRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> SimulateInjectResponse:
    """Inject "Abholung nötig" / "Abholung erledigt" on its own (decision 24).

    Until now a pickup could only be simulated bundled with "Einsatz beendet",
    which is the one moment a real crew often does *not* know yet: the vehicle
    drives on half an hour later, and only then do three people need a lift. The
    other half — "der Bus war da" — had no way in at all, so an exercise could
    raise the warning but never clear it.

    Goes through ``crud.feld.record_pickup``, so the Restliste, the map and the
    warning bell behave exactly as they do for a crew tapping on `/feld`.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    needed = payload.needed if payload else True
    note = (payload.note if payload else None) or (stranded_pickup_note(incident) if needed else None)

    actor = await simulated_filer(db, incident, current_user, random.Random())
    changed = await feld_crud.record_pickup(
        db,
        incident,
        actor=actor,
        needed=needed,
        note=note,
        request=request,
    )

    place = incident.location_address or incident.title
    if not changed:
        return SimulateInjectResponse(
            message=(f"Abholung war bereits gemeldet: {place}" if needed else f"Keine offene Abholung: {place}")
        )
    if needed:
        return SimulateInjectResponse(message=f"Abholung nötig: {place} ({note}){actor.suffix}")
    return SimulateInjectResponse(message=f"Abholung erledigt: {place}{actor.suffix}")


@router.post(
    "/events/{event_id}/simulate/vehicle-breakdown/{incident_id}",
    response_model=SimulateVehicleBreakdownResponse,
)
async def simulate_vehicle_breakdown(
    event_id: UUID,
    incident_id: UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> SimulateVehicleBreakdownResponse:
    """Inject "Fahrzeug fällt aus": a random assigned vehicle becomes unavailable.

    Stops the vehicle's simulated GPS drive (if any) and raises a critical
    notification — the trainee has to unassign it and dispatch a replacement.
    The assignment is deliberately left in place: cleaning up is the exercise.
    """
    from ..services.gps_simulation import gps_simulation

    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    # Readiness is `out_of_service_since`, not the legacy `status` mirror, and an
    # archived vehicle is retired inventory that must not be picked as a victim.
    vehicles_result = await db.execute(
        select(Vehicle)
        .join(IncidentAssignment, IncidentAssignment.resource_id == Vehicle.id)
        .where(IncidentAssignment.incident_id == incident_id)
        .where(IncidentAssignment.resource_type == "vehicle")
        .where(IncidentAssignment.unassigned_at.is_(None))
        .where(Vehicle.out_of_service_since.is_(None))
        .where(Vehicle.archived_at.is_(None))
    )
    candidates = list(vehicles_result.scalars().all())
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Kein einsatzbereites Fahrzeug diesem Einsatz zugewiesen",
        )

    vehicle = random.choice(candidates)
    # Through the helper, so the exercise leaves the same row a real breakdown
    # would: `out_of_service_since` stamped and `status` mirrored, never one of
    # the two on its own — the drift `crud/materials.py` exists to prevent.
    apply_out_of_service(vehicle, True)

    message, params = notification_params.training_vehicle_down(vehicle.name, incident.title)
    db.add(
        Notification(
            type="training_emergency",
            severity="critical",
            message=message,
            params=params,
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
    )
    await db.commit()
    await db.refresh(vehicle)

    # A broken-down vehicle stops rolling.
    await gps_simulation.stop(vehicle.name)

    # Plain dict instead of schemas.Vehicle: its validator rejects the empty
    # radio_call_sign the DB default allows, and this is a broadcast, not input.
    background_tasks.add_task(
        broadcast_vehicle_update,
        {
            "id": str(vehicle.id),
            "name": vehicle.name,
            "type": vehicle.type,
            "display_order": vehicle.display_order,
            "status": vehicle.status,
            "radio_call_sign": vehicle.radio_call_sign,
        },
        "update",
    )

    return SimulateVehicleBreakdownResponse(vehicle_name=vehicle.name, message=message)
