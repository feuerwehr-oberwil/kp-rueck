"""Reko form CRUD operations."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import Incident, RekoReport, StatusTransition, User
from ..services.tokens import generate_form_token, validate_form_token


async def get_or_create_reko_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    token: str,
    personnel_id: uuid.UUID | None = None,
) -> RekoReport:
    """
    Get existing Reko report or create draft.

    Allows resuming forms (loads existing draft or submitted report).
    When creating a new draft, pre-fills with data from the latest submitted
    report of the incident (the "Ergänzung" workflow).

    The prefill is deliberately NOT filtered by person. Reports are keyed on
    the token, and every freshly minted link is a new token — so a filter on
    ``submitted_by_personnel_id`` meant any report whose author the row did not
    name was invisible to the next form: the training simulator's reports carry
    no personnel at all, and a direct link opened after the Übungssteuerung had
    already filed one landed on a blank page instead of the report it was sent
    to amend.

    Args:
        db: Database session
        incident_id: Incident UUID
        token: Form access token
        personnel_id: Optional personnel who is doing the reko

    Returns:
        RekoReport instance

    Raises:
        ValueError: If token is invalid or incident not found
    """
    # Validate token
    if not validate_form_token(token, str(incident_id)):
        raise ValueError("Invalid token")

    # Serialize prefill with photo unlinking for this incident. Otherwise a
    # draft can commit a copied filename after its last existing reference is deleted.
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id).with_for_update())
    if not incident_result.scalar_one_or_none():
        raise ValueError("Incident not found")

    # Try to find existing report with this token
    result = await db.execute(
        select(RekoReport).where(RekoReport.incident_id == incident_id, RekoReport.token == token)
    )
    report = result.scalar_one_or_none()

    if report:
        # Update personnel_id if provided and not already set
        if personnel_id and not report.submitted_by_personnel_id:
            report.submitted_by_personnel_id = personnel_id
            await db.commit()
            await db.refresh(report)
        return report

    # The latest submitted report of THIS incident, whoever filed it — the
    # prefill for the "Ergänzung" case (see the docstring for why the person
    # filter had to go).
    prev_result = await db.execute(
        select(RekoReport)
        .where(
            RekoReport.incident_id == incident_id,
            RekoReport.is_draft == False,  # noqa: E712
        )
        .order_by(RekoReport.submitted_at.desc())
        .limit(1)
    )
    previous_report = prev_result.scalar_one_or_none()

    # Create new draft, pre-filled with previous submission data if available
    if previous_report:
        report = RekoReport(
            incident_id=incident_id,
            token=token,
            is_draft=True,
            submitted_by_personnel_id=personnel_id,
            # Pre-fill from previous submission
            is_relevant=previous_report.is_relevant,
            dangers_json=previous_report.dangers_json,
            effort_json=previous_report.effort_json,
            power_supply=previous_report.power_supply,
            photos_json=previous_report.photos_json,
            summary_text=previous_report.summary_text,
            additional_notes=previous_report.additional_notes,
            # Carry the arrival over so a follow-up form doesn't offer
            # "Ich bin vor Ort" again (and re-ping the command post).
            arrived_at=previous_report.arrived_at,
        )
    else:
        report = RekoReport(
            incident_id=incident_id,
            token=token,
            is_draft=True,
            submitted_by_personnel_id=personnel_id,
        )

    db.add(report)
    await db.commit()
    await db.refresh(report)

    return report


async def get_or_create_kp_reko_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    user: User,
) -> RekoReport:
    """The board's door onto the same table (plan 26 §5.1).

    The token version above resolves the *reporting person* from the link; there
    is no link here, so there is nobody to resolve — the personnel FK stays NULL
    and the operator lands in ``created_by_user_id`` instead (decision 6). What
    an editor files is a radio message they transcribed, not a report they made
    in the field, and the outputs have to be able to say so.

    An operator's own unfinished draft is reused rather than stacked, so a form
    saved twice is one report; a crew's report is never taken over here — that is
    an amendment and goes through ``update_reko_report`` with the user, which
    keeps ``submitted_by_personnel_id`` and adds ``updated_by_user_id``.

    The row still gets a real form token: ``token`` is NOT NULL, it is what the
    field path keys on, and minting one keeps a KP report indistinguishable from
    a field one in every way except its provenance columns. It is never handed
    out — no link is generated from it.

    Raises:
        ValueError: If the incident does not exist
    """
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    if not incident_result.scalar_one_or_none():
        raise ValueError("Incident not found")

    existing = await db.execute(
        select(RekoReport)
        .where(
            RekoReport.incident_id == incident_id,
            RekoReport.created_by_user_id == user.id,
            RekoReport.is_draft == True,  # noqa: E712
        )
        .order_by(RekoReport.submitted_at.desc())
        .limit(1)
    )
    draft = existing.scalar_one_or_none()
    if draft:
        return draft

    report = RekoReport(
        incident_id=incident_id,
        token=generate_form_token(str(incident_id), "reko"),
        is_draft=True,
        created_by_user_id=user.id,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


async def update_reko_report(
    db: AsyncSession,
    report_id: uuid.UUID,
    update_data: schemas.RekoReportUpdate,
    submit: bool = False,
    user: User | None = None,
) -> RekoReport:
    """
    Update Reko report (supports both draft saves and final submission).

    Args:
        db: Database session
        report_id: Report UUID
        update_data: Updated fields
        submit: If True, marks as submitted (not draft)
        user: The operator, when the write came through the board rather than
            the form link. Stamps ``updated_by_user_id`` and nothing else — a
            crew-filed report keeps its ``submitted_by_personnel_id``, so an
            amended one carries both lines (§5.3).

    Returns:
        Updated RekoReport instance

    Raises:
        ValueError: If report not found
    """
    result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
    report = result.scalar_one_or_none()

    if not report:
        raise ValueError("Report not found")

    # Update fields. Draft status is intentionally NOT settable via the update
    # body (defense in depth: the schema no longer has is_draft) — only the
    # explicit `submit` flag below may change it, so a stray draft-save can
    # never flip a submitted report back to draft.
    update_fields = update_data.model_dump(exclude_unset=True)
    update_fields.pop("is_draft", None)
    for field, value in update_fields.items():
        setattr(report, field, value)

    # Mark as submitted if requested
    if submit:
        report.is_draft = False

    if user is not None:
        report.updated_by_user_id = user.id

    report.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(report)

    return report


async def get_incident_reko_reports(db: AsyncSession, incident_id: uuid.UUID) -> list[RekoReport]:
    """
    Get all Reko reports for an incident.

    Args:
        db: Database session
        incident_id: Incident UUID

    Returns:
        List of RekoReport instances ordered by submission time (newest first)
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
) -> RekoReport:
    """
    Mark reko personnel as arrived on site.

    Sets the arrived_at timestamp on the reko report.

    Args:
        db: Database session
        incident_id: Incident UUID
        token: Form access token

    Returns:
        Updated RekoReport instance

    Raises:
        ValueError: If token is invalid or incident not found
    """
    # Validate token
    if not validate_form_token(token, str(incident_id)):
        raise ValueError("Invalid token")

    # Check if incident exists
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = incident_result.scalar_one_or_none()
    if not incident:
        raise ValueError("Incident not found")

    # Try to find existing report with this token
    result = await db.execute(
        select(RekoReport).where(
            and_(
                RekoReport.incident_id == incident_id,
                RekoReport.token == token,
            )
        )
    )
    report = result.scalar_one_or_none()

    newly_arrived = False
    if not report:
        # Create new draft report with arrived_at
        report = RekoReport(
            incident_id=incident_id,
            token=token,
            is_draft=True,
            arrived_at=datetime.now(UTC),
        )
        db.add(report)
        newly_arrived = True
    else:
        # Update existing report with arrived_at if not already set
        if not report.arrived_at:
            report.arrived_at = datetime.now(UTC)
            newly_arrived = True

    await db.commit()
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
    """ "Reko meldet: vor Ort" over the radio (plan 26 §5.2).

    The same body as ``mark_reko_arrived`` above with the token lookup replaced:
    same column, same row, same report a crew would have written into — a board
    watching for the field's message must not be able to tell the difference in
    anything except the provenance line.

    ``clear=True`` wipes the arrival off *every* report of this incident, because
    the board reads the earliest one across them: leaving a second row's
    timestamp behind would make a corrected mis-hear reappear a second later.
    The user FK goes with it — an arrival nobody has reported is not a KP report.

    Otherwise it is idempotent the way the field tap is: an arrival already on
    the row stays where it is unless an explicit time is given, so a second radio
    confirmation does not move a timestamp the KP has already acted on.

    Returns the report carrying the arrival, or ``None`` when a clear found
    nothing to clear.

    Raises:
        ValueError: If the incident does not exist
    """
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    if not incident_result.scalar_one_or_none():
        raise ValueError("Incident not found")

    result = await db.execute(
        select(RekoReport).where(RekoReport.incident_id == incident_id).order_by(RekoReport.submitted_at.desc())
    )
    reports = list(result.scalars().all())

    if clear:
        cleared = None
        for report in reports:
            if report.arrived_at is not None:
                report.arrived_at = None
                cleared = report
            report.arrived_reported_by_user_id = None
        if cleared is None:
            return None
        await db.commit()
        await db.refresh(cleared)
        return cleared

    # Prefer the row that already carries an arrival, so a correction edits the
    # timestamp the board is showing rather than adding a second, earlier one.
    target = next((report for report in reports if report.arrived_at is not None), None)
    if target is None:
        target = next((report for report in reports if report.is_draft), None) or (reports[0] if reports else None)
    if target is None:
        target = RekoReport(
            incident_id=incident_id,
            token=generate_form_token(str(incident_id), "reko"),
            is_draft=True,
            created_by_user_id=user.id,
        )
        db.add(target)

    if target.arrived_at is None or at is not None:
        target.arrived_at = at or datetime.now(UTC)
        target.arrived_reported_by_user_id = user.id

    await db.commit()
    await db.refresh(target)
    return target


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
    from sqlalchemy import and_, func

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


