"""Divera 24/7 webhook integration API endpoints."""

import logging
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..crud import assignments as assignments_crud
from ..crud import divera as divera_crud
from ..crud import events as events_crud
from ..crud import external_identities as identities_crud
from ..crud import incidents as incidents_crud
from ..crud import personnel as personnel_crud
from ..crud import special_functions as special_functions_crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..services import alerting, divera_alarm, incident_display
from ..services import settings as settings_service
from ..services.audit import log_action
from ..services.divera_intake import (
    broadcast_emergency_received,
    incident_create_from_emergency,
    try_auto_attach,
)
from ..services.divera_members import build_sync_preview, execute_sync, fetch_divera_members
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_incident_update, get_divera_poller_stats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/divera", tags=["divera"])


# Type/priority inference lives in services.divera_intake so the webhook,
# poller and attach endpoints share one source.


@router.post("/webhook", status_code=status.HTTP_200_OK)
@limiter.limit(RateLimits.WEBHOOK)
async def receive_divera_webhook(
    payload: schemas.DiveraWebhookPayload,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request = None,
):
    """
    Receive Divera 24/7 webhook and store emergency.

    This endpoint receives webhooks from Divera and:
    1. Validates webhook secret (query param or X-Webhook-Secret header)
    2. Stores the emergency in divera_emergencies table
    3. Auto-attaches it (as a new incident) to the newest active event that has
       auto-attach enabled — otherwise it stays in the pool for manual attachment
    4. Broadcasts WebSocket notification to frontend
    5. Returns 200 OK to Divera
    """
    # Validate webhook secret
    from ..services.settings import get_setting

    webhook_secret = await get_setting(db, "alarm_webhook_secret")
    if webhook_secret:
        import secrets as _secrets

        provided_secret = (request.query_params.get("secret", "") if request else "") or (
            request.headers.get("X-Webhook-Secret", "") if request else ""
        )
        if not provided_secret or not _secrets.compare_digest(provided_secret, webhook_secret):
            logger.warning("Divera webhook rejected: invalid or missing secret")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    try:
        # Check if emergency already exists (deduplication)
        existing = await divera_crud.get_divera_emergency_by_divera_id(db, payload.id)
        if existing:
            logger.info(f"Duplicate Divera webhook ignored: ID {payload.id}")
            return {"status": "ok", "message": "Duplicate emergency ignored"}

        # Create new emergency
        emergency = await divera_crud.create_divera_emergency(db, payload)

        logger.info(
            f"New Divera emergency received: ID {emergency.id}, "
            f"Divera ID {emergency.divera_id}, Title: {emergency.title}"
        )

        # Auto-attach to the newest active event with the flag on (if any) —
        # the emergency lands on that event's board as a fresh incident.
        incident = await try_auto_attach(db, emergency)

        # Broadcast WebSocket notification to frontend (pool + board)
        background_tasks.add_task(
            broadcast_emergency_received,
            schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode="json"),
            schemas.IncidentResponse.model_validate(incident).model_dump(mode="json") if incident else None,
        )

        return {
            "status": "ok",
            "message": "Emergency stored successfully",
            "emergency_id": str(emergency.id),
            "auto_attached_incident_id": str(incident.id) if incident else None,
        }

    except IntegrityError as e:
        logger.error(f"Database integrity error: {e}")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Emergency already exists")
    except Exception as e:
        logger.error(f"Error processing Divera webhook: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error processing webhook")


