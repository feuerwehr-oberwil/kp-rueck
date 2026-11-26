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

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, status
from sqlalchemy import func, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings as app_settings
from ..crud import feld as feld_crud
from ..crud import print_jobs as print_crud
from ..crud.print_jobs import MAX_PRINT_ATTEMPTS, STALE_CLAIM_ERROR, requeue_lost_jobs
from ..database import execute_dml, get_db
from ..models import Event, Incident, PrintJob
from ..services import print_signal
from ..services import settings as settings_service
from ..utils.error_codes import CodedHTTPException, ErrorCode
from ..utils.errors import ErrorMessages
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
        raise CodedHTTPException(
            status.HTTP_403_FORBIDDEN,
            ErrorCode.PRINT_AGENT_DISABLED,
            "Print-Agent deaktiviert (PRINT_AGENT_TOKEN nicht gesetzt)",
        )
    # As bytes: compare_digest raises on a str with non-ASCII characters (a 500, not the 401).
    if not secrets.compare_digest(x_agent_token.encode(), app_settings.print_agent_token.encode()):
        raise CodedHTTPException(
            status.HTTP_401_UNAUTHORIZED, ErrorCode.PRINT_AGENT_TOKEN_INVALID, "Ungültiges Agent-Token"
        )


async def require_printer_configured(db: AsyncSession) -> None:
    """Refuse to queue a job that can never come out of a printer.

    Two settings decide whether printing works, not one: ``printer.enabled`` AND an address
    the agent can reach — the agent asks for both via ``GET /api/print/config/`` and has
    nowhere to send the bytes without the second.

    The address used to go unchecked here. A station with printing switched on but no IP
    accepted every job, returned 201, and stacked them in ``print_jobs`` forever: no error
    on the board, no error in the agent log, and nothing on paper. Failing at the door is
    the whole point — an operator who prints an Einsatzzettel finds out now, not never.

    Only the five endpoints that CREATE jobs use this. The agent's own poll/claim/complete
    routes stay open on ``printer.enabled`` alone, so a queue that filled up before the
    address went missing can still be drained.
    """
    if not await settings_service.read(db, settings_service.PRINTER_ENABLED):
        raise CodedHTTPException(400, ErrorCode.PRINTING_OFF, "Drucken ist ausgeschaltet")
    if not (await settings_service.read(db, settings_service.PRINTER_IP)).strip():
        raise CodedHTTPException(
            400, ErrorCode.PRINTER_ADDRESS_MISSING, "Keine Druckeradresse gesetzt (Einstellungen → Drucker → Adresse)"
        )


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
    return schemas.PrinterConfigResponse(
        enabled=await settings_service.read(db, settings_service.PRINTER_ENABLED),
        ip=await settings_service.read(db, settings_service.PRINTER_IP),
        port=await settings_service.read(db, settings_service.PRINTER_PORT),
    )


@router.get("/status/", response_model=schemas.PrinterStatusResponse)
async def get_printer_status(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> schemas.PrinterStatusResponse:
    """Get printer status and configuration."""
    enabled = await settings_service.read(db, settings_service.PRINTER_ENABLED)
    ip = await settings_service.read(db, settings_service.PRINTER_IP)
    port = await settings_service.read(db, settings_service.PRINTER_PORT)
    auto_anfahrt = await settings_service.read(db, settings_service.PRINTER_AUTO_ANFAHRT)

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
        enabled=enabled,
        ip=ip,
        port=port,
        auto_anfahrt=auto_anfahrt,
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
    await require_printer_configured(db)
    if await db.get(Incident, incident_id) is None:
        raise CodedHTTPException(404, ErrorCode.INCIDENT_NOT_FOUND, ErrorMessages.INCIDENT_NOT_FOUND)
    return await print_crud.queue_assignment_print(db, incident_id, dedup=False)


@router.post("/board/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_board_print(
    request: schemas.PrintBoardRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
    """Queue a board snapshot for printing."""
    await require_printer_configured(db)
    event = await db.get(Event, request.event_id)
    if event is None:
        raise CodedHTTPException(404, ErrorCode.EVENT_NOT_FOUND, ErrorMessages.EVENT_NOT_FOUND)

    payload = await print_crud.build_board_payload(
        db,
        event,
        include_incidents=request.include_incidents,
        include_completed=request.include_completed,
        include_vehicles=request.include_vehicles,
        include_personnel=request.include_personnel,
    )
    return await print_crud.enqueue(db, "board", payload, event_id=event.id)


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
    await require_printer_configured(db)

    event_result = await db.execute(select(Event).where(Event.id == event_id))
    event = event_result.scalar_one_or_none()
    if not event:
        raise CodedHTTPException(404, ErrorCode.EVENT_NOT_FOUND, ErrorMessages.EVENT_NOT_FOUND)

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
                # False for a "Weiteres Material" entry (§18.35): it has to be
                # fetched like every other line, but no assignment and no
                # catalogue unit stands behind the name, so `since` is when the
                # rapport saying so was filed rather than when it was dispatched.
                "tracked": unit.get("tracked", True),
            }
            for unit in restliste["material_on_site"]
        ],
    }

    return await print_crud.enqueue(db, "abholliste", payload, event_id=event_id)


