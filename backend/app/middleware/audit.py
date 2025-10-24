"""Middleware to automatically log API requests."""
import time
from typing import Callable

from fastapi import BackgroundTasks, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from ..services.audit import log_action
from ..database import audit_session_maker


async def _log_api_request(
    user,
    path: str,
    method: str,
    duration_ms: float,
):
    """Background task to log API request to audit log using separate connection pool."""
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
                request=None,  # Request object not available in background task
            )
            await db.commit()
        except Exception as e:
            # Never fail request due to audit logging
            print(f"Audit logging failed: {e}")


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
        if (
            response.status_code < 300
            and request.url.path.startswith("/api/")
            and request.url.path != "/api/health"
        ):
            # Schedule audit logging using separate connection pool to avoid conflicts
            duration_ms = round((time.time() - start_time) * 1000, 2)
            user = getattr(request.state, "user", None)

            # Get or create background_tasks
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
            )

            response.background = background_tasks

        return response