@router.get("/emergencies", response_model=schemas.DiveraEmergencyListResponse)
async def list_divera_emergencies(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    attached: bool | None = Query(None, description="Filter by attachment status"),
    event_id: UUID | None = Query(None, description="Filter by event ID"),
    include_archived: bool = Query(False, description="Include archived emergencies"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """
    List Divera emergencies with filters.

    Query parameters:
    - attached: true = only attached, false = only unattached, null = all
    - event_id: filter by specific event
    - include_archived: include archived emergencies
    - skip/limit: pagination
    """
    emergencies = await divera_crud.get_divera_emergencies(
        db=db,
        attached=attached,
        event_id=event_id,
        include_archived=include_archived,
        skip=skip,
        limit=limit,
    )

    total = await divera_crud.count_divera_emergencies(
        db=db,
        attached=attached,
        event_id=event_id,
        include_archived=include_archived,
    )

    unattached_count = await divera_crud.count_divera_emergencies(
        db=db,
        attached=False,
        include_archived=False,
    )

    return schemas.DiveraEmergencyListResponse(
        emergencies=[schemas.DiveraEmergencyResponse.model_validate(e) for e in emergencies],
        total=total,
        unattached_count=unattached_count,
    )


@router.get("/emergencies/{emergency_id}", response_model=schemas.DiveraEmergencyResponse)
async def get_divera_emergency(
    emergency_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Get a specific Divera emergency by ID."""
    emergency = await divera_crud.get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Divera emergency not found")

    return schemas.DiveraEmergencyResponse.model_validate(emergency)


@router.post(
    "/emergencies/{emergency_id}/attach",
    response_model=schemas.IncidentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def attach_emergency_to_event(
    emergency_id: UUID,
    request_data: schemas.AttachEmergencyRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Attach a Divera emergency to an Event by creating an Incident.

    1. Fetches the Divera emergency
    2. Verifies the Event exists
    3. Creates an Incident from the emergency data
    4. Links the emergency to the Event and Incident
    5. Broadcasts WebSocket update

    Editor role required.
    """
    # Get emergency
    emergency = await divera_crud.get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Divera emergency not found")

    # Prevent re-attachment to the same event
    if emergency.attached_to_event_id == request_data.event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Emergency already attached to this event")

    # Allow re-attachment to different events

    # Verify event exists
    event = await events_crud.get_event_by_id(db, request_data.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Simulated training alarms never become real incidents
    if emergency.is_training and not event.training_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Übungs-Alarm kann nur an eine Übung angehängt werden",
        )

    # Derive incident (type/priority inferred from title/text)
    incident_create = incident_create_from_emergency(emergency, request_data.event_id)

    # Create the incident, carrying the alarm's provenance onto the board card
    incident = await incidents_crud.create_incident(
        db=db,
        incident=incident_create,
        current_user=current_user,
        request=request,
        source=emergency.source or "divera",
        source_ref=emergency.source_id,
    )

    # Link emergency to event and incident
    try:
        await divera_crud.attach_emergency_to_event(
            db=db,
            emergency_id=emergency_id,
            event_id=request_data.event_id,
            incident_id=incident.id,
        )
    except ValueError as e:
        logger.warning("Failed to attach emergency %s to event: %s", emergency_id, e)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.INVALID_REQUEST)

    # Convert to response schema
    incident_response = await incident_display.incident_with_display(db, incident)

    # Broadcast WebSocket update for instant board refresh
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    logger.info(
        f"Divera emergency {emergency_id} attached to event {request_data.event_id}, created incident {incident.id}"
    )

    return incident_response


@router.post("/emergencies/bulk-attach", response_model=schemas.BulkAttachEmergenciesResponse)
async def bulk_attach_emergencies(
    request_data: schemas.BulkAttachEmergenciesRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Attach multiple Divera emergencies to an Event.

    Creates an Incident for each emergency and links them to the Event.
    Max 100 emergencies per request.

    Returns list of created Incidents.
    """
    # Verify event exists
    event = await events_crud.get_event_by_id(db, request_data.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    created_incidents = []
    errors = []

    for emergency_id in request_data.emergency_ids:
        try:
            # Get emergency
            emergency = await divera_crud.get_divera_emergency_by_id(db, emergency_id)
            if not emergency:
                errors.append(f"Emergency {emergency_id} not found")
                continue

            # Skip if already attached to this event
            if emergency.attached_to_event_id == request_data.event_id:
                errors.append(f"Emergency {emergency_id} already attached to this event")
                continue

            # Allow re-attachment to different events

            # Simulated training alarms never become real incidents
            if emergency.is_training and not event.training_flag:
                errors.append(f"Emergency {emergency_id}: Übungs-Alarm kann nur an eine Übung angehängt werden")
                continue

            # Create incident (type/priority inferred from title/text)
            incident_create = incident_create_from_emergency(emergency, request_data.event_id)

            incident = await incidents_crud.create_incident(
                db=db,
                incident=incident_create,
                current_user=current_user,
                request=request,
                source=emergency.source or "divera",
                source_ref=emergency.source_id,
            )

            # Link emergency
            await divera_crud.attach_emergency_to_event(
                db=db,
                emergency_id=emergency_id,
                event_id=request_data.event_id,
                incident_id=incident.id,
            )

            created_incidents.append(incident)

        except Exception as e:
            logger.error(f"Error attaching emergency {emergency_id}: {e}")
            errors.append(f"Emergency {emergency_id}: {str(e)}")

    if errors:
        logger.warning(f"Bulk attach completed with errors: {errors}")

    # Broadcast all created incidents for instant board refresh
    for incident in created_incidents:
        incident_response = await incident_display.incident_with_display(db, incident)
        background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    logger.info(f"Bulk attach completed: {len(created_incidents)} incidents created, {len(errors)} errors")

    return schemas.BulkAttachEmergenciesResponse(
        created=await incident_display.incidents_with_display(db, created_incidents),
        errors=errors,
    )


@router.delete("/emergencies/{emergency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_divera_emergency(
    emergency_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Archive a Divera emergency (soft delete).

    Editor role required.
    Note: This does not delete the linked Incident, just archives the emergency.
    """
    try:
        await divera_crud.archive_divera_emergency(db, emergency_id)
        logger.info(f"Divera emergency {emergency_id} archived by {current_user.username}")
    except ValueError as e:
        logger.warning("Failed to archive emergency %s: %s", emergency_id, e)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.NOT_FOUND)


@router.get("/personnel-sync/preview", response_model=schemas.DiveraSyncPreview)
async def get_personnel_sync_preview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Preview personnel sync from Divera.

    Fetches current members from Divera API, compares with existing personnel,
    and returns a categorized diff (new, updated, unchanged, not_in_divera).

    Editor role required. Divera access key must be configured.
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Personnel sync is disabled in demo mode",
        )

    if not settings.divera_access_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Divera access key not configured. Set DIVERA_ACCESS_KEY in settings.",
        )

    try:
        divera_members = await fetch_divera_members()
    except Exception as e:
        logger.error(f"Failed to fetch Divera members: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch members from Divera: {e}",
        )

    existing = await personnel_crud.get_all_personnel(db)
    preview = build_sync_preview(divera_members, existing)

    return schemas.DiveraSyncPreview(
        new=[schemas.DiveraSyncPreviewItem(**item) for item in preview["new"]],
        unchanged=[schemas.DiveraSyncPreviewItem(**item) for item in preview["unchanged"]],
        not_in_divera=[schemas.DiveraSyncPreviewItem(**item) for item in preview["not_in_divera"]],
    )


