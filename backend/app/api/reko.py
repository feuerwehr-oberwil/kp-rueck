"""Reko form API endpoints.

Field-crew form endpoints validate the per-incident form token; report
viewing/editing and link generation additionally accept cookie auth. Nothing
here is fully open: a leaked form link must not allow minting fresh tokens or
rewriting other incidents' recon reports.
"""

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser, get_current_user
from ..crud import assignments as assignments_crud
from ..crud import incidents as incidents_crud
from ..crud import reko as crud
from ..crud import reko_assignment as reko_assign_crud
from ..crud.locking import lock_incident_with_group, lock_incidents_with_groups, lock_resource
from ..crud.manual_order import OrderChangedError
from ..database import get_db
from ..logging_config import get_logger
from ..middleware.rate_limit import RateLimits, limiter
from ..models import Event, Incident, IncidentAssignment, RekoReport, User
from ..utils.error_codes import CodedHTTPException, ErrorCode
from ..utils.errors import ErrorMessages
from ..websocket_manager import (
    broadcast_assignment_update,
    broadcast_incident_update,
    broadcast_reko_update,
)

logger = get_logger(__name__)
from ..services import reko_history, share_links
from ..services.audit import log_action
from ..services.merge_links import live_incident_id, merged_into_ids
from ..services.photo_storage import enforce_demo_photo_limits, photo_storage
from ..services.reko_history import RekoAuthor
from ..services.tokens import (
    decode_form_token,
    generate_feld_token,
    generate_form_token,
    validate_form_token,
)

router = APIRouter(prefix="/reko", tags=["reko"])


async def _require_form_token(
    db: AsyncSession,
    token: str,
    incident_id: uuid.UUID,
    personnel_id: uuid.UUID | None = None,
) -> uuid.UUID | None:
    """Validate form scope and the live field device behind any derived credential."""
    claims = decode_form_token(token, str(incident_id))
    if claims is None:
        raise CodedHTTPException(400, ErrorCode.REKO_LINK_INVALID, "Ungültiger Reko-Link")
    binding = claims.field_binding
    if binding is None:
        # Standalone board-issued links have no field device to revoke.
        return personnel_id
    from ..crud.feld import claim_is_live

    if not await claim_is_live(db, binding.claim_id, binding.event_id, binding.personnel_id):
        raise CodedHTTPException(
            401, ErrorCode.FELD_DEVICE_SIGNED_OUT, "Dieses Gerät wurde abgemeldet. Bitte den Code neu eingeben."
        )
    incident = await db.get(Incident, incident_id)
    if incident is None or incident.event_id != binding.event_id:
        raise CodedHTTPException(401, ErrorCode.FELD_FORM_TOKEN_INVALID, "Ungültiger Zugriffscode")
    if personnel_id is not None and personnel_id != binding.personnel_id:
        raise CodedHTTPException(
            403, ErrorCode.FELD_TOKEN_OTHER_PERSON, "Der Zugriffscode gehört zu einer anderen Person."
        )
    return binding.personnel_id


async def _require_user_or_form_token(
    request: Request,
    incident_id: uuid.UUID,
    reko_token: str | None,
    access_token: str | None,
    db: AsyncSession,
    *,
    write: bool = False,
) -> User | None:
    """Allow a scoped form token or a session with the required read/write role.

    Field crews open reko links without an account; operators view/edit
    reports from the cookie-authenticated board. Raises 401 otherwise.

    Returns the user when the *session* opened the door and ``None`` when the
    token did — which is the provenance question itself, answered once at the
    door instead of re-derived by every handler (plan 26 §5.1).
    """
    if reko_token and validate_form_token(reko_token, str(incident_id)):
        await _require_form_token(db, reko_token, incident_id)
        return None
    user = await get_current_user(request, access_token, db)
    if write and user.role not in ("editor", "admin"):
        raise HTTPException(status_code=403, detail="Bearbeiter-Berechtigung erforderlich")
    return user


async def _token_door_id(db: AsyncSession, token: str | None, incident_id: uuid.UUID) -> uuid.UUID:
    """The id a form token was minted for: this card, or a card merged into it (R2).

    A report filed through a Reko link moves with a merge, so by the time the
    link edits it again the report sits on the surviving card while the token
    still names the card it was minted for. The token stays valid ONLY for that
    original card — this finds it among the cards merged into this one, never
    any other.
    """
    if not token or validate_form_token(token, str(incident_id)):
        return incident_id
    for merged_id in await merged_into_ids(db, incident_id):
        if validate_form_token(token, str(merged_id)):
            return merged_id
    return incident_id


