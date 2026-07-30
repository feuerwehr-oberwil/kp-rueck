"""Reko form API endpoints.

Field-crew form endpoints validate the per-incident form token; report
viewing/editing and link generation additionally accept cookie auth. Nothing
here is fully open: a leaked form link must not allow minting fresh tokens or
rewriting other incidents' recon reports.
"""

import uuid
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentUser, get_current_user
from ..config import settings
from ..crud import reko as crud
from ..database import get_db
from ..logging_config import get_logger
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Incident, RekoReport
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_incident_update, broadcast_reko_update

logger = get_logger(__name__)
from ..services.audit import log_action
from ..services.notification_service import create_reko_arrived_notification
from ..services.photo_storage import photo_storage
from ..services.tokens import generate_form_token, validate_form_token, validate_reko_dashboard_token

router = APIRouter(prefix="/reko", tags=["reko"])


async def _require_user_or_form_token(
    request: Request,
    incident_id: uuid.UUID,
    reko_token: str | None,
    access_token: str | None,
    authorization: str | None,
    db: AsyncSession,
) -> None:
    """Allow a valid reko form token for this incident OR any logged-in user.

    Field crews open reko links without an account; operators view/edit
    reports from the cookie-authenticated board. Raises 401 otherwise.
    """
    if reko_token and validate_form_token(reko_token, str(incident_id)):
        return
    await get_current_user(request, access_token, authorization, db)


