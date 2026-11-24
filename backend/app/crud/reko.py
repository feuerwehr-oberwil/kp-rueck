"""Reko form CRUD operations."""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import Incident, RekoReport, StatusTransition, User
from ..services import reko_history
from ..services.merge_links import live_incident_id
from ..services.reko_history import RekoAuthor
from ..services.tokens import generate_form_token, validate_form_token
from .locking import lock_incident_with_group


async def _locked_report(db: AsyncSession, incident_id: uuid.UUID) -> RekoReport | None:
    """THE report of a live incident, if it has one, read under the card lock.

    The lock (`crud/locking.py`, card with its Auftrag) makes two first writes – a crew's
    tap and a board save, two boards, a retry – find one row instead of racing the unique
    index, and serializes them with the photo unlink and the status move's filing.

    Raises:
        ValueError: If the incident does not exist
    """
    if await lock_incident_with_group(db, incident_id) is None:
        raise ValueError("Incident not found")
    result = await db.execute(
        select(RekoReport).where(RekoReport.incident_id == incident_id).execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def _the_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    new_report: Callable[[], RekoReport],
) -> RekoReport:
    """THE report of a live incident (`_locked_report`), created by `new_report` when there
    is none yet.

    Raises:
        ValueError: If the incident does not exist
    """
    report = await _locked_report(db, incident_id)
    if report is None:
        report = new_report()
        db.add(report)
        await db.flush()
        await db.refresh(report)
    return report


async def get_or_create_reko_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    token: str,
    personnel_id: uuid.UUID | None = None,
) -> RekoReport:
    """The field's door onto THE incident's report (one per Einsatz, owner pick 23.11.2026).

    Any valid form link of the incident opens the same report – a second Reko person, a
    fresh link, the Übungssteuerung – and edits it in place. A link minted for a card that
    was merged away opens the report of the card it went into (R2 review).

    The person is stamped while the report has no person and is not filed yet: the crew
    that files it is who the outputs name («Erfasst von …»), also when the KP opened the
    row first («Reko vor Ort» over the radio). A report already filed keeps its author;
    each edit names its own in the Chronik (`reko_history`).

    Raises:
        ValueError: If token is invalid or incident not found
    """
    if not validate_form_token(token, str(incident_id)):
        raise ValueError("Invalid token")
    incident_id = await live_incident_id(db, incident_id)
    report = await _the_report(
        db,
        incident_id,
        lambda: RekoReport(incident_id=incident_id, token=token, is_draft=True, submitted_by_personnel_id=personnel_id),
    )
    if personnel_id and not report.submitted_by_personnel_id and report.is_draft:
        report.submitted_by_personnel_id = personnel_id
        await db.flush()
        await db.refresh(report)
    return report


async def get_or_create_kp_reko_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    user: User,
) -> RekoReport:
    """The board's door onto THE incident's report (plan 26 §5.1, one per Einsatz since 23.11.2026).

    No link, so nobody to resolve: a report the board creates carries the operator in
    ``created_by_user_id`` and no personnel (decision 6) – what an editor files is a radio
    message they transcribed. A report the crew created is edited in place and keeps its
    ``submitted_by_personnel_id``; ``update_reko_report`` adds the operator as
    ``updated_by_user_id``.

    The row still gets a real form token: ``token`` is NOT NULL. It is never handed out.

    Raises:
        ValueError: If the incident does not exist
    """
    incident_id = await live_incident_id(db, incident_id)
    report = await _the_report(
        db,
        incident_id,
        lambda: RekoReport(
            incident_id=incident_id,
            token=generate_form_token(str(incident_id), "reko"),
            is_draft=True,
            created_by_user_id=user.id,
        ),
    )
    return report


