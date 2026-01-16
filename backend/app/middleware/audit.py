"""Middleware to automatically log API requests."""

import logging
import time
from collections.abc import Callable

from fastapi import BackgroundTasks, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

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


class AuditMiddleware(BaseHTTPMiddleware):
    """
    Log all API requests to audit log.

    Note: Only logs successful requests (2xx status codes).
    Failed requests are logged by exception handlers.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and log if appropriate."""
        start_time = time.time()

        # Call next middleware/route
        response = await call_next(request)

        # Only log successful API requests (skip health checks, static files)
        if response.status_code < 300 and request.url.path.startswith("/api/") and request.url.path != "/api/health":
            duration_ms = round((time.time() - start_time) * 1000, 2)
            user = getattr(request.state, "user", None)

            # Check if test session is injected
            test_db_session = getattr(request.app.state, "test_db_session", None)

            # In test mode, log synchronously to ensure tests can verify immediately
            if test_db_session is not None:
                # Test mode: use injected session synchronously
                await _log_api_request(
                    user=user,
                    path=request.url.path,
                    method=request.method,
                    duration_ms=duration_ms,
                    test_db_session=test_db_session,
                )
            else:
                # Production: Use background tasks with separate connection pool
                if not hasattr(response, "background") or response.background is None:
                    background_tasks = BackgroundTasks()
                else:
                    background_tasks = response.background

                background_tasks.add_task(
                    _log_api_request,
                    user=user,
                    path=request.url.path,
                    method=request.method,
                    duration_ms=duration_ms,
                    test_db_session=None,
                )

                response.background = background_tasks

        return response
