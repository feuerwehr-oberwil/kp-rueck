"""Rate limiting middleware using slowapi.

Uses pure ASGI middleware (not BaseHTTPMiddleware) to avoid
TaskGroup/ExceptionGroup crashes when stacked with other middlewares.

Provides protection against:
- Brute force attacks on authentication endpoints
- DoS attacks through resource-heavy endpoints
- API abuse

Configuration:
- Auth endpoints: Stricter limits (5/minute for login)
- General API: Moderate limits (100/minute)
- Health checks: No limits

Features:
- X-RateLimit-* headers on all responses
- Retry-After header on 429 responses
"""

import re
import time

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def get_client_identifier(request: Request) -> str:
    """
    Get client identifier for rate limiting.

    Uses X-Forwarded-For header when behind a proxy (Railway),
    falls back to direct IP address otherwise.
    """
    # Check for forwarded header (common when behind proxy/load balancer)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        # We want the first (client) IP
        return forwarded.split(",")[0].strip()

    # Fall back to direct remote address
    return get_remote_address(request)


# Create limiter instance with custom key function and header injection
limiter = Limiter(
    key_func=get_client_identifier,
    headers_enabled=True,  # Enable X-RateLimit headers
)


# Rate limit constants - centralized for easy adjustment
class RateLimits:
    """Rate limit configurations."""

    # Authentication - strict to prevent brute force
    LOGIN = "3/minute"
    REGISTER = "3/minute"
    PASSWORD_RESET = "3/minute"

    # General API - moderate limits
    DEFAULT = "100/minute"

    # Demo mode - tighter limits
    DEMO_DEFAULT = "60/minute"

    # Resource-intensive endpoints
    EXPORT = "10/minute"
    BULK_OPERATIONS = "20/minute"

    # File uploads
    PHOTO_UPLOAD = "30/minute"

    # Webhooks - prevent flooding
    WEBHOOK = "10/minute"


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """
    Custom handler for rate limit exceeded errors.

    Returns a user-friendly error message in German with rate limit headers.
    """
    # Parse the limit from exception detail (e.g., "5 per 1 minute")
    retry_after = 60  # Default to 60 seconds
    limit_value = "unknown"
    limit_match = re.search(r"(\d+)\s+per\s+(\d+)\s+(\w+)", str(exc.detail))
    if limit_match:
        limit_value = limit_match.group(1)
        window = int(limit_match.group(2))
        unit = limit_match.group(3)

        # Convert to seconds
        if "minute" in unit:
            retry_after = window * 60
        elif "hour" in unit:
            retry_after = window * 3600
        elif "second" in unit:
            retry_after = window

    reset_time = int(time.time()) + retry_after

    return JSONResponse(
        status_code=429,
        content={
            "detail": "Zu viele Anfragen. Bitte warten Sie einen Moment.",
            "error": "rate_limit_exceeded",
            "retry_after": retry_after,
        },
        headers={
            "Retry-After": str(retry_after),
            "X-RateLimit-Limit": limit_value,
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": str(reset_time),
        },
    )


class RateLimitHeadersMiddleware:
    """
    Middleware to add rate limit headers to responses (pure ASGI middleware).

    Adds X-RateLimit-* headers to help clients implement backoff.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start" and request.url.path.startswith("/api"):
                # Check if X-RateLimit-Limit is already present (slowapi sets it for limited routes)
                existing_headers = dict(message.get("headers", []))
                has_rate_limit = any(k == b"x-ratelimit-limit" for k, _ in message.get("headers", []))
                if not has_rate_limit:
                    message = {
                        **message,
                        "headers": list(message.get("headers", [])) + [
                            (b"x-ratelimit-policy", b"100/minute"),
                        ],
                    }
            await send(message)

        await self.app(scope, receive, send_wrapper)
