"""Middleware to automatically log API requests.

Uses pure ASGI middleware (not BaseHTTPMiddleware) to avoid
TaskGroup/ExceptionGroup crashes when stacked with other middlewares.
"""

import asyncio
import logging
import time
from collections.abc import Coroutine
from typing import TYPE_CHECKING

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..database import audit_session_maker
from ..services.audit import log_action

if TYPE_CHECKING:
    from ..models.user import User

logger = logging.getLogger(__name__)

# Strong references to in-flight audit tasks; see the create_task call below.
_inflight_audit_tasks: set[asyncio.Task[None]] = set()


async def _log_api_request(user: "User | None", path: str, method: str, duration_ms: float) -> None:
    """Write one mutation's audit row through `audit_session_maker`, its own connection pool.

    Never raises: a failed or timed-out audit write is logged, the request is not affected.
    """
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


async def _dispatch(write: Coroutine[None, None, None]) -> None:
    """Start the audit write in the background and return at once: a slow write never adds
    latency to the request.

    The tests' `client` fixture (`tests/conftest.py` `route_audit_into`) replaces this with
    an awaited write into the test session, whose one connection cannot run two statements
    at once.
    """
    # Strong reference until it finishes: asyncio keeps only a weak one, so an
    # unreferenced task can be collected mid-flight and the audit entry is lost.
    task = asyncio.create_task(write)
    _inflight_audit_tasks.add(task)
    task.add_done_callback(_inflight_audit_tasks.discard)


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

            await _dispatch(
                _log_api_request(user=user, path=request.url.path, method=request.method, duration_ms=duration_ms)
            )
