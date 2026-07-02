"""Print API endpoints for thermal printer integration.

This module provides endpoints for:
- Queuing print jobs (assignment slips, board snapshots)
- Print agent polling for pending jobs
- Print job status updates

NOTE: These endpoints are intended for local installations only.
The print agent runs on the command post computer and polls for jobs.
"""

import logging
import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings as app_settings
from ..crud.print_jobs import build_assignment_payload, requeue_lost_jobs
from ..database import get_db
from ..models import Event, EventAttendance, EventSpecialFunction, Incident, Material, Personnel, PrintJob, Vehicle
from ..services import settings as settings_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/print", tags=["print"])


async def require_print_agent(x_agent_token: str = Header(default="")) -> None:
    """Authenticate the print agent via a shared token.

    If PRINT_AGENT_TOKEN is unset, all requests are allowed (backwards
    compatible for LAN-only installs where security is network isolation).
    """
    if not app_settings.print_agent_token:
        return
    if not secrets.compare_digest(x_agent_token, app_settings.print_agent_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent token")


# How long after the agent's last contact we still consider it "online".
# The agent polls for pending jobs at least every 60s (idle), so 90s gives margin.
AGENT_ONLINE_THRESHOLD_SECONDS = 90

# In-memory heartbeat for the print agent. This is a single-instance local
# deployment (the agent polls a backend on the same LAN), so module-level state
# is sufficient and avoids a DB write on every poll. Resets on backend restart;
# the agent repopulates it within one poll interval.
_agent_last_seen: datetime | None = None


def _touch_agent_heartbeat() -> None:
    """Record that the print agent just contacted the backend."""
    global _agent_last_seen
    _agent_last_seen = datetime.now(UTC)


async def _load_incident_for_print(db: AsyncSession, incident_id: uuid.UUID) -> Incident:
    """Load an incident with its assignments, raising 404 if missing."""
    result = await db.execute(
        select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident_id)
    )
    incident = result.scalar_one_or_none()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