def _board_save_files_now(report: RekoReport, update: schemas.RekoReportUpdate) -> bool:
    """Whether this board save files the incident's report (owner picks 19.11.2026 #30, 23.11.2026 #6).

    One rule: the moment «Einsatz relevant?» is answered (Ja or Nein) – in this save or an
    earlier one – on a report that is still a draft, whoever opened it (the KP, or a crew
    still typing in the field: the KP heard the answer over the radio). Filing is then
    exactly the crew's submit (`crud.process_reko_submission`: «Reko» → «Reko
    abgeschlossen», priority bump, bell). A status move files nothing. The caller holds the
    card lock.
    """
    if not report.is_draft:
        return False
    relevant = update.is_relevant if "is_relevant" in update.model_fields_set else report.is_relevant
    return relevant is not None


async def _after_save(
    db: AsyncSession,
    background_tasks: BackgroundTasks,
    incident: Incident | None,
    report: RekoReport,
    filed_now: bool,
) -> None:
    """What every save of the report sets off, whichever door it came through.

    The first filing is the one «Reko-Meldung» (`process_reko_submission`: status, priority,
    bell). A later edit of a filed report rings nothing (owner pick 23.11.2026) but still
    escalates on a danger it adds (pass 5, S4). Every save – drafts too – tells the other
    boards: they show the one live report, form and all.
    """
    if incident is not None and filed_now:
        await crud.process_reko_submission(db, incident, report)
        background_tasks.add_task(
            broadcast_incident_update, {"id": str(incident.id), "has_completed_reko": True}, "update"
        )
    elif incident is not None and not report.is_draft and await crud.escalate_for_dangers(db, incident, report):
        background_tasks.add_task(
            broadcast_incident_update, {"id": str(incident.id), "priority": incident.priority}, "update"
        )
    background_tasks.add_task(
        broadcast_reko_update, {"incident_id": str(report.incident_id)}, "submit" if filed_now else "update"
    )


def _response(report: RekoReport, incident: Incident | None) -> schemas.RekoReportResponse:
    """The report with the incident's details the form header shows."""
    response_data = schemas.RekoReportResponse.model_validate(report)
    if incident:
        response_data.incident_title = incident.title
        response_data.incident_location = incident.location_address
        response_data.incident_type = incident.type
        response_data.incident_description = incident.description
        response_data.incident_contact = incident.contact
    return response_data