@router.post("/personnel-sync/execute", response_model=schemas.DiveraSyncResult)
async def execute_personnel_sync(
    request_data: schemas.DiveraSyncExecute,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Execute personnel sync from Divera.

    Fetches current members from Divera, compares with DB, and applies changes.
    Optionally removes personnel not found in Divera.

    Editor role required. Divera access key must be configured.
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Personnel sync is disabled in demo mode",
        )

    if not settings.divera_access_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Divera access key not configured. Set DIVERA_ACCESS_KEY in settings.",
        )

    try:
        divera_members = await fetch_divera_members()
    except Exception as e:
        logger.error(f"Failed to fetch Divera members: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch members from Divera: {e}",
        )

    existing = await personnel_crud.get_all_personnel(db)
    preview = build_sync_preview(divera_members, existing)

    result = await execute_sync(
        db=db,
        preview=preview,
        remove_stale=request_data.remove_stale,
        current_user=current_user,
        request=request,
    )

    logger.info(
        f"Divera personnel sync completed: "
        f"{result['created']} created, {result['deleted']} deleted, "
        f"{result['unchanged']} unchanged"
    )

    return schemas.DiveraSyncResult(**result)


# Outbound alarm (ausalarmierung). Defaults live in DEFAULT_SETTINGS so the
# settings editor, the GET response and this fallback all agree.
DEFAULT_ALARM_TITLE = settings_service.DEFAULT_SETTINGS["alerting.title_template"]
DEFAULT_ALARM_TEXT = settings_service.DEFAULT_SETTINGS["alerting.text_template"]