async def process_reko_submission(
    db: AsyncSession,
    incident: Incident,
    report: RekoReport,
) -> None:
    """
    Handle post-submission side effects for a reko report.

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
        await db.commit()
        await db.refresh(incident)

    # Auto-bump priority from low → medium if any danger flags are set
    if report.dangers_json:
        dangers = report.dangers_json
        has_danger = any(
            [
                dangers.get("fire"),
                dangers.get("explosion"),
                dangers.get("collapse"),
                dangers.get("chemical"),
                dangers.get("electrical"),
                dangers.get("fire_danger"),
            ]
        )
        if has_danger and incident.priority == "low":
            incident.priority = "medium"
            await db.commit()
            await db.refresh(incident)

    # Create notification
    if incident.event_id:
        submitted_by_name = None
        if report.submitted_by_personnel_id:
            await db.refresh(report, ["submitted_by_personnel"])
            if report.submitted_by_personnel:
                submitted_by_name = report.submitted_by_personnel.name

        danger_types = []
        if report.dangers_json:
            d = report.dangers_json
            if d.get("fire"):
                danger_types.append("Feuer")
            if d.get("explosion"):
                danger_types.append("Explosion")
            if d.get("collapse"):
                danger_types.append("Einsturz")
            if d.get("chemical"):
                danger_types.append("Gefahrstoffe")
            if d.get("electrical"):
                danger_types.append("Elektrisch")
            if d.get("fire_danger"):
                danger_types.append("Brandgefahr")

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