@router.get("/form", response_model=schemas.RekoReportResponse)
async def get_reko_form(
    incident_id: uuid.UUID = Query(...),
    token: str = Query(...),
    personnel_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
    """
    Load THE incident's Reko report for the form (created as a draft when there is none).

    No authentication required - uses token validation. Every valid link of the incident
    opens the same report (one per Einsatz, owner pick 23.11.2026).

    Query params:
        incident_id: UUID of incident
        token: Form access token
        personnel_id: Optional personnel who is doing the reko
    """
    personnel_id = await _require_form_token(db, token, incident_id, personnel_id)
    try:
        report = await crud.get_or_create_reko_report(db, incident_id, token, personnel_id)

        # Fetch incident title — of the card the report is on (a merged link's
        # report lives on the card it went into)
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


# Older field tabs send this complete initial snapshot after a failed load. The legacy
# is_draft marker distinguishes it from an intentional field-level clear in the current app.
_EMPTY_LEGACY_DRAFT = schemas.RekoReportUpdate(
    is_relevant=None,
    dangers_json=schemas.DangersAssessment(other_notes=""),
    effort_json=schemas.EffortEstimation(),
    power_supply="unknown",
    summary_text="",
    additional_notes="",
)


@router.post("/", response_model=schemas.RekoReportResponse)
async def submit_reko_report(
    report_data: schemas.RekoReportCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    submit: bool = Query(default=True, description="Mark as submitted (not draft)"),
    access_token: str | None = Cookie(None),
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
        raise CodedHTTPException(400, ErrorCode.REKO_LINK_INVALID, "Ungültiger Reko-Link")

    user = await _require_user_or_form_token(
        request,
        report_data.incident_id,
        field_token,
        access_token,
        db,
        write=True,
    )

    # THE report of the incident. The token resolves the reporting *person*; the board has
    # no such person to resolve, so a report it creates carries the operator in
    # `created_by_user_id` instead (decision 6).
    try:
        if user is not None:
            report = await crud.get_or_create_kp_reko_report(db, report_data.incident_id, user)
            author = RekoAuthor.kp(user)
        elif field_token is not None:
            personnel_id = await _require_form_token(db, field_token, report_data.incident_id)
            report = await crud.get_or_create_reko_report(db, report_data.incident_id, field_token, personnel_id)
            author = RekoAuthor.feld(personnel_id)
        else:
            # Unreachable — the helper returns None only when a token opened the
            # door — but it is what narrows the token for the type checker.
            raise HTTPException(status_code=401, detail=ErrorMessages.INVALID_REQUEST)
    except ValueError as e:
        logger.warning("Reko report creation failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e

    # Update with new data
    update_data = schemas.RekoReportUpdate(
        **report_data.model_dump(exclude={"incident_id", "token"}, exclude_unset=True)
    )
    # A board save files a draft once «Einsatz relevant?» is answered (`_board_save_files_now`).
    if user is not None and not submit:
        submit = _board_save_files_now(report, update_data)
    filed_now = False
    if (
        field_token
        and not submit
        and update_data == _EMPTY_LEGACY_DRAFT
        and (await request.json()).get("is_draft") is True
    ):
        updated = report
    else:
        updated, filed_now = await crud.update_reko_report(db, report.id, update_data, author=author, submit=submit)

    # The LIVE card the report is on: status, bell and release happen there, not on a card
    # merged away (R2 review).
    incident = await db.get(Incident, updated.incident_id)
    response_data = _response(updated, incident)
    await _after_save(db, background_tasks, incident, updated, filed_now)
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
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
    """Edit THE incident's Reko report – the field's later answers, the KP's in place.

    Requires either a form token of the report's incident (X-Reko-Token header) or a
    logged-in editor — recon reports feed operator decisions and the printed slip, so they
    must not be rewritable by anyone who can reach the API. Since one report serves the
    whole incident (owner pick 23.11.2026), any valid link of that incident may edit it,
    not only the link that created the row.

    A KP edit of a crew-filed report keeps both provenance sides (plan 26 §5.1):
    ``submitted_by_personnel_id`` from the crew, ``updated_by_user_id`` from the operator.
    """
    existing = await db.get(RekoReport, report_id)
    if not existing:
        raise CodedHTTPException(404, ErrorCode.REKO_REPORT_NOT_FOUND, ErrorMessages.REPORT_NOT_FOUND)

    door_id = await _token_door_id(db, x_reko_token, existing.incident_id)
    user = await _require_user_or_form_token(
        request,
        door_id,
        x_reko_token,
        access_token,
        db,
        write=True,
    )
    # The card (with its Auftrag) before the report row (`crud/locking.py`), for both doors:
    # the field and the KP write the same row, and a filing then writes the card – a door
    # that took the row first would deadlock against the other. The status move files
    # drafts under the same card lock, so whether this save files is decided on the row as
    # it is once that move is done (Sol review S2).
    card = await lock_incident_with_group(db, existing.incident_id)
    if card is not None and card.merged_into_id is not None:
        # Both cards had a report: this one stays hidden on the merged-away card, and a tab
        # still open on that card must not edit it (Sol review G, S5). The form and the photo
        # routes resolve the card it went into; this route names the row.
        raise CodedHTTPException(
            409,
            ErrorCode.REKO_REPORT_MERGED,
            "Dieser Einsatz wurde zusammengeführt. Bitte neu laden und den Reko-Bericht dort bearbeiten.",
        )
    existing = await db.scalar(
        select(RekoReport).where(RekoReport.id == report_id).with_for_update().execution_options(populate_existing=True)
    )
    if existing is None:
        raise CodedHTTPException(404, ErrorCode.REKO_REPORT_NOT_FOUND, ErrorMessages.REPORT_NOT_FOUND)
    if user is not None:
        author = RekoAuthor.kp(user)
        if not submit:
            submit = _board_save_files_now(existing, update_data)
    else:
        claims = decode_form_token(x_reko_token, str(door_id)) if x_reko_token else None
        binding = claims.field_binding if claims else None
        author = RekoAuthor.feld(binding.personnel_id if binding else None)

    try:
        updated, filed_now = await crud.update_reko_report(db, report_id, update_data, author=author, submit=submit)
    except ValueError as e:
        logger.warning("Reko report update failed: %s", e)
        raise CodedHTTPException(404, ErrorCode.REKO_REPORT_NOT_FOUND, ErrorMessages.REPORT_NOT_FOUND) from e

    incident = await db.get(Incident, updated.incident_id)
    response_data = _response(updated, incident)
    await _after_save(db, background_tasks, incident, updated, filed_now)
    return response_data


@router.get("/{report_id}", response_model=schemas.RekoReportResponse)
async def get_report(
    report_id: uuid.UUID,
    request: Request,
    token: str | None = Query(None),
    access_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> schemas.RekoReportResponse:
    """Get Reko report by ID (for viewing on incident card).

    Requires either the incident's form token (?token=) or a logged-in user.
    """
    result = await db.execute(select(RekoReport).where(RekoReport.id == report_id))
    report = result.scalar_one_or_none()

    if not report:
        raise CodedHTTPException(404, ErrorCode.REKO_REPORT_NOT_FOUND, ErrorMessages.REPORT_NOT_FOUND)

    door_id = await _token_door_id(db, token, report.incident_id)
    await _require_user_or_form_token(request, door_id, token, access_token, db)

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
    """The incident's Reko report, as a list: empty, or THE one (one per Einsatz since 23.11.2026).

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
    personnel_id = await _require_form_token(db, token, incident_id)
    try:
        report = await crud.mark_reko_arrived(db, incident_id, token, personnel_id)

        # The «Reko vor Ort» notification is raised inside `crud.mark_reko_arrived`
        # (first arrival only), so the Übungssteuerung's simulate path — which
        # calls the CRUD function directly — rings the same bell as this route.

        # Fetch incident for the response details
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

        # Broadcast incident update so other clients see "vor Ort" status
        background_tasks.add_task(
            broadcast_incident_update,
            {
                "id": str(report.incident_id),
                "reko_arrived_at": report.arrived_at.isoformat() if report.arrived_at else None,
            },
            "update",
        )
        # Broadcast reko update for reko-specific listeners
        background_tasks.add_task(
            broadcast_reko_update,
            {"incident_id": str(report.incident_id)},
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
    user = await get_current_user(request, access_token, db)
    if user.role not in ("editor", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bearbeiter-Berechtigung erforderlich")

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
) -> tuple[RekoReport, RekoAuthor]:
    """THE report of the incident a photo attaches to, and who is attaching it.

    One report per Einsatz, so both doors land on the same row: the field crew through its
    form token, the KP through its session (the WhatsApp case – the picture reached the KP
    on another channel). The row is created as a draft when there is none yet. The card
    lock it is found under serializes the photo list with every other write of the report.
    """
    if user is not None:
        return await crud.get_or_create_kp_reko_report(db, incident_id, user), RekoAuthor.kp(user)
    if field_token is None:
        # Unreachable: the door helper returns None only for a valid token.
        raise HTTPException(status_code=401, detail=ErrorMessages.INVALID_REQUEST)
    personnel_id = await _require_form_token(db, field_token, incident_id)
    report = await crud.get_or_create_reko_report(db, incident_id, field_token, personnel_id)
    return report, RekoAuthor.feld(personnel_id)


async def _record_photo_change(
    db: AsyncSession, report: RekoReport, before: dict[str, Any], author: RekoAuthor
) -> None:
    """The photo list moved: its Chronik row, and the KP's amendment stamp."""
    if author.user_id is not None:
        report.updated_by_user_id = author.user_id
        report.updated_by_user_at = datetime.now(UTC)
    await reko_history.record_changes(db, report, before, author)


@router.post("/{incident_id}/photos", response_model=None)
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def upload_photo(
    request: Request,
    incident_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    x_reko_token: str | None = Header(None),
    access_token: str | None = Cookie(None),
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
        db: Database session

    Returns:
        { "filename": "uuid.jpg" }
    """
    # A token that is present but wrong stays a 400 whoever is logged in: a
    # leaked link must not become a way to write into another incident.
    if x_reko_token is not None and not validate_form_token(x_reko_token, str(incident_id)):
        raise CodedHTTPException(400, ErrorCode.REKO_LINK_INVALID, "Ungültiger Reko-Link")

    user = await _require_user_or_form_token(request, incident_id, x_reko_token, access_token, db, write=True)

    await enforce_demo_photo_limits(db, file, RekoReport.photos_json)

    try:
        report, author = await _photo_report(db, incident_id, user, x_reko_token)
    except ValueError as e:
        logger.warning("Reko photo upload failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e
    before = reko_history.snapshot(report)

    # Save photo
    filename = await photo_storage.save_photo(
        # The card the report is on — after a merge, the surviving one.
        incident_id=report.incident_id,
        file=file,
        current_photos=report.photos_json,
    )

    # Update report with new photo
    current_photos = report.photos_json if report.photos_json else []
    report.photos_json = [*current_photos, filename]
    await _record_photo_change(db, report, before, author)
    background_tasks.add_task(broadcast_reko_update, {"incident_id": str(report.incident_id)}, "update")

    return {"filename": filename}


@router.delete("/{incident_id}/photos/{filename}", response_model=None)
async def delete_photo(
    request: Request,
    incident_id: uuid.UUID,
    filename: str,
    background_tasks: BackgroundTasks,
    x_reko_token: str | None = Header(None),
    access_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    """
    Delete photo from Reko report.

    Same two doors as the upload: the incident's form token, or a session.

    Args:
        incident_id: Incident UUID
        filename: Photo filename to delete
        x_reko_token: Form access token (from header), for the field door
        db: Database session

    Returns:
        { "success": true }
    """
    if x_reko_token is not None and not validate_form_token(x_reko_token, str(incident_id)):
        raise CodedHTTPException(400, ErrorCode.REKO_LINK_INVALID, "Ungültiger Reko-Link")

    user = await _require_user_or_form_token(request, incident_id, x_reko_token, access_token, db, write=True)

    try:
        report, author = await _photo_report(db, incident_id, user, x_reko_token)
    except ValueError as e:
        logger.warning("Reko photo delete failed: %s", e)
        raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST) from e
    before = reko_history.snapshot(report)

    # Check if photo exists in report
    current_photos = report.photos_json if report.photos_json else []
    if filename not in current_photos:
        raise CodedHTTPException(404, ErrorCode.PHOTO_NOT_FOUND, ErrorMessages.PHOTO_NOT_FOUND)

    # A card merged away keeps its own report when the surviving card had one, and photos
    # are copied, not moved, between cards: the file stays while any report still lists it.
    report.photos_json = [p for p in current_photos if p != filename]
    await _record_photo_change(db, report, before, author)
    referenced = await db.scalar(
        select(RekoReport.id)
        .where(
            RekoReport.incident_id == report.incident_id,
            RekoReport.photos_json.contains([filename]),
        )
        .limit(1)
    )
    incident_key = str(report.incident_id)
    # Committed before the file goes: a rollback after the unlink would list a photo that no
    # longer exists.
    await db.commit()
    if referenced is None:
        photo_storage.delete_photo(report.incident_id, filename)
    background_tasks.add_task(broadcast_reko_update, {"incident_id": incident_key}, "update")

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


@photos_router.get(
    "/{incident_id}/{filename}",
    response_class=FileResponse,
    responses={
        200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}},
        400: {"description": "Invalid or expired Reko form credential."},
        401: {"description": "Authentication required, invalid session, or revoked field device."},
        404: {"description": "Photo not found or outside the supplied token's scope."},
    },
)
async def serve_photo(
    incident_id: uuid.UUID,
    filename: str,
    request: Request,
    token: str | None = Query(None, description="Viewer share token, when there is no session"),
    reko_token: str | None = Query(None, description="Reko form token, restricted to its report's photos"),
    view: Literal["full"] | None = Query(
        None, description="`full`: the in-app viewer – never cached, so every open is a logged view"
    ),
    access_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """
    Serve photo file with authentication and authorization.

    Each credential grants a different photo scope.

    * A **session** reads any photo of any incident — an operator on the board
      already sees the whole event.
    * A **viewer share token** (`?token=`) reads only the Reko photos of the
      event it was minted for, and only those a submitted report lists. Without
      it the share board draws the Reko result but a broken image where the
      picture of the damage should be, which is the most useful part of it.
      Anyone holding the link can then see those photos — that is the cost the
      link has always carried for everything else on the display, and the
      narrowing above is what keeps it to that.

    * A **Reko form token** (`?reko_token=`) reads only photos the incident's
      Reko report lists, draft included – the report the link edits. Field-derived
      tokens also require their device claim to remain live.

    Files outside a valid token's scope return 404 so links cannot probe them.

    A thumbnail may come from the operator's browser cache; the in-app viewer asks with
    `?view=full`, answered `no-store`, so opening a photo always reaches this route and
    its `view_photo` entry (Sol review G, S8).

    Args:
        incident_id: Incident UUID
        filename: Photo filename
        token: Viewer share token, checked before the session cookie
        reko_token: Form credential, checked before either of the other doors
        db: Database session

    Returns:
        Image file with cache headers

    Raises:
        HTTPException 400: If the Reko form credential is invalid or expired
        HTTPException 401: If no credential opens a door, or the device was revoked
        HTTPException 404: If the photo is not found, or out of the token's reach
    """
    # Form credentials fail closed. Viewer bookmarks retain their existing
    # session fallback so a stale share link does not lock out an operator.
    viewer_event_id = None
    current_user = None
    # A merged card's photos are served from the card it went into (and the link
    # that names the merged card keeps working — R2 review).
    live_id = await live_incident_id(db, incident_id)
    if reko_token is not None:
        await _require_form_token(db, reko_token, incident_id)
        # The incident's one report (a merged link: the surviving card's) must list the file.
        report_query = select(RekoReport.id).where(
            RekoReport.incident_id.in_({incident_id, live_id}),
            RekoReport.photos_json.contains([filename]),
        )
        if await db.scalar(report_query) is None:
            raise CodedHTTPException(404, ErrorCode.PHOTO_NOT_FOUND, ErrorMessages.PHOTO_NOT_FOUND)
    else:
        viewer_event_id = await share_links.event_of(db, "viewer", token) if token else None
        if viewer_event_id is None:
            current_user = await get_current_user(request, access_token, db)

    # Verify incident exists
    incident_result = await db.execute(select(Incident).where(Incident.id == incident_id))
    incident = incident_result.scalar_one_or_none()

    if not incident:
        raise CodedHTTPException(404, ErrorCode.INCIDENT_NOT_FOUND, ErrorMessages.INCIDENT_NOT_FOUND)

    if viewer_event_id and not await _viewer_token_may_see_photo(db, incident, filename, viewer_event_id):
        raise CodedHTTPException(404, ErrorCode.PHOTO_NOT_FOUND, ErrorMessages.PHOTO_NOT_FOUND)

    # Get photo path and verify it exists (this is also the path-traversal guard)
    file_path = photo_storage.get_photo_path(incident_id, filename) or (
        photo_storage.get_photo_path(live_id, filename) if live_id != incident_id else None
    )
    if not file_path:
        raise CodedHTTPException(404, ErrorCode.PHOTO_NOT_FOUND, ErrorMessages.PHOTO_NOT_FOUND)

    # Log photo access for audit trail. `user=None` on the token door is the
    # provenance itself: nobody was logged in, somebody held a scoped link.
    await log_action(
        db=db,
        action_type="view_photo",
        resource_type="reko_photo",
        resource_id=incident_id,
        user=current_user,
        changes={
            "filename": filename,
            "via": "reko_token" if reko_token is not None else "viewer_token" if viewer_event_id else "session",
            **({"view": view} if view else {}),
        },
        request=request,
    )

    # Field credentials and viewer links are revocable; their photos must be reauthorized on reload.
    by_link = reko_token is not None or viewer_event_id is not None
    return FileResponse(
        file_path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, no-store" if by_link or view else "private, max-age=3600",
            "Referrer-Policy": "no-referrer",
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

    A new assignment, so ``ensure_assignable`` applies (409 on an archived Ereignis or
    a closed Einsatz); a missing Einsatz or person is a 404.
    """
    try:
        locked_incident = await assignments_crud.lock_for_new_assignment(
            db, incident_id, "personnel", assignment.personnel_id
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND) from e
    except assignments_crud.IncidentNotOnBoardError as e:
        raise HTTPException(
            status_code=409, detail="Dieser Einsatz ist nicht mehr auf dem Board (gelöscht oder zusammengeführt)."
        ) from e
    except assignments_crud.ResourceNotAssignableError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    # Get available Reko personnel to check for existing assignment
    _, currently_assigned_id = await reko_assign_crud.get_available_reko_personnel_for_incident(db, incident_id)

    # If the same person is already assigned, do nothing
    if currently_assigned_id == assignment.personnel_id:
        raise HTTPException(status_code=400, detail="Person ist diesem Einsatz bereits zugewiesen")

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
    # Last in the person's Reko order (the Reko-Modus numbers); the person's row lock taken
    # above keeps two assigns from drawing the same number.
    db_assignment = IncidentAssignment(
        incident_id=incident_id,
        resource_type="personnel",
        resource_id=assignment.personnel_id,
        assigned_by=current_user.id,
        purpose="reko",
        reko_position=await reko_assign_crud.next_reko_position(db, locked_incident.event_id, assignment.personnel_id),
    )
    db.add(db_assignment)
    await db.flush()
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
        raise HTTPException(status_code=404, detail=ErrorMessages.ASSIGNMENT_NOT_FOUND)

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
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    from_personnel_id: uuid.UUID = Query(..., description="Personnel ID to transfer from"),
    to_personnel_id: uuid.UUID = Query(..., description="Personnel ID to transfer to"),
    event_id: uuid.UUID = Query(..., description="Event ID"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Transfer all open reko assignments from one person to another.

    Only transfers incidents that are in reko status (not yet completed).

    The new person gets NEW assignments, so ``ensure_assignable`` applies: an
    archived Ereignis refuses the whole handover (409), an unknown person is a 404.
    Lock order (``crud/locking.py``): the Einsätze with their Aufträge, then the person.
    """
    # Get all reko assignments for the source person in this event
    assignments = await reko_assign_crud.get_reko_assignments_for_personnel(db, event_id, from_personnel_id)

    locked = await lock_incidents_with_groups(db, [a["incident_id"] for a in assignments])
    to_person = await lock_resource(db, "personnel", to_personnel_id)
    event = await db.get(Event, event_id)
    if to_person is None or event is None:
        raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND)

    # Filter to only open assignments (incidents in reko status, not reko_done or later).
    # They join the new person's order at its end, in the order the old person had them.
    transferred: list[str] = []
    next_position = await reko_assign_crud.next_reko_position(db, event_id, to_personnel_id)
    for assignment in assignments:
        incident = locked.get(assignment["incident_id"])
        if incident and incident.status in ("incoming", "reko"):
            try:
                assignments_crud.ensure_assignable(to_person, event=event, incident=incident)
            except assignments_crud.ResourceNotAssignableError as e:
                raise HTTPException(status_code=409, detail=str(e)) from e
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
                reko_position=next_position,
            )
            next_position += 1
            db.add(db_assignment)
            transferred.append(str(assignment["incident_id"]))

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


@router.post(
    "/personnel/{personnel_id}/order",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reorder_reko_assignments(
    personnel_id: uuid.UUID,
    body: schemas.RekoOrderRequest,
    background_tasks: BackgroundTasks,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Put a Reko person's Rekos in order (editor only) – the Reko-Modus drag on the map.

    The same contract as ``POST /incident-groups/{id}/stops/reorder``: ``ordered_ids`` are
    Einsatz ids; with ``expected_ids`` the write happens only while the person still holds
    exactly those Rekos (409 otherwise). The order shows as numbered pins and as the order of the
    person's /feld list.
    """
    try:
        updated = await reko_assign_crud.reorder_reko_assignments(
            db, body.event_id, personnel_id, body.ordered_ids, body.expected_ids
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=ErrorMessages.PERSONNEL_NOT_FOUND) from e
    except OrderChangedError:
        # Nothing was written; get_db rolls back and releases the person's lock.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reko-Reihenfolge wurde inzwischen geändert",
        ) from None

    if updated:
        # The order lives on the assignment rows: boards and phones re-read them.
        background_tasks.add_task(broadcast_incident_update, {"event_id": str(body.event_id)}, "refresh")
