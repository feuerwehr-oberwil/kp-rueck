"""Middleware to automatically log API requests.

Uses pure ASGI middleware (not BaseHTTPMiddleware) to avoid
TaskGroup/ExceptionGroup crashes when stacked with other middlewares.
"""

import asyncio
import logging
import time

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..database import audit_session_maker
from ..services.audit import log_action

logger = logging.getLogger(__name__)


async def _log_api_request(
    user,
    path: str,
    method: str,
    duration_ms: float,
    test_db_session=None,
):
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

        # Only log successful API requests (skip health checks, static files)
        request = Request(scope)
        if status_code < 300 and request.url.path.startswith("/api/") and request.url.path != "/api/health":
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
                asyncio.create_task(
                    _log_api_request(
                        user=user,
                        path=request.url.path,
                        method=request.method,
                        duration_ms=duration_ms,
                        test_db_session=None,
                    )
                )
