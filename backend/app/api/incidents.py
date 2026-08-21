"""Incident API endpoints."""

import logging
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..crud import events as events_crud
from ..crud import feld as feld_crud
from ..crud import incidents as crud
from ..crud import kp_messages as kp_messages_crud
from ..crud import reko as reko_crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..services import incident_display
from ..services.audit import log_action
from ..services.incident_leader import effective_leader_ids
from ..utils.errors import ErrorMessages
from ..websocket_manager import (
    broadcast_group_update,
    broadcast_incident_update,
    broadcast_kp_message_update,
    broadcast_reko_update,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incidents", tags=["incidents"])


async def trigger_sync_background() -> None:
    """Trigger immediate sync in background (event-based sync).

    When an incident is created/updated locally, we push changes TO Railway.
    """
    try:
        from ..services.settings import get_setting_value
        from ..services.sync_service import create_sync_service

        # Get a new database session for background task
        # One session, then out. The `break` used to sit in a `finally:`, which silently
        # discarded anything raised above it — so a failing sync never reached the handler
        # below and "Background sync failed" was never logged. The inner try/finally had no
        # other purpose, so it is gone entirely.
        async for db in get_db():
            # Check Railway URL from database settings
            railway_url = await get_setting_value(db, "railway_database_url", "")
            if not railway_url:
                logger.debug("Background sync skipped: No Railway database URL configured")
                return

            sync_service = await create_sync_service(db)

            # Check Railway health
            railway_healthy = await sync_service.check_railway_health()
            if not railway_healthy:
                logger.debug("Background sync skipped: Railway unreachable")
                return

            # Push local changes to Railway (event-based)
            result = await sync_service.sync_to_railway()
            if result.success:
                logger.info("Event-based sync to Railway successful: %d records", sum(result.records_synced.values()))
            else:
                logger.warning("Event-based sync to Railway failed: %s", result.errors)
            break
    except Exception as e:
        # Log error but don't fail the incident creation
        logger.error("Background sync failed: %s", e)


@router.get("/", response_model=list[schemas.IncidentResponse])
async def list_incidents(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    response: Response,
    event_id: uuid.UUID,  # Required: filter by event
    status: str | None = None,
    skip: int = Query(default=0, ge=0),
    # The DEFAULT is what mattered: no production caller passes a limit, so 100 was a hard
    # ceiling on the board. The maximum stays 500 — it is an asserted security boundary
    # (tests/test_security/test_input_validation.py), and raising it bought nothing.
    limit: int = Query(default=500, ge=1, le=500),
) -> list[schemas.IncidentResponse]:
    """
    List incidents for a specific event.

    Sets `X-Total-Count` to the number of incidents matching the filters before
    skip/limit, so the client can tell a complete board from a truncated one. Without it
    a truncated board is indistinguishable from a small one — the client sees a plain
    array either way and has nothing to warn the operator with.

    Args:
        event_id: Event ID to filter incidents (required)
        status: Optional status filter
        skip: Pagination offset
        limit: Max number of results (default 500, max 500)
    """
    incidents = await crud.get_incidents(
        db=db,
        event_id=event_id,
        skip=skip,
        limit=limit,
        status=status,
    )
    response.headers["X-Total-Count"] = str(await crud.count_incidents(db=db, event_id=event_id, status=status))
    return await incident_display.incidents_with_display(db, incidents)


# response_model=None keeps the untyped `{}` response schema this route has always published:
# without it FastAPI would derive a response model from the new return annotation and drift
# docs/openapi.json.
@router.get("/sync-version", response_model=None)
async def get_sync_version(
    event_id: str = Query(...),
    # The `= None` default is dead: the Annotated `Depends` in CurrentUser always injects a
    # User. It cannot be dropped (it precedes other defaulted params) and it must NOT become
    # `CurrentUser | None` — FastAPI stops seeing the Depends inside a Union and fails at import.
    current_user: CurrentUser = None,  # type: ignore[assignment]
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Return a quick hash of the current state for change detection.

    Lightweight endpoint that returns a version string based on incident count
    and latest update timestamp. Clients can poll this cheaply and only do a
    full refresh when the version changes.

    MUST be declared before /{incident_id}: a path param route declared first
    would swallow "sync-version" as an incident id and 422 — which silently
    killed the polling fallback's change detection.
    """
    result = await db.execute(
        select(
            sa_func.count(models.Incident.id),
            sa_func.max(models.Incident.updated_at),
        )
        .where(models.Incident.event_id == event_id)
        .where(models.Incident.deleted_at.is_(None))
    )
    row = result.one()
    count = row[0] or 0
    latest = row[1]

    # Also check assignment changes (crew/vehicle/material changes)
    assignment_result = await db.execute(
        select(
            sa_func.count(models.IncidentAssignment.id),
            sa_func.max(models.IncidentAssignment.assigned_at),
        )
        .join(models.Incident, models.IncidentAssignment.incident_id == models.Incident.id)
        .where(models.Incident.event_id == event_id)
        .where(models.Incident.deleted_at.is_(None))
    )
    a_row = assignment_result.one()
    a_count = a_row[0] or 0
    a_latest = a_row[1]

    # Also fold in Auftrag (incident group) changes so the polling fallback
    # notices group create/rename/reorder even if a group_update WS event is missed.
    group_result = await db.execute(
        select(
            sa_func.count(models.IncidentGroup.id),
            sa_func.max(models.IncidentGroup.updated_at),
        )
        .where(models.IncidentGroup.event_id == event_id)
        .where(models.IncidentGroup.deleted_at.is_(None))
    )
    g_row = group_result.one()
    g_count = g_row[0] or 0
    g_latest = g_row[1]

    group_assignment_result = await db.execute(
        select(
            sa_func.count(models.IncidentGroupAssignment.id),
            sa_func.max(models.IncidentGroupAssignment.assigned_at),
            sa_func.max(models.IncidentGroupAssignment.unassigned_at),
        )
        .join(
            models.IncidentGroup,
            models.IncidentGroupAssignment.incident_group_id == models.IncidentGroup.id,
        )
        .where(models.IncidentGroup.event_id == event_id)
    )
    ga_row = group_assignment_result.one()
    ga_count = ga_row[0] or 0
    ga_assigned_latest = ga_row[1]
    ga_unassigned_latest = ga_row[2]

    # Field-report tables: Reko (arrived_at, submission) and Schadenplatz-Rapport
    # (arrival, pickup, rapport filing) don't touch Incident.updated_at, so without
    # this the polling fallback never noticed them — with the WebSocket down, the
    # board and the Übungssteuerung showed stale field state until a manual reload.
    reko_result = await db.execute(
        select(sa_func.max(models.RekoReport.updated_at))
        .join(models.Incident, models.RekoReport.incident_id == models.Incident.id)
        .where(models.Incident.event_id == event_id)
        .where(models.Incident.deleted_at.is_(None))
    )
    reko_latest = reko_result.scalar_one_or_none()

    report_result = await db.execute(
        select(sa_func.max(models.SchadenplatzReport.updated_at))
        .join(models.Incident, models.SchadenplatzReport.incident_id == models.Incident.id)
        .where(models.Incident.event_id == event_id)
        .where(models.Incident.deleted_at.is_(None))
    )
    report_latest = report_result.scalar_one_or_none()

    # Combine into version string
    latest_str = latest.isoformat() if latest else "0"
    a_latest_str = a_latest.isoformat() if a_latest else "0"
    g_latest_str = g_latest.isoformat() if g_latest else "0"
    ga_assigned_str = ga_assigned_latest.isoformat() if ga_assigned_latest else "0"
    ga_unassigned_str = ga_unassigned_latest.isoformat() if ga_unassigned_latest else "0"
    reko_str = reko_latest.isoformat() if reko_latest else "0"
    report_str = report_latest.isoformat() if report_latest else "0"
    version = (
        f"{count}-{latest_str}-{a_count}-{a_latest_str}-{g_count}-{g_latest_str}-"
        f"{ga_count}-{ga_assigned_str}-{ga_unassigned_str}-{reko_str}-{report_str}"
    )
    return {"version": version}


@router.get("/{incident_id}", response_model=schemas.IncidentResponse)
async def get_incident(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> schemas.IncidentResponse:
    """Get incident by ID."""
    incident = await crud.get_incident(db, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return await incident_display.incident_with_display(db, incident)


@router.post("/", response_model=schemas.IncidentResponse, status_code=status.HTTP_201_CREATED)
async def create_incident(
    incident: schemas.IncidentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.IncidentResponse:
    """
    Create new incident (editor only).

    Verifies that the event exists before creating the incident.
    Triggers immediate sync (event-based) after creation.
    """
    # Verify event exists
    event = await events_crud.get_event_by_id(db, incident.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Demo mode: cap incidents per event at 50 (the demo seed itself creates
    # ~21 per sandbox, so a global cap would make manual creation impossible).
    if settings.demo_mode:
        count_result = await db.execute(
            select(sa_func.count()).select_from(models.Incident).where(models.Incident.event_id == incident.event_id)
        )
        event_incidents = count_result.scalar() or 0
        if event_incidents >= 50:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo-Modus: Maximale Anzahl Einsätze (50) erreicht. Die Demo wird regelmässig zurückgesetzt.",
            )

    try:
        new_incident = await crud.create_incident(
            db=db,
            incident=incident,
            current_user=current_user,
            request=request,
        )
    except crud.InvalidIncidentGroupError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Trigger immediate sync in background (event-based sync)
    background_tasks.add_task(trigger_sync_background)

    # Convert SQLAlchemy model to Pydantic for response and WebSocket broadcast
    incident_response = await incident_display.incident_with_display(db, new_incident)

    # Broadcast WebSocket update
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    return incident_response


@router.patch("/{incident_id}", response_model=schemas.IncidentResponse)
async def update_incident(
    incident_id: uuid.UUID,
    incident_update: schemas.IncidentUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
    expected_updated_at: datetime | None = None,
) -> schemas.IncidentResponse:
    """
    Update incident (editor only).

    Supports optimistic locking via expected_updated_at query param.
    """
    try:
        incident = await crud.update_incident(
            db=db,
            incident_id=incident_id,
            incident_update=incident_update,
            current_user=current_user,
            request=request,
            expected_updated_at=expected_updated_at,
        )
    except crud.InvalidIncidentGroupError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        logger.warning("Incident update conflict for %s: %s", incident_id, e)
        raise HTTPException(status_code=409, detail=ErrorMessages.CONFLICT) from e

    if not incident:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    # Convert SQLAlchemy model to Pydantic for response and WebSocket broadcast
    incident_response = await incident_display.incident_with_display(db, incident)

    # Broadcast WebSocket update
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "update")
    if getattr(incident, "group_resources_released", False) and incident.group_id:
        background_tasks.add_task(
            broadcast_group_update,
            {"id": str(incident.group_id), "event_id": str(incident.event_id)},
            "update",
        )

    return incident_response


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_incidents(
    reorder: schemas.IncidentReorder,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> None:
    """Persist the manual top-to-bottom card order for a status column (editor only).

    `ordered_ids` lists the column's cards in their new order; each card's
    position is set to its index. Broadcasts so other boards pick up the order.
    """
    updated = await crud.reorder_incidents(
        db=db,
        event_id=reorder.event_id,
        ordered_ids=reorder.ordered_ids,
    )

    if updated:
        background_tasks.add_task(
            broadcast_incident_update,
            {"event_id": str(reorder.event_id), "ordered_ids": [str(i) for i in reorder.ordered_ids]},
            "reorder",
        )


@router.post("/{incident_id}/status", response_model=schemas.IncidentResponse)
async def update_status(
    incident_id: uuid.UUID,
    status_update: schemas.StatusTransitionCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.IncidentResponse:
    """
    Update incident status (Kanban drag-and-drop).

    Creates status_transitions record.
    """
    incident = await crud.update_incident_status(
        db=db,
        incident_id=incident_id,
        new_status=status_update.to_status.value,
        current_user=current_user,
        request=request,
        notes=status_update.notes,
    )

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Convert SQLAlchemy model to Pydantic for response and WebSocket broadcast
    incident_response = await incident_display.incident_with_display(db, incident)

    # Broadcast WebSocket update for status change
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "update")
    if getattr(incident, "group_resources_released", False) and incident.group_id:
        background_tasks.add_task(
            broadcast_group_update,
            {"id": str(incident.group_id), "event_id": str(incident.event_id)},
            "update",
        )

    return incident_response


@router.get("/{incident_id}/field-report", response_model=schemas.FieldReportState)
async def get_field_report(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> schemas.FieldReportState:
    """The three field reports of one Schadenplatz, as `/feld` returns them."""
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    return schemas.FieldReportState(**await feld_crud.field_report_state(db, incident))


@router.post("/{incident_id}/field-report", response_model=schemas.FieldReportState)
async def set_field_report(
    incident_id: uuid.UUID,
    payload: schemas.FieldReportUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.FieldReportState:
    """The KP twin of the `/feld` field actions (decision 28).

    The normal case is a radio message: the crew has no signal, no phone or no
    hands and dictates. A field surface whose data can only arrive through that
    surface would make the KP a spectator to its own board — so *everything* a
    crew can tap here, an operator can enter, through the **same CRUD module**
    (`crud/feld.py`). Two thin routers, one implementation.

    Set or clear any of the three: a field present in the body with a value sets
    it, present as `null` clears it, absent leaves it alone. Without that
    distinction an operator correcting the pickup note would wipe the arrival.

    **Provenance is never faked.** This path leaves `field_complete_reported_by`
    and `pickup_requested_by` NULL — they are personnel FKs and no operator is
    the crew — and puts the user in the audit-log entry instead.
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    actor = feld_crud.FieldActor(user=current_user)
    provided = payload.model_fields_set

    if "arrived_at" in provided:
        await feld_crud.record_arrival(db, incident, actor=actor, at=payload.arrived_at, request=request)

    if "field_complete_reported_at" in provided:
        await feld_crud.record_field_complete(
            db, incident, actor=actor, at=payload.field_complete_reported_at, request=request
        )

    if "pickup_needed" in provided and payload.pickup_needed is not None:
        await feld_crud.record_pickup(
            db,
            incident,
            actor=actor,
            needed=payload.pickup_needed,
            note=payload.pickup_note,
            at=payload.pickup_requested_at,
            request=request,
        )
    elif "pickup_note" in provided and incident.pickup_needed:
        # Editing only the note of an open pickup. The waiting time is the
        # operationally decisive fact at 02:00, so `pickup_requested_at` stays.
        await feld_crud.record_pickup(db, incident, actor=actor, needed=True, note=payload.pickup_note, request=request)

    return schemas.FieldReportState(**await feld_crud.field_report_state(db, incident))


@router.get("/{incident_id}/field-messages", response_model=list[schemas.KpFieldMessage])
async def list_field_messages(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[models.IncidentFieldMessage]:
    """The KP's messages to this Schadenplatz's squad, oldest first."""
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    return await kp_messages_crud.messages_for_incident(db, incident_id)


@router.post("/{incident_id}/field-messages", response_model=schemas.KpFieldMessage, status_code=201)
async def send_field_message(
    incident_id: uuid.UUID,
    payload: schemas.KpFieldMessageCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> models.IncidentFieldMessage:
    """«Meldung an den Trupp» — the KP's half of the field message loop (sweep 27 §P3.2).

    Symmetric to the crew's Freitext-Meldung, and deliberately as small: one
    sentence, timestamped, with the sender's display name. The squad reads it on
    `/feld`, where it rides the polled assignments payload; the incident's
    Verlauf and the Meldungen thread read it back via `/timeline`.

    No notification — a bell that tells the KP what the KP just typed would be
    noise. The broadcast keeps other open boards in step.
    """
    if not payload.message.strip():
        raise HTTPException(status_code=422, detail="Leere Meldung")
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    row = await kp_messages_crud.create_kp_message(
        db, incident, user=current_user, message=payload.message, request=request
    )
    background_tasks.add_task(
        broadcast_kp_message_update,
        {
            "id": str(row.id),
            "incident_id": str(incident_id),
            "message": row.message,
            "author_name": row.author_name,
            "created_at": row.created_at.isoformat(),
        },
        "created",
    )
    return row


@router.post("/{incident_id}/reko-arrived", response_model=schemas.RekoArrivedState)
async def set_reko_arrived(
    incident_id: uuid.UUID,
    payload: schemas.RekoArrivedUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.RekoArrivedState:
    """ "Reko meldet: vor Ort" over the radio (plan 26 §5.2, decision 15).

    The KP twin of `POST /api/reko/{incident_id}/arrived`, which is a form-token
    route and therefore had nowhere to put a message that arrived by radio. It
    reuses `crud.mark_reko_arrived`'s body with the token lookup replaced and
    broadcasts the same two WebSocket events — **a board watching for a field
    message must not be able to tell the difference in anything except the
    provenance line.** The one deliberate difference: no `reko_arrived`
    notification. The message came over the KP's own radio and the operator is
    logging it — a bell/toast here would notify the KP of its own action (same
    rule as the KP-filed rapport). The field path (`POST /api/reko/…/arrived`)
    keeps notifying.

    Idempotent, correctable and clearable: absent `arrived_at` means "now" and
    leaves an existing arrival alone, an explicit one lands at the time the
    message was actually given (five minutes ago, over the radio), and `null`
    clears it, because a mis-heard call is corrected rather than amended.

    The arrival is displayed and written in exactly ONE place, the detail's
    Feldmeldungen row. Do not add a second control for it somewhere else.
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    clear = "arrived_at" in payload.model_fields_set and payload.arrived_at is None
    try:
        report = await reko_crud.set_reko_arrived_by_user(
            db, incident_id, user=current_user, at=payload.arrived_at, clear=clear
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND) from e

    await log_action(
        db=db,
        action_type="reko_arrived_cleared" if clear else "reko_arrived",
        resource_type="incident",
        resource_id=incident_id,
        user=current_user,
        changes={"arrived_at": report.arrived_at.isoformat() if report and report.arrived_at else None},
        request=request,
    )
    await db.commit()

    arrived_at = report.arrived_at if report else None

    background_tasks.add_task(
        broadcast_incident_update,
        {"id": str(incident_id), "reko_arrived_at": arrived_at.isoformat() if arrived_at else None},
        "update",
    )
    background_tasks.add_task(
        broadcast_reko_update,
        {"incident_id": str(incident_id)},
        "arrived",
    )

    return schemas.RekoArrivedState(
        incident_id=incident_id,
        arrived_at=arrived_at,
        arrived_reported_by_user_id=report.arrived_reported_by_user_id if report else None,
    )


@router.get("/{incident_id}/rapport", response_model=schemas.SchadenplatzRapport)
async def get_incident_rapport(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.SchadenplatzRapport:
    """The Schadenplatz-Rapport from the board — the same prefill as `/feld` (§4).

    KP parity is a hard requirement, not a convenience (decision 28): the normal
    case is a radio message, and an editor must be able to create a rapport for
    an incident that never had any field contact, fill every field, tick the
    checklist and submit it. **One CRUD module, two thin routers** — the board's
    detail section renders the same form component over this pair.

    Editor-gated rather than `CurrentUser`: the response carries the owner block,
    which is the first citizen PII in kp-rueck (§9).
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    actor = feld_crud.FieldActor(user=current_user)
    return schemas.SchadenplatzRapport(**await feld_crud.get_rapport(db, incident, actor=actor))


@router.put("/{incident_id}/rapport", response_model=schemas.SchadenplatzRapport)
async def save_incident_rapport(
    incident_id: uuid.UUID,
    payload: schemas.RapportUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.SchadenplatzRapport:
    """The KP twin of the `/feld` upsert, over the same CRUD (decision 28).

    **Provenance is never faked.** This path stamps `*_by_user_id`, leaves the
    personnel columns NULL, and every output prints "(Funkmeldung)". A mixed
    report — crew filed, KP amended — shows both lines, which is why the two
    pairs exist rather than one resolved author.
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    actor = feld_crud.FieldActor(user=current_user)
    return schemas.SchadenplatzRapport(
        **await feld_crud.save_rapport(db, incident, actor=actor, payload=payload, request=request)
    )


@router.post("/{incident_id}/rapport/photos", response_model=schemas.RapportPhotosResponse)
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def upload_rapport_photo(
    incident_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
    file: UploadFile = File(...),
) -> schemas.RapportPhotosResponse:
    """The KP twin of the `/feld` photo upload — the WhatsApp-photo case (§6.1).

    A crew with no signal sends the picture over whatever channel works and the
    operator attaches it here. Same CRUD, same storage, same files on disk;
    provenance stays honest — this stamps the user, not a personnel row.
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    actor = feld_crud.FieldActor(user=current_user)
    photos = await feld_crud.add_photo(db, incident, actor=actor, file=file, request=request)
    return schemas.RapportPhotosResponse(
        incident_id=incident.id,
        photos=photos,
        filename=photos[-1] if photos else None,
    )


@router.delete("/{incident_id}/rapport/photos/{filename}", response_model=schemas.RapportPhotosResponse)
@limiter.limit(RateLimits.PHOTO_UPLOAD)
async def delete_rapport_photo(
    incident_id: uuid.UUID,
    filename: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.RapportPhotosResponse:
    """Detach a photo from the board side."""
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    actor = feld_crud.FieldActor(user=current_user)
    photos = await feld_crud.remove_photo(db, incident, actor=actor, filename=filename, request=request)
    return schemas.RapportPhotosResponse(incident_id=incident.id, photos=photos)


@router.get("/{incident_id}/rapport/material-return", response_model=schemas.MaterialReturnResponse)
async def get_rapport_material_return(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
    include_draft: bool = Query(
        False,
        description="Also answer from a rapport that is still a draft. For the completion gate's prefill only.",
    ),
) -> schemas.MaterialReturnResponse:
    """ "Material zurück – freigeben" (decision 17): what the board may release.

    A read only. The releasing itself goes through the existing per-assignment
    release — a field form must not silently write assignments, and the decision
    stays with the operator.

    ``left_on_site`` is returned separately and is **not** in the release set;
    consumables are in neither (decision 26). ``left_on_site_named`` carries the
    "Weiteres Material" the crew left behind (§18.35) — names with no assignment
    under them, so there is nothing to release and the list says so rather than
    letting an operator read silence as "nothing is left there".

    Also the source of truth for the completion gate's prefill (§18): the same
    answers, plus who filed them, so "Material vor Ort oder ins Magazin?" arrives
    already answered instead of asking the crew's question a second time.

    **The two callers differ in exactly one flag (§18.23).** The release list in
    the incident detail is submitted-only (the default): its click releases
    assignments, and doing that off a half-typed checklist is how a pump gets
    freed while it is still running in a cellar. The completion gate passes
    ``include_draft=true``: it only prefills a dialog the operator confirms, and
    a crew that filled the checklist without pressing *Rapport abschliessen* on
    a phone in the rain is the normal case — throwing its answers away is the
    thing this parameter exists to stop. ``rapport_is_draft`` tells the caller
    which it got, so a draft is never quoted as a filed rapport.
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    returned, left = await feld_crud.material_return_units(db, incident, include_draft=include_draft)
    rapport_by, submitted_at, is_draft = await feld_crud.material_return_attribution(
        db, incident, include_draft=include_draft
    )
    return schemas.MaterialReturnResponse(
        returned=[schemas.MaterialReturnUnit(**unit) for unit in returned],
        left_on_site=[schemas.MaterialReturnUnit(**unit) for unit in left],
        left_on_site_named=await feld_crud.material_left_on_site_named(db, incident, include_draft=include_draft),
        rapport_by=rapport_by,
        rapport_submitted_at=submitted_at,
        rapport_is_draft=is_draft,
    )


@router.patch("/{incident_id}/rapport/material-return", response_model=schemas.RapportMaterialDecisionsResponse)
async def apply_rapport_material_decisions(
    incident_id: uuid.UUID,
    payload: schemas.RapportMaterialDecisionsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.RapportMaterialDecisionsResponse:
    """The completion gate's write-back: where the KP decided each unit stays.

    The GET above is the gate's prefill; this is the confirmed answer going the
    other way. «Vor Ort» sets ``left_on_site`` on the rapport's checklist row
    (or "Weiteres Material" entry, addressed by name), «Magazin» clears it — so
    the Restliste and the Abholliste reflect the KP's decision rather than only
    what the crew happened to tick.

    Deliberately a no-op (``applied: false``) when the incident has no rapport
    row at all: a Schadenplatz that was never dispatched has nothing to record,
    and the board's own release — which the gate performs separately — is the
    whole story there.
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident or incident.deleted_at is not None:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
    applied = await feld_crud.apply_material_decisions(db, incident, decisions=payload.decisions)
    return schemas.RapportMaterialDecisionsResponse(applied=applied)


@router.get("/{incident_id}/history", response_model=list[schemas.StatusTransitionResponse])
async def get_status_history(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> list[models.StatusTransition]:
    """Get status transition history for incident."""
    return await crud.get_incident_status_history(db, incident_id)


@router.get("/{incident_id}/participants", response_model=schemas.IncidentParticipantsResponse)
async def get_incident_participants(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> schemas.IncidentParticipantsResponse:
    """Everyone and everything that was on this incident — the "Beteiligt" roll-up.

    Completing an incident releases its crew, so the board's crew list goes
    empty and the record of who actually turned out only survives in the
    assignment rows (soft-released via ``unassigned_at``). This rolls those rows
    up to one entry per resource so the question "who was there" is answerable
    long after the incident closed.

    Distinct from ``/timeline``, which is the raw chronological event feed: this
    is the summary you would read into a report.
    """
    incident = await crud.get_incident(db, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    result = await db.execute(
        select(models.IncidentAssignment)
        .where(models.IncidentAssignment.incident_id == incident_id)
        .order_by(models.IncidentAssignment.assigned_at)
    )
    assignments = list(result.scalars().all())

    # Resolve names in one query per kind rather than per row.
    names: dict[tuple[str, uuid.UUID], str] = {}
    # `type[Any]`, not `type[Base]`: mypy joins the three model classes to their common base,
    # which declares neither `id` nor `name`, so the loop below stopped type-checking (it is
    # what turned main red on 2026-08-05). This is plan 14's pattern 2 — the same reason
    # `SyncService.SYNCABLE_MODELS` is annotated this way. A Protocol does not fit: `select()`
    # needs a real entity, not a structural type.
    lookups: tuple[tuple[str, type[Any]], ...] = (
        ("personnel", models.Personnel),
        ("vehicle", models.Vehicle),
        ("material", models.Material),
    )
    for resource_type, model in lookups:
        ids = {a.resource_id for a in assignments if a.resource_type == resource_type}
        if not ids:
            continue
        rows = await db.execute(select(model).where(model.id.in_(ids)))
        for row in rows.scalars().all():
            names[(resource_type, row.id)] = row.name

    # Who held the Reko function for this event. A Reko person shows up in the
    # assignment rows like anyone else, but they went to look, not to work — the
    # list says so rather than filing them under crew.
    reko_ids: set[uuid.UUID] = set()
    if incident.event_id:
        reko_rows = await db.execute(
            select(models.EventSpecialFunction.personnel_id).where(
                models.EventSpecialFunction.event_id == incident.event_id,
                models.EventSpecialFunction.function_type == "reko",
            )
        )
        reko_ids = {row[0] for row in reko_rows.all()}

    # Who led it. `is_leader` is cleared when an assignment is released, so rolling
    # the raw flag up leaves a completed incident with nobody flagged — in the one
    # view whose entire job is to answer "who was here" long after it closed.
    # Resolve it the way every other reader does.
    active_leader_ids = {
        a.resource_id for a in assignments if a.resource_type == "personnel" and a.is_leader and a.unassigned_at is None
    }
    leader_ids = effective_leader_ids(incident, active_leader_ids)

    rolled: dict[tuple[str, uuid.UUID], schemas.IncidentParticipant] = {}
    for a in assignments:
        key = (a.resource_type, a.resource_id)
        is_leader = a.resource_type == "personnel" and a.resource_id in leader_ids
        existing = rolled.get(key)
        if existing is None:
            rolled[key] = schemas.IncidentParticipant(
                resource_type=a.resource_type,
                resource_id=a.resource_id,
                name=names.get(key),
                first_assigned_at=a.assigned_at,
                last_released_at=a.unassigned_at,
                stints=1,
                is_reko=a.resource_type == "personnel" and a.resource_id in reko_ids,
                is_leader=is_leader,
            )
            continue
        existing.stints += 1
        existing.is_leader = existing.is_leader or is_leader
        # A single still-open stint makes the whole participation still open,
        # whatever order the rows arrived in.
        if existing.last_released_at is not None:
            existing.last_released_at = (
                None if a.unassigned_at is None else max(existing.last_released_at, a.unassigned_at)
            )

    # Longest involvement first — the people who carried the incident read top.
    return schemas.IncidentParticipantsResponse(participants=sorted(rolled.values(), key=lambda p: p.first_assigned_at))


@router.get("/{incident_id}/timeline", response_model=schemas.IncidentTimelineResponse)
async def get_incident_timeline(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
) -> schemas.IncidentTimelineResponse:
    """Get the merged event timeline for an incident.

    Combines status transitions, resource assignments (assign + unassign) and
    the field's Freitext-Meldungen into a single chronologically sorted list.
    It is the whole content of the "Verlauf" tab in the operation detail, and
    the source of the message thread shown next to the Feldmeldungen.
    """
    # Verify incident exists
    incident = await crud.get_incident(db, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    # Load status transitions with the user who made each change
    transitions_result = await db.execute(
        select(models.StatusTransition, models.User)
        .outerjoin(models.User, models.StatusTransition.user_id == models.User.id)
        .where(models.StatusTransition.incident_id == incident_id)
    )
    transitions = transitions_result.all()

    # Load assignments with the user who made each assignment
    assignments_result = await db.execute(
        select(models.IncidentAssignment, models.User)
        .outerjoin(models.User, models.IncidentAssignment.assigned_by == models.User.id)
        .where(models.IncidentAssignment.incident_id == incident_id)
    )
    assignments = assignments_result.all()

    # Freitext-Meldungen from the field. They have no table of their own — see
    # `crud/feld.record_field_message`, which writes them as an append-only
    # audit-log entry plus a notification. That was exactly the problem: the
    # notification is dismissible and the audit log is not rendered anywhere on
    # the incident, so what a crew radioed in was visible nowhere afterwards.
    # Reading them back here is what puts them in the incident's own history.
    messages_result = await db.execute(
        select(models.AuditLog, models.User)
        .outerjoin(models.User, models.AuditLog.user_id == models.User.id)
        .where(
            models.AuditLog.resource_type == "incident",
            models.AuditLog.resource_id == incident_id,
            models.AuditLog.action_type == "field_message",
        )
    )
    field_messages = messages_result.all()

    # …and the KP's own messages to the squad (sweep 27 §P3.2). They have a
    # table (`incident_field_messages`) because `/feld` has to read them back;
    # here they interleave with the crew's sentences so the thread shows both
    # halves of the conversation.
    kp_messages = await kp_messages_crud.messages_for_incident(db, incident_id)

    # Bulk-fetch resource names so we don't N+1 query
    personnel_ids = {a.resource_id for a, _ in assignments if a.resource_type == "personnel"}
    vehicle_ids = {a.resource_id for a, _ in assignments if a.resource_type == "vehicle"}
    material_ids = {a.resource_id for a, _ in assignments if a.resource_type == "material"}

    personnel_names: dict[uuid.UUID, str] = {}
    if personnel_ids:
        result = await db.execute(select(models.Personnel).where(models.Personnel.id.in_(personnel_ids)))
        personnel_names = {p.id: p.name for p in result.scalars().all()}

    vehicle_names: dict[uuid.UUID, str] = {}
    if vehicle_ids:
        result = await db.execute(select(models.Vehicle).where(models.Vehicle.id.in_(vehicle_ids)))
        vehicle_names = {v.id: v.name for v in result.scalars().all()}

    material_names: dict[uuid.UUID, str] = {}
    if material_ids:
        result = await db.execute(select(models.Material).where(models.Material.id.in_(material_ids)))
        material_names = {m.id: m.name for m in result.scalars().all()}

    def _resource_name(resource_type: str, resource_id: uuid.UUID) -> str | None:
        if resource_type == "personnel":
            return personnel_names.get(resource_id)
        if resource_type == "vehicle":
            return vehicle_names.get(resource_id)
        if resource_type == "material":
            return material_names.get(resource_id)
        return None

    def _actor(user: models.User | None) -> str | None:
        if user is None:
            return None
        return user.display_name or user.username

    events: list[schemas.IncidentTimelineEvent] = []

    for transition, user in transitions:
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="status_change",
                timestamp=transition.timestamp,
                actor_name=_actor(user),
                from_status=transition.from_status,
                to_status=transition.to_status,
                notes=transition.notes,
            )
        )

    for assignment, user in assignments:
        actor = _actor(user)
        name = _resource_name(assignment.resource_type, assignment.resource_id)
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="assignment",
                timestamp=assignment.assigned_at,
                actor_name=actor,
                assignment_action="assigned",
                resource_type=assignment.resource_type,
                resource_name=name,
            )
        )
        if assignment.unassigned_at is not None:
            # No `unassigned_by` field — actor unknown for unassign events
            events.append(
                schemas.IncidentTimelineEvent(
                    event_type="assignment",
                    timestamp=assignment.unassigned_at,
                    actor_name=None,
                    assignment_action="unassigned",
                    resource_type=assignment.resource_type,
                    resource_name=name,
                )
            )

    for entry, user in field_messages:
        changes = entry.changes_json or {}
        text = changes.get("message")
        if not text:
            continue
        # Provenance, never faked: a crew member's name when the message came
        # through /feld, the operator's when it was typed in the KP.
        personnel_name = changes.get("personnel_name")
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="field_message",
                timestamp=entry.timestamp,
                actor_name=personnel_name or _actor(user),
                message=str(text),
                source=changes.get("source"),
            )
        )

    for kp_message in kp_messages:
        events.append(
            schemas.IncidentTimelineEvent(
                event_type="kp_message",
                timestamp=kp_message.created_at,
                actor_name=kp_message.author_name,
                message=kp_message.message,
                source="kp",
            )
        )

    events.sort(key=lambda e: e.timestamp)

    # Collapse near-duplicate events: same payload within a short time window
    # is treated as one event. Covers cascading unassigns on completion plus
    # bursty re-clicks. Real re-assignments minutes apart are kept.
    dedup_window_seconds = 10
    last_seen: dict[tuple[str, str | None, str | None, str | None, str | None, str | None], datetime] = {}
    deduped: list[schemas.IncidentTimelineEvent] = []
    for event in events:
        # Messages are never deduplicated. They are human input, they are the
        # one kind of entry here nobody can reconstruct from board state, and a
        # crew tapping the same chip twice is itself information.
        if event.event_type in ("field_message", "kp_message"):
            deduped.append(event)
            continue
        payload_key = (
            event.event_type,
            event.from_status,
            event.to_status,
            event.assignment_action,
            event.resource_type,
            event.resource_name,
        )
        prev_ts = last_seen.get(payload_key)
        if prev_ts is not None and (event.timestamp - prev_ts).total_seconds() < dedup_window_seconds:
            continue
        last_seen[payload_key] = event.timestamp
        deduped.append(event)

    # Display order: newest first. Dedup happens on the ascending sort above so
    # the "earliest of a near-duplicate cluster" is the one we keep.
    deduped.reverse()
    return schemas.IncidentTimelineResponse(events=deduped)


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> None:
    """Delete incident (hard delete for training, soft delete for live)."""
    success = await crud.delete_incident(
        db=db,
        incident_id=incident_id,
        current_user=current_user,
        request=request,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Broadcast WebSocket update for deletion
    background_tasks.add_task(broadcast_incident_update, {"id": str(incident_id)}, "delete")


@router.post("/{incident_id}/restore", response_model=schemas.IncidentResponse)
async def restore_incident(
    incident_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.IncidentResponse:
    """Restore a soft-deleted incident (editor only).

    Powers the "Rückgängig" undo affordance. Idempotency guard: restoring an
    incident that is not deleted returns 409, so a double-click on the undo
    toast is harmless. Unknown ID returns 404. Broadcasts an incident update so
    other boards re-show the card without a manual refresh.
    """
    try:
        incident = await crud.restore_incident(
            db=db,
            incident_id=incident_id,
            current_user=current_user,
            request=request,
        )
    except ValueError:
        raise HTTPException(status_code=409, detail=ErrorMessages.CONFLICT) from None
    except IntegrityError:
        # Defensive: restore_incident appends route stops at the end to avoid a
        # group_position collision, but guard against any other unique-constraint
        # race so the undo returns a clean 409 rather than a 500.
        await db.rollback()
        raise HTTPException(status_code=409, detail=ErrorMessages.CONFLICT) from None

    if not incident:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    # Re-fetch with populated relationships (assigned_vehicles, reko flags, …) so
    # the response mirrors GET /{id} and the frontend can consume it directly.
    populated = await crud.get_incident(db, incident_id)
    incident_response = await incident_display.incident_with_display(db, populated or incident)

    # Broadcast WebSocket update (mirror the update path) so other clients
    # re-show the restored card.
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "update")

    return incident_response


@router.post("/{incident_id}/transfer", response_model=schemas.TransferAssignmentsResponse)
async def transfer_assignments(
    incident_id: uuid.UUID,
    transfer_request: schemas.TransferAssignmentsRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
) -> schemas.TransferAssignmentsResponse:
    """
    Transfer all active assignments from this incident to another incident (editor only).

    This will:
    1. Move all personnel, vehicle, and material assignments
    2. Block if any resource is already assigned to target
    3. Log the transfer action
    4. Broadcast WebSocket updates
    """
    from ..crud import assignments as assignment_crud

    try:
        result = await assignment_crud.transfer_assignments(
            db=db,
            source_incident_id=incident_id,
            target_incident_id=transfer_request.target_incident_id,
            current_user=current_user,
            request=request,
        )
    except ValueError as e:
        # Surface the specific reason (which resource conflicts / nothing to transfer)
        # so the operator sees why it failed instead of a generic message.
        logger.warning("Assignment transfer failed for incident %s: %s", incident_id, e)
        msg = str(e)
        low = msg.lower()
        if "not found" in low or "nicht gefunden" in low:
            raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND) from e
        elif "bereits zugewiesen" in low or "already assigned" in low or "conflict" in low:
            raise HTTPException(status_code=409, detail=msg) from e
        else:
            raise HTTPException(status_code=400, detail=msg) from e

    # Get event_id for WebSocket broadcast
    incident_result = await db.execute(select(models.Incident).where(models.Incident.id == incident_id))
    incident = incident_result.scalar_one()
    event_id = incident.event_id

    # Broadcast WebSocket update
    from ..websocket_manager import broadcast_message

    background_tasks.add_task(
        broadcast_message,
        data={
            "type": "assignments_transferred",
            "source_incident_id": str(incident_id),
            "target_incident_id": str(transfer_request.target_incident_id),
            "assignment_ids": [str(aid) for aid in result["assignment_ids"]],
            "count": result["transferred_count"],
            "event_id": str(event_id),
        },
        room="operations",
    )

    return schemas.TransferAssignmentsResponse(
        transferred_count=result["transferred_count"],
        assignment_ids=result["assignment_ids"],
        message=f"{result['transferred_count']} Ressourcen übertragen",
    )
