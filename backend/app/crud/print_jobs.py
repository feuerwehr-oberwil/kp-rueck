"""Print job CRUD operations."""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..database import execute_dml
from ..models import (
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroupAssignment,
    Material,
    Personnel,
    PrintJob,
    RekoReport,
    Vehicle,
)
from ..services.tokens import generate_feld_token

logger = logging.getLogger(__name__)

# Don't re-print the same incident within this window
DEDUP_WINDOW_SECONDS = 30

# Reaper thresholds: a claimed job prints in seconds, so a 'printing' job this
# old means the agent died mid-print (power loss, crash) and no completion
# will ever arrive. Failed jobs (paper out, cable pulled) retry after a short
# pause. Both are capped so a broken printer doesn't loop forever.
STALE_PRINTING_TIMEOUT_SECONDS = 120
FAILED_RETRY_DELAY_SECONDS = 30
MAX_PRINT_ATTEMPTS = 3

# Hard stop on requeueing, measured from when the job was created rather than in attempts.
#
# The attempt cap alone stopped being a stop the moment "printer unreachable" stopped
# counting as an attempt (see api/print.py): a printer that is off for the weekend would
# otherwise be offered the same slip every thirty seconds until somebody noticed. For the
# types that have a TTL the expiry below is the real deadline and this never fires; it exists
# for the one type that deliberately has none — the test print, where the person who asked
# for it has long since walked away.
REQUEUE_MAX_AGE_SECONDS = 60 * 60

# How long a queued job stays worth printing. Past this it is expired instead of handed to
# the agent.
#
# Without this, a printer that was offline for two hours drained its entire backlog the
# moment it came back: dozens of slips, oldest first, for incidents that had since been
# closed — during the operation that is still running. Paper that describes a situation
# which no longer exists is not merely useless in a command post, it actively competes with
# the current picture.
#
# Split by type because they age differently. A board snapshot is a photograph of a moment
# and is superseded by the next one within minutes, so it spoils fast. An Einsatzzettel is
# about one incident and stays meaningful for as long as that incident plausibly runs.
PRINT_JOB_TTL_SECONDS: dict[str, int] = {
    "board": 15 * 60,
    "assignment": 60 * 60,
    "qr_code": 60 * 60,
    # The Abholliste is next morning's driving list, not a picture of now: it
    # ages in hours, not minutes, and a stale one is still mostly right — the
    # pump either got collected or it did not.
    "abholliste": 60 * 60,
}
# Test prints are excluded on purpose: somebody is standing at the printer waiting for one,
# and if it is late that is exactly the diagnosis they are trying to make.
DEFAULT_PRINT_JOB_TTL_SECONDS: int | None = None


async def requeue_lost_jobs(db: AsyncSession) -> int:
    """Requeue jobs that would otherwise be lost forever (audit point 13).

    - 'printing' older than the stale timeout → back to 'pending'
      (the claim consumed an attempt, so retry_count increments).
    - 'failed' with attempts left → back to 'pending' after a short delay
      (retry_count was already incremented on failure).

    Called from the agent's pending-jobs poll; returns the number requeued.
    Uses plain UPDATEs so concurrent polls can't double-requeue.
    """
    now = datetime.now(UTC)
    requeued = 0

    stale_result = await execute_dml(
        db,
        sa_update(PrintJob)
        .where(
            PrintJob.status == "printing",
            PrintJob.claimed_at < now - timedelta(seconds=STALE_PRINTING_TIMEOUT_SECONDS),
            PrintJob.retry_count < MAX_PRINT_ATTEMPTS,
        )
        .values(status="pending", claimed_at=None, retry_count=PrintJob.retry_count + 1),
    )
    requeued += stale_result.rowcount or 0

    failed_result = await execute_dml(
        db,
        sa_update(PrintJob)
        .where(
            PrintJob.status == "failed",
            PrintJob.completed_at < now - timedelta(seconds=FAILED_RETRY_DELAY_SECONDS),
            PrintJob.retry_count < MAX_PRINT_ATTEMPTS,
            PrintJob.created_at > now - timedelta(seconds=REQUEUE_MAX_AGE_SECONDS),
        )
        .values(status="pending", claimed_at=None, completed_at=None),
    )
    requeued += failed_result.rowcount or 0

    if requeued:
        await db.commit()
        logger.info("Requeued %d lost print job(s)", requeued)

    await expire_stale_jobs(db)

    return requeued


