"""Reko form API endpoints (no authentication required)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..crud import reko as crud
from ..database import get_db
from ..models import RekoReport
from ..services.tokens import generate_form_token, validate_form_token

router = APIRouter(prefix="/reko", tags=["reko"])


@router.get("/form")
async def get_reko_form(
    incident_id: uuid.UUID = Query(...),
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Load Reko form (existing draft or new).

    No authentication required - uses token validation.

    Query params:
        incident_id: UUID of incident
        token: Form access token

    Returns existing draft or creates new one.
    """
    try:
        report = await crud.get_or_create_reko_report(db, incident_id, token)
        return report
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/", response_model=schemas.RekoReportResponse)
async def submit_reko_report(
    report_data: schemas.RekoReportCreate,
    submit: bool = Query(default=True, description="Mark as submitted (not draft)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit or update Reko report.

    Use submit=false for draft saves (auto-save).
    Use submit=true for final submission.
    """
    # Validate token
    if not validate_form_token(report_data.token, str(report_data.incident_id)):
        raise HTTPException(status_code=400, detail="Invalid token")

    # Get or create report
    report = await crud.get_or_create_reko_report(
        db, report_data.incident_id, report_data.token
    )

    # Update with new data
    update_data = schemas.RekoReportUpdate(**report_data.model_dump(exclude={'incident_id', 'token'}))
    updated = await crud.update_reko_report(db, report.id, update_data, submit=submit)

    return updated


@router.patch("/{report_id}", response_model=schemas.RekoReportResponse)
async def update_report(
    report_id: uuid.UUID,
    update_data: schemas.RekoReportUpdate,
    submit: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """Update existing Reko report (e.g., add more photos after submission)."""
    try:
        updated = await crud.update_reko_report(db, report_id, update_data, submit=submit)
        return updated
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{report_id}", response_model=schemas.RekoReportResponse)
async def get_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get Reko report by ID (for viewing on incident card)."""
    result = await db.execute(
        select(RekoReport).where(RekoReport.id == report_id)
    )
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    return report


@router.get("/incident/{incident_id}/reports", response_model=list[schemas.RekoReportResponse])
async def get_incident_reports(
    incident_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get all Reko reports for an incident (for incident detail view)."""
    return await crud.get_incident_reko_reports(db, incident_id)


@router.post("/generate-link")
async def generate_reko_link(
    incident_id: uuid.UUID,
    form_type: str = "reko",
):
    """
    Generate Reko form link for an incident (editor-only in practice).

    Returns shareable link with token.
    """
    token = generate_form_token(str(incident_id), form_type)
    link = f"/reko?incident_id={incident_id}&token={token}"

    return {
        "incident_id": incident_id,
        "token": token,
        "link": link,
        "qr_code_url": f"/api/qr?data={link}",  # Future: QR code generation
    }
