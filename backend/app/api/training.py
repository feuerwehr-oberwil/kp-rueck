"""Training automation API endpoints."""

import asyncio
import logging
import random
from datetime import UTC, datetime
from io import BytesIO
from typing import TYPE_CHECKING, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..crud import feld as feld_crud
from ..crud import personnel_checkin as checkin_crud
from ..crud import reko as reko_crud
from ..database import async_session_maker, get_db
from ..models import (
    EmergencyTemplate,
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    IncidentGroupAssignment,
    Material,
    Notification,
    Personnel,
    SchadenplatzReport,
    TrainingLocation,
    Vehicle,
)
from ..schemas import (
    DiveraEmergencyResponse,
    EmergencyTemplateResponse,
    FieldReportUpdate,
    GenerateEmergencyRequest,
    IncidentResponse,
    ManualDispatchRequest,
    RapportUpdate,
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
    TrainingLocationResponse,
)
from ..services import incident_display
from ..services.divera_intake import broadcast_emergency_received
from ..services.tokens import generate_form_token
from ..services.training import (
    TrainingGenerator,
    generate_training_divera_emergency,
    generate_training_emergency,
)
from ..services.training_photos import attach_training_photos, pick_pool_photos
from ..services.training_simulation_data import (
    RAPPORT_SIM_PROFILE,
    generate_escalation,
    generate_field_message,
    generate_rapport_data,
    generate_reinforcement_request,
    generate_reko_report_data,
)
from ..websocket_manager import (
    broadcast_incident_update,
    broadcast_personnel_update,
    broadcast_vehicle_update,
)
from .incidents import set_field_report

if TYPE_CHECKING:
    # Imported lazily at runtime inside the endpoints below (circular import), so the
    # annotation-only reference lives here.
    from ..services.gps_simulation import SimulatedDrive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training", tags=["training"])


async def _require_training_event(db: AsyncSession, event_id: UUID) -> Event:
    """Shared guard: training endpoints only work on training events."""
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only available for training events")
    return event


async def _get_event_incident(db: AsyncSession, event_id: UUID, incident_id: UUID) -> Incident:
    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id or incident.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found in this event")
    return incident