async def expire_stale_jobs(db: AsyncSession) -> int:
    """Retire queued jobs that have outlived their usefulness.

    Runs alongside the reaper on the agent's poll, so expiry happens on the same path that
    would otherwise hand the job over. Marked 'expired' rather than deleted: the queue is
    part of the operational record, and "this was never printed, and why" is worth keeping.
    """
    now = datetime.now(UTC)
    expired = 0

    for job_type, ttl_seconds in PRINT_JOB_TTL_SECONDS.items():
        result = await execute_dml(
            db,
            sa_update(PrintJob)
            .where(
                PrintJob.status == "pending",
                PrintJob.job_type == job_type,
                PrintJob.created_at < now - timedelta(seconds=ttl_seconds),
            )
            .values(status="expired", completed_at=now),
        )
        expired += result.rowcount or 0

    if expired:
        await db.commit()
        logger.info("Expired %d stale print job(s) past their TTL", expired)

    return expired


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
    cutoff = datetime.now(UTC) - timedelta(seconds=DEDUP_WINDOW_SECONDS)
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
    incident_result = await db.execute(
        select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident_id)
    )
    incident = incident_result.scalar_one_or_none()

    if not incident:
        raise ValueError(f"Incident {incident_id} not found")

    # Build payload
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
    await db.flush()
    await db.refresh(job)

    logger.info(f"Queued assignment print job {job.id} for incident {incident_id}")
    return job


def public_base_url() -> str:
    """The origin a printed QR has to point a phone at.

    The slip is printed by the *auto-print on dispatch* as often as by the
    button, and that path has no HTTP request to read a base URL from — GPS
    automation moves a card to `enroute` with nobody's browser involved. Even
    when there is a request, ``request.base_url`` is the **backend's** origin,
    which on a split deployment (Railway: the browser talks to the frontend and
    Next proxies to `API_URL`) is not the address a phone can open.

    So: ``CORS_ORIGINS``, whose first entry is by definition the browser origin
    this installation is served from. On the compose stack that is the station's
    single Caddy origin and everything agrees; in dev it is localhost:3000.
    """
    origins = settings.cors_origins
    if isinstance(origins, str):
        origins = [origins]
    for origin in origins:
        candidate = (origin or "").strip().rstrip("/")
        if candidate and candidate != "*":
            return candidate
    return ""


async def build_feld_slip_link(db: AsyncSession, incident: Incident) -> str | None:
    """The second QR on the Einsatzzettel (decision 19, §3.1).

    The **same event token** with ``&incident_id=`` appended — a shortcut, not a
    second door. The global QR on the poster stays the door; this only spares a
    crew the person-picker detour by preselecting the Schadenplatz they were
    just handed.

    It can only preselect the *incident*, never the person: the slip is printed
    before it is known who drives.

    Accepted exposure, and it belongs in the operator docs (`docs/SETUP.md`): a
    slip left in a vehicle is a working credential until the event token
    expires. That is the same exposure as the poster on the wall, but it is now
    on paper that travels — so slips join the "collect at the end of the
    Ereignis" habit the posters already have.
    """
    if incident.event_id is None:
        return None
    base = public_base_url()
    if not base:
        logger.warning("No CORS origin configured — the Einsatzzettel prints without a /feld QR")
        return None
    token = generate_feld_token(incident.event_id)
    return f"{base}/feld?token={token}&incident_id={incident.id}"