async def update_reko_report(
    db: AsyncSession,
    report_id: uuid.UUID,
    update_data: schemas.RekoReportUpdate,
    *,
    author: RekoAuthor,
    submit: bool = False,
) -> tuple[RekoReport, bool]:
    """
    Update the Reko report (draft saves, the submission, every later edit).

    Args:
        db: Database session
        report_id: Report UUID
        update_data: Updated fields – only those set are written
        author: Who wrote it. A KP author stamps ``updated_by_user_id`` (+ its time) and
            nothing else, so a crew-filed report keeps its ``submitted_by_personnel_id``
            (§5.3). Every field that moved gets its Chronik row (`reko_history`).
        submit: If True, files a draft (no-op on a filed report). The filing names its
            author: ``submitted_by_user_id`` for the KP, ``submitted_by_personnel_id`` (when
            the link names a person) for the field – not whoever opened the draft (S4).

    Returns:
        The report, and whether THIS write filed it (draft → filed, read under the row
        lock) – the one write that rings the bell (`process_reko_submission`).

    Raises:
        ValueError: If report not found
    """
    # Read the latest JSON under the row lock before merging disjoint hazard/effort edits.
    result = await db.execute(
        select(RekoReport).where(RekoReport.id == report_id).with_for_update().execution_options(populate_existing=True)
    )
    report = result.scalar_one_or_none()

    if not report:
        raise ValueError("Report not found")

    before = reko_history.snapshot(report)

    # Update fields. Draft status is intentionally NOT settable via the update
    # body (defense in depth: the schema no longer has is_draft) — only the
    # explicit `submit` flag below may change it, so a stray draft-save can
    # never flip a submitted report back to draft.
    update_fields = update_data.model_dump(exclude_unset=True)
    update_fields.pop("is_draft", None)
    for field, value in update_fields.items():
        if field in {"dangers_json", "effort_json"} and isinstance(value, dict):
            value = {**(getattr(report, field) or {}), **value}
        setattr(report, field, value)

    now = datetime.now(UTC)
    # Mark as submitted if requested. The draft → filed step is the report's submission
    # time: the row was created when the form opened. A filed report keeps it.
    filed_now = submit and report.is_draft
    if filed_now:
        report.is_draft = False
        report.submitted_at = now
        report.submitted_by_user_id = author.user_id
        if author.personnel_id is not None:
            report.submitted_by_personnel_id = author.personnel_id

    if author.user_id is not None:
        report.updated_by_user_id = author.user_id
        report.updated_by_user_at = now

    report.updated_at = now

    await db.flush()
    await reko_history.record_changes(db, report, before, author, now=now)
    await db.refresh(report)

    return report, filed_now


async def get_incident_reko_reports(db: AsyncSession, incident_id: uuid.UUID) -> list[RekoReport]:
    """The incident's Reko report as a list – empty, or THE one (one per Einsatz).

    A list for the route that has always returned one (`GET /reko/incident/{id}/reports`).
    """
    result = await db.execute(
        select(RekoReport)
        .options(selectinload(RekoReport.submitted_by_personnel))
        .where(RekoReport.incident_id == incident_id)
        .order_by(RekoReport.submitted_at.desc())
    )
    return list(result.scalars().all())


async def mark_reko_arrived(
    db: AsyncSession,
    incident_id: uuid.UUID,
    token: str,
    personnel_id: uuid.UUID | None = None,
) -> RekoReport:
    """
    Mark reko personnel as arrived on site – on THE incident's report.

    Args:
        db: Database session
        incident_id: Incident UUID
        token: Form access token
        personnel_id: The person the link is bound to, if any (`get_or_create_reko_report`)

    Returns:
        Updated RekoReport instance

    Raises:
        ValueError: If token is invalid or incident not found
    """
    # Validate the token against the id it was minted for; the report is the one of the
    # card that id lives on now (R2 review) — the arrival and its bell belong there.
    report = await get_or_create_reko_report(db, incident_id, token, personnel_id)
    incident = await db.get(Incident, report.incident_id)
    if incident is None:
        raise ValueError("Incident not found")

    newly_arrived = report.arrived_at is None
    if newly_arrived:
        report.arrived_at = datetime.now(UTC)
        await db.flush()
        await db.refresh(report)

    # «Reko vor Ort» rings the bell — HERE, not in the API route, so every
    # token path notifies: the crew's tap on /reko AND the Übungssteuerung's
    # simulate step, which calls this function directly and used to arrive on
    # the board without a sound. Only on the FIRST arrival — the tap is
    # idempotent, and a re-tap is not a second crew. The KP's own radio entry
    # (`set_reko_arrived_by_user` below) stays deliberately silent.
    if newly_arrived and incident.event_id:
        from ..services.notification_service import create_reko_arrived_notification

        arrived_by_name = None
        if report.submitted_by_personnel_id:
            await db.refresh(report, ["submitted_by_personnel"])
            if report.submitted_by_personnel:
                arrived_by_name = report.submitted_by_personnel.name

        await create_reko_arrived_notification(
            db=db,
            incident_id=incident.id,
            event_id=incident.event_id,
            incident_title=incident.title or incident.location_address or "Unbekannt",
            arrived_by_name=arrived_by_name,
            incident_address=incident.location_address,
        )

    return report


