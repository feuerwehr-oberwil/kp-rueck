"""Reko form API endpoints (no authentication required)."""
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import schemas
from ..crud import reko as crud
from ..database import get_db
from ..models import RekoReport, Incident
from ..services.tokens import generate_form_token, validate_form_token
from ..services.photo_storage import photo_storage

router = APIRouter(prefix="/reko", tags=["reko"])


@router.get("/form", response_model=schemas.RekoReportResponse)
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

        # Fetch incident title
        incident_result = await db.execute(
            select(Incident).where(Incident.id == incident_id)
        )
        incident = incident_result.scalar_one_or_none()

        # Convert to response schema with incident_title
        response_data = schemas.RekoReportResponse.model_validate(report)
        if incident:
            response_data.incident_title = incident.title

        return response_data
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

    # Fetch incident title
    incident_result = await db.execute(
        select(Incident).where(Incident.id == report_data.incident_id)
    )
    incident = incident_result.scalar_one_or_none()

    # Convert to response schema with incident_title
    response_data = schemas.RekoReportResponse.model_validate(updated)
    if incident:
        response_data.incident_title = incident.title

    return response_data


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

        # Fetch incident title
        incident_result = await db.execute(
            select(Incident).where(Incident.id == updated.incident_id)
        )
        incident = incident_result.scalar_one_or_none()

        # Convert to response schema with incident_title
        response_data = schemas.RekoReportResponse.model_validate(updated)
        if incident:
            response_data.incident_title = incident.title

        return response_data
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

    # Fetch incident title
    incident_result = await db.execute(
        select(Incident).where(Incident.id == report.incident_id)
    )
    incident = incident_result.scalar_one_or_none()

    # Convert to response schema with incident_title
    response_data = schemas.RekoReportResponse.model_validate(report)
    if incident:
        response_data.incident_title = incident.title

    return response_data


@router.get("/incident/{incident_id}/reports", response_model=list[schemas.RekoReportResponse])
async def get_incident_reports(
    incident_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get all Reko reports for an incident (for incident detail view)."""
    reports = await crud.get_incident_reko_reports(db, incident_id)

    # Fetch incident title once
    incident_result = await db.execute(
        select(Incident).where(Incident.id == incident_id)
    )
    incident = incident_result.scalar_one_or_none()
    incident_title = incident.title if incident else None

    # Convert to response schemas with incident_title
    response_list = []
    for report in reports:
        response_data = schemas.RekoReportResponse.model_validate(report)
        response_data.incident_title = incident_title
        response_list.append(response_data)

    return response_list


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


# ============================================
# Photo Upload Endpoints
# ============================================


@router.post("/{incident_id}/photos")
async def upload_photo(
    incident_id: uuid.UUID,
    file: UploadFile = File(...),
    x_reko_token: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload photo to Reko report.

    Requires X-Reko-Token header for authentication.
    Photos are compressed, resized, and stored as JPEG files.

    Args:
        incident_id: Incident UUID
        file: Uploaded image file
        x_reko_token: Form access token (from header)
        db: Database session

    Returns:
        { "filename": "uuid.jpg" }
    """
    # Validate token
    if not validate_form_token(x_reko_token, str(incident_id)):
        raise HTTPException(status_code=400, detail="Invalid token")

    # Get or create report
    report = await crud.get_or_create_reko_report(db, incident_id, x_reko_token)

    # Save photo
    filename = await photo_storage.save_photo(
        incident_id=incident_id,
        file=file,
        current_photos=report.photos_json,
    )

    # Update report with new photo
    report.photos_json = report.photos_json + [filename]
    await db.commit()

    return {"filename": filename}


@router.delete("/{incident_id}/photos/{filename}")
async def delete_photo(
    incident_id: uuid.UUID,
    filename: str,
    x_reko_token: str = Header(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete photo from Reko report.

    Requires X-Reko-Token header for authentication.

    Args:
        incident_id: Incident UUID
        filename: Photo filename to delete
        x_reko_token: Form access token (from header)
        db: Database session

    Returns:
        { "success": true }
    """
    # Validate token
    if not validate_form_token(x_reko_token, str(incident_id)):
        raise HTTPException(status_code=400, detail="Invalid token")

    # Get report
    report = await crud.get_or_create_reko_report(db, incident_id, x_reko_token)

    # Check if photo exists in report
    if filename not in report.photos_json:
        raise HTTPException(status_code=404, detail="Photo not found in report")

    # Delete from disk
    deleted = photo_storage.delete_photo(incident_id, filename)

    # Remove from report (even if file was already deleted from disk)
    report.photos_json = [p for p in report.photos_json if p != filename]
    await db.commit()

    return {"success": True}


# Photo serving endpoint (separate router to avoid /reko prefix)
from fastapi import APIRouter as BaseAPIRouter
photos_router = BaseAPIRouter(prefix="/photos", tags=["photos"])


@photos_router.get("/{incident_id}/{filename}")
async def serve_photo(
    incident_id: uuid.UUID,
    filename: str,
):
    """
    Serve photo file.

    No authentication required - photos are public once uploaded.
    Returns image with cache headers for performance.

    Args:
        incident_id: Incident UUID
        filename: Photo filename

    Returns:
        Image file with cache headers
    """
    file_path = photo_storage.get_photo_path(incident_id, filename)

    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")

    return FileResponse(
        file_path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",  # Cache for 1 year
        }
    )
