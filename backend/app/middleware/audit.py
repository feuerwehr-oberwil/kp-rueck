"""Middleware to automatically log API requests."""
import time
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from ..services.audit import log_action
from ..database import async_session_maker


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
            # Log in background (don't slow down response)
            async with async_session_maker() as db:
                try:
                    user = getattr(request.state, "user", None)

                    await log_action(
                        db=db,
                        action_type=f"{request.method.lower()}_request",
                        resource_type="api",
                        user=user,
                        changes={
                            "path": request.url.path,
                            "method": request.method,
                            "duration_ms": round((time.time() - start_time) * 1000, 2),
                        },
                        request=request,
                    )

                    await db.commit()
                except Exception as e:
                    # Never fail request due to audit logging
                    print(f"Audit logging failed: {e}")

        return response
