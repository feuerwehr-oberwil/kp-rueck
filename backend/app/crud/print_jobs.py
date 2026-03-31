"""Print job CRUD operations."""

import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Incident, Material, Personnel, PrintJob, RekoReport, Vehicle

logger = logging.getLogger(__name__)

# Don't re-print the same incident within this window
DEDUP_WINDOW_SECONDS = 30


async def queue_assignment_print(
    db: AsyncSession,
    incident_id: uuid.UUID,
) -> PrintJob | None:
    """
    Queue an assignment slip print job for an incident.

    Deduplicates: skips if a job for this incident is already pending/printing,
    or was completed within the last 30 seconds.
    """
    # Dedup: check for existing recent job for this incident
    cutoff = datetime.utcnow() - timedelta(seconds=DEDUP_WINDOW_SECONDS)
    result = await db.execute(
        select(PrintJob).where(
            and_(
                PrintJob.incident_id == incident_id,
                PrintJob.job_type == "assignment",
                # Pending/printing, or recently completed
                (PrintJob.status.in_(["pending", "printing"]))
                | (and_(PrintJob.status == "completed", PrintJob.completed_at > cutoff)),
            )
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        logger.info(
            f"Skipping duplicate print for incident {incident_id} "
            f"(existing job {existing.id}, status={existing.status})"
        )
        return None

    # Get incident with assignments
    result = await db.execute(
        select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident_id)
    )
    incident = result.scalar_one_or_none()

    if not incident:
        raise ValueError(f"Incident {incident_id} not found")

    # Build payload
    payload = await _build_assignment_payload(db, incident)

    # Create print job
    job = PrintJob(
        job_type="assignment",
        status="pending",
        payload=payload,
        incident_id=incident_id,
        event_id=incident.event_id,
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    logger.info(f"Queued assignment print job {job.id} for incident {incident_id}")
    return job


async def _build_assignment_payload(db: AsyncSession, incident: Incident) -> dict:
    """Build the payload for an assignment slip print job."""
    # Get active assignments (unassigned_at is NULL)
    active_assignments = [a for a in incident.assignments if a.unassigned_at is None]

    # Separate by type
    personnel_ids = [a.resource_id for a in active_assignments if a.resource_type == "personnel"]
    vehicle_ids = [a.resource_id for a in active_assignments if a.resource_type == "vehicle"]
    material_ids = [a.resource_id for a in active_assignments if a.resource_type == "material"]

    # Fetch personnel
    crew = []
    if personnel_ids:
        result = await db.execute(select(Personnel).where(Personnel.id.in_(personnel_ids)))
        for p in result.scalars().all():
            crew.append({"name": p.name, "role": p.role})

    # Fetch vehicles
    vehicles = []
    if vehicle_ids:
        result = await db.execute(select(Vehicle).where(Vehicle.id.in_(vehicle_ids)))
        for v in result.scalars().all():
            vehicles.append({"name": v.name, "type": v.type, "radio_call_sign": v.radio_call_sign})

    # Fetch materials
    materials = []
    if material_ids:
        result = await db.execute(select(Material).where(Material.id.in_(material_ids)))
        for m in result.scalars().all():
            materials.append({"name": m.name, "type": m.type})

    # Fetch reko report if submitted
    reko_summary = None
    reko_result = await db.execute(
        select(RekoReport)
        .where(RekoReport.incident_id == incident.id)
        .where(RekoReport.is_draft == False)  # noqa: E712
        .order_by(RekoReport.submitted_at.desc())
        .limit(1)
    )
    reko = reko_result.scalar_one_or_none()
    if reko:
        dangers = []
        if reko.dangers_json:
            danger_labels = {
                "fire": "Feuer", "explosion": "Explosion", "collapse": "Einsturz",
                "chemical": "Gefahrstoffe", "electrical": "Elektrisch",
            }
            for key, label in danger_labels.items():
                if reko.dangers_json.get(key):
                    dangers.append(label)
        reko_summary = {
            "is_relevant": reko.is_relevant,
            "dangers": dangers,
            "personnel_count": reko.effort_json.get("personnel_count") if reko.effort_json else None,
            "estimated_duration": reko.effort_json.get("estimated_duration_hours") if reko.effort_json else None,
            "summary_text": reko.summary_text,
        }

    # Build payload
    payload = {
        "incident_id": str(incident.id),
        "title": incident.title,
        "type": incident.type,
        "priority": incident.priority,
        "location": incident.location_address or "",
        "description": incident.description or "",
        "contact": incident.contact or "",
        "nachbarhilfe": incident.nachbarhilfe,
        "nachbarhilfe_note": incident.nachbarhilfe_note or "",
        "internal_notes": incident.internal_notes or "",
        "zu_fuss": incident.zu_fuss,
        "reko_summary": reko_summary,
        "crew": crew,
        "vehicles": vehicles,
        "materials": materials,
        "created_at": incident.created_at.isoformat() if incident.created_at else None,
    }

    return payload
