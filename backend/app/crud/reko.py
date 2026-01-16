"""Reko form CRUD operations."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
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

    # Try to find existing report
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

    # Create new draft with personnel_id if provided
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
