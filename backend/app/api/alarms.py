"""Generic (provider-neutral) alarm intake API.

``POST /api/alarms`` lets any dispatch system deliver alarms into the intake
pool with a single HTTP call — no vendor SDK, no Divera account. Delivered
alarms behave exactly like Divera alarms: they land in the pool, auto-attach
to the active event when enabled, and are broadcast to all connected clients.

Authentication uses the same shared secret as the Divera webhook — the
``ALARM_WEBHOOK_SECRET`` env var, else the ``alarm_webhook_secret`` setting —
passed as ``?secret=`` or via the ``X-Webhook-Secret`` header. Unlike the Divera
adapter (which stays permissive for backward compatibility), this endpoint fails
closed: no configured secret means no access.

See docs/ALARM-INTEGRATIONS.md for the integration guide.
"""

import logging
import secrets as _secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..crud import divera as divera_crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..schemas.alarms import RESERVED_ALARM_SOURCES
from ..services.divera_intake import broadcast_emergency_received, try_auto_attach
from ..services.settings import get_alarm_webhook_secret

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alarms", tags=["alarms"])


async def _check_webhook_secret(db: AsyncSession, request: Request) -> None:
    """Validate the shared webhook secret; fail closed when none is configured."""
    webhook_secret = await get_alarm_webhook_secret(db)
    if not webhook_secret:
        logger.warning("Generic alarm rejected: no alarm_webhook_secret configured")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

    provided = request.query_params.get("secret", "") or request.headers.get("X-Webhook-Secret", "")
    if not provided or not _secrets.compare_digest(provided, webhook_secret):
        logger.warning("Generic alarm rejected: invalid or missing secret")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)


@router.post("", response_model=schemas.AlarmAck, status_code=status.HTTP_200_OK)
@limiter.limit(RateLimits.WEBHOOK)
async def receive_alarm(
    alarm: schemas.AlarmIn,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request = None,
):
    """
    Receive a provider-neutral alarm and store it in the intake pool.

    1. Validates the shared webhook secret (query param or X-Webhook-Secret header)
    2. Deduplicates redeliveries by (source, source_id) when source_id is given
    3. Stores the alarm in the pool
    4. Auto-attaches it (as a new incident) to the newest active event that has
       auto-attach enabled — otherwise it stays in the pool for manual attachment
    5. Broadcasts a WebSocket notification to all connected clients
    """
    await _check_webhook_secret(db, request)

    if alarm.source in RESERVED_ALARM_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"source '{alarm.source}' is reserved — pick your own slug for this sender",
        )

    try:
        # Redelivery of a known alarm acks the existing pool entry (idempotency)
        if alarm.source_id is not None:
            existing = await divera_crud.get_emergency_by_source(db, alarm.source, alarm.source_id)
            if existing:
                logger.info("Duplicate alarm ignored: %s:%s", alarm.source, alarm.source_id)
                return schemas.AlarmAck(
                    created=False,
                    emergency_id=existing.id,
                    auto_attached_incident_id=existing.created_incident_id,
                )

        emergency = await divera_crud.create_alarm_emergency(db, alarm)

        logger.info(
            "New alarm received via generic webhook: %s:%s, Title: %s",
            emergency.source,
            emergency.source_id,
            emergency.title,
        )

        incident = await try_auto_attach(db, emergency)

        background_tasks.add_task(
            broadcast_emergency_received,
            schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode="json"),
            schemas.IncidentResponse.model_validate(incident).model_dump(mode="json") if incident else None,
            emergency.source,
        )

        return schemas.AlarmAck(
            created=True,
            emergency_id=emergency.id,
            auto_attached_incident_id=incident.id if incident else None,
        )

    except IntegrityError:
        # Concurrent redelivery raced past the dedupe check; ack the winner.
        await db.rollback()
        existing = (
            await divera_crud.get_emergency_by_source(db, alarm.source, alarm.source_id)
            if alarm.source_id is not None
            else None
        )
        if existing:
            return schemas.AlarmAck(
                created=False,
                emergency_id=existing.id,
                auto_attached_incident_id=existing.created_incident_id,
            )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Alarm already exists")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error processing generic alarm")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error processing alarm")