@router.post("/test/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_test_print(
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
    """Queue a test print to verify the whole printing chain end-to-end."""
    await require_printer_configured(db)

    payload = {
        "requested_by": current_user.display_name or current_user.username,
        "printed_at": datetime.now(UTC).isoformat(),
    }

    return await print_crud.enqueue(db, "test", payload)


@router.post("/qr-code/", response_model=schemas.PrintJobResponse, status_code=status.HTTP_201_CREATED)
async def queue_qr_code_print(
    request: schemas.PrintQRCodeRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
    """Queue a QR-code slip (shareable link as QR + text) for printing.

    ``code`` / ``valid_until`` ride along untouched when the caller sends them
    (the Feld slip does, nothing else). They are the only reason a scanned Feld
    poster does not strand its reader at a code prompt — see
    ``PrintQRCodeRequest`` and ``format_qr_code_slip`` in the agent, which prints
    both under the QR and skips them when absent.
    """
    await require_printer_configured(db)

    payload = {
        "qr_content": request.qr_content,
        "title": request.title,
        "subtitle": request.subtitle,
        "code": request.code,
        "valid_until": request.valid_until,
        "printed_at": datetime.now(UTC).isoformat(),
    }

    return await print_crud.enqueue(db, "qr_code", payload, event_id=request.event_id)


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

        # End the transaction before parking. Without this the session would hold a
        # pooled connection idle-in-transaction for the whole hang, which is how a long poll
        # quietly turns into a connection leak under any concurrency. A COMMIT, not a
        # rollback: the reaper's writes (a retired claim, an expired job) must stand even if
        # the agent hangs up during the wait (hunt 2026-11-24).
        await db.commit()
        with contextlib.suppress(TimeoutError):
            async with asyncio.timeout(min(remaining, LONG_POLL_RECHECK_SECONDS)):
                await print_signal.wait_for_job()


@router.get("/jobs/{job_id}/", response_model=schemas.PrintJobResponse)
async def get_print_job(
    job_id: uuid.UUID,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> PrintJob:
    """Get a single print job by id (used by the frontend to poll test-print results).

    Editor only: the payload carries the Feld QR token and Feld-Code of a printed slip, and the
    only caller (the Testdruck in Settings) polls a job it just queued as an editor.
    """
    result = await db.execute(select(PrintJob).where(PrintJob.id == job_id))
    job = result.scalar_one_or_none()

    if not job:
        raise CodedHTTPException(404, ErrorCode.PRINT_JOB_NOT_FOUND, ErrorMessages.PRINT_JOB_NOT_FOUND)

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
        raise CodedHTTPException(404, ErrorCode.PRINT_JOB_NOT_FOUND, ErrorMessages.PRINT_JOB_NOT_FOUND)

    if claimed.rowcount == 0:
        # Lost the race, or it was never claimable. Either way the agent must not print it.
        raise CodedHTTPException(
            409,
            ErrorCode.PRINT_JOB_NOT_PENDING,
            f"Druckauftrag wartet nicht (Status: {job.status})",
            params={"status": job.status},
        )

    await db.flush()
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
        raise CodedHTTPException(404, ErrorCode.PRINT_JOB_NOT_FOUND, ErrorMessages.PRINT_JOB_NOT_FOUND)

    # A report that arrives after the reaper retired the silent claim (`STALE_CLAIM_ERROR`) is
    # the agent's answer after all – it counts, «failed» with the printer's own error too.
    retired_silent = job.status == "failed" and job.error_message == STALE_CLAIM_ERROR
    if job.status == update.status.value and job.status in ("completed", "failed") and not retired_silent:
        # A repeat of the report that already landed. The agent retries its completion report
        # on a network error (tools/print-agent/protocols/rueck.py), and a lost RESPONSE looks
        # exactly like a lost request from its side — so the first attempt may well have been
        # recorded. Answer it as done, and change nothing: no second retry_count increment, no
        # second toast in the operations room.
        return job

    if job.status not in ("pending", "printing") and not retired_silent:
        raise CodedHTTPException(
            409,
            ErrorCode.PRINT_JOB_NOT_COMPLETABLE,
            f"Druckauftrag kann nicht abgeschlossen werden (Status: {job.status})",
            params={"status": job.status},
        )

    job.status = update.status.value
    job.completed_at = datetime.now(UTC)
    job.error_message = update.error_message

    if update.status == schemas.PrintJobStatus.FAILED and not update.retryable:
        # A retryable failure (printer unreachable) deliberately does NOT count: the reaper
        # requeues it, the TTL decides how long that is still worth doing, and the slip
        # survives a printer that is merely rebooting. See PrintJobUpdate.retryable.
        job.retry_count += 1

    await db.flush()
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
        raise CodedHTTPException(404, ErrorCode.PRINT_JOB_NOT_FOUND, ErrorMessages.PRINT_JOB_NOT_FOUND)

    await db.delete(job)

    logger.info(f"Print job {job_id} deleted by user {current_user.username}")