async def set_reko_arrived_by_user(
    db: AsyncSession,
    incident_id: uuid.UUID,
    user: User,
    at: datetime | None,
    clear: bool,
) -> RekoReport | None:
    """ "Reko meldet: vor Ort" over the radio (plan 26 §5.2), on THE incident's report.

    The same column a crew's tap writes, so a board watching for the field's message cannot
    tell the difference in anything except the provenance line.

    ``clear=True`` wipes the arrival (a mis-heard call is corrected, not amended), and the
    user FK goes with it — an arrival nobody has reported is not a KP report.

    Otherwise it is idempotent the way the field tap is: an arrival already on the row stays
    where it is unless an explicit time is given, so a second radio confirmation does not
    move a timestamp the KP has already acted on.

    Returns the report carrying the arrival, or ``None`` when a clear found nothing to clear.

    Raises:
        ValueError: If the incident does not exist
    """
    if clear:
        report = await _locked_report(db, incident_id)
        if report is None or report.arrived_at is None:
            return None
        report.arrived_at = None
        report.arrived_reported_by_user_id = None
    else:
        report = await get_or_create_kp_reko_report(db, incident_id, user)
        if report.arrived_at is None or at is not None:
            report.arrived_at = at or datetime.now(UTC)
            report.arrived_reported_by_user_id = user.id

    await db.flush()
    await db.refresh(report)
    return report


async def get_reko_summaries_by_event(db: AsyncSession, event_id: uuid.UUID) -> dict[uuid.UUID, dict[str, Any]]:
    """
    Get reko summaries for all incidents in an event (bulk load).

    This is a performance optimization that fetches all reko data for an event
    in a single query instead of N separate queries (one per incident).

    Only returns the latest submitted (non-draft) report for each incident.

    Args:
        db: Database session
        event_id: Event UUID

    Returns:
        Dictionary mapping incident_id to reko summary dict
    """
    from sqlalchemy import func

    # Subquery to get the latest submitted report per incident
    # We want only non-draft reports, ordered by submission time
    latest_report_subquery = (
        select(
            RekoReport.incident_id,
            func.max(RekoReport.submitted_at).label("max_submitted_at"),
        )
        .where(RekoReport.is_draft == False)  # noqa: E712 - SQLAlchemy needs == not 'is'
        .group_by(RekoReport.incident_id)
        .subquery()
    )

    # Main query joining incidents with their latest reko reports
    result = await db.execute(
        select(
            Incident.id.label("incident_id"),
            RekoReport.id.label("report_id"),
            RekoReport.arrived_at,
            RekoReport.is_relevant,
            RekoReport.dangers_json,
            RekoReport.effort_json,
            RekoReport.summary_text,
            # The photos ride along in the bulk load: they are the part of the
            # Reko result a viewer screen most wants to see, and fetching them
            # per incident would undo the point of this query.
            RekoReport.photos_json,
            RekoReport.submitted_at,
            RekoReport.submitted_by_personnel_id,
        )
        .select_from(Incident)
        .outerjoin(
            latest_report_subquery,
            Incident.id == latest_report_subquery.c.incident_id,
        )
        .outerjoin(
            RekoReport,
            and_(
                RekoReport.incident_id == Incident.id,
                RekoReport.submitted_at == latest_report_subquery.c.max_submitted_at,
                RekoReport.is_draft == False,  # noqa: E712
            ),
        )
        .where(
            and_(
                Incident.event_id == event_id,
                Incident.deleted_at.is_(None),
            )
        )
    )
    rows = result.all()

    # Build personnel lookup for names (batch load)
    personnel_ids = {row.submitted_by_personnel_id for row in rows if row.submitted_by_personnel_id}
    personnel_names = {}
    if personnel_ids:
        from ..models import Personnel

        personnel_result = await db.execute(select(Personnel.id, Personnel.name).where(Personnel.id.in_(personnel_ids)))
        personnel_names = {row.id: row.name for row in personnel_result.all()}

    # Build response dictionary
    summaries = {}
    for row in rows:
        summaries[row.incident_id] = {
            "incident_id": row.incident_id,
            "has_completed_reko": row.report_id is not None,
            "arrived_at": row.arrived_at,
            "is_relevant": row.is_relevant,
            "dangers_json": row.dangers_json,
            "effort_json": row.effort_json,
            "summary_text": row.summary_text,
            "photos_json": row.photos_json or [],
            "submitted_at": row.submitted_at,
            "submitted_by_personnel_name": personnel_names.get(row.submitted_by_personnel_id)
            if row.submitted_by_personnel_id
            else None,
        }

    return summaries


