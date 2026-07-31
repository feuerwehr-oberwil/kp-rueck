"""Middleware to automatically log API requests.

Uses pure ASGI middleware (not BaseHTTPMiddleware) to avoid
TaskGroup/ExceptionGroup crashes when stacked with other middlewares.
"""

import asyncio
import logging
import time
from typing import TYPE_CHECKING

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..database import audit_session_maker
from ..services.audit import log_action

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from ..models.user import User

logger = logging.getLogger(__name__)

# Strong references to in-flight audit tasks; see the create_task call below.
_inflight_audit_tasks: set[asyncio.Task[None]] = set()


async def _log_api_request(
    user: "User | None",
    path: str,
    method: str,
    duration_ms: float,
    test_db_session: "AsyncSession | None" = None,
) -> None:
    """Background task to log API request to audit log using separate connection pool."""
    # In test mode with injected session, use that session directly (no commit needed)
    if test_db_session is not None:
        try:
            await log_action(
                db=test_db_session,
                action_type=f"{method.lower()}_request",
                resource_type="api",
                user=user,
                changes={
                    "path": path,
                    "method": method,
                    "duration_ms": duration_ms,
                },
                request=None,
            )
            await test_db_session.commit()
        except Exception as e:
            logger.error("Audit logging failed: %s", e)
    else:
        # Production: use separate connection pool
        # Catch pool timeout errors gracefully - audit should never block requests
        try:
            async with audit_session_maker() as db:
                try:
                    await log_action(
                        db=db,
                        action_type=f"{method.lower()}_request",
                        resource_type="api",
                        user=user,
                        changes={
                            "path": path,
                            "method": method,
                            "duration_ms": duration_ms,
                        },
                        request=None,
                    )
                    await db.commit()
                except Exception as e:
                    logger.error("Audit logging failed: %s", e)
        except TimeoutError:
            # Pool exhausted - log warning but don't fail
            logger.warning("Audit pool timeout - request not logged: %s %s", method, path)
        except Exception as e:
            # Any other pool/connection error
            logger.error("Audit session error: %s", e)


class AuditMiddleware:
    """
    Log all API requests to audit log (pure ASGI middleware).

    Note: Only logs successful requests (2xx status codes).
    Failed requests are logged by exception handlers.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start_time = time.time()
        status_code = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        await self.app(scope, receive, send_wrapper)

        # Only log successful API requests that CHANGE something (skip health, static files).
        #
        # Reads used to be logged too, which made the audit log grow with traffic rather than
        # with activity: the board polls /api/incidents and /api/sync-version every ~5 s per
        # client, so two idle wall displays alone wrote on the order of a gigabyte a year, and
        # a storm at ~90 req/s several gigabytes a day. With retention defaulting to "keep
        # forever" that ends as a full disk mid-operation — and on a station box the database
        # shares that disk, so Postgres write-stops and the board dies.
        #
        # The record this exists for is fully intact: every create/update/delete is still
        # written, both here and as domain entries via log_action. What is deliberately given
        # up is "who VIEWED what" — read tracking that nothing in the product consumes and no
        # export reports.
        request = Request(scope)
        is_mutation = request.method in {"POST", "PUT", "PATCH", "DELETE"}
        if (
            status_code < 300
            and is_mutation
            and request.url.path.startswith("/api/")
            and request.url.path != "/api/health"
        ):
            duration_ms = round((time.time() - start_time) * 1000, 2)
            user = getattr(request.state, "user", None)

            # Check if test session is injected
            test_db_session = getattr(request.app.state, "test_db_session", None)

            if test_db_session is not None:
                # Test mode: log synchronously to ensure tests can verify immediately
                await _log_api_request(
                    user=user,
                    path=request.url.path,
                    method=request.method,
                    duration_ms=duration_ms,
                    test_db_session=test_db_session,
                )
            else:
                # Production: fire-and-forget
                # Strong reference until it finishes: asyncio keeps only a weak one, so an
                # unreferenced task can be collected mid-flight and the audit entry is lost.
                task = asyncio.create_task(
                    _log_api_request(
                        user=user,
                        path=request.url.path,
                        method=request.method,
                        duration_ms=duration_ms,
                        test_db_session=None,
                    )
                )
                _inflight_audit_tasks.add(task)
                task.add_done_callback(_inflight_audit_tasks.discard)