async def build_assignment_payload(db: AsyncSession, incident: Incident) -> dict[str, Any]:
    """Build the payload for an assignment slip print job.

    Shared between auto-print (on dispatch) and manual print (API endpoint).
    Includes per-vehicle driver info, Reko summary, internal notes, and
    Nachbarhilfe details so the printed slip carries full tactical context.
    """
    # Route resources cover every stop. A direct incident assignment wins when
    # the same resource exists at both levels (notably for driver_stay).
    effective: dict[tuple[str, uuid.UUID], IncidentAssignment | IncidentGroupAssignment] = {}
    if incident.group_id is not None:
        group_result = await db.execute(
            select(IncidentGroupAssignment).where(
                IncidentGroupAssignment.incident_group_id == incident.group_id,
                IncidentGroupAssignment.unassigned_at.is_(None),
            )
        )
        effective.update({(a.resource_type, a.resource_id): a for a in group_result.scalars().all()})
    effective.update({(a.resource_type, a.resource_id): a for a in incident.assignments if a.unassigned_at is None})
    active_assignments = list(effective.values())

    # Separate by type
    personnel_ids = [a.resource_id for a in active_assignments if a.resource_type == "personnel"]
    vehicle_ids = [a.resource_id for a in active_assignments if a.resource_type == "vehicle"]
    material_ids = [a.resource_id for a in active_assignments if a.resource_type == "material"]

    # Vehicle assignment lookup for driver_stay
    vehicle_assignment_map = {a.resource_id: a for a in active_assignments if a.resource_type == "vehicle"}

    # Reko personnel for this event — excluded from crew section (they're on Reko duty, not assigned crew)
    reko_personnel_ids: set[uuid.UUID] = set()
    if incident.event_id:
        result = await db.execute(
            select(EventSpecialFunction.personnel_id).where(
                and_(
                    EventSpecialFunction.event_id == incident.event_id,
                    EventSpecialFunction.function_type == "reko",
                )
            )
        )
        reko_personnel_ids = {row[0] for row in result.all()}

    # Drivers per vehicle for this event
    driver_map: dict[uuid.UUID, str] = {}
    if vehicle_ids and incident.event_id:
        result = await db.execute(
            select(EventSpecialFunction, Personnel)
            .join(Personnel, EventSpecialFunction.personnel_id == Personnel.id)
            .where(
                and_(
                    EventSpecialFunction.event_id == incident.event_id,
                    EventSpecialFunction.function_type == "driver",
                    EventSpecialFunction.vehicle_id.in_(vehicle_ids),
                )
            )
        )
        for sf, person in result.all():
            if sf.vehicle_id:
                driver_map[sf.vehicle_id] = person.name

    # Fetch personnel (excluding Reko-tagged personnel from crew list). The
    # Einsatzleiter rides along on the slip: the crew that reads it off the
    # printer is exactly the audience that needs to know who is leading, and
    # they have no board to look at.
    leader_ids = {a.resource_id for a in active_assignments if a.resource_type == "personnel" and a.is_leader}
    crew = []
    if personnel_ids:
        # Ordered, because the EL-first sort below is STABLE: without this the
        # rest of the crew printed in whatever order Postgres returned rows,
        # which differs between two prints of the same slip.
        personnel_result = await db.execute(
            select(Personnel)
            .where(Personnel.id.in_(personnel_ids))
            .order_by(Personnel.role_sort_order, Personnel.role, Personnel.name)
        )
        for p in personnel_result.scalars().all():
            if p.id not in reko_personnel_ids:
                crew.append({"name": p.name, "role": p.role, "is_leader": p.id in leader_ids})
        # EL first (plan 25, decision 23) — incident-scoped, so this reorders only
        # this slip. Stable: everyone else keeps the order they came back in.
        crew.sort(key=lambda member: not member["is_leader"])

    # Fetch vehicles with driver info
    vehicles = []
    if vehicle_ids:
        vehicle_result = await db.execute(select(Vehicle).where(Vehicle.id.in_(vehicle_ids)))
        for v in vehicle_result.scalars().all():
            assignment = vehicle_assignment_map.get(v.id)
            vehicles.append(
                {
                    "name": v.name,
                    "type": v.type,
                    "radio_call_sign": v.radio_call_sign,
                    "driver": driver_map.get(v.id),
                    "driver_stay": assignment.driver_stay if assignment else False,
                }
            )

    # Fetch materials
    materials = []
    if material_ids:
        material_result = await db.execute(select(Material).where(Material.id.in_(material_ids)))
        for m in material_result.scalars().all():
            materials.append({"name": m.name, "type": m.type})

    # Fetch most-recent submitted Reko report so crews get tactical context on the slip
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
                "fire": "Feuer",
                "explosion": "Explosion",
                "collapse": "Einsturz",
                "chemical": "Gefahrstoffe",
                "electrical": "Elektrisch",
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

    return {
        "incident_id": str(incident.id),
        # When the CONTENT was captured, not when the paper came out. The agent stamps this in
        # the footer (tools/print-agent/formatters.py::_stamp), so an Einsatzzettel that waited
        # in the queue behind an offline printer does not claim to be current. Without it the
        # agent falls back to now() — exactly the bug the stamp exists to fix, and this is the
        # slip it matters most for: the assignment TTL is an hour, so it is the type most
        # likely to sit queued. Matches the board/test/qr_code payloads in api/print.py.
        "printed_at": datetime.now(UTC).isoformat(),
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
        # The second QR (decision 19). None when the incident has no event or the
        # installation has no configured origin — the agent then simply prints no
        # QR block, which is what an older agent does anyway.
        "feld_qr": await build_feld_slip_link(db, incident),
        "crew": crew,
        "vehicles": vehicles,
        "materials": materials,
        "created_at": incident.created_at.isoformat() if incident.created_at else None,
    }
