"""Print API endpoints for thermal printer integration.

This module provides endpoints for:
- Queuing print jobs (assignment slips, board snapshots)
- Print agent polling for pending jobs
- Print job status updates

NOTE: These endpoints are intended for local installations only.
The print agent runs on the command post computer and polls for jobs.
"""

import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..models import Event, Incident, Material, Personnel, PrintJob, Vehicle
from ..services import settings as settings_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/print", tags=["print"])


async def _build_assignment_payload(db: AsyncSession, incident_id: uuid.UUID) -> dict:
    """Build the payload for an assignment slip print job."""
    # Get incident with assignments
    result = await db.execute(
        select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident_id)
    )
    incident = result.scalar_one_or_none()

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

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
        "crew": crew,
        "vehicles": vehicles,
        "materials": materials,
        "created_at": incident.created_at.isoformat() if incident.created_at else None,
    }

    return payload


async def _build_board_payload(db: AsyncSession, event_id: uuid.UUID) -> dict:
    """Build the payload for a board snapshot print job."""
    # Get event
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Get all non-deleted incidents for this event
    result = await db.execute(
        select(Incident)
        .options(selectinload(Incident.assignments))
        .where(
            and_(
                Incident.event_id == event_id,
                Incident.deleted_at.is_(None),
            )
        )
        .order_by(Incident.created_at)
    )
    incidents = result.scalars().all()

    # Build incidents list
    incidents_data = []
    for inc in incidents:
        active_assignments = [a for a in inc.assignments if a.unassigned_at is None]
        vehicle_ids = [a.resource_id for a in active_assignments if a.resource_type == "vehicle"]

        # Get vehicle names
        vehicle_names = []
        if vehicle_ids:
            veh_result = await db.execute(select(Vehicle.name).where(Vehicle.id.in_(vehicle_ids)))
            vehicle_names = [name for (name,) in veh_result.all()]

        incidents_data.append(
            {
                "title": inc.title,
                "status": inc.status,
                "location": inc.location_address or "",
                "type": inc.type,
                "priority": inc.priority,
                "vehicles": vehicle_names,
            }
        )

    # Get vehicle status summary
    result = await db.execute(select(Vehicle).order_by(Vehicle.display_order))
    all_vehicles = result.scalars().all()

    # Check which vehicles are assigned to active incidents
    assigned_vehicle_ids = set()
    for inc in incidents:
        if inc.status not in ("abschluss",):
            for a in inc.assignments:
                if a.resource_type == "vehicle" and a.unassigned_at is None:
                    assigned_vehicle_ids.add(a.resource_id)

    vehicle_status = []
    for v in all_vehicles:
        vehicle_status.append(
            {
                "name": v.name,
                "type": v.type,
                "available": v.id not in assigned_vehicle_ids and v.status == "available",
            }
        )

    # Get personnel summary (checked in for this event)
    from ..models import EventAttendance

    result = await db.execute(
        select(func.count(EventAttendance.id)).where(
            and_(
                EventAttendance.event_id == event_id,
                EventAttendance.checked_in.is_(True),
            )
        )
    )
    checked_in_count = result.scalar() or 0

    result = await db.execute(select(func.count(Personnel.id)))
    total_personnel = result.scalar() or 0

    payload = {
        "event_id": str(event.id),
        "event_name": event.name,
        "training_flag": event.training_flag,
        "incidents": incidents_data,
        "vehicle_status": vehicle_status,
        "personnel_summary": {
            "total": total_personnel,
            "present": checked_in_count,
        },
        "printed_at": datetime.now(UTC).isoformat(),
    }

    return payload


@router.get("/config/", response_model=schemas.PrinterConfigResponse)
async def get_printer_config(
    db: AsyncSession = Depends(get_db),
):
    """
    Get printer configuration for the print agent.

    NOTE: This endpoint does NOT require authentication.
    It's intended for the local print agent which doesn't have credentials.
    """
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    ip = await settings_service.get_setting_value(db, "printer.ip", "")
    port = await settings_service.get_setting_value(db, "printer.port", "9100")

    return schemas.PrinterConfigResponse(
        enabled=enabled.lower() == "true",
        ip=ip,
        port=int(port),
    )


