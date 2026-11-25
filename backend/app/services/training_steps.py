"""The field steps of an Übung, one function each – shared by the inject endpoints and the Regie.

`api/training_simulate.py` (the per-step simulate endpoints) and `api/training_gps_sim.py`
call these, and so do `POST …/regie/step/{incident_id}` and the Autopilot
(`services/training_regie.py`), so a step does the same thing whoever presses it. Each one
writes through the CRUD the real path uses and flushes; the caller commits and broadcasts.
A step that cannot run now raises `StepRefusedError` with the German reason.
"""

import random
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import feld as feld_crud
from app.crud import incidents as incidents_crud
from app.crud import reko as reko_crud
from app.database import after_rollback
from app.models import Incident, IncidentAssignment, RekoReport, User, Vehicle
from app.schemas import RekoReportUpdate
from app.services.gps_simulation import SimulatedDrive, gps_simulation
from app.services.photo_storage import photo_storage
from app.services.rapport_rows import STATUS_LABELS
from app.services.reko_history import RekoAuthor
from app.services.tokens import generate_form_token
from app.services.training import simulated_filer, stranded_pickup_note
from app.services.training_photos import attach_training_photos
from app.services.training_simulation_data import generate_reko_report_data, scene_type

DriveTarget = Literal["incident", "magazin"]

# Start of a drive when nothing better is known (Oberwil).
_FALLBACK_START = (47.51637699933488, 7.561800450458299)


class StepRefusedError(Exception):
    """The step cannot run now. `str(exc)` is the German reason for the trainer."""


def _require_status(incident: Incident, wanted: str) -> None:
    if incident.status != wanted:
        label = STATUS_LABELS.get(wanted, wanted)
        current = STATUS_LABELS.get(incident.status, incident.status)
        raise StepRefusedError(f"Einsatz muss im Status «{label}» sein (aktuell: «{current}»)")


async def mark_reko_arrived(db: AsyncSession, incident: Incident) -> None:
    """«Reko vor Ort»: the Reko crew reaches the scene. Sets `arrived_at`, the incident stays in Reko."""
    _require_status(incident, "reko")
    await reko_crud.mark_reko_arrived(db, incident.id, generate_form_token(str(incident.id), "reko"))


async def file_reko_report(db: AsyncSession, incident: Incident) -> RekoReport:
    """«Reko-Meldung»: arrival (if not yet), a generated report, submitted like a real one.

    The submission runs the real side effects (status → Reko abgeschlossen, priority, bell),
    once: only when this write filed the incident's one report (`filed_now`). The simulated
    crew is a form link without a person – «Feld» in the Chronik.
    """
    _require_status(incident, "reko")
    token = generate_form_token(str(incident.id), "reko")
    await reko_crud.mark_reko_arrived(db, incident.id, token)
    report = await reko_crud.get_or_create_reko_report(db, incident.id, token)

    # The description carries cues the title misses («Heizöl im Keller» → keller).
    reko_data = generate_reko_report_data(incident.type, title=incident.title, description=incident.description)
    # A not-relevant report carries no illustration (`_not_relevant_report`).
    photo_summary = reko_data.pop("photo_summary", None)
    photo_depth_cm = reko_data.pop("photo_depth_cm", None)
    author = RekoAuthor.feld(None)
    updated, filed_now = await reko_crud.update_reko_report(
        db, report.id, RekoReportUpdate(**reko_data), author=author, submit=True
    )

    # The wording illustration alone, or a type photo when the text has none.
    if updated.is_relevant:
        photo_filenames = await attach_training_photos(
            incident.id,
            scene_type(incident.type, incident.title),
            current_photos=updated.photos_json,
            summary_text=photo_summary,
            depth_cm=photo_depth_cm,
        )
        for filename in photo_filenames:
            # Stored already: gone again if the filing rolls back.
            after_rollback(db, photo_storage.delete_photo, incident.id, filename)
        if photo_filenames:
            # Part of the simulated filing, not an edit after it: no Chronik row of its own.
            updated.photos_json = (updated.photos_json or []) + photo_filenames
            await db.flush()
            await db.refresh(updated)

    await db.refresh(incident)
    if filed_now:
        await reko_crud.process_reko_submission(db, incident, updated)
    await db.refresh(incident)
    return updated


async def report_vehicle_on_scene(db: AsyncSession, incident: Incident, *, user: User, request: Request | None) -> None:
    """«Fahrzeug vor Ort» without GPS: the crew files «Angekommen», the card moves to Im Einsatz.

    The arrival keeps an earlier stamp (`only_if_unset`), as the field tap does.
    """
    _require_status(incident, "enroute")
    actor = await simulated_filer(db, incident, user, random.Random())
    await feld_crud.record_arrival(db, incident, actor=actor, at=datetime.now(UTC), only_if_unset=True, request=request)
    await incidents_crud.update_incident_status(db, incident.id, "active", user, request)
    await db.refresh(incident)


