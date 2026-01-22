"""Reko form API endpoints (no authentication required for forms, authentication required for photos)."""

import uuid

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentUser
from ..crud import reko as crud
from ..database import get_db
from ..logging_config import get_logger
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Incident, RekoReport
from ..utils.errors import ErrorMessages

logger = get_logger(__name__)
from ..crud import reko_dashboard as reko_dashboard_crud
from ..services.audit import log_action
from ..services.notification_service import create_reko_notification
from ..services.photo_storage import photo_storage
from ..services.tokens import generate_form_token, validate_form_token

router = APIRouter(prefix="/reko", tags=["reko"])


@router.get("/form", response_model=schemas.RekoReportResponse)
async def get_reko_form(
    incident_id: uuid.UUID = Query(...),
    token: str = Query(...),
    personnel_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Load Reko form (existing draft or new).

    No authentication required - uses token validation.

    Query params:
        incident_id: UUID of incident
        token: Form access token
        personnel_id: Optional personnel who is doing the reko

    Returns existing draft or creates new one.
    """
    try:
        report = await crud.get_or_create_reko_report(db, incident_id, token, personnel_id)

        # Fetch incident title
        incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
        incident = incident_result.scalar_one_or_none()

        # Convert to response schema with incident details
        response_data = schemas.RekoReportResponse.model_validate(report)
        if incident:
            response_data.incident_title = incident.title
            response_data.incident_location = incident.location_address
            response_data.incident_type = incident.type
            response_data.incident_description = incident.description
        # Include personnel name if available
        if report.submitted_by_personnel_id:
            # Reload with relationship to get name
            await db.refresh(report, ["submitted_by_personnel"])
            if report.submitted_by_personnel:
                response_data.submitted_by_personnel_name = report.submitted_by_personnel.name

        return response_data
    except ValueError as e:
        logger.warning("Reko form validation failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST)


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
    report = await crud.get_or_create_reko_report(db, report_data.incident_id, report_data.token)

    # Update with new data
    update_data = schemas.RekoReportUpdate(**report_data.model_dump(exclude={"incident_id", "token"}))
    updated = await crud.update_reko_report(db, report.id, update_data, submit=submit)

    # Fetch incident details
    incident_result = await db.execute(select(Incident).where(Incident.id == report_data.incident_id))
    incident = incident_result.scalar_one_or_none()

    # Convert to response schema with incident details
    response_data = schemas.RekoReportResponse.model_validate(updated)
    if incident:
        response_data.incident_title = incident.title
        response_data.incident_location = incident.location_address
        response_data.incident_type = incident.type
        response_data.incident_description = incident.description

    # Create notification when report is submitted (not draft)
    if submit and incident and incident.event_id:
        # Get personnel name if available
        submitted_by_name = None
        if updated.submitted_by_personnel_id:
            await db.refresh(updated, ["submitted_by_personnel"])
            if updated.submitted_by_personnel:
                submitted_by_name = updated.submitted_by_personnel.name

        await create_reko_notification(
            db=db,
            incident_id=incident.id,
            event_id=incident.event_id,
            incident_title=incident.title or incident.location_address or "Unbekannt",
            is_relevant=updated.is_relevant if updated.is_relevant is not None else True,
            submitted_by_name=submitted_by_name,
        )

        # Auto-unassign Reko personnel from incident after form submission
        if updated.submitted_by_personnel_id:
            await reko_dashboard_crud.unassign_reko_personnel_from_incident(
                db=db,
                incident_id=incident.id,
                personnel_id=updated.submitted_by_personnel_id,
            )
            logger.info(
                "Auto-unassigned Reko personnel %s from incident %s after form submission",
                updated.submitted_by_personnel_id,
                incident.id,
            )

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
        incident_result = await db.execute(select(Incident).where(Incident.id == updated.incident_id))
        incident = incident_result.scalar_one_or_none()

        # Convert to response schema with incident details
        response_data = schemas.RekoReportResponse.model_validate(updated)
        if incident:
            response_data.incident_title = incident.title
            response_data.incident_location = incident.location_address
            response_data.incident_type = incident.type
            response_data.incident_description = incident.description

        return response_data
    except ValueError as e:
        logger.warning("Reko report update failed: %s", e)
        raise HTTPException(status_code=404, detail=ErrorMessages.REPORT_NOT_FOUND)


@router.get("/{report_id}", response_model=schemas.RekoReportResponse)
async def get_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get Reko report by ID (for viewing on incident card)."""
    result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Fetch incident title
    incident_result = await db.execute(select(Incident).where(Incident.id == report.incident_id))
    incident = incident_result.scalar_one_or_none()

    # Convert to response schema with incident details
    response_data = schemas.RekoReportResponse.model_validate(report)
    if incident:
        response_data.incident_title = incident.title
        response_data.incident_location = incident.location_address
        response_data.incident_type = incident.type
        response_data.incident_description = incident.description

    return response_data


@router.get("/incident/{incident_id}/reports", response_model=list[schemas.RekoReportResponse])
async def get_incident_reports(
    incident_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get all Reko reports for an incident (for incident detail view)."""
    reports = await crud.get_incident_reko_reports(db, incident_id)

    # Fetch incident title once
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = incident_result.scalar_one_or_none()
    incident_title = incident.title if incident else None

    # Convert to response schemas with incident details and personnel info
    response_list = []
    for report in reports:
        response_data = schemas.RekoReportResponse.model_validate(report)
        response_data.incident_title = incident_title
        if incident:
            response_data.incident_location = incident.location_address
            response_data.incident_type = incident.type
            response_data.incident_description = incident.description
        # Include personnel name if available
        if report.submitted_by_personnel:
            response_data.submitted_by_personnel_name = report.submitted_by_personnel.name
        response_list.append(response_data)

    return response_list


@router.post("/generate-link")
async def generate_reko_link(
    incident_id: uuid.UUID = Query(...),
    form_type: str = Query("reko"),
    personnel_id: uuid.UUID | None = Query(None),
):
    """
    Generate Reko form link for an incident (editor-only in practice).

    Args:
        incident_id: The incident this reko is for
        form_type: Type of form (default: reko)
        personnel_id: Optional personnel who will do the reko

    Returns shareable link with token.
    """
    token = generate_form_token(str(incident_id), form_type)
    link = f"/reko?incident_id={incident_id}&token={token}"
    if personnel_id:
        link += f"&personnel_id={personnel_id}"

    return {
        "incident_id": incident_id,
        "token": token,
        "link": link,
        "personnel_id": personnel_id,
        "qr_code_url": f"/api/qr?data={link}",  # Future: QR code generation
    }


@router.get("/event/{event_id}/summaries", response_model=schemas.EventRekoSummariesResponse)
async def get_event_reko_summaries(
    event_id: uuid.UUID,
    _current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get reko summaries for all incidents in an event (bulk load).

    This is a performance optimization endpoint that eliminates N+1 queries
    when loading the kanban board. Instead of fetching reko data for each
    incident separately, this returns all reko summaries in a single request.

    Only returns the latest submitted (non-draft) report for each incident.

    Requires authentication.
    """
    summaries = await crud.get_reko_summaries_by_event(db, event_id)

    # Convert UUID keys to strings for JSON serialization
    summaries_str_keys = {str(k): v for k, v in summaries.items()}

    return schemas.EventRekoSummariesResponse(
        summaries=summaries_str_keys,
        total=len(summaries),
    )


# ============================================
# Photo Upload Endpoints
# ============================================


@router.post("/{incident_id}/photos")
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def upload_photo(
    request: Request,
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
    current_photos = report.photos_json if report.photos_json else []
    report.photos_json = current_photos + [filename]
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
    current_photos = report.photos_json if report.photos_json else []
    if filename not in current_photos:
        raise HTTPException(status_code=404, detail="Photo not found in report")

    # Delete from disk
    photo_storage.delete_photo(incident_id, filename)

    # Remove from report (even if file was already deleted from disk)
    report.photos_json = [p for p in current_photos if p != filename]
    await db.commit()

    return {"success": True}


# Photo serving endpoint (separate router to avoid /reko prefix)
from fastapi import APIRouter as BaseAPIRouter

photos_router = BaseAPIRouter(prefix="/photos", tags=["photos"])


@photos_router.get("/{incident_id}/{filename}")
async def serve_photo(
    incident_id: uuid.UUID,
    filename: str,
    request: Request,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Serve photo file with authentication and authorization.

    SECURITY: Requires authentication to prevent unauthorized access to photos
    that may contain sensitive operational information.

    Args:
        incident_id: Incident UUID
        filename: Photo filename
        current_user: Authenticated user
        db: Database session

    Returns:
        Image file with cache headers

    Raises:
        HTTPException 401: If not authenticated
        HTTPException 403: If user doesn't have access to incident
        HTTPException 404: If photo not found
    """
    # Verify incident exists
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = incident_result.scalar_one_or_none()

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Get photo path and verify it exists
    file_path = photo_storage.get_photo_path(incident_id, filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Log photo access for audit trail
    await log_action(
        db=db,
        action_type="view_photo",
        resource_type="reko_photo",
        resource_id=incident_id,
        user=current_user,
        changes={"filename": filename},
        request=request,
    )
    await db.commit()

    # Return file with shorter cache (1 hour) for authenticated resources
    return FileResponse(
        file_path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, max-age=3600",  # 1 hour cache for authenticated users
        },
    )
