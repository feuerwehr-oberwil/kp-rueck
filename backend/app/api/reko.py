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
from ..auth.dependencies import CurrentEditor, CurrentUser, get_current_user
from ..config import settings
from ..crud import incidents as incidents_crud
from ..crud import reko as crud
from ..crud import reko_assignment as reko_assign_crud
from ..database import get_db
from ..logging_config import get_logger
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Incident, IncidentAssignment, RekoReport, User
from ..utils.errors import ErrorMessages
from ..websocket_manager import (
    broadcast_assignment_update,
    broadcast_incident_update,
    broadcast_reko_update,
)

logger = get_logger(__name__)
from ..services.audit import log_action
from ..services.photo_storage import photo_storage
from ..services.tokens import (
    generate_feld_token,
    generate_form_token,
    validate_form_token,
    validate_viewer_token,
)

router = APIRouter(prefix="/reko", tags=["reko"])


async def _require_user_or_form_token(
    request: Request,
    incident_id: uuid.UUID,
    reko_token: str | None,
    access_token: str | None,
    authorization: str | None,
    db: AsyncSession,
) -> User | None:
    """Allow a valid reko form token for this incident OR any logged-in user.

    Field crews open reko links without an account; operators view/edit
    reports from the cookie-authenticated board. Raises 401 otherwise.

    Returns the user when the *session* opened the door and ``None`` when the
    token did — which is the provenance question itself, answered once at the
    door instead of re-derived by every handler (plan 26 §5.1).
    """
    if reko_token and validate_form_token(reko_token, str(incident_id)):
        return None
    return await get_current_user(request, access_token, authorization, db)


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
    request: Request,
    submit: bool = Query(default=True, description="Mark as submitted (not draft)"),
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
    """
    Submit or update Reko report.

    Use submit=false for draft saves (auto-save).
    Use submit=true for final submission.

    **One route, two doors** (plan 26 §5.1, decision 11). A field crew sends the
    incident's form token; the board sends none and is identified by its session.
    The alternative — a `…-by-editor` twin — would be two handlers that have to
    be kept in step forever, which is the drift this is here to prevent. Neither
    a token nor a session is still a 401.

    A token that is *present but wrong* stays a 400 no matter who is logged in,
    exactly as before: a leaked link must not become a way to write into another
    incident, and that guarantee has to survive the auth change.
    """
    field_token = report_data.token
    if field_token is not None and not validate_form_token(field_token, str(report_data.incident_id)):
        raise HTTPException(status_code=400, detail="Invalid token")

    user = await _require_user_or_form_token(
        request, report_data.incident_id, field_token, access_token, authorization, db
    )

    # Get or create report. The token resolves the reporting *person*; the board
    # has no such person to resolve, so `submitted_by_personnel_id` stays NULL and
    # the operator lands in `created_by_user_id` instead (decision 6).
    try:
        if user is not None:
            report = await crud.get_or_create_kp_reko_report(db, report_data.incident_id, user)
        elif field_token is not None:
            report = await crud.get_or_create_reko_report(db, report_data.incident_id, field_token)
        else:
            # Unreachable — the helper returns None only when a token opened the
            # door — but it is what narrows the token for the type checker.
            raise HTTPException(status_code=401, detail=ErrorMessages.INVALID_REQUEST)
    except ValueError as e:
        logger.warning("Reko report creation failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e

    # Update with new data
    update_data = schemas.RekoReportUpdate(**report_data.model_dump(exclude={"incident_id", "token"}))
    updated = await crud.update_reko_report(db, report.id, update_data, submit=submit, user=user)

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

    This is how the KP amends a crew-filed report (plan 26 §5.1): what came in
    over the radio afterwards is added to the same row instead of filing a second
    one, and the report then carries **both** provenance sides —
    ``submitted_by_personnel_id`` from the crew, ``updated_by_user_id`` from the
    operator — which is what a mixed report has to be able to print.
    """
    result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
    existing = result.scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail=ErrorMessages.REPORT_NOT_FOUND)

    user = await _require_user_or_form_token(
        request, existing.incident_id, x_reko_token, access_token, authorization, db
    )

    try:
        updated = await crud.update_reko_report(db, report_id, update_data, submit=submit, user=user)

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

        # The «Reko vor Ort» notification is raised inside `crud.mark_reko_arrived`
        # (first arrival only), so the Übungssteuerung's simulate path — which
        # calls the CRUD function directly — rings the same bell as this route.

        # Fetch incident for the response details
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
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Generate the direct Reko link for an incident (editor/admin only).

    **With a `personnel_id` this is a `/feld` link, not a bare form link.** The
    link the KP sends the Reko person carries a *bound* feld token — the same
    strength the code exchange mints (plan 26, decision 18) — plus the incident
    as a deep link. Opening it lands the person on the field surface already
    authenticated as themselves, and `/feld` routes a Reko auftrag straight
    into the form. No code entry, no picker, and the Rapport/Meldung machinery
    is one tap away instead of on "a separate page".

    The bound token is shorter-lived than the poster's (72 h vs 30 days): it is
    a personal credential travelling through a messenger, and the person can
    always re-enter through the poster QR once it expires. It is backed by a
    device claim, so "alle Geräte abmelden" recalls it like any other device.

    Without a `personnel_id` (no Reko assigned) the old per-incident `/reko`
    form link is returned unchanged.
    """
    # The `/reko-dashboard` door is gone with the page (plan 26, decision 24).
    # The field surface mints its own form token through `/feld` after running
    # its two-step, so this route is the board's alone again.
    user = await get_current_user(request, access_token, authorization, db)
    if user.role not in ("editor", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor-Berechtigung erforderlich")

    incident = (await db.execute(select(Incident).where(Incident.id == incident_id))).scalar_one_or_none()
    if incident is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.INVALID_REQUEST)

    if personnel_id is not None and incident.event_id is not None:
        # Imported here to keep the reko router free of a module-level feld
        # dependency — the two doors stay strangers except for this mint.
        from ..crud import feld as feld_crud

        claim = await feld_crud.create_claim(db, incident.event_id, personnel_id)
        token = generate_feld_token(
            incident.event_id,
            personnel_id=personnel_id,
            unlocked=True,
            claim_id=claim.id,
            expires_hours=72,
        )
        link = f"/feld?token={token}&incident_id={incident_id}"
        return {
            "incident_id": incident_id,
            "token": token,
            "link": link,
            "personnel_id": personnel_id,
            "qr_code_url": f"/api/qr?data={link}",
        }

    token = generate_form_token(str(incident_id), form_type)
    link = f"/reko?incident_id={incident_id}&token={token}"

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


async def _photo_report(
    db: AsyncSession,
    incident_id: uuid.UUID,
    user: User | None,
    field_token: str | None,
    report_id: uuid.UUID | None,
) -> RekoReport:
    """Which report a photo attaches to, for whichever door it came through.

    * **Field crew** (token): the report that token owns, as before.
    * **KP, amending** (session + ``report_id``): straight onto that report — the
      operator is adding to a report that already exists, and parking the photo
      in a side draft would leave it invisible in the one place it belongs.
    * **KP, creating** (session, no ``report_id``): the operator's own draft, the
      same row ``POST /api/reko/`` submits a moment later. So a photo dropped in
      while the form is still open survives the save.
    """
    if user is not None:
        if report_id is not None:
            result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
            report = result.scalar_one_or_none()
            # A report id from another incident must not become a way to write
            # into that incident's report.
            if not report or report.incident_id != incident_id:
                raise HTTPException(status_code=404, detail=ErrorMessages.REPORT_NOT_FOUND)
            return report
        return await crud.get_or_create_kp_reko_report(db, incident_id, user)
    if field_token is None:
        # Unreachable: the door helper returns None only for a valid token.
        raise HTTPException(status_code=401, detail=ErrorMessages.INVALID_REQUEST)
    return await crud.get_or_create_reko_report(db, incident_id, field_token)


@router.post("/{incident_id}/photos", response_model=None)
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def upload_photo(
    request: Request,
    incident_id: uuid.UUID,
    file: UploadFile = File(...),
    x_reko_token: str | None = Header(None),
    report_id: uuid.UUID | None = Query(
        None,
        description="Session door only: attach to this existing report instead of the operator's draft.",
    ),
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """
    Upload photo to Reko report.

    **One route, two doors**, the same shape `POST /api/reko/` has: a field crew
    sends the incident's form token, the board sends none and is identified by
    its session. The board door is the WhatsApp case — the crew has no signal at
    the Schadenplatz and sends the picture over whatever channel works, so the
    operator has to be able to attach it to the report they are transcribing.

    Photos are compressed, resized, and stored as JPEG files.

    Args:
        incident_id: Incident UUID
        file: Uploaded image file
        x_reko_token: Form access token (from header), for the field door
        report_id: The report to attach to, for the board door when amending
        db: Database session

    Returns:
        { "filename": "uuid.jpg" }
    """
    # A token that is present but wrong stays a 400 whoever is logged in: a
    # leaked link must not become a way to write into another incident.
    if x_reko_token is not None and not validate_form_token(x_reko_token, str(incident_id)):
        raise HTTPException(status_code=400, detail="Invalid token")

    user = await _require_user_or_form_token(request, incident_id, x_reko_token, access_token, authorization, db)

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

    try:
        report = await _photo_report(db, incident_id, user, x_reko_token, report_id)
    except ValueError as e:
        logger.warning("Reko photo upload failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e

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
    request: Request,
    incident_id: uuid.UUID,
    filename: str,
    x_reko_token: str | None = Header(None),
    report_id: uuid.UUID | None = Query(
        None,
        description="Session door only: the report the photo hangs on, when amending an existing one.",
    ),
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """
    Delete photo from Reko report.

    Same two doors as the upload: the incident's form token, or a session.

    Args:
        incident_id: Incident UUID
        filename: Photo filename to delete
        x_reko_token: Form access token (from header), for the field door
        report_id: The report the photo hangs on, for the board door when amending
        db: Database session

    Returns:
        { "success": true }
    """
    if x_reko_token is not None and not validate_form_token(x_reko_token, str(incident_id)):
        raise HTTPException(status_code=400, detail="Invalid token")

    user = await _require_user_or_form_token(request, incident_id, x_reko_token, access_token, authorization, db)

    try:
        report = await _photo_report(db, incident_id, user, x_reko_token, report_id)
    except ValueError as e:
        logger.warning("Reko photo delete failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e

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


async def _viewer_token_may_see_photo(
    db: AsyncSession,
    incident: Incident,
    filename: str,
    event_id: uuid.UUID,
) -> bool:
    """Two questions a share token has to answer before a photo is served.

    A viewer token is scoped to ONE event, so it may only reach an incident of
    that event — a forwarded link for the Sturm must not open a photo from the
    Grossbrand next door. And within that incident it may only reach the files a
    **submitted** Reko report actually lists: `get_photo_path` proves a file
    exists on that incident's directory on disk, nothing more, and that
    directory also holds the Schadenplatz-Rapport photos, which the share link
    does not carry and must not serve. A draft's photos stay out for the same
    reason — an unsent report is not part of the shared situation.
    """
    if incident.event_id != event_id:
        return False

    result = await db.execute(
        select(RekoReport.photos_json).where(
            RekoReport.incident_id == incident.id,
            RekoReport.is_draft == False,  # noqa: E712 - SQLAlchemy needs == not 'is'
        )
    )
    return any(filename in (photos or []) for photos in result.scalars())


@photos_router.get("/{incident_id}/{filename}")
async def serve_photo(
    incident_id: uuid.UUID,
    filename: str,
    request: Request,
    token: str | None = Query(None, description="Viewer share token, when there is no session"),
    access_token: str | None = Cookie(None),
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """
    Serve photo file with authentication and authorization.

    SECURITY: two doors, and they are not equally wide.

    * A **session** reads any photo of any incident — an operator on the board
      already sees the whole event.
    * A **viewer share token** (`?token=`) reads only the Reko photos of the
      event it was minted for, and only those a submitted report lists. Without
      it the share board draws the Reko result but a broken image where the
      picture of the damage should be, which is the most useful part of it.
      Anyone holding the link can then see those photos — that is the cost the
      link has always carried for everything else on the display, and the
      narrowing above is what keeps it to that.

    Everything that is not one of those two doors is a 404, never a 403: a share
    link must not be usable to confirm that a photo of another event exists.

    Args:
        incident_id: Incident UUID
        filename: Photo filename
        token: Viewer share token, checked before the session cookie
        db: Database session

    Returns:
        Image file with cache headers

    Raises:
        HTTPException 401: If neither door opens
        HTTPException 404: If the photo is not found, or out of the token's reach
    """
    # Token first, session second — the same "one route, two doors" shape as
    # _require_user_or_form_token. A token that does not validate falls through
    # to the cookie rather than short-circuiting, so a stale token in a bookmark
    # never locks out an operator who is logged in anyway.
    viewer_event_id = validate_viewer_token(token) if token else None
    current_user = None if viewer_event_id else await get_current_user(request, access_token, authorization, db)

    # Verify incident exists
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = incident_result.scalar_one_or_none()

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    if viewer_event_id and not await _viewer_token_may_see_photo(db, incident, filename, viewer_event_id):
        raise HTTPException(status_code=404, detail="Photo not found")

    # Get photo path and verify it exists (this is also the path-traversal guard)
    file_path = photo_storage.get_photo_path(incident_id, filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Log photo access for audit trail. `user=None` on the token door is the
    # provenance itself: nobody was logged in, somebody held the share link.
    await log_action(
        db=db,
        action_type="view_photo",
        resource_type="reko_photo",
        resource_id=incident_id,
        user=current_user,
        changes={"filename": filename, "via": "viewer_token" if viewer_event_id else "session"},
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


# ============================================
# Reko assignment — the BOARD's own endpoints
# ============================================
#
# These four moved here from `api/reko_dashboard.py` when the login-less
# dashboard page was removed (plan 26, decision 24). They were never part of
# that page: every one is editor-authed, and the field-surface registry said so
# in its own comment for as long as they lived there. Deleting the router would
# have taken the board's Reko assignment UI with it, which is the whole reason
# this is a move rather than a deletion.


@router.get(
    "/incidents/{incident_id}/available-reko",
    response_model=schemas.AvailableRekoPersonnelResponse,
)
async def get_available_reko_personnel(
    incident_id: uuid.UUID,
    current_user: CurrentEditor,  # Editor only
    db: AsyncSession = Depends(get_db),
) -> schemas.AvailableRekoPersonnelResponse:
    """
    Get available Reko personnel for assignment to an incident.

    Editor only - used when assigning Reko personnel from incident card.
    Returns all Reko personnel with their assignment counts.
    """
    available, currently_assigned_id = await reko_assign_crud.get_available_reko_personnel_for_incident(db, incident_id)

    return schemas.AvailableRekoPersonnelResponse(
        personnel=[schemas.AvailableRekoPersonnel(**p) for p in available],
        currently_assigned_id=currently_assigned_id,
    )


@router.post(
    "/incidents/{incident_id}/assign-reko",
    response_model=schemas.AssignmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_reko_personnel(
    incident_id: uuid.UUID,
    assignment: schemas.AssignRekoPersonnelRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,  # Editor only
    db: AsyncSession = Depends(get_db),
) -> schemas.AssignmentResponse:
    """
    Assign Reko personnel to an incident.

    Editor only - creates a personnel assignment for the Reko person.
    If another Reko person is already assigned, they will be unassigned first.
    """
    # Get available Reko personnel to check for existing assignment
    _, currently_assigned_id = await reko_assign_crud.get_available_reko_personnel_for_incident(db, incident_id)

    # If the same person is already assigned, do nothing
    if currently_assigned_id == assignment.personnel_id:
        raise HTTPException(status_code=400, detail="Personnel already assigned to this incident")

    # If a different Reko person is assigned, unassign them first
    if currently_assigned_id is not None:
        await reko_assign_crud.unassign_reko_personnel_from_incident(db, incident_id, currently_assigned_id)
        logger.info(
            "Unassigned previous Reko personnel %s from incident %s for replacement",
            currently_assigned_id,
            incident_id,
        )

    # Create the new assignment.
    #
    # `purpose="reko"` is the whole point of the column (plan 26 §27): this row
    # and a crew row are otherwise identical, and `/feld` would then ask a trupp
    # that only drove out to look for a Schadenplatz-Rapport. Set here, at the
    # path the assignment came in through — never inferred afterwards.
    db_assignment = IncidentAssignment(
        incident_id=incident_id,
        resource_type="personnel",
        resource_id=assignment.personnel_id,
        assigned_by=current_user.id,
        purpose="reko",
    )
    db.add(db_assignment)
    await db.commit()
    await db.refresh(db_assignment)

    # Auto-move incident from "incoming" to "reko" when reko personnel is assigned
    incident = await incidents_crud.get_incident(db, incident_id)
    if incident and incident.status == "incoming":
        await incidents_crud.update_incident_status(
            db=db,
            incident_id=incident_id,
            new_status="reko",
            current_user=current_user,
            request=request,
            notes="Automatisch verschoben: Reko-Person zugewiesen",
        )
        await db.commit()
        logger.info(
            "Auto-moved incident %s from incoming to reko after reko assignment",
            incident_id,
        )
        # Broadcast incident update for the status change
        background_tasks.add_task(
            broadcast_incident_update,
            {"id": str(incident_id), "status": "reko"},
            "update",
        )

    # Broadcast WebSocket update
    background_tasks.add_task(
        broadcast_assignment_update,
        {
            "id": str(db_assignment.id),
            "incident_id": str(incident_id),
            "resource_type": "personnel",
            "resource_id": str(assignment.personnel_id),
            "assigned_at": db_assignment.assigned_at.isoformat(),
        },
        "create",
    )

    return schemas.AssignmentResponse.model_validate(db_assignment)


@router.delete(
    "/incidents/{incident_id}/unassign-reko/{personnel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unassign_reko_personnel(
    incident_id: uuid.UUID,
    personnel_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,  # Editor only
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Unassign Reko personnel from an incident.

    Editor only - removes the personnel assignment for the Reko person.
    """
    success = await reko_assign_crud.unassign_reko_personnel_from_incident(db, incident_id, personnel_id)

    if not success:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Broadcast WebSocket update
    background_tasks.add_task(
        broadcast_assignment_update,
        {
            "incident_id": str(incident_id),
            "resource_type": "personnel",
            "resource_id": str(personnel_id),
        },
        "delete",
    )

    return None


@router.post(
    "/transfer-rekos",
    status_code=status.HTTP_200_OK,
    response_model=None,
)
async def transfer_reko_assignments(
    from_personnel_id: uuid.UUID = Query(..., description="Personnel ID to transfer from"),
    to_personnel_id: uuid.UUID = Query(..., description="Personnel ID to transfer to"),
    event_id: uuid.UUID = Query(..., description="Event ID"),
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    request: Request = None,  # type: ignore[assignment]
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    current_user: CurrentEditor = None,  # type: ignore[assignment]
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Transfer all open reko assignments from one person to another.

    Only transfers incidents that are in reko status (not yet completed).
    """
    # Get all reko assignments for the source person in this event
    assignments = await reko_assign_crud.get_reko_assignments_for_personnel(db, event_id, from_personnel_id)

    # Filter to only open assignments (incidents in reko status, not reko_done or later)
    transferred: list[str] = []
    for assignment in assignments:
        incident = await incidents_crud.get_incident(db, assignment["incident_id"])
        if incident and incident.status in ("incoming", "reko"):
            # Unassign old person
            await reko_assign_crud.unassign_reko_personnel_from_incident(
                db, assignment["incident_id"], from_personnel_id
            )
            # Assign new person — still a Reko auftrag, so it keeps the purpose
            # (a handover that quietly turned into a crew row would land the new
            # person with a Rapport the old one never owed).
            db_assignment = IncidentAssignment(
                incident_id=assignment["incident_id"],
                resource_type="personnel",
                resource_id=to_personnel_id,
                assigned_by=current_user.id if current_user else None,
                purpose="reko",
            )
            db.add(db_assignment)
            transferred.append(str(assignment["incident_id"]))

    await db.commit()

    # Broadcast updates
    if background_tasks:
        for inc_id in transferred:
            background_tasks.add_task(
                broadcast_assignment_update,
                {
                    "incident_id": inc_id,
                    "resource_type": "personnel",
                    "resource_id": str(to_personnel_id),
                },
                "create",
            )

    return {"transferred_count": len(transferred), "incident_ids": transferred}
