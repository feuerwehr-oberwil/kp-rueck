"""Print job CRUD operations."""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, overload

from sqlalchemy import and_, func, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..database import after_commit, execute_dml
from ..models import (
    Event,
    EventAttendance,
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
from ..services import print_signal
from ..services.person_label import person_text, roster_namesakes
from ..services.tokens import generate_feld_token

logger = logging.getLogger(__name__)

# Don't re-print the same incident within this window
DEDUP_WINDOW_SECONDS = 30

# Reaper thresholds: a claimed job prints in seconds, so a 'printing' job this
# old means the agent died mid-print (power loss, crash) and no completion
# will ever arrive. Failed jobs (paper out, cable pulled) retry after a short
# pause. Both are capped so a broken printer doesn't loop forever.
#
# ⚠️ This is the time from CLAIM to REPORT, and it is only safe while the agent keeps that
# window to one job: past it the job is requeued and printed a second time. The agent used to
# claim a batch of up to ten before printing any, so the tenth claim aged through nine prints
# first — against an unreachable printer (5 s connect timeout per destination) that alone
# approaches this. It now claims one job, prints it and reports it (with bounded retries,
# ~35 s worst case) before claiming the next. The CUPS output's 30-minute patience does not
# apply here: the agent refuses to pair KP Rück's protocol with anything but ESC/POS.
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

# What the status page says for a claim that went silent on its last attempt (hunt
# 2026-11-24): the agent took it and never reported, so paper may or may not have come out.
STALE_CLAIM_ERROR = "Keine Rückmeldung vom Druck-Agent – ob gedruckt wurde, ist unklar."

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
      (the claim consumed an attempt, so retry_count increments) – or, on its last
      attempt, 'failed' with `STALE_CLAIM_ERROR`: it stayed «printing» forever before.
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

    # Out of attempts: retired, with a reason the Drucker page shows. Not counted as requeued.
    retired = await execute_dml(
        db,
        sa_update(PrintJob)
        .where(
            PrintJob.status == "printing",
            PrintJob.claimed_at < now - timedelta(seconds=STALE_PRINTING_TIMEOUT_SECONDS),
            PrintJob.retry_count >= MAX_PRINT_ATTEMPTS,
        )
        .values(status="failed", completed_at=now, error_message=STALE_CLAIM_ERROR),
    )
    if retired.rowcount:
        await db.flush()
        logger.warning("Retired %d print job(s) whose last claim went silent", retired.rowcount)

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
        await db.flush()
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
        await db.flush()
        logger.info("Expired %d stale print job(s) past their TTL", expired)

    return expired


async def enqueue(
    db: AsyncSession,
    job_type: str,
    payload: dict[str, Any],
    *,
    event_id: uuid.UUID | None = None,
    incident_id: uuid.UUID | None = None,
) -> PrintJob:
    """Queue one print job and wake the agent once it is committed. Flushes; the caller commits.

    Every slip goes through here: the queue routes (api/print.py), the auto-print on dispatch
    and the fallback board snapshot. Flushed, not committed, so a failure before the commit
    rolls the job back with its error – a retry then queues one slip, not two (hunt 2026-11-24).
    """
    job = PrintJob(job_type=job_type, status="pending", payload=payload, event_id=event_id, incident_id=incident_id)
    db.add(job)
    await db.flush()
    await db.refresh(job)
    after_commit(db, print_signal.notify_job_queued)
    logger.info("Queued %s print job %s (event %s, incident %s)", job_type, job.id, event_id, incident_id)
    return job


@overload
async def queue_assignment_print(
    db: AsyncSession, incident_id: uuid.UUID, *, dedup: Literal[True] = True
) -> PrintJob | None: ...
@overload
async def queue_assignment_print(db: AsyncSession, incident_id: uuid.UUID, *, dedup: Literal[False]) -> PrintJob: ...
async def queue_assignment_print(db: AsyncSession, incident_id: uuid.UUID, *, dedup: bool = True) -> PrintJob | None:
    """Queue an incident's assignment slip. ``ValueError`` when the incident does not exist.

    ``dedup`` (the auto-print on dispatch) skips the slip, returning None, while a job for this
    incident is pending or printing or completed within the last 30 seconds. The «Drucken»
    button passes ``dedup=False``: a reprint asked for is a reprint.
    """
    if dedup:
        cutoff = datetime.now(UTC) - timedelta(seconds=DEDUP_WINDOW_SECONDS)
        existing = await db.scalar(
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
        if existing:
            logger.info(
                f"Skipping duplicate print for incident {incident_id} "
                f"(existing job {existing.id}, status={existing.status})"
            )
            return None

    incident = await db.scalar(
        select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident_id)
    )
    if not incident:
        raise ValueError(f"Incident {incident_id} not found")

    payload = await build_assignment_payload(db, incident)
    return await enqueue(db, "assignment", payload, event_id=incident.event_id, incident_id=incident_id)


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

    Since the Feld-Code, the link alone opens nothing — it buys the right to be
    asked for four digits, which is why the slip prints them next to it
    (:func:`build_feld_slip_code`). A slip left in a vehicle is still a working
    credential for whoever also has the code, so slips keep the "collect at the
    end of the Ereignis" habit the posters have (`docs/SETUP.md`).
    """
    if incident.event_id is None:
        return None
    base = public_base_url()
    if not base:
        logger.warning("No CORS origin configured — the Einsatzzettel prints without a /feld QR")
        return None
    token = generate_feld_token(incident.event_id)
    return f"{base}/feld?token={token}&incident_id={incident.id}"


async def build_feld_slip_code(db: AsyncSession, incident: Incident) -> str | None:
    """The four digits that go on the paper next to the QR.

    A QR that opens a code prompt, handed over without the code, strands the
    crew that scans it in the rain — the same rule the board's enlarged QR
    follows (plan 26, decision 22). The slip is the one place the two must
    travel together, because nobody is standing next to the board when it is
    read.

    ``None`` when the incident belongs to no Ereignis or the event predates the
    code, in which case the agent prints the QR block without a code line.
    """
    if incident.event_id is None:
        return None
    event = await db.get(Event, incident.event_id)
    return event.feld_code if event is not None else None


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

    # A namesake is printed with their Kennung, as the board shows them (services.person_label).
    shared = await roster_namesakes(db)

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
                driver_map[sf.vehicle_id] = person_text(person.name, person.kennung, shared)

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
                crew.append(
                    {"name": person_text(p.name, p.kennung, shared), "role": p.role, "is_leader": p.id in leader_ids}
                )
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

    # Whether this slip belongs to an exercise. The board snapshot has always printed an
    # ÜBUNG marker; the assignment slip — the sheet a crew actually carries to an address —
    # did not even receive the flag, so a training slip and a live one were indistinguishable
    # once they left the printer.
    training_flag = False
    if incident.event_id is not None:
        training_flag = bool(await db.scalar(select(Event.training_flag).where(Event.id == incident.event_id)))

    return {
        "incident_id": str(incident.id),
        "training_flag": training_flag,
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
        # The slip printed `Tel: {contact}` — but `contact` is the reporter's NAME. The
        # number was never in the payload, so the one field a crew might need to call
        # ahead with was a person's name under a telephone label.
        "contact_phone": incident.contact_phone or "",
        "nachbarhilfe": incident.nachbarhilfe,
        "nachbarhilfe_note": incident.nachbarhilfe_note or "",
        "internal_notes": incident.internal_notes or "",
        "zu_fuss": incident.zu_fuss,
        "reko_summary": reko_summary,
        # The second QR (decision 19). None when the incident has no event or the
        # installation has no configured origin — the agent then simply prints no
        # QR block, which is what an older agent does anyway.
        "feld_qr": await build_feld_slip_link(db, incident),
        # And the code the QR asks for. Printed only where the QR is printed;
        # on its own it opens nothing.
        "feld_code": await build_feld_slip_code(db, incident),
        "crew": crew,
        "vehicles": vehicles,
        "materials": materials,
        "created_at": incident.created_at.isoformat() if incident.created_at else None,
    }


async def build_board_payload(
    db: AsyncSession,
    event: Event,
    *,
    include_incidents: bool = True,
    include_completed: bool = False,
    include_vehicles: bool = True,
    include_personnel: bool = True,
) -> dict[str, Any]:
    """The payload of a board snapshot slip: `POST /print/board/` and the fallback auto-print."""
    event_id = event.id

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

    # A namesake is printed with their Kennung, as the board shows them (services.person_label).
    shared = await roster_namesakes(db)

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
            driver_map[sf.vehicle_id] = person_text(person.name, person.kennung, shared)

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
                    crew.append(
                        {
                            "name": person_text(p.name, p.kennung, shared),
                            "role": p.role,
                            "is_leader": p.id in leader_ids,
                        }
                    )

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

    # Get vehicle status summary. Archived vehicles are retired inventory — they
    # are off the board and out of the pickers, so a slip that still lists them
    # would be the one surface telling the KP the station owns a truck it sold.
    all_vehicles_result = await db.execute(
        select(Vehicle).where(Vehicle.archived_at.is_(None)).order_by(Vehicle.display_order)
    )
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
                # Readiness reads `out_of_service`, not the legacy `status` mirror
                # — same precedence the board draws: not ready ▸ assigned ▸ free.
                "available": v.id not in assigned_vehicle_ids and not v.out_of_service,
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

    total_personnel_result = await db.execute(select(func.count(Personnel.id)).where(Personnel.in_scope(event_id)))
    total_personnel = total_personnel_result.scalar() or 0

    # Get individual checked-in personnel for detailed listing
    personnel_list: list[dict[str, Any]] = []
    if include_personnel:
        # `checked_in_by_user_id` rides along so the slip can mark the channel
        # (plan 26 §7). NULL is the normal case — somebody tapped their own name
        # on the check-in link — and prints nothing; a user id means an operator
        # ticked the name at the board off a radio roll-call, which is a weaker
        # claim about who is actually standing in the Magazin and says so.
        checked_in_personnel_result = await db.execute(
            select(Personnel, EventAttendance.checked_in_by_user_id)
            .join(EventAttendance, Personnel.id == EventAttendance.personnel_id)
            .where(
                and_(
                    EventAttendance.event_id == event_id,
                    EventAttendance.checked_in.is_(True),
                )
            )
            .order_by(Personnel.role_sort_order, Personnel.role, Personnel.name)
        )
        for p, checked_in_by_user_id in checked_in_personnel_result.all():
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
                    "name": person_text(p.name, p.kennung, shared),
                    "role": p.role,
                    "assigned": is_assigned,
                    # "kp" when an operator checked this person in, otherwise absent.
                    # A field self-check-in is the normal case and carries no marker.
                    **({"channel": "kp"} if checked_in_by_user_id else {}),
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
