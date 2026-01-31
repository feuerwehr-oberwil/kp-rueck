"""Reko form CRUD operations."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..models import Incident, RekoReport
from ..services.tokens import validate_form_token


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
    report by this personnel (for "Ergänzung" workflow).

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

    # Check if incident exists
    result = await db.execute(select(Incident).where(Incident.id == incident_id))
    if not result.scalar_one_or_none():
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

    # Check for existing submitted report by this personnel to pre-fill from
    previous_report = None
    if personnel_id:
        prev_result = await db.execute(
            select(RekoReport)
            .where(
                RekoReport.incident_id == incident_id,
                RekoReport.submitted_by_personnel_id == personnel_id,
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


async def update_reko_report(
    db: AsyncSession,
    report_id: uuid.UUID,
    update_data: schemas.RekoReportUpdate,
    submit: bool = False,
) -> RekoReport:
    """
    Update Reko report (supports both draft saves and final submission).

    Args:
        db: Database session
        report_id: Report UUID
        update_data: Updated fields
        submit: If True, marks as submitted (not draft)

    Returns:
        Updated RekoReport instance

    Raises:
        ValueError: If report not found
    """
    result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
    report = result.scalar_one_or_none()

    if not report:
        raise ValueError("Report not found")

    # Update fields
    for field, value in update_data.model_dump(exclude_unset=True).items():
        setattr(report, field, value)

    # Mark as submitted if requested
    if submit:
        report.is_draft = False

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
    if not incident_result.scalar_one_or_none():
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

    if not report:
        # Create new draft report with arrived_at
        report = RekoReport(
            incident_id=incident_id,
            token=token,
            is_draft=True,
            arrived_at=datetime.now(UTC),
        )
        db.add(report)
    else:
        # Update existing report with arrived_at if not already set
        if not report.arrived_at:
            report.arrived_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(report)

    return report


async def get_reko_summaries_by_event(
    db: AsyncSession, event_id: uuid.UUID
) -> dict[uuid.UUID, dict]:
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

        personnel_result = await db.execute(
            select(Personnel.id, Personnel.name).where(Personnel.id.in_(personnel_ids))
        )
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
            "submitted_at": row.submitted_at,
            "submitted_by_personnel_name": personnel_names.get(row.submitted_by_personnel_id)
            if row.submitted_by_personnel_id
            else None,
        }

    return summaries