@router.get("/form", response_model=schemas.RekoReportResponse)
async def get_reko_form(
    incident_id: uuid.UUID = Query(...),
    token: str = Query(...),
    personnel_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
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
            response_data.incident_contact = incident.contact
        # Include personnel name if available
        if report.submitted_by_personnel_id:
            # Reload with relationship to get name
            await db.refresh(report, ["submitted_by_personnel"])
            if report.submitted_by_personnel:
                response_data.submitted_by_personnel_name = report.submitted_by_personnel.name

        return response_data
    except ValueError as e:
        logger.warning("Reko form validation failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e


@router.post("/", response_model=schemas.RekoReportResponse)
async def submit_reko_report(
    report_data: schemas.RekoReportCreate,
    background_tasks: BackgroundTasks,
    submit: bool = Query(default=True, description="Mark as submitted (not draft)"),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
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
        response_data.incident_contact = incident.contact

    # Handle post-submission side effects (status transition, priority bump, notification)
    if submit and incident:
        await crud.process_reko_submission(db, incident, updated)
        # Broadcast incident update so other clients see reko completion and status change
        background_tasks.add_task(
            broadcast_incident_update,
            {"id": str(report_data.incident_id), "has_completed_reko": True},
            "update",
        )
        # Broadcast reko update for reko-specific listeners
        background_tasks.add_task(
            broadcast_reko_update,
            {"incident_id": str(report_data.incident_id)},
            "submit",
        )

    return response_data


@router.patch("/{report_id}", response_model=schemas.RekoReportResponse)
async def update_report(
    report_id: uuid.UUID,
    update_data: schemas.RekoReportUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    submit: bool = Query(default=False),
    x_reko_token: str | None = Header(None),
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
    """Update existing Reko report (e.g., add more photos after submission).

    Requires either the incident's form token (X-Reko-Token header) or a
    logged-in user — recon reports feed operator decisions and the printed
    slip, so they must not be rewritable by anyone who can reach the API.
    """
    result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
    existing = result.scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail=ErrorMessages.REPORT_NOT_FOUND)

    await _require_user_or_form_token(request, existing.incident_id, x_reko_token, access_token, authorization, db)

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
            response_data.incident_contact = incident.contact

        # Broadcast reko update
        if submit:
            background_tasks.add_task(
                broadcast_reko_update,
                {"incident_id": str(updated.incident_id)},
                "update",
            )

        return response_data
    except ValueError as e:
        logger.warning("Reko report update failed: %s", e)
        raise HTTPException(status_code=404, detail=ErrorMessages.REPORT_NOT_FOUND) from e


@router.get("/{report_id}", response_model=schemas.RekoReportResponse)
async def get_report(
    report_id: uuid.UUID,
    request: Request,
    token: str | None = Query(None),
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
    """Get Reko report by ID (for viewing on incident card).

    Requires either the incident's form token (?token=) or a logged-in user.
    """
    result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    await _require_user_or_form_token(request, report.incident_id, token, access_token, authorization, db)

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
        response_data.incident_contact = incident.contact

    return response_data


@router.get("/incident/{incident_id}/reports", response_model=list[schemas.RekoReportResponse])
async def get_incident_reports(
    incident_id: uuid.UUID,
    _current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[schemas.RekoReportResponse]:
    """Get all Reko reports for an incident (for incident detail view).

    Requires authentication — only called from the logged-in board UI.
    """
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
            response_data.incident_contact = incident.contact
        # Include personnel name if available
        if report.submitted_by_personnel:
            response_data.submitted_by_personnel_name = report.submitted_by_personnel.name
        response_list.append(response_data)

    return response_list


@router.post("/{incident_id}/arrived", response_model=schemas.RekoReportResponse)
async def mark_reko_arrived(
    incident_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
    """
    Mark Reko personnel as arrived on site.

    This creates a "ping" notification for the command post without
    requiring the full form to be filled out first.

    Query params:
        token: Form access token

    Returns the updated reko report with arrived_at timestamp.
    """
    try:
        report = await crud.mark_reko_arrived(db, incident_id, token)

        # Fetch incident for notification
        incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
        incident = incident_result.scalar_one_or_none()

        if incident and incident.event_id:
            # Get personnel name if available
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

        # Convert to response schema with incident details
        response_data = schemas.RekoReportResponse.model_validate(report)
        if incident:
            response_data.incident_title = incident.title
            response_data.incident_location = incident.location_address
            response_data.incident_type = incident.type
            response_data.incident_description = incident.description
            response_data.incident_contact = incident.contact

        # Broadcast incident update so other clients see "vor Ort" status
        background_tasks.add_task(
            broadcast_incident_update,
            {"id": str(incident_id), "reko_arrived_at": report.arrived_at.isoformat() if report.arrived_at else None},
            "update",
        )
        # Broadcast reko update for reko-specific listeners
        background_tasks.add_task(
            broadcast_reko_update,
            {"incident_id": str(incident_id)},
            "arrived",
        )

        return response_data
    except ValueError as e:
        logger.warning("Mark reko arrived failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e


@router.post("/generate-link", response_model=None)
async def generate_reko_link(
    request: Request,
    incident_id: uuid.UUID = Query(...),
    form_type: str = Query("reko"),
    personnel_id: uuid.UUID | None = Query(None),
    dashboard_token: str | None = Query(None),
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Generate Reko form link for an incident.

    Requires either an editor/admin login or a valid reko-dashboard link
    token whose event contains the incident (the dashboard runs on field
    phones without an account). A leaked form link must NOT allow minting
    fresh tokens for arbitrary incidents.

    Args:
        incident_id: The incident this reko is for
        form_type: Type of form (default: reko)
        personnel_id: Optional personnel who will do the reko
        dashboard_token: Event-scoped reko-dashboard token (alternative to login)

    Returns shareable link with token.
    """
    authorized = False
    if dashboard_token:
        event_id = validate_reko_dashboard_token(dashboard_token)
        if event_id is not None:
            incident = await db.get(Incident, incident_id)
            authorized = incident is not None and incident.event_id == event_id
    if not authorized:
        user = await get_current_user(request, access_token, authorization, db)
        if user.role not in ("editor", "admin"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor-Berechtigung erforderlich")

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
) -> schemas.EventRekoSummariesResponse:
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
        # Plain dicts; pydantic builds the RekoSummary models from them.
        summaries=summaries_str_keys,  # type: ignore[arg-type]
        total=len(summaries),
    )


# ============================================
# Photo Upload Endpoints
# ============================================


@router.post("/{incident_id}/photos", response_model=None)
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def upload_photo(
    request: Request,
    incident_id: uuid.UUID,
    file: UploadFile = File(...),
    x_reko_token: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
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

    # Demo mode: limit file size to 1MB and total photos to 15
    if settings.demo_mode:
        # Check file size (read first chunk to estimate)
        contents = await file.read()
        if len(contents) > 1 * 1024 * 1024:  # 1MB
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo-Modus: Maximale Dateigrösse 1MB.",
            )
        # Reset file position for photo_storage
        await file.seek(0)

        # Count total photos across all reports
        total_photos_result = await db.execute(
            select(sa_func.coalesce(sa_func.array_length(RekoReport.photos_json, 1), 0))
        )
        total_photos = sum(r[0] for r in total_photos_result)
        if total_photos >= 15:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo-Modus: Maximale Anzahl Fotos (15) erreicht.",
            )

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
    report.photos_json = [*current_photos, filename]
    await db.commit()

    return {"filename": filename}


@router.delete("/{incident_id}/photos/{filename}", response_model=None)
async def delete_photo(
    incident_id: uuid.UUID,
    filename: str,
    x_reko_token: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
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
) -> FileResponse:
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
