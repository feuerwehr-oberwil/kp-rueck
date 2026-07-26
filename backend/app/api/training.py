"""Training automation API endpoints."""

import asyncio
import logging
import random
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..crud import personnel_checkin as checkin_crud
from ..crud import reko as reko_crud
from ..database import async_session_maker, get_db
from ..models import (
    EmergencyTemplate,
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    Notification,
    Personnel,
    TrainingLocation,
    Vehicle,
)
from ..schemas import (
    DiveraEmergencyResponse,
    EmergencyTemplateResponse,
    GenerateEmergencyRequest,
    IncidentResponse,
    ManualDispatchRequest,
    RekoReportResponse,
    RekoReportUpdate,
    SimulateCheckinRequest,
    SimulateCheckinResponse,
    SimulateDiveraRequest,
    SimulateInjectResponse,
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
from ..services.training_photos import attach_training_photos
from ..services.training_simulation_data import (
    generate_escalation,
    generate_reinforcement_request,
    generate_reko_report_data,
)
from ..websocket_manager import (
    broadcast_incident_update,
    broadcast_personnel_update,
    broadcast_vehicle_update,
)

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
):
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
    try:
        incidents = await generate_training_emergency(
            db, event_id, category=request.category, count=request.count, source=request.source
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
):
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
async def list_templates(current_user: CurrentUser, category: str | None = None, db: AsyncSession = Depends(get_db)):
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
async def list_locations(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
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
_trickle_tasks: dict[UUID, asyncio.Task] = {}


async def _trickle_checkins(event_id: UUID, people: list[tuple[UUID, str]], window_seconds: float):
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
):
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
        select(Personnel).where(Personnel.availability != "unavailable").order_by(Personnel.name.asc())
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
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Field crew reports the incident finished ("Einsatz beendet").

    Informational only: stamps ``field_complete_reported_at`` so the operator
    sees a "Feld meldet: beendet" badge on the card and can decide to close the
    incident. Deliberately does NOT change the status — closing is the
    operator's board action, mimicking the real command-post split.
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only available for training events")

    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found in this event")

    from datetime import UTC, datetime

    incident.field_complete_reported_at = datetime.now(UTC)
    await db.commit()
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
):
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
):
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
):
    """Inject a simulated Divera alarm into the emergency pool.

    Trainees then run the real alarm-intake workflow: alert sound and toast on
    the pool page, review, attach to the exercise. The entry is training-marked
    (ÜBUNG badge), excluded from auto-attach and only attachable to training
    events — it never touches real operations or Divera itself.
    """
    await _require_training_event(db, event_id)

    if request.category and request.category not in ["normal", "critical"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category must be 'normal' or 'critical'")

    emergency = await generate_training_divera_emergency(db, event_id, category=request.category)

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
):
    """Inject "Lage verschärft sich": the field reports a worsening situation.

    Bumps the incident to high priority, appends the Lagemeldung to the
    description and raises a critical bell notification — the trainee has to
    reassess resources and priorities mid-incident.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    if incident.status == "abschluss" or incident.completed_at is not None:
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
            message=f"Lage verschärft: {incident.title} — {text}",
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
):
    """Inject "Feld fordert Verstärkung": the crew on scene asks for more.

    Notification only — what (and whether) to send is the trainee's decision
    on the board.
    """
    await _require_training_event(db, event_id)
    incident = await _get_event_incident(db, event_id, incident_id)

    if incident.status == "abschluss" or incident.completed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Abgeschlossene Einsätze können keine Verstärkung anfordern",
        )

    request_text = generate_reinforcement_request(incident.type)
    message = f"Feld fordert Verstärkung: {request_text} — {incident.title}"
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
):
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

    message = f"Fahrzeug {vehicle.name} ausgefallen: {incident.title} — Ersatz disponieren"
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


def _drive_response(drive, now: datetime) -> GpsSimDriveResponse:
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
async def list_gps_simulations(current_user: CurrentUser):
    """List active simulated drives."""
    from ..services.gps_simulation import gps_simulation

    now = datetime.now(UTC)
    return [_drive_response(d, now) for d in gps_simulation.list_drives()]


@router.post("/gps-sim/start", response_model=GpsSimDriveResponse)
async def start_gps_simulation(
    request: GpsSimStartRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
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

    # Safety rail: simulated positions are global, so refuse while any live
    # (non-training) event has open incidents — never paint fake positions
    # into a real operation.
    live_count = (
        await db.execute(
            select(func.count())
            .select_from(Incident)
            .join(Event, Incident.event_id == Event.id)
            .where(Event.training_flag.is_(False))
            .where(Event.archived_at.is_(None))
            .where(Incident.deleted_at.is_(None))
            .where(Incident.status != "abschluss")
        )
    ).scalar_one()
    if live_count:
        raise HTTPException(
            status_code=409,
            detail="GPS-Simulation gesperrt: Ein Ernstfall-Ereignis hat aktive Einsätze.",
        )

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
):
    """Change the cruise speed of a vehicle's active simulated drive."""
    from ..services.gps_simulation import gps_simulation

    vehicle = await db.get(Vehicle, request.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Fahrzeug nicht gefunden")

    drive = await gps_simulation.set_speed(vehicle.name, max(10.0, min(100.0, request.speed_kmh)))
    if drive is None:
        raise HTTPException(status_code=404, detail="Keine aktive Fahrt für dieses Fahrzeug")
    return _drive_response(drive, datetime.now(UTC))


@router.post("/gps-sim/stop")
async def stop_gps_simulation(
    request: GpsSimStopRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
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
