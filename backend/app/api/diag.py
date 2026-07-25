"""Diagnostics: the station's own error sink, and the two opt-in channels upstream.

The sink comes first and is the primary thing this module does — a crash on the board is
invisible to whoever runs the server, so the browser posts uncaught errors here and they
surface in the SERVER log, on the station's own machine, where the deployer already looks.
That path needs no consent and no network: it is the app telling its own operator what
happened.

What consent gates is the SECOND hop. Two channels, gated differently on purpose:

* ``POST /diag/client-error`` — background. Additionally queued for upstream only when an
  admin has switched telemetry on. Unauthenticated (a crash can happen on the login screen),
  so it is capped per hour on top of the client's own per-session cap.
* ``POST /diag/report`` — the manual "Problem melden" form. Requires a logged-in user and is
  queued regardless of the background switch, because the operator saw the payload and
  pressed send. Refused only when the DEPLOYER has disabled outbound entirely.

The contract for all of it: never 500, never trust the payload. A diagnostics sink that
becomes a source of errors is worse than no sink.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentAdmin, CurrentUser
from ..config import settings
from ..database import get_db
from ..logging_config import get_logger
from ..models import TelemetryOutbox
from ..telemetry import consent as consent_mod
from ..telemetry import outbox, scrub
from ..telemetry.envelope import build_event

logger = get_logger("kprueck.clienterror")

router = APIRouter(prefix="/diag", tags=["diag"])

# Ceiling on background payloads queued per hour, per instance. The client caps itself too,
# but that cap lives in code an attacker controls — this one is ours.
MAX_QUEUED_PER_HOUR = 60

APP_NAME = "kp-rueck"


class ClientError(BaseModel):
    """A bounded report of a frontend error. All fields optional/length-capped."""

    message: str = Field(default="", max_length=2000)
    stack: str | None = Field(default=None, max_length=8000)
    component_stack: str | None = Field(default=None, max_length=8000, alias="componentStack")
    # 'render' | 'error' | 'unhandledrejection'
    kind: str = Field(default="error", max_length=40)
    path: str | None = Field(default=None, max_length=400)
    build: str | None = Field(default=None, max_length=120)


class ProblemReport(BaseModel):
    """The manual channel. ``message`` is the whole point; the rest is context the dialog
    already showed the operator verbatim before they pressed send."""

    message: str = Field(default="", max_length=4000)
    build: str | None = Field(default=None, max_length=120)
    locale: str | None = Field(default=None, max_length=20)
    viewport: str | None = Field(default=None, max_length=40)
    online: bool | None = None


async def _queued_last_hour(db: AsyncSession) -> int:
    since = datetime.now(UTC) - timedelta(hours=1)
    return int(
        (
            await db.execute(
                select(func.count()).select_from(TelemetryOutbox).where(TelemetryOutbox.created_at >= since)
            )
        ).scalar()
        or 0
    )


@router.post("/client-error", status_code=204)
async def report_client_error(payload: ClientError, request: Request, db: AsyncSession = Depends(get_db)) -> None:
    """Log a client-reported error at WARNING (visible without DEBUG). Never raises."""
    ua = request.headers.get("user-agent", "?")[:300]
    try:
        logger.warning(
            "client-error kind=%s build=%s path=%s ua=%s :: %s%s",
            payload.kind,
            payload.build,
            payload.path,
            ua,
            payload.message,
            f"\n{payload.stack}" if payload.stack else "",
        )
    except Exception:  # noqa: BLE001 — a diagnostics sink must never raise
        pass

    try:
        if await consent_mod.get_consent(db) != consent_mod.CONSENT_ERRORS:
            return
        if await _queued_last_hour(db) >= MAX_QUEUED_PER_HOUR:
            logger.debug("telemetry: hourly queue cap reached, dropping")
            return
        install_id = await consent_mod.get_install_id(db, mint=True)
        event = build_event(
            channel="error",
            context=scrub.build_context(
                install_id=install_id or "unknown",
                app=APP_NAME,
                release=payload.build or "unknown",
                user_agent=ua,
            ),
            error=scrub.build_error(
                kind=payload.kind,
                message=payload.message,
                stack=payload.stack,
                component_stack=payload.component_stack,
                path=payload.path,
            ),
        )
        await outbox.enqueue(db, channel="error", payload=event)
        await db.commit()
    except Exception:  # noqa: BLE001 — telemetry must never break the sink it hangs off
        await db.rollback()
        logger.debug("telemetry: could not queue client error", exc_info=True)


@router.post("/report", status_code=202)
async def submit_problem_report(
    payload: ProblemReport,
    request: Request,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Queue a manual problem report. Pressing send IS the consent — see telemetry/consent.py.

    Returns the sanitised payload so the UI can show, after the fact, exactly what was queued.
    A preview the sender writes is a promise; one the receiver echoes back is a check.
    """
    if not consent_mod.env_allows_outbound():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="outbound-disabled")
    try:
        install_id = await consent_mod.get_install_id(db, mint=True)
        event = build_event(
            channel="report",
            context=scrub.build_context(
                install_id=install_id or "unknown",
                app=APP_NAME,
                release=payload.build or "unknown",
                user_agent=request.headers.get("user-agent", "")[:300],
                viewport=payload.viewport,
                locale=payload.locale,
                online=payload.online,
            ),
            report=scrub.build_report(message=payload.message, trouble_kind=None, trouble_at=None),
        )
        await outbox.enqueue(db, channel="report", payload=event)
        await db.commit()
    except Exception:  # noqa: BLE001
        await db.rollback()
        logger.exception("problem report could not be queued")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="queue-failed") from None
    return {"queued": True, "sent": event}


