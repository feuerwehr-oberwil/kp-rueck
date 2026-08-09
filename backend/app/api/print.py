"""Print API endpoints for thermal printer integration.

This module provides endpoints for:
- Queuing print jobs (assignment slips, board snapshots)
- Print agent polling for pending jobs
- Print job status updates

NOTE: These endpoints are intended for local installations only.
The print agent runs on the command post computer and polls for jobs.
"""

import asyncio
import contextlib
import logging
import secrets
import time
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings as app_settings
from ..crud import feld as feld_crud
from ..crud.print_jobs import MAX_PRINT_ATTEMPTS, build_assignment_payload, requeue_lost_jobs
from ..database import execute_dml, get_db
from ..models import Event, EventAttendance, EventSpecialFunction, Incident, Material, Personnel, PrintJob, Vehicle
from ..services import print_signal
from ..services import settings as settings_service
from ..websocket_manager import broadcast_print_job_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/print", tags=["print"])


async def require_print_agent(x_agent_token: str = Header(default="")) -> None:
    """Authenticate the print agent via a shared token.

    Fail CLOSED: with no PRINT_AGENT_TOKEN configured these endpoints are off, not open.
    They used to be open on the assumption that the agent only ever reaches the backend
    across a trusted LAN — but the same image also runs on a public host, where "unset"
    silently meant "anyone can drain the print queue". Setting the token is the
    deployment's opt-in to the agent, exactly like ALARM_WEBHOOK_SECRET is for intake.
    """
    if not app_settings.print_agent_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Print-Agent deaktiviert (PRINT_AGENT_TOKEN nicht gesetzt)",
        )
    if not secrets.compare_digest(x_agent_token, app_settings.print_agent_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent token")


# How long after the agent's last contact we still consider it "online".
# The agent touches the backend at least every 25s (the long-poll hang) and, on a backend
# too old to long-poll, every 10s (the idle poll). 90s gives margin over both.
AGENT_ONLINE_THRESHOLD_SECONDS = 90

# Long-poll bounds for /jobs/pending/. The hang has to stay comfortably under the idle
# timeout of any proxy in front of the backend (Caddy, Railway) or the agent would see a
# stream of dropped connections instead of clean empty responses.
LONG_POLL_MAX_SECONDS = 30.0
# While parked, re-query on this timer as well as on the signal. The signal alone would be
# enough for today's single worker; this is what keeps the endpoint correct if the backend
# is ever run with several, at the cost of one indexed query per agent per interval.
LONG_POLL_RECHECK_SECONDS = 5.0

# In-memory heartbeat for the print agent. This is a single-instance local
# deployment (the agent polls a backend on the same LAN), so module-level state
# is sufficient and avoids a DB write on every poll. Resets on backend restart;
# the agent repopulates it within one poll interval.
_agent_last_seen: datetime | None = None


def _touch_agent_heartbeat() -> None:
    """Record that the print agent just contacted the backend."""
    global _agent_last_seen
    _agent_last_seen = datetime.now(UTC)


def job_event_payload(job: PrintJob) -> dict[str, Any]:
    """Status envelope broadcast on `print_job_update`.

    Deliberately NOT the whole job: `payload` carries incident detail (crew names,
    contact, internal notes) and this broadcast reaches the entire operations room,
    viewers and wall displays included. Status, why it failed, and whether another
    attempt is coming is everything the operator's toast needs.
    """
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "incident_id": str(job.incident_id) if job.incident_id else None,
        "event_id": str(job.event_id) if job.event_id else None,
        "error_message": job.error_message,
        "retry_count": job.retry_count,
        # The reaper requeues a failed job while attempts remain, so `failed` is not
        # yet final. Saying so is the difference between "go refill the paper" and
        # "go refill the paper, a retry is already coming".
        "will_retry": job.status == "failed" and job.retry_count < MAX_PRINT_ATTEMPTS,
    }


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
) -> dict[str, Any]:
    """Build the payload for a board snapshot print job."""
    # Get event
    event_result = await db.execute(select(Event).where(Event.id == event_id))
    event = event_result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Get all non-deleted incidents for this event
    incident_result = await db.execute(
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
    incidents = incident_result.scalars().all()

    # Find reko personnel for this event to exclude from crew
    reko_personnel_ids: set[uuid.UUID] = set()
    reko_result = await db.execute(
        select(EventSpecialFunction.personnel_id).where(
            and_(
                EventSpecialFunction.event_id == event_id,
                EventSpecialFunction.function_type == "reko",
            )
        )
    )
    reko_personnel_ids = {row[0] for row in reko_result.all()}

    # Find all drivers for this event
    driver_map: dict[uuid.UUID, str] = {}  # vehicle_id -> driver name
    driver_result = await db.execute(
        select(EventSpecialFunction, Personnel)
        .join(Personnel, EventSpecialFunction.personnel_id == Personnel.id)
        .where(
            and_(
                EventSpecialFunction.event_id == event_id,
                EventSpecialFunction.function_type == "driver",
            )
        )
    )
    for sf, person in driver_result.all():
        if sf.vehicle_id:
            driver_map[sf.vehicle_id] = person.name

    # Build incidents list with full details
    incidents_data: list[dict[str, Any]] = []
    for inc in incidents:
        active_assignments = [a for a in inc.assignments if a.unassigned_at is None]
        personnel_ids = [a.resource_id for a in active_assignments if a.resource_type == "personnel"]
        vehicle_ids = [a.resource_id for a in active_assignments if a.resource_type == "vehicle"]
        material_ids = [a.resource_id for a in active_assignments if a.resource_type == "material"]

        # Build vehicle assignment map for driver_stay
        vehicle_assignment_map = {a.resource_id: a for a in active_assignments if a.resource_type == "vehicle"}

        # Get vehicle details with driver info
        inc_vehicles: list[dict[str, Any]] = []
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

        # Get crew details (exclude reko personnel). `is_leader` rides along so
        # the board snapshot marks the Einsatzleiter the same way the
        # per-incident slip does — the formatter already reads it.
        leader_ids = {a.resource_id for a in active_assignments if a.resource_type == "personnel" and a.is_leader}
        crew: list[dict[str, Any]] = []
        if personnel_ids:
            pers_result = await db.execute(select(Personnel).where(Personnel.id.in_(personnel_ids)))
            for p in pers_result.scalars().all():
                if p.id not in reko_personnel_ids:
                    crew.append({"name": p.name, "role": p.role, "is_leader": p.id in leader_ids})

        # Get material details
        materials_list: list[dict[str, Any]] = []
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
    all_vehicles_result = await db.execute(select(Vehicle).order_by(Vehicle.display_order))
    all_vehicles = all_vehicles_result.scalars().all()

    # Check which vehicles are assigned to active incidents
    assigned_vehicle_ids: set[uuid.UUID] = set()
    for inc in incidents:
        if inc.status not in ("complete",):
            for a in inc.assignments:
                if a.resource_type == "vehicle" and a.unassigned_at is None:
                    assigned_vehicle_ids.add(a.resource_id)

    vehicle_status: list[dict[str, Any]] = []
    for v in all_vehicles:
        vehicle_status.append(
            {
                "name": v.name,
                "type": v.type,
                "available": v.id not in assigned_vehicle_ids and v.status == "available",
            }
        )

    # Get personnel summary (checked in for this event)
    checked_in_result = await db.execute(
        select(func.count(EventAttendance.id)).where(
            and_(
                EventAttendance.event_id == event_id,
                EventAttendance.checked_in.is_(True),
            )
        )
    )
    checked_in_count = checked_in_result.scalar() or 0

    total_personnel_result = await db.execute(select(func.count(Personnel.id)))
    total_personnel = total_personnel_result.scalar() or 0

    # Get individual checked-in personnel for detailed listing
    personnel_list: list[dict[str, Any]] = []
    if include_personnel:
        checked_in_personnel_result = await db.execute(
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
        for p in checked_in_personnel_result.scalars().all():
            # Determine if this person is assigned to any active incident
            is_assigned = False
            for inc in incidents:
                if inc.status in ("complete",):
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

    payload: dict[str, Any] = {
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
) -> schemas.PrinterConfigResponse:
    """
    Get printer configuration for the print agent.

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; 403 when it is unset (fail-closed).
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
) -> schemas.PrinterStatusResponse:
    """Get printer status and configuration."""
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    ip = await settings_service.get_setting_value(db, "printer.ip", "")
    port = await settings_service.get_setting_value(db, "printer.port", "9100")
    auto_anfahrt = await settings_service.get_setting_value(db, "printer.auto_anfahrt", "true")

    # Count pending jobs
    pending_result = await db.execute(select(func.count(PrintJob.id)).where(PrintJob.status == "pending"))
    pending_count = pending_result.scalar() or 0

    # Get last job info
    last_job_result = await db.execute(
        select(PrintJob)
        .where(PrintJob.status.in_(["completed", "failed"]))
        .order_by(PrintJob.completed_at.desc())
        .limit(1)
    )
    last_job = last_job_result.scalar_one_or_none()

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
) -> PrintJob:
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
    # After the commit, so an agent woken by this immediately sees the row.
    print_signal.notify_job_queued()

    logger.info(f"Queued assignment print job {job.id} for incident {incident_id}")
    return job


@router.post("/board/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_board_print(
    request: schemas.PrintBoardRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
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
    print_signal.notify_job_queued()

    logger.info(f"Queued board print job {job.id} for event {request.event_id}")
    return job


@router.post("/abholliste/{event_id}/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_abholliste_print(
    event_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
    """The Abholliste — the material half of the Restliste, on paper (decision 25).

    Address · unit · since when, one line each: the sheet somebody takes along
    the next morning. It goes through the **existing print-job path** rather
    than becoming a fourth document format, because it is a driving list, not a
    report.

    Material left on site is a *different day's* job and stays separate from the
    Trupp-Abholung flag: a pump running in a cellar and three people standing in
    the rain are two problems, and merging them into one sheet would lose that.
    """
    enabled = await settings_service.get_setting_value(db, "printer.enabled", "false")
    if enabled.lower() != "true":
        raise HTTPException(status_code=400, detail="Printer is not enabled")

    event_result = await db.execute(select(Event).where(Event.id == event_id))
    event = event_result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    restliste = await feld_crud.event_restliste(db, event_id)
    payload: dict[str, Any] = {
        "printed_at": datetime.now(UTC).isoformat(),
        "event_name": event.name,
        "training_flag": event.training_flag,
        "requested_by": current_user.display_name or current_user.username,
        "units": [
            {
                "name": unit["name"],
                "location": unit["location"],
                "address": unit["location_address"] or unit["incident_title"],
                "since": unit["since"].isoformat() if unit["since"] else None,
            }
            for unit in restliste["material_on_site"]
        ],
    }

    job = PrintJob(
        job_type="abholliste",
        status="pending",
        payload=payload,
        event_id=event_id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    print_signal.notify_job_queued()

    logger.info(f"Queued Abholliste print job {job.id} for event {event_id}")
    return job


@router.post("/test/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_test_print(
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
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
    print_signal.notify_job_queued()

    logger.info(f"Queued test print job {job.id} by user {current_user.username}")
    return job


@router.post("/qr-code/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_qr_code_print(
    request: schemas.PrintQRCodeRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
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
    print_signal.notify_job_queued()

    logger.info(f"Queued QR-code print job {job.id} by user {current_user.username}")
    return job


@router.get(
    "/jobs/pending/", response_model=list[schemas.PrintJobResponse], dependencies=[Depends(require_print_agent)]
)
async def get_pending_jobs(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=10, ge=1, le=50),
    wait: float = Query(default=0.0, ge=0.0, le=LONG_POLL_MAX_SECONDS),
) -> Sequence[PrintJob]:
    """
    Get pending print jobs for the print agent.

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; 403 when it is unset (fail-closed).

    With `wait` set the request LONG-POLLS: the response is held open until a job is queued
    or `wait` seconds pass, so a slip reaches the printer in milliseconds instead of on the
    agent's next poll. `wait=0` (the default) keeps the original immediate behaviour, which
    is what makes this safe to ship ahead of the agent — an old agent never sends the
    parameter and sees no change at all.
    """
    _touch_agent_heartbeat()
    deadline = time.monotonic() + wait

    while True:
        # Arm before looking, never after: see services/print_signal.
        print_signal.arm()
        # Reaper: bring back jobs stuck in 'printing' (agent died mid-print) or
        # 'failed' with attempts left — otherwise those slips vanish silently. Running it
        # on every pass through the wait, not just at entry, is a bonus of long-polling:
        # recovery used to be bounded by the idle poll interval, and is now a few seconds.
        await requeue_lost_jobs(db)
        result = await db.execute(
            select(PrintJob).where(PrintJob.status == "pending").order_by(PrintJob.created_at).limit(limit)
        )
        jobs = result.scalars().all()

        remaining = deadline - time.monotonic()
        if jobs or remaining <= 0:
            return jobs

        # End the read transaction before parking. Without this the session would hold a
        # pooled connection idle-in-transaction for the whole hang, which is how a long poll
        # quietly turns into a connection leak under any concurrency.
        await db.rollback()
        with contextlib.suppress(TimeoutError):
            async with asyncio.timeout(min(remaining, LONG_POLL_RECHECK_SECONDS)):
                await print_signal.wait_for_job()


@router.get("/jobs/{job_id}/", response_model=schemas.PrintJobResponse)
async def get_print_job(
    job_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
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
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
    """
    Claim a print job (mark as printing).

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; 403 when it is unset (fail-closed).
    """
    _touch_agent_heartbeat()

    # Conditional UPDATE, not read-then-write. The old form checked `status != "pending"` in
    # Python and then assigned, so two agents polling the same queue could both pass the check
    # and both print the slip — the known "each job prints once, at random" hazard, defended
    # until now only by the prose rule that you must not run two agents. A single-row UPDATE
    # with the status in the WHERE clause is atomic, so exactly one claimant wins and the
    # loser gets a clean 409. kp-front's print_relay._try_claim already did it this way.
    claimed = await execute_dml(
        db,
        sa_update(PrintJob)
        .where(PrintJob.id == job_id, PrintJob.status == "pending")
        .values(status="printing", claimed_at=datetime.now(UTC)),
    )

    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")

    if claimed.rowcount == 0:
        # Lost the race, or it was never claimable. Either way the agent must not print it.
        raise HTTPException(status_code=409, detail=f"Job is not pending (status: {job.status})")

    await db.commit()
    await db.refresh(job)

    # The claim is the only proof the agent is alive and took this particular job.
    # Without it the client cannot tell "nobody is running the print service" from
    # "the printer is chewing on it", and both would look like the same spinner.
    background_tasks.add_task(broadcast_print_job_update, job_event_payload(job))

    logger.info(f"Print job {job_id} claimed by agent")
    return job


@router.patch(
    "/jobs/{job_id}/complete/", response_model=schemas.PrintJobResponse, dependencies=[Depends(require_print_agent)]
)
async def complete_print_job(
    job_id: uuid.UUID,
    update: schemas.PrintJobUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
    """
    Complete a print job (mark as completed or failed).

    Authenticated via the shared agent token (X-Agent-Token) when
    PRINT_AGENT_TOKEN is configured; 403 when it is unset (fail-closed).
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

    if update.status == schemas.PrintJobStatus.FAILED and not update.retryable:
        # A retryable failure (printer unreachable) deliberately does NOT count: the reaper
        # requeues it, the TTL decides how long that is still worth doing, and the slip
        # survives a printer that is merely rebooting. See PrintJobUpdate.retryable.
        job.retry_count += 1

    await db.commit()
    await db.refresh(job)

    # The whole point: a failure with "Papier leer" has to reach the person who is
    # already walking to the printer, not only the Einstellungen → Drucker page.
    background_tasks.add_task(broadcast_print_job_update, job_event_payload(job))

    logger.info(f"Print job {job_id} completed with status: {update.status.value}")
    return job


@router.delete("/jobs/{job_id}/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_print_job(
    job_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a print job (editor only)."""
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")

    await db.delete(job)
    await db.commit()

    logger.info(f"Print job {job_id} deleted by user {current_user.username}")