async def escalate_for_dangers(db: AsyncSession, incident: Incident, report: RekoReport) -> bool:
    """Priority low → medium when a filed report names a danger. Returns whether it changed.

    Part of every filing (`process_reko_submission`), and of a board amendment of a filed
    report: «Ja» synced first and a danger ticked afterwards must escalate just the same (Sol
    review pass 5, S4). The status step and the bell stay with the filing. Never lowers.
    """
    dangers = report.dangers_json or {}
    has_danger = any(
        dangers.get(key) for key in ("fire", "explosion", "collapse", "chemical", "electrical", "fire_danger")
    )
    if not has_danger or incident.priority != "low":
        return False
    incident.priority = "medium"
    await db.flush()
    await db.refresh(incident)
    await db.refresh(report)
    return True


async def process_reko_submission(
    db: AsyncSession,
    incident: Incident,
    report: RekoReport,
) -> None:
    """
    Handle the side effects of filing the report – once, on its draft → filed step.

    Later edits of the filed report do not come here (no second bell, owner pick
    23.11.2026); they only escalate (`escalate_for_dangers`).

    - Auto-transition incident status reko → reko_done
    - Bump priority low → medium if dangers detected
    - Create reko notification

    The reko link is read/report-only: it never closes or otherwise mutates the
    incident beyond recording the report and the standard reko → reko_done step.
    Closing a not-relevant incident is an operator action on the board.

    Args:
        db: Database session
        incident: The incident the report belongs to
        report: The submitted reko report
    """
    from ..services.notification_service import create_reko_notification

    # Auto-transition reko → reko_done
    if incident.status == "reko":
        old_status = incident.status
        incident.status = "reko_done"
        transition = StatusTransition(
            incident_id=incident.id,
            from_status=old_status,
            to_status="reko_done",
            notes="Reko-Formular eingereicht",
        )
        db.add(transition)
        await db.flush()
        await db.refresh(incident)
        # The report may have been expired along with the card it moved onto (a
        # merge loads the card with its reports); reload it before reading on.
        await db.refresh(report)

    await escalate_for_dangers(db, incident, report)

    # Create notification
    if incident.event_id:
        submitted_by_name = None
        if report.submitted_by_personnel_id:
            await db.refresh(report, ["submitted_by_personnel"])
            if report.submitted_by_personnel:
                submitted_by_name = report.submitted_by_personnel.name

        # Keys, not labels: the bell names them in the operator's language, and the
        # German sentence maps them itself (`notification_params.DANGER_LABELS_DE`).
        from ..services.notification_params import DANGER_LABELS_DE

        dangers_found = report.dangers_json or {}
        danger_types = [key for key in DANGER_LABELS_DE if dangers_found.get(key)]

        personnel_count = None
        estimated_duration = None
        if report.effort_json:
            personnel_count = report.effort_json.get("personnel_count")
            estimated_duration = report.effort_json.get("estimated_duration_hours")

        await create_reko_notification(
            db=db,
            incident_id=incident.id,
            event_id=incident.event_id,
            incident_title=incident.title or incident.location_address or "Unbekannt",
            is_relevant=report.is_relevant if report.is_relevant is not None else True,
            submitted_by_name=submitted_by_name,
            incident_address=incident.location_address,
            danger_types=danger_types if danger_types else None,
            personnel_count=personnel_count,
            estimated_duration=estimated_duration,
        )