_TOKEN_RE = re.compile(r"\{(\w+)\}")


def _render_alarm_template(template: str, incident) -> str:
    """Render an alarm title/text template against an incident.

    Same section engine as the frontend (message-template.ts): a line whose tokens
    all resolve empty is dropped, unknown tokens become empty, blank runs collapse.
    Token-replace (not str.format) so a stray brace can't raise.

    NOTE: this is only a fallback. The send dialog renders the message client-side
    (with crew/vehicle/material names) and sends it as an override, so tokens the
    backend can't fill here (vehicles/crew/materials/reko/...) just drop their line.
    """
    values = {
        "title": incident.title or "",
        "type": incident.type or "",
        "location": incident.location_address or "",
        "priority": incident.priority or "",
        "notes": incident.description or "",
    }
    out: list[str] = []
    for line in template.split("\n"):
        line_tokens = _TOKEN_RE.findall(line)
        if not line_tokens:
            out.append(line)
            continue
        if all(not values.get(t, "") for t in line_tokens):
            continue
        out.append(_TOKEN_RE.sub(lambda m: values.get(m.group(1), ""), line))
    # Collapse blank runs and trim trailing blanks.
    collapsed: list[str] = []
    for line in out:
        if not line.strip() and (not collapsed or not collapsed[-1].strip()):
            continue
        collapsed.append(line)
    while collapsed and not collapsed[-1].strip():
        collapsed.pop()
    return "\n".join(collapsed)