# --- Admin surface --------------------------------------------------------------------


class ConsentUpdate(BaseModel):
    consent: str = Field(max_length=16)


@router.get("/telemetry")
async def telemetry_status(current_user: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Everything the admin screen needs to answer "what is this instance sending".

    Includes the last few payloads verbatim. The queue is the honest answer to that question
    and there is no reason to summarise it — a fire station should be able to read the actual
    JSON without opening psql.
    """
    rows = list(
        (await db.execute(select(TelemetryOutbox).order_by(TelemetryOutbox.created_at.desc()).limit(10)))
        .scalars()
        .all()
    )
    return {
        "consent": await consent_mod.get_consent(db),
        # A missing row is off, but it is not an ANSWER — the UI asks once rather than letting
        # "nobody looked at it yet" read as a decision.
        "decided": await consent_mod.is_decided(db),
        "installId": await consent_mod.get_install_id(db),
        # False when the DEPLOYER disabled it in env — the UI must then explain that the
        # switch it is showing cannot do anything, rather than pretend it can.
        "outboundAllowed": consent_mod.env_allows_outbound(),
        "ingestConfigured": bool(settings.telemetry_dsn),
        "pending": sum(1 for r in rows if r.sent_at is None),
        "recent": [
            {
                "id": str(r.id),
                "channel": r.channel,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
                "sentAt": r.sent_at.isoformat() if r.sent_at else None,
                "attempts": r.attempts,
                "lastError": r.last_error,
                "payload": r.payload_json,
            }
            for r in rows
        ],
    }


@router.put("/telemetry/consent")
async def update_consent(body: ConsentUpdate, current_user: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Turn the background channel on or off. Off also discards whatever is still queued."""
    try:
        value = await consent_mod.set_consent(db, body.consent)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    discarded = 0
    if value == consent_mod.CONSENT_OFF:
        discarded = await outbox.drop_unsent(db, channel="error")
    await db.commit()
    return {"consent": value, "discarded": discarded}


@router.post("/telemetry/install-id")
async def rotate_install_id(current_user: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Mint a fresh install id, cutting the link to everything sent so far."""
    new_id = await consent_mod.regenerate_install_id(db)
    await db.commit()
    return {"installId": new_id}