@router.post("/events/{event_id}/generate/", response_model=list[IncidentResponse])
async def generate_emergencies(
    event_id: UUID,
    request: GenerateEmergencyRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> list[IncidentResponse]:
    """
    Manually generate training emergencies.

    - **category**: 'normal', 'critical', or null for random
    - **count**: Number to generate (1-10, for burst mode)
    """
    # Verify event exists and is training
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if not event.training_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Can only generate emergencies for training events"
        )

    # Validate count
    if request.count < 1 or request.count > 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Count must be between 1 and 10")

    # Validate category
    if request.category and request.category not in ["normal", "critical"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category must be 'normal' or 'critical'")

    # Validate source
    if request.source not in ["operator", "intake"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source must be 'operator' or 'intake'")

    # Generate emergencies. If the training template/location pool was never seeded
    # the generator raises ValueError — surface that as a clean 503 (with CORS headers,
    # so the browser shows the message instead of an opaque NetworkError) rather than a 500.
    # The request schema types `category` as a plain `str | None` (API contract), the
    # generator wants the Literal — the check above is what makes them the same thing.
    category = cast(Literal["normal", "critical"] | None, request.category)

    try:
        incidents = await generate_training_emergency(
            db, event_id, category=category, count=request.count, source=request.source
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Keine Übungs-Szenarien vorhanden. Bitte zuerst die Übungsdaten seeden.",
        ) from exc

    # Convert to response models and broadcast WebSocket updates
    responses = []
    for incident in incidents:
        incident_response = await incident_display.incident_with_display(db, incident)
        responses.append(incident_response)
        # Broadcast WebSocket update for each created incident
        background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    return responses


@router.post("/events/{event_id}/dispatch/", response_model=IncidentResponse)
async def manual_dispatch(
    event_id: UUID,
    request: ManualDispatchRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> IncidentResponse:
    """Trainer-driven dispatch: place a specific template at a specific location.

    Unlike `/generate/` (random template, random location), the trainer picks
    both — useful to inject a known scenario at a known address for exercise
    realism (e.g. "BMA Schulhaus" at the actual local school).
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.training_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only dispatch emergencies for training events",
        )

    template = await db.get(EmergencyTemplate, request.template_id)
    if not template or not template.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Emergency template not found")

    generator = TrainingGenerator(db)

    if request.location_id is not None:
        location = await db.get(TrainingLocation, request.location_id)
        if not location or not location.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training location not found")
        incident = await generator.dispatch_specific(event_id, template, location=location)
    else:
        # Ad-hoc map pin path — validator guarantees these fields are set.
        # S101 suppressed: narrows the Optionals for the call below; the validator guarantees it.
        assert request.latitude is not None and request.longitude is not None and request.address  # noqa: S101
        incident = await generator.dispatch_specific(
            event_id,
            template,
            location_override=(request.address, request.latitude, request.longitude),
        )

    response = await incident_display.incident_with_display(db, incident)
    background_tasks.add_task(broadcast_incident_update, response.model_dump(mode="json"), "create")
    return response


@router.get("/templates/", response_model=list[EmergencyTemplateResponse])
async def list_templates(
    current_user: CurrentUser, category: str | None = None, db: AsyncSession = Depends(get_db)
) -> list[EmergencyTemplateResponse]:
    """List all emergency templates, optionally filtered by category."""
    query = select(EmergencyTemplate).where(EmergencyTemplate.is_active)

    if category:
        if category not in ["normal", "critical"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Category must be 'normal' or 'critical'"
            )
        query = query.where(EmergencyTemplate.category == category)

    result = await db.execute(query)
    templates = result.scalars().all()

    return [EmergencyTemplateResponse.model_validate(t) for t in templates]


@router.get("/locations/", response_model=list[TrainingLocationResponse])
async def list_locations(
    current_user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> list[TrainingLocationResponse]:
    """List all training locations."""
    result = await db.execute(select(TrainingLocation).where(TrainingLocation.is_active))
    locations = result.scalars().all()

    return [TrainingLocationResponse.model_validate(loc) for loc in locations]


# ============================================
# Training Simulation Endpoints
# ============================================


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
        stranded = incident.zu_fuss or not await _has_vehicle(db, incident)
        rate = RAPPORT_SIM_PROFILE.pickup_when_stranded if stranded else RAPPORT_SIM_PROFILE.pickup_otherwise
        pickup_needed = rng.random() < rate
        if pickup_needed and pickup_note is None:
            pickup_note = _pickup_note(incident)

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only available for training events")

    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found in this event")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only available for training events")

    # Verify incident belongs to event
    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found in this event")

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
        await db.commit()
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category must be 'normal' or 'critical'")

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

    db.add(
        Notification(
            type="training_emergency",
            severity="critical",
            message=f"Lage verschärft: {incident.title} – {text}",
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
    )
    await db.commit()
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
    message = f"Feld fordert Verstärkung: {request_text} – {incident.title}"
    db.add(
        Notification(
            type="training_emergency",
            severity="warning",
            message=message,
            incident_id=incident.id,
            event_id=event_id,
            dismissed=False,
        )
    )
    await db.commit()

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


async def _has_vehicle(db: AsyncSession, incident: Incident) -> bool:
    """Is a vehicle actually with this crew — directly or through its Auftrag?

    An Auftrag owns its resources for every stop, so a stop with no assignment
    row of its own can still have a vehicle standing in front of it. Getting
    this wrong would strand a squad that has its Pio parked next to it.
    """
    direct = await db.execute(
        select(IncidentAssignment.id)
        .where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "vehicle",
            IncidentAssignment.unassigned_at.is_(None),
        )
        .limit(1)
    )
    if direct.first() is not None:
        return True
    if incident.group_id is None:
        return False
    grouped = await db.execute(
        select(IncidentGroupAssignment.id)
        .where(
            IncidentGroupAssignment.incident_group_id == incident.group_id,
            IncidentGroupAssignment.resource_type == "vehicle",
            IncidentGroupAssignment.unassigned_at.is_(None),
        )
        .limit(1)
    )
    return grouped.first() is not None


def _pickup_note(incident: Incident) -> str:
    """Why this crew is stuck, in the words the field would use.

    Two situations cover practically every real pickup: the Trupp walked there,
    or the vehicle that brought them drove on to the next Schadenplatz.
    """
    return "Trupp zu Fuss vor Ort" if incident.zu_fuss else "Fahrzeug ist weitergefahren"


async def _simulated_material_units(db: AsyncSession, incident_id: UUID) -> list[dict[str, Any]]:
    """The checklist rows to answer, with the ``type`` the bucket rule needs.

    Released units included, the same as the real prefill: a pump that came back
    early still belongs in the record. ``Material.type`` is a
    station-configurable free string, which is why it travels to the generator
    instead of being mapped to an enum on the way.
    """
    result = await db.execute(
        select(IncidentAssignment.id, Material.name, Material.type, Material.consumable)
        .join(Material, Material.id == IncidentAssignment.resource_id)
        .where(
            IncidentAssignment.incident_id == incident_id,
            IncidentAssignment.resource_type == "material",
        )
        .order_by(Material.location_sort_order, Material.name)
    )
    return [
        {"assignment_id": assignment_id, "name": name, "type": material_type, "consumable": consumable}
        for assignment_id, name, material_type, consumable in result.all()
    ]


async def _simulated_filer(
    db: AsyncSession,
    incident: Incident,
    current_user: CurrentUser,
    rng: random.Random,
) -> feld_crud.FieldActor:
    """Who files this simulated rapport (§16.1): the EL 70 %, someone else 30 %.

    The leader comes from ``services.incident_leader`` through
    ``get_incident_leaders``, never from the raw ``is_leader`` flag — a
    completed incident has no active leader row left, and completed incidents
    are exactly the ones this inject exists for.

    An incident with nobody assigned falls back to the editor, which renders as
    "im KP erfasst". That is the truth of the situation and not worth faking.
    """
    leaders = await feld_crud.get_incident_leaders(db, [incident.id])
    leader = leaders.get(incident.id)

    crew_result = await db.execute(
        select(Personnel.id, Personnel.name)
        .join(IncidentAssignment, IncidentAssignment.resource_id == Personnel.id)
        .where(
            IncidentAssignment.incident_id == incident.id,
            IncidentAssignment.resource_type == "personnel",
        )
        .order_by(Personnel.name)
    )
    crew = sorted({(row[0], row[1]) for row in crew_result.all()}, key=lambda entry: entry[1])
    others = [entry for entry in crew if leader is None or entry[0] != leader[0]]

    if leader is not None and (not others or rng.random() < RAPPORT_SIM_PROFILE.filed_by_leader):
        return feld_crud.FieldActor(personnel_id=leader[0], personnel_name=leader[1])
    if others:
        personnel_id, name = rng.choice(others)
        return feld_crud.FieldActor(personnel_id=personnel_id, personnel_name=name)
    return feld_crud.FieldActor(user=current_user)


async def _attach_simulated_rapport_photos(
    db: AsyncSession,
    incident: Incident,
    *,
    actor: feld_crud.FieldActor,
    request: Request,
) -> int:
    """Put 0-2 curated scene photos on the Schadenplatz-Rapport; returns how many.

    The same offline pool the simulated Reko reports draw from
    (``services/training_photos``), but through ``crud.feld.add_photo`` rather
    than the storage service directly: a rapport photo carries its own audit
    entry and its own ``updated_by``, and going around that door would leave a
    file on the report that nobody filed. So the exercise shows the KP a rapport
    photo that is indistinguishable from a crew's.

    Degrades to fewer or no photos on any per-file failure — a stripped or
    unreadable pool must never break the inject.
    """
    attached = 0
    for path in pick_pool_photos(incident.type):
        try:
            upload = UploadFile(file=BytesIO(path.read_bytes()), filename=path.name)
            await feld_crud.add_photo(db, incident, actor=actor, file=upload, request=request)
            attached += 1
        except Exception as exc:  # a bad pool image is not a failed exercise
            logger.warning("Skipping training pool photo %s for rapport: %s", path, exc)
    return attached


async def _file_simulated_rapport(
    db: AsyncSession,
    incident: Incident,
    *,
    current_user: CurrentUser,
    rng: random.Random,
    request: Request,
) -> SimulateRapportResponse:
    """Generate one plausible rapport and file it through the shared upsert.

    Everything the KP feels — the card badge, "Material zurück – freigeben", the
    Restliste, the Einsätze export — comes out of this one call, because it
    is the same ``save_rapport`` an operator and a crew both reach.

    Photos go on **before** the rapport is filed, which is the order a crew
    works in: they photograph the Schadenplatz while filling the form.
    """
    actor = await _simulated_filer(db, incident, current_user, rng)
    photos = await _attach_simulated_rapport_photos(db, incident, actor=actor, request=request)
    view = await feld_crud.get_rapport(db, incident, actor=actor)
    prefill = view["prefill"]
    units = await _simulated_material_units(db, incident.id)

    data = generate_rapport_data(
        incident_type=incident.type,
        title=incident.title,
        description=incident.description,
        materials=units,
        # The prefilled checklist itself, which is what a crew answers against.
        # Only the rows the board dispatched (§18.33 put the whole fleet on the
        # list): a simulated crew correcting the board by unticking is realistic,
        # a simulated crew inventing a vehicle that was never sent is not.
        vehicles=[{"vehicle_id": row["vehicle_id"]} for row in view["vehicles"] if row["on_board"]],
        board_personnel_count=prefill["board_personnel_count"],
        rng=rng,
    )
    saved = await feld_crud.save_rapport(db, incident, actor=actor, payload=RapportUpdate(**data), request=request)

    ticked = sum(1 for row in saved["materials"] if row["used"] or row["left_on_site"])
    return SimulateRapportResponse(
        incident_id=incident.id,
        incident_title=incident.title,
        filed_by=actor.personnel_name,
        vehicles_present=sum(1 for row in saved["vehicles"] if row["present"]),
        materials_ticked=ticked,
        photos=photos,
        message=f"Rapport erfasst: {incident.location_address or incident.title}{actor.suffix}",
    )


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
    return await _file_simulated_rapport(db, incident, current_user=current_user, rng=random.Random(), request=request)


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
        await _file_simulated_rapport(db, incident, current_user=current_user, rng=rng, request=request)
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
    actor = await _simulated_filer(db, incident, current_user, rng)

    notification = await feld_crud.record_field_message(db, incident, actor=actor, message=text, request=request)
    return SimulateInjectResponse(message=notification.message if notification else text)


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

    actor = await _simulated_filer(db, incident, current_user, random.Random())
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
    note = (payload.note if payload else None) or (_pickup_note(incident) if needed else None)

    actor = await _simulated_filer(db, incident, current_user, random.Random())
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

    vehicles_result = await db.execute(
        select(Vehicle)
        .join(IncidentAssignment, IncidentAssignment.resource_id == Vehicle.id)
        .where(IncidentAssignment.incident_id == incident_id)
        .where(IncidentAssignment.resource_type == "vehicle")
        .where(IncidentAssignment.unassigned_at.is_(None))
        .where(Vehicle.status == "available")
    )
    candidates = list(vehicles_result.scalars().all())
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Kein einsatzbereites Fahrzeug diesem Einsatz zugewiesen",
        )

    vehicle = random.choice(candidates)
    vehicle.status = "unavailable"

    message = f"Fahrzeug {vehicle.name} ausgefallen: {incident.title} – Ersatz disponieren"
    db.add(
        Notification(
            type="training_emergency",
            severity="critical",
            message=message,
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


# ---------------------------------------------------------------------------
# GPS drive simulation (Übungssteuerung) — see services/gps_simulation.py
# ---------------------------------------------------------------------------


class GpsSimStartRequest(BaseModel):
    vehicle_id: UUID
    target: Literal["incident", "magazin"]
    incident_id: UUID | None = None
    speed_kmh: float = 30.0


class GpsSimStopRequest(BaseModel):
    vehicle_id: UUID | None = None  # None stops all drives


class GpsSimSpeedRequest(BaseModel):
    vehicle_id: UUID
    speed_kmh: float


class GpsSimDriveResponse(BaseModel):
    vehicle_id: UUID
    vehicle_name: str
    target_label: str
    kind: str
    progress: float
    eta_seconds: float
    speed_kmh: float
    started_at: datetime


def _drive_response(drive: "SimulatedDrive", now: datetime) -> GpsSimDriveResponse:
    return GpsSimDriveResponse(
        vehicle_id=drive.vehicle_id,
        vehicle_name=drive.vehicle_name,
        target_label=drive.target_label,
        kind=drive.kind,
        progress=drive.progress(now),
        eta_seconds=drive.eta_seconds(now),
        speed_kmh=drive.cruise_kmh,
        started_at=drive.started_at,
    )


@router.get("/gps-sim/", response_model=list[GpsSimDriveResponse])
async def list_gps_simulations(current_user: CurrentUser) -> list[GpsSimDriveResponse]:
    """List active simulated drives."""
    from ..services.gps_simulation import gps_simulation

    now = datetime.now(UTC)
    return [_drive_response(d, now) for d in gps_simulation.list_drives()]


@router.post("/gps-sim/start", response_model=GpsSimDriveResponse)
async def start_gps_simulation(
    request: GpsSimStartRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> GpsSimDriveResponse:
    """Start a simulated GPS drive for a vehicle (training use).

    The simulated positions feed the exact same pipeline as real Traccar data,
    so trainees get the real deal: map movement, distance labels, geofence
    notification and the arrival/return prompts.
    """
    from ..services.gps_simulation import SimulatedDrive, gps_simulation
    from ..services.settings import get_setting_value
    from ..services.traccar_poller import traccar_poller
    from ..traccar import traccar_client

    if settings.demo_mode:
        raise HTTPException(status_code=403, detail="Im Demo-Modus nicht verfügbar")

    vehicle = await db.get(Vehicle, request.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Fahrzeug nicht gefunden")

    # Drives to a training incident are always allowed — an open Ernstfall
    # event elsewhere does not lock the Übungssteuerung. The only target-side
    # rail is below: you can only drive to incidents of a training event.

    # Resolve the target
    if request.target == "incident":
        if not request.incident_id:
            raise HTTPException(status_code=400, detail="incident_id fehlt")
        incident = await db.get(Incident, request.incident_id)
        if not incident or incident.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Einsatz nicht gefunden")
        event = await db.get(Event, incident.event_id)
        if not event or not event.training_flag:
            raise HTTPException(status_code=400, detail="Nur Einsätze aus Übungen können angefahren werden")
        if incident.location_lat is None or incident.location_lng is None:
            raise HTTPException(status_code=400, detail="Einsatz hat keine Koordinaten")
        target = (float(incident.location_lat), float(incident.location_lng))
        target_label = incident.location_address or incident.title or "Einsatz"
    else:
        lat_raw = await get_setting_value(db, "gps.station_lat", "")
        lng_raw = await get_setting_value(db, "gps.station_lng", "")
        try:
            target = (float(lat_raw), float(lng_raw))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="Magazin-Koordinaten fehlen (Einstellungen → GPS)",
            ) from None
        target_label = "Magazin"

    # Start position: current simulated position > (for returns) the assigned
    # incident's location > real GPS > magazin > firestation
    start = gps_simulation.current_position(vehicle.name)
    if start is None and request.target == "magazin":
        # A returning vehicle conceptually starts at the incident it is still
        # assigned to — its REAL tracker usually sits parked at the magazin,
        # which would make the return drive an 8-metre no-op.
        row = (
            await db.execute(
                select(Incident.location_lat, Incident.location_lng)
                .join(IncidentAssignment, IncidentAssignment.incident_id == Incident.id)
                .where(IncidentAssignment.resource_type == "vehicle")
                .where(IncidentAssignment.resource_id == vehicle.id)
                .where(IncidentAssignment.unassigned_at.is_(None))
                .where(Incident.deleted_at.is_(None))
                .where(Incident.location_lat.isnot(None))
                .where(Incident.location_lng.isnot(None))
                .order_by(IncidentAssignment.assigned_at.desc())
                .limit(1)
            )
        ).first()
        if row:
            start = (float(row[0]), float(row[1]))
    if start is None:
        try:
            for p in await traccar_client.get_vehicle_positions():
                if p.device_name.lower() == vehicle.name.lower():
                    start = (p.latitude, p.longitude)
                    break
        except Exception:
            start = None
    if start is None:
        try:
            start = (
                float(await get_setting_value(db, "gps.station_lat", "")),
                float(await get_setting_value(db, "gps.station_lng", "")),
            )
        except (TypeError, ValueError):
            start = None
    if start is None:
        try:
            start = (
                float(await get_setting_value(db, "firestation_latitude", "")),
                float(await get_setting_value(db, "firestation_longitude", "")),
            )
        except (TypeError, ValueError):
            start = (47.51637699933488, 7.561800450458299)

    drive = SimulatedDrive(
        vehicle_id=vehicle.id,
        vehicle_name=vehicle.name,
        start_lat=start[0],
        start_lng=start[1],
        target_lat=target[0],
        target_lng=target[1],
        target_label=target_label,
        kind=request.target,
        cruise_kmh=max(10.0, min(100.0, request.speed_kmh)),
        started_at=datetime.now(UTC),
    )
    await gps_simulation.start(drive)
    # Make sure positions actually flow, even without a real Traccar server.
    await traccar_poller.start_polling()

    return _drive_response(drive, datetime.now(UTC))


@router.post("/gps-sim/speed", response_model=GpsSimDriveResponse)
async def set_gps_simulation_speed(
    request: GpsSimSpeedRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> GpsSimDriveResponse:
    """Change the cruise speed of a vehicle's active simulated drive."""
    from ..services.gps_simulation import gps_simulation

    vehicle = await db.get(Vehicle, request.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Fahrzeug nicht gefunden")

    drive = await gps_simulation.set_speed(vehicle.name, max(10.0, min(100.0, request.speed_kmh)))
    if drive is None:
        raise HTTPException(status_code=404, detail="Keine aktive Fahrt für dieses Fahrzeug")
    return _drive_response(drive, datetime.now(UTC))


@router.post("/gps-sim/stop", response_model=None)
async def stop_gps_simulation(
    request: GpsSimStopRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Stop one vehicle's simulated drive, or all of them."""
    from ..services.gps_simulation import gps_simulation

    vehicle_name = None
    if request.vehicle_id is not None:
        vehicle = await db.get(Vehicle, request.vehicle_id)
        if not vehicle:
            raise HTTPException(status_code=404, detail="Fahrzeug nicht gefunden")
        vehicle_name = vehicle.name

    stopped = await gps_simulation.stop(vehicle_name)
    return {"stopped": stopped}