@router.post("/incidents/{incident_id}/alarm", response_model=schemas.DiveraAlarmResponse)
async def send_incident_alarm(
    incident_id: UUID,
    request_data: schemas.DiveraAlarmRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Send an outbound Divera alarm to selected personnel assigned to an incident.

    Editor role. Off by default: requires ``alerting.enabled = true`` and a
    configured alerting provider. Never sends for training events or in demo
    mode. Recipients are restricted to personnel actually assigned to the
    incident; anyone not linked to the provider is skipped and reported, not
    silently dropped.
    """
    provider = alerting.get_provider()
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kein Alarmierungs-Provider konfiguriert",
        )
    enabled = await settings_service.get_setting_value(db, "alerting.enabled", "false")
    if enabled.lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ausalarmierung ist deaktiviert",
        )
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ausalarmierung ist im Demo-Modus deaktiviert",
        )

    incident = await incidents_crud.get_incident(db, incident_id)
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    # Training events run the full flow but never reach Divera — recipients are
    # still resolved so the simulated result can report how many WOULD be alarmed,
    # but no external request is made (see the `is_training` short-circuit below).
    event = await events_crud.get_event_by_id(db, incident.event_id)
    is_training = event is not None and event.training_flag

    # Valid recipients = personnel assigned to this incident, plus the drivers of
    # the incident's assigned vehicles (drivers are event-scoped special functions,
    # not personnel assignments).
    assignments = await assignments_crud.get_incident_assignments(db, incident_id)
    assigned_personnel_ids = {a.resource_id for a in assignments if a.resource_type == "personnel"}
    assigned_vehicle_ids = {a.resource_id for a in assignments if a.resource_type == "vehicle"}
    if assigned_vehicle_ids:
        functions = await special_functions_crud.get_event_special_functions(db, incident.event_id)
        for fn in functions:
            if fn.function_type == "driver" and fn.vehicle_id in assigned_vehicle_ids:
                assigned_personnel_ids.add(fn.personnel_id)

    # Provider-side ids come from the neutral identity table; the deprecated
    # personnel.divera_user_id column is a read fallback for one release.
    identity_map = await identities_crud.get_identity_map(db, provider.slug, list(request_data.personnel_ids))

    sent: list[schemas.DiveraAlarmRecipient] = []
    skipped: list[schemas.DiveraAlarmRecipient] = []
    external_ids: dict[UUID, str] = {}
    for pid in request_data.personnel_ids:
        person = await personnel_crud.get_personnel(db, pid)
        if person is None:
            continue
        if pid not in assigned_personnel_ids:
            skipped.append(
                schemas.DiveraAlarmRecipient(
                    personnel_id=pid, name=person.name, reason="nicht diesem Einsatz zugewiesen"
                )
            )
            continue
        external_id = identity_map.get(pid)
        if external_id is None and provider.slug == "divera" and person.divera_user_id:
            external_id = str(person.divera_user_id)
        if not external_id:
            skipped.append(
                schemas.DiveraAlarmRecipient(
                    personnel_id=pid,
                    name=person.name,
                    reason=f"nicht mit {provider.display_name} verknüpft",
                )
            )
            continue
        external_ids[pid] = external_id
        sent.append(
            schemas.DiveraAlarmRecipient(
                personnel_id=pid,
                name=person.name,
                divera_user_id=int(external_id) if external_id.isdigit() else None,
            )
        )

    foreign_id = f"kprueck-{incident_id}"

    if not sent:
        return schemas.DiveraAlarmResponse(
            success=False,
            foreign_id=foreign_id,
            sent=[],
            skipped=skipped,
            error=f"Keine mit {provider.display_name} verknüpften Empfänger — nichts gesendet",
        )

    # Prefer the client-rendered override (it can fill crew/vehicle/material names
    # the backend can't), but never let an empty body reach Divera: if the override
    # is blank/whitespace, render the configured template; if that's empty too,
    # fall back to the built-in default so the alarm always has a title and text.
    title = (request_data.title or "").strip()
    if not title:
        title = _render_alarm_template(
            await settings_service.get_setting_value(db, "alerting.title_template", DEFAULT_ALARM_TITLE),
            incident,
        ).strip()
    if not title:
        title = _render_alarm_template(DEFAULT_ALARM_TITLE, incident).strip() or "KP-Rück Alarm"

    text = (request_data.text or "").strip()
    if not text:
        text = _render_alarm_template(
            await settings_service.get_setting_value(db, "alerting.text_template", DEFAULT_ALARM_TEXT),
            incident,
        ).strip()
    if not text:
        text = _render_alarm_template(DEFAULT_ALARM_TEXT, incident).strip() or (incident.title or "Alarm")

    # Training: simulate the send end-to-end but make NO external request.
    if is_training:
        logger.info(
            "Training: simulating %s alarm for incident %s (%d recipient(s), no external call)",
            provider.slug,
            incident_id,
            len(sent),
        )
        return schemas.DiveraAlarmResponse(
            success=True,
            foreign_id=foreign_id,
            sent=sent,
            skipped=skipped,
            count_recipients=len(sent),
            simulated=True,
        )

    try:
        result = await provider.send_alarm(
            external_ids=[external_ids[r.personnel_id] for r in sent],
            title=title,
            text=text,
            foreign_id=foreign_id,
            priority=request_data.priority,
            address=incident.location_address,
            lat=float(incident.location_lat) if incident.location_lat is not None else None,
            lng=float(incident.location_lng) if incident.location_lng is not None else None,
            channels=alerting.AlarmChannels(
                push=request_data.send_push,
                sms=request_data.send_sms,
                call=request_data.send_call,
                mail=request_data.send_mail,
            ),
        )
    except alerting.AlarmSendError as e:
        logger.error("%s alarm failed for incident %s: %s", provider.slug, incident_id, e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    await log_action(
        db=db,
        action_type="divera_alarm",
        resource_type="incident",
        resource_id=incident_id,
        user=current_user,
        changes={
            "provider": provider.slug,
            "recipients": [str(r.personnel_id) for r in sent],
            "channels": {
                "push": request_data.send_push,
                "sms": request_data.send_sms,
                "call": request_data.send_call,
                "mail": request_data.send_mail,
            },
            "divera_alarm_id": result.provider_alarm_id,
        },
        request=request,
    )

    return schemas.DiveraAlarmResponse(
        success=True,
        foreign_id=foreign_id,
        divera_alarm_id=result.provider_alarm_id,
        sent=sent,
        skipped=skipped,
        count_recipients=result.count_recipients,
    )


@router.get("/members", response_model=list[schemas.DiveraMemberPreview])
async def list_divera_members(
    current_user: CurrentEditor,
):
    """List Divera members (id + name) — used to pick a test-alarm recipient.

    Reads live from Divera (pull/all); independent of local personnel linking.
    """
    if not settings.divera_access_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Divera access key not configured",
        )
    try:
        members = await fetch_divera_members()
    except Exception as e:
        logger.error("Failed to fetch Divera members: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch members from Divera: {e}",
        )
    members.sort(key=lambda m: m["name"].lower())
    return [schemas.DiveraMemberPreview(**m) for m in members]


@router.post("/test-alarm", response_model=schemas.DiveraAlarmResponse)
async def send_test_alarm(
    request_data: schemas.DiveraTestAlarmRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Send a setup test alarm (push only) to a single Divera member.

    Used from Settings to verify the Divera connection. Same gating as a real
    alarm minus the incident/training checks. Targets the chosen Divera user
    directly, so it works before any local personnel are linked.
    """
    if not settings.divera_access_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Divera access key not configured",
        )
    enabled = await settings_service.get_setting_value(db, "alerting.enabled", "false")
    if enabled.lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ausalarmierung ist deaktiviert",
        )
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ausalarmierung ist im Demo-Modus deaktiviert",
        )

    name = request_data.name or "Testperson"
    foreign_id = f"kprueck-test-{request_data.divera_user_id}"
    try:
        data = await divera_alarm.send_alarm(
            user_cluster_relation=[request_data.divera_user_id],
            title="KP-Rück Test",
            text="Testalarm – bitte ignorieren. Verifiziert die Divera-Anbindung.",
            foreign_id=foreign_id,
            send_push=True,
        )
    except divera_alarm.DiveraAlarmError as e:
        logger.error("Divera test alarm failed: %s", e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

    await log_action(
        db=db,
        action_type="divera_test_alarm",
        resource_type="settings",
        resource_id=None,
        user=current_user,
        changes={"divera_user_id": request_data.divera_user_id, "divera_alarm_id": data.get("id")},
        request=request,
    )

    return schemas.DiveraAlarmResponse(
        success=True,
        foreign_id=foreign_id,
        divera_alarm_id=data.get("id"),
        sent=[
            schemas.DiveraAlarmRecipient(
                personnel_id=None,  # no local person — direct Divera target
                name=name,
                divera_user_id=request_data.divera_user_id,
            )
        ],
        count_recipients=data.get("count_recipients"),
    )


@router.get("/polling/status")
async def get_polling_status(
    current_user: CurrentUser,
):
    """
    Get Divera polling status.

    Returns information about the polling fallback mechanism:
    - Whether polling is configured (access key set)
    - Whether polling is currently active (users connected)
    - Last poll time
    - Poll and error counts
    """
    stats = get_divera_poller_stats()
    if stats is None:
        return {
            "configured": False,
            "message": "Divera polling service not available",
        }
    return stats
