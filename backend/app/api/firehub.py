"""FireHub (Tercero) webhook integration.

FireHub fires a station-configured webhook on its ``Einsatzstart`` and ``Einsatzende``
triggers. This adapter maps that payload onto the provider-neutral intake pipeline
(``source="firehub"``): a *start* lands the alarm in the pool and auto-attaches it to the
active event exactly like a Divera alarm.

An *end* is recorded, not acted on. Closing a Schadenplatz — and releasing the personnel and
vehicles on it — stays the operator's decision, so ``end`` never moves a card: it writes a
note to the audit trail (Einsatztagebuch), linked to the incident when the alarm was pulled
onto the board. A Wehr that does not want the note simply does not wire the Einsatzende
webhook; the split lives in FireHub's configuration. (KP Front, which owns the Einsatzrapport,
can use the same end to stamp the report's end time — a change in that repo, not this one.)

Auth is the same shared secret as ``POST /api/alarms`` and the Divera webhook —
``?secret=`` or ``X-Webhook-Secret`` — and fails closed when none is configured.

See docs/ALARM-INTEGRATIONS.md.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..crud import divera as divera_crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..services.audit import log_action
from ..services.divera_intake import broadcast_emergency_received, check_webhook_secret, try_auto_attach

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/firehub", tags=["firehub"])


@router.post("/webhook", status_code=status.HTTP_200_OK, response_model=None)
@limiter.limit(RateLimits.WEBHOOK)
async def receive_firehub_webhook(
    payload: schemas.FireHubWebhook,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    # FastAPI injects this itself and the `= None` default is unreachable; annotating it
    # `| None` turns it into a Pydantic body field and the app fails at import.
    request: Request = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """
    Receive a FireHub Einsatzstart/Einsatzende webhook.

    1. Validates the shared webhook secret (query param or X-Webhook-Secret header)
    2. On ``trigger.action == "end"``: records an audit note, without moving the card
    3. Otherwise (``start``): deduplicates by ``opsID``, stores the alarm, auto-attaches it
       to the newest active event with auto-attach on, and broadcasts to all clients
    """
    await check_webhook_secret(db, request, label="FireHub webhook")

    source_id = str(payload.operation.ops_id)

    if payload.trigger.action.lower() == "end":
        return await _handle_end(db, source_id)

    return await _handle_start(db, payload, background_tasks)


async def _handle_start(
    db: AsyncSession,
    payload: schemas.FireHubWebhook,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """Store (or ack a redelivery of) a FireHub operation start as a pool alarm."""
    alarm = payload.to_alarm()
    # opsID is required, so the dedupe key is always present — take it straight from the
    # payload (a str, unlike the Optional AlarmIn.source_id) for the lookups below.
    source_id = str(payload.operation.ops_id)

    # Redelivery of a known operation acks the existing pool entry (idempotency on opsID).
    existing = await divera_crud.get_emergency_by_source(db, alarm.source, source_id)
    if existing:
        logger.info("Duplicate FireHub alarm ignored: firehub:%s", source_id)
        return _start_ack(existing.id, existing.created_incident_id, created=False)

    try:
        emergency = await divera_crud.create_alarm_emergency(db, alarm)
    except IntegrityError:
        # Concurrent redelivery raced past the dedupe check; ack the winner.
        await db.rollback()
        existing = await divera_crud.get_emergency_by_source(db, alarm.source, source_id)
        if existing:
            return _start_ack(existing.id, existing.created_incident_id, created=False)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Alarm already exists") from None

    logger.info("New FireHub alarm: firehub:%s, Title: %s", emergency.source_id, emergency.title)

    incident = await try_auto_attach(db, emergency)

    background_tasks.add_task(
        broadcast_emergency_received,
        schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode="json"),
        schemas.IncidentResponse.model_validate(incident).model_dump(mode="json") if incident else None,
        emergency.source,
    )

    return _start_ack(emergency.id, incident.id if incident else None, created=True)


async def _handle_end(db: AsyncSession, source_id: str) -> dict[str, Any]:
    """Record an operation end as an audit note, without moving the card.

    Closing a Schadenplatz — and the personnel/vehicle release that comes with it — is the
    operator's decision, not the dispatch system's, so ``end`` never changes incident status.
    It writes one audit-log row (attributed to no user; ``user=None`` is the system path),
    linked to the incident when the alarm was pulled onto the board. FireHub carries no
    distinct end timestamp, so the note records the receipt time. An end for an alarm we never
    saw (start lost, already purged) is an idempotent no-op.
    """
    emergency = await divera_crud.get_emergency_by_source(db, "firehub", source_id)

    if emergency is None:
        logger.info("FireHub end for unknown alarm firehub:%s — nothing to note", source_id)
        return {"status": "ok", "action": "end", "noted": False, "emergency_id": None, "incident_id": None}

    incident_id = emergency.created_incident_id
    await log_action(
        db,
        action_type="firehub_operation_end",
        resource_type="incident" if incident_id else "emergency",
        resource_id=incident_id or emergency.id,
        user=None,
        changes={
            "source": "firehub",
            "ops_id": source_id,
            "ended_at": datetime.now(UTC).isoformat(),
            "emergency_id": str(emergency.id),
        },
    )
    # log_action only flushes; the audit row is rolled back on session close without this.
    await db.commit()
    logger.info("FireHub end noted for firehub:%s (incident=%s)", source_id, incident_id)

    return {
        "status": "ok",
        "action": "end",
        "noted": True,
        "emergency_id": str(emergency.id),
        "incident_id": str(incident_id) if incident_id else None,
    }


def _start_ack(emergency_id: Any, incident_id: Any, *, created: bool) -> dict[str, Any]:
    """Shape the JSON ack for a start webhook (mirrors the generic AlarmAck fields)."""
    return {
        "status": "ok",
        "action": "start",
        "created": created,
        "emergency_id": str(emergency_id),
        "auto_attached_incident_id": str(incident_id) if incident_id else None,
    }