async def _build_board_payload(
    db: AsyncSession,
    event_id: uuid.UUID,
    include_incidents: bool = True,
    include_completed: bool = False,
    include_vehicles: bool = True,
    include_personnel: bool = True,
) -> dict:
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

    # Find reko personnel for this event to exclude from crew
    reko_personnel_ids: set[uuid.UUID] = set()
    result = await db.execute(
        select(EventSpecialFunction.personnel_id).where(
            and_(
                EventSpecialFunction.event_id == event_id,
                EventSpecialFunction.function_type == "reko",
            )
        )
    )
    reko_personnel_ids = {row[0] for row in result.all()}

    # Find all drivers for this event
    driver_map: dict[uuid.UUID, str] = {}  # vehicle_id -> driver name
    result = await db.execute(
        select(EventSpecialFunction, Personnel)
        .join(Personnel, EventSpecialFunction.personnel_id == Personnel.id)
        .where(
            and_(
                EventSpecialFunction.event_id == event_id,
                EventSpecialFunction.function_type == "driver",
            )
        )
    )
    for sf, person in result.all():
        if sf.vehicle_id:
            driver_map[sf.vehicle_id] = person.name

    # Build incidents list with full details
    incidents_data = []
    for inc in incidents:
        active_assignments = [a for a in inc.assignments if a.unassigned_at is None]
        personnel_ids = [a.resource_id for a in active_assignments if a.resource_type == "personnel"]
        vehicle_ids = [a.resource_id for a in active_assignments if a.resource_type == "vehicle"]
        material_ids = [a.resource_id for a in active_assignments if a.resource_type == "material"]

        # Build vehicle assignment map for driver_stay
        vehicle_assignment_map = {a.resource_id: a for a in active_assignments if a.resource_type == "vehicle"}

        # Get vehicle details with driver info
        inc_vehicles = []
        if vehicle_ids:
            veh_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(vehicle_ids)))
            for v in veh_result.scalars().all():
                assignment = vehicle_assignment_map.get(v.id)
                inc_vehicles.append(
                    {
                        "name": v.name,
                        "type": v.type,
                        "radio_call_sign": v.radio_call_sign,
                        "driver": driver_map.get(v.id),
                        "driver_stay": assignment.driver_stay if assignment else False,
                    }
                )

        # Get crew details (exclude reko personnel)
        crew = []
        if personnel_ids:
            pers_result = await db.execute(select(Personnel).where(Personnel.id.in_(personnel_ids)))
            for p in pers_result.scalars().all():
                if p.id not in reko_personnel_ids:
                    crew.append({"name": p.name, "role": p.role})

        # Get material details
        materials_list = []
        if material_ids:
            mat_result = await db.execute(select(Material).where(Material.id.in_(material_ids)))
            for m in mat_result.scalars().all():
                materials_list.append({"name": m.name, "type": m.type})

        incidents_data.append(
            {
                "title": inc.title,
                "status": inc.status,
                "location": inc.location_address or "",
                "type": inc.type,
                "priority": inc.priority,
                "nachbarhilfe": inc.nachbarhilfe,
                "description": inc.description or "",
                "contact": inc.contact or "",
                "vehicles": inc_vehicles,
                "crew": crew,
                "materials": materials_list,
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

    # Get individual checked-in personnel for detailed listing
    personnel_list = []
    if include_personnel:
        result = await db.execute(
            select(Personnel)
            .join(EventAttendance, Personnel.id == EventAttendance.personnel_id)
            .where(
                and_(
                    EventAttendance.event_id == event_id,
                    EventAttendance.checked_in.is_(True),
                )
            )
            .order_by(Personnel.role_sort_order, Personnel.name)
        )
        for p in result.scalars().all():
            # Determine if this person is assigned to any active incident
            is_assigned = False
            for inc in incidents:
                if inc.status in ("abschluss",):
                    continue
                for a in inc.assignments:
                    if a.resource_type == "personnel" and a.resource_id == p.id and a.unassigned_at is None:
                        is_assigned = True
                        break
                if is_assigned:
                    break

            personnel_list.append(
                {
                    "name": p.name,
                    "role": p.role,
                    "assigned": is_assigned,
                }
            )

    payload = {
        "event_id": str(event.id),
        "event_name": event.name,
        "training_flag": event.training_flag,
        # When the incident list is excluded, emit an empty list so the agent
        # prints just the personnel/vehicle overview. We still compute incidents
        # above so personnel "assigned" status and vehicle availability are right.
        "incidents": incidents_data if include_incidents else [],
        "vehicle_status": vehicle_status,
        "personnel_summary": {
            "total": total_personnel,
            "present": checked_in_count,
        },
        "personnel_list": personnel_list,
        "include_incidents": include_incidents,
        "include_completed": include_completed,
        "include_vehicles": include_vehicles,
        "include_personnel": include_personnel,
        "printed_at": datetime.now(UTC).isoformat(),
    }

    return payload


@router.get("/config/", response_model=schemas.PrinterConfigResponse, dependencies=[Depends(require_print_agent)])
async def get_printer_config(
    db: AsyncSession = Depends(get_db),
):
    """
    Get printer configuration for the print agent.

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; open otherwise (LAN-only installs).
    """
    _touch_agent_heartbeat()
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

    agent_online = bool(
        _agent_last_seen and (datetime.now(UTC) - _agent_last_seen).total_seconds() < AGENT_ONLINE_THRESHOLD_SECONDS
    )

    return schemas.PrinterStatusResponse(
        enabled=enabled.lower() == "true",
        ip=ip,
        port=int(port),
        auto_anfahrt=auto_anfahrt.lower() == "true",
        pending_jobs=pending_count,
        last_job_at=last_job.completed_at if last_job else None,
        last_error=last_job.error_message if last_job and last_job.status == "failed" else None,
        agent_online=agent_online,
        agent_last_seen=_agent_last_seen,
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

    # Build payload via the shared builder (includes Reko summary, internal notes,
    # Nachbarhilfe, zu_fuss, and per-vehicle driver info)
    incident = await _load_incident_for_print(db, incident_id)
    payload = await build_assignment_payload(db, incident)

    # Create print job
    job = PrintJob(
        job_type="assignment",
        status="pending",
        payload=payload,
        incident_id=incident_id,
        event_id=incident.event_id,
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
    payload = await _build_board_payload(
        db,
        request.event_id,
        include_incidents=request.include_incidents,
        include_completed=request.include_completed,
        include_vehicles=request.include_vehicles,
        include_personnel=request.include_personnel,
    )

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


@router.post("/test/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_test_print(
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Queue a test print to verify the whole printing chain end-to-end."""
    # Check if printer is enabled (the agent only polls when enabled)
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    if enabled.lower() != "true":
        raise HTTPException(status_code=400, detail="Printer is not enabled")

    payload = {
        "requested_by": current_user.display_name or current_user.username,
        "printed_at": datetime.now(UTC).isoformat(),
    }

    job = PrintJob(
        job_type="test",
        status="pending",
        payload=payload,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(f"Queued test print job {job.id} by user {current_user.username}")
    return job


@router.post("/qr-code/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_qr_code_print(
    request: schemas.PrintQRCodeRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Queue a QR-code slip (shareable link as QR + text) for printing."""
    # Check if printer is enabled (the agent only polls when enabled)
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    if enabled.lower() != "true":
        raise HTTPException(status_code=400, detail="Printer is not enabled")

    payload = {
        "qr_content": request.qr_content,
        "title": request.title,
        "subtitle": request.subtitle,
        "printed_at": datetime.now(UTC).isoformat(),
    }

    job = PrintJob(
        job_type="qr_code",
        status="pending",
        payload=payload,
        event_id=request.event_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(f"Queued QR-code print job {job.id} by user {current_user.username}")
    return job


@router.get(
    "/jobs/pending/", response_model=list[schemas.PrintJobResponse], dependencies=[Depends(require_print_agent)]
)
async def get_pending_jobs(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=10, ge=1, le=50),
):
    """
    Get pending print jobs for the print agent.

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; open otherwise (LAN-only installs).
    """
    _touch_agent_heartbeat()
    # Reaper: bring back jobs stuck in 'printing' (agent died mid-print) or
    # 'failed' with attempts left — otherwise those slips vanish silently.
    await requeue_lost_jobs(db)
    result = await db.execute(
        select(PrintJob).where(PrintJob.status == "pending").order_by(PrintJob.created_at).limit(limit)
    )
    jobs = result.scalars().all()
    return jobs


@router.get("/jobs/{job_id}/", response_model=schemas.PrintJobResponse)
async def get_print_job(
    job_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Get a single print job by id (used by the frontend to poll test-print results)."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")

    return job


@router.patch(
    "/jobs/{job_id}/claim/", response_model=schemas.PrintJobResponse, dependencies=[Depends(require_print_agent)]
)
async def claim_print_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Claim a print job (mark as printing).

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; open otherwise (LAN-only installs).
    """
    _touch_agent_heartbeat()
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


@router.patch(
    "/jobs/{job_id}/complete/", response_model=schemas.PrintJobResponse, dependencies=[Depends(require_print_agent)]
)
async def complete_print_job(
    job_id: uuid.UUID,
    update: schemas.PrintJobUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Complete a print job (mark as completed or failed).

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; open otherwise (LAN-only installs).
    """
    _touch_agent_heartbeat()
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