@router.get("/status/", response_model=schemas.PrinterStatusResponse)
async def get_printer_status(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get printer status and configuration."""
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    ip = await settings_service.get_setting_value(db, "printer.ip", "")
    port = await settings_service.get_setting_value(db, "printer.port", "9100")
    auto_anfahrt = await settings_service.get_setting_value(db, "printer.auto_anfahrt", "true")

    # Count pending jobs
    result = await db.execute(select(func.count(PrintJob.id)).where(PrintJob.status == "pending"))
    pending_count = result.scalar() or 0

    # Get last job info
    result = await db.execute(
        select(PrintJob)
        .where(PrintJob.status.in_(["completed", "failed"]))
        .order_by(PrintJob.completed_at.desc())
        .limit(1)
    )
    last_job = result.scalar_one_or_none()

    return schemas.PrinterStatusResponse(
        enabled=enabled.lower() == "true",
        ip=ip,
        port=int(port),
        auto_anfahrt=auto_anfahrt.lower() == "true",
        pending_jobs=pending_count,
        last_job_at=last_job.completed_at if last_job else None,
        last_error=last_job.error_message if last_job and last_job.status == "failed" else None,
    )


@router.post("/assignment/{incident_id}/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_assignment_print(
    incident_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Queue an assignment slip for printing."""
    # Check if printer is enabled
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    if enabled.lower() != "true":
        raise HTTPException(status_code=400, detail="Printer is not enabled")

    # Build payload
    payload = await _build_assignment_payload(db, incident_id)

    # Get event_id from incident
    result = await db.execute(select(Incident.event_id).where(Incident.id == incident_id))
    event_id = result.scalar_one_or_none()

    # Create print job
    job = PrintJob(
        job_type="assignment",
        status="pending",
        payload=payload,
        incident_id=incident_id,
        event_id=event_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(f"Queued assignment print job {job.id} for incident {incident_id}")
    return job


@router.post("/board/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_board_print(
    request: schemas.PrintBoardRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Queue a board snapshot for printing."""
    # Check if printer is enabled
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    if enabled.lower() != "true":
        raise HTTPException(status_code=400, detail="Printer is not enabled")

    # Build payload
    payload = await _build_board_payload(db, request.event_id)

    # Create print job
    job = PrintJob(
        job_type="board",
        status="pending",
        payload=payload,
        event_id=request.event_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(f"Queued board print job {job.id} for event {request.event_id}")
    return job


@router.get("/jobs/pending/", response_model=list[schemas.PrintJobResponse])
async def get_pending_jobs(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=10, ge=1, le=50),
):
    """
    Get pending print jobs for the print agent.

    NOTE: This endpoint does NOT require authentication.
    It's intended for the local print agent which doesn't have credentials.
    Security is handled by network isolation (local network only).
    """
    result = await db.execute(
        select(PrintJob).where(PrintJob.status == "pending").order_by(PrintJob.created_at).limit(limit)
    )
    jobs = result.scalars().all()
    return jobs


@router.patch("/jobs/{job_id}/claim/", response_model=schemas.PrintJobResponse)
async def claim_print_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Claim a print job (mark as printing).

    NOTE: This endpoint does NOT require authentication.
    It's intended for the local print agent.
    """
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")

    if job.status != "pending":
        raise HTTPException(status_code=409, detail=f"Job is not pending (status: {job.status})")

    job.status = "printing"
    job.claimed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(job)

    logger.info(f"Print job {job_id} claimed by agent")
    return job


@router.patch("/jobs/{job_id}/complete/", response_model=schemas.PrintJobResponse)
async def complete_print_job(
    job_id: uuid.UUID,
    update: schemas.PrintJobUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Complete a print job (mark as completed or failed).

    NOTE: This endpoint does NOT require authentication.
    It's intended for the local print agent.
    """
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")

    if job.status not in ("pending", "printing"):
        raise HTTPException(status_code=409, detail=f"Job cannot be completed (status: {job.status})")

    job.status = update.status.value
    job.completed_at = datetime.now(UTC)
    job.error_message = update.error_message

    if update.status == schemas.PrintJobStatus.FAILED:
        job.retry_count += 1

    await db.commit()
    await db.refresh(job)

    logger.info(f"Print job {job_id} completed with status: {update.status.value}")
    return job


@router.delete("/jobs/{job_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_print_job(
    job_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Delete a print job (editor only)."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")

    await db.delete(job)
    await db.commit()

    logger.info(f"Print job {job_id} deleted by user {current_user.username}")