async def report_field_complete(
    db: AsyncSession,
    incident: Incident,
    *,
    user: User,
    pickup_needed: bool | None,
    request: Request | None,
) -> None:
    """«Einsatz beendet» plus the field's answer to «Kommt ihr selbst zurück?».

    Informational: stamps `field_complete_reported_at` (the card badge), no status change –
    closing is the operator's move. Written as a KP radio entry (the trainer sits in the KP),
    the same calls as `POST /api/incidents/{id}/field-report`. `pickup_needed=None` follows
    the «bleibt vor Ort» pill, the suggestion /feld makes (`crud.feld.vehicle_on_site`, owner
    23.11.2026): a vehicle on site → «fährt selbst», none → «Abholung nötig». The answer goes
    to `record_pickup` as `self_drive`: a KP «nein» reads «fährt selbst», not «Abholung disponiert».
    A pickup the situation decided carries the field's reason as its note.
    """
    pickup_note = None
    if pickup_needed is None:
        pickup_needed = await feld_crud.vehicle_on_site(db, incident) is None
        if pickup_needed:
            pickup_note = stranded_pickup_note(incident)

    actor = feld_crud.FieldActor(user=user)
    await feld_crud.record_field_complete(db, incident, actor=actor, at=datetime.now(UTC), request=request)
    await feld_crud.record_pickup(
        db,
        incident,
        actor=actor,
        needed=pickup_needed,
        note=pickup_note,
        request=request,
        self_drive=not pickup_needed,
    )
    await db.refresh(incident)


async def start_vehicle_drive(
    db: AsyncSession, vehicle: Vehicle, *, target: DriveTarget, incident: Incident | None, speed_kmh: float
) -> SimulatedDrive:
    """Send one vehicle on a simulated drive to `incident` or back to the magazin.

    Start: its current simulated position › (home drive) the incident it is assigned to ›
    its real GPS › the magazin. The positions feed the real Traccar pipeline (map, geofence,
    arrival and return prompts).
    """
    from app.services.settings import get_station_coordinates
    from app.services.traccar_poller import traccar_poller
    from app.traccar import traccar_client

    if target == "incident":
        if incident is None:
            raise StepRefusedError("incident_id fehlt")
        if incident.location_lat is None or incident.location_lng is None:
            raise StepRefusedError("Einsatz hat keine Koordinaten")
        goal = (float(incident.location_lat), float(incident.location_lng))
        label = incident.location_address or incident.title or "Einsatz"
    else:
        station = await get_station_coordinates(db)
        if station is None:
            raise StepRefusedError("Magazin-Koordinaten fehlen (Einstellungen → Allgemein)")
        goal, label = station, "Magazin"

    start = gps_simulation.current_position(vehicle.name)
    if start is None and target == "magazin":
        # A returning vehicle starts at the incident it is still assigned to – its real
        # tracker usually sits parked at the magazin, which would make the drive a no-op.
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
        start = await get_station_coordinates(db) or _FALLBACK_START

    drive = SimulatedDrive(
        vehicle_id=vehicle.id,
        vehicle_name=vehicle.name,
        start_lat=start[0],
        start_lng=start[1],
        target_lat=goal[0],
        target_lng=goal[1],
        target_label=label,
        kind=target,
        cruise_kmh=max(10.0, min(100.0, speed_kmh)),
        started_at=datetime.now(UTC),
        incident_id=incident.id if incident else None,
    )
    await gps_simulation.start(drive)
    # Make sure positions flow, even without a real Traccar server.
    await traccar_poller.start_polling()
    return drive


async def assigned_vehicles(db: AsyncSession, incident_id: UUID) -> list[Vehicle]:
    """The vehicles on the incident now (active assignments), by name."""
    result = await db.execute(
        select(Vehicle)
        .join(IncidentAssignment, IncidentAssignment.resource_id == Vehicle.id)
        .where(IncidentAssignment.incident_id == incident_id)
        .where(IncidentAssignment.resource_type == "vehicle")
        .where(IncidentAssignment.unassigned_at.is_(None))
        .order_by(Vehicle.name)
    )
    return list(result.scalars().unique().all())


async def start_incident_drives(
    db: AsyncSession, incident: Incident, *, target: DriveTarget, speed_kmh: float
) -> list[SimulatedDrive]:
    """«Fahrt zu Einsatz» / «Rückfahrt Magazin»: every assigned vehicle not yet on this leg drives.

    A vehicle with a drive of the same kind (rolling or parked at the goal) is left alone; a
    finished outbound drive is replaced by the home drive.
    """
    vehicles = await assigned_vehicles(db, incident.id)
    if not vehicles:
        raise StepRefusedError("Dem Einsatz ist kein Fahrzeug zugewiesen")
    on_leg = {d.vehicle_id for d in gps_simulation.list_drives() if d.kind == target}
    to_send = [v for v in vehicles if v.id not in on_leg]
    if not to_send:
        raise StepRefusedError("Alle Fahrzeuge sind schon unterwegs")
    return [await start_vehicle_drive(db, v, target=target, incident=incident, speed_kmh=speed_kmh) for v in to_send]
