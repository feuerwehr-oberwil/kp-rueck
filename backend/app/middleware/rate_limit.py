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

from ..config import settings
from ..environment import is_production_environment


def client_ip(request: Request) -> str | None:
    """The caller's IP address, taken from X-Forwarded-For in a way a caller cannot forge.

    This header is written by the client first and appended to by each proxy on the way in,
    so its LEFTMOST entry is whatever the caller typed – reading that (which both this
    function and the audit log used to do) meant anyone could pick their own IP by sending
    `X-Forwarded-For: 1.2.3.4`. That defeated the login throttle, the request rate limit,
    and the attribution in the audit trail all at once.

    The trustworthy entry is the one OUR OWN outermost proxy appended, i.e. the
    `trusted_proxy_count`-th from the right. With the reference deployments that is one hop
    – Caddy in the compose stack, Railway's edge on Railway – and it holds for app traffic
    too, because the Next.js `/backend-api` proxy forwards the header it received rather
    than adding to it.

    Set `TRUSTED_PROXY_COUNT=0` when the app is directly exposed with no proxy in front:
    then the header is ignored entirely and only the socket address counts.
    """
    count = settings.trusted_proxy_count
    if count > 0:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            hops = [part.strip() for part in forwarded.split(",") if part.strip()]
            if len(hops) >= count:
                return hops[-count]
            # Fewer hops than configured: the request did not traverse the expected
            # chain. Trust the socket instead of guessing.

    return request.client.host if request.client else None


def get_client_identifier(request: Request) -> str:
    """Get client identifier for rate limiting."""
    return client_ip(request) or get_remote_address(request)


# Create limiter instance with custom key function
# headers_enabled=False: _inject_headers requires Response objects but FastAPI
# endpoints return dicts. Header injection crashes with "parameter `response`
# must be an instance of starlette.responses.Response". Rate limit enforcement
# still works – 429 responses are handled by rate_limit_exceeded_handler.
limiter = Limiter(
    key_func=get_client_identifier,
    headers_enabled=False,
)


# Rate limit constants - centralized for easy adjustment
class RateLimits:
    """Rate limit configurations."""

    # Authentication.
    #
    # LOGIN is deliberately NOT the brute-force control. It keys on client IP
    # and counts every attempt, successful ones included – and a command post
    # NATs every tablet and wall display behind one public IP, so a tight
    # value here locked out the whole crew whenever a few people signed in
    # within the same minute, with no recovery but waiting.
    #
    # Brute force is handled by auth/login_throttle.py, which keys on
    # (IP, username) and counts only FAILURES. This ceiling just blunts
    # username spraying from a single host, so it sits well above legitimate
    # command-post traffic. Tune via LOGIN_RATE_LIMIT_PER_IP.
    LOGIN = settings.login_rate_limit_per_ip
    REGISTER = "3/minute"
    PASSWORD_RESET = "3/minute"  # noqa: S105 – a rate limit, not a secret

    # Handing a credential back to an admin who asked for it (the alarm webhook secret).
    # Deliberately loose enough that an admin copying it into a dispatch provider's form,
    # fumbling it and asking again is not locked out, and tight enough that the endpoint is
    # useless as an oracle if a session is ever stolen. Every call is in the audit log.
    SECRET_REVEAL = "10/minute"  # noqa: S105 – a rate limit, not a secret

    # General API - moderate limits
    DEFAULT = "100/minute"

    # Demo mode - tighter limits
    DEMO_DEFAULT = "60/minute"
    DEMO_RESET = "2/hour"
    DEMO_SANDBOX = "10/hour"

    # Resource-intensive endpoints
    EXPORT = "10/minute"
    BULK_OPERATIONS = "20/minute"

    # File uploads
    PHOTO_UPLOAD = "30/minute"

    # Webhooks - prevent flooding
    WEBHOOK = "10/minute"

    # Public alarm intake - token-gated write endpoint, keep tight against abuse
    INTAKE = "10/minute"

    # /feld field surface - token-gated and public, but the page polls and
    # autosaves a draft, so it needs more headroom than INTAKE. Still capped:
    # anyone with the event link reaches it. Photo upload keeps PHOTO_UPLOAD.
    FELD = "60/minute"

    # The Feld-Code exchange. Tight enough that guessing four digits is not
    # worth starting, loose enough that a crew fumbling it with cold wet hands
    # is not locked out — because locking a firefighter out mid-storm is the
    # worse failure of the two (decision 28). A device unlocks once per
    # Ereignis, so this ceiling only ever bites on repeated wrong answers.
    #
    # Relaxed off production. The E2E suite walks this door on every phone it
    # opens and runs from one address, so the real ceiling turned a full run
    # into a wall of "Falscher Code" — the page cannot tell a 429 from a wrong
    # code, and deliberately does not try (an error that distinguishes them is
    # an oracle). Same shape as AUTH_BYPASS_AUTH_DEV: the hardening is on where
    # it protects somebody.
    FELD_UNLOCK = "10 per 10 minutes" if is_production_environment() else "1000 per minute"


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
                has_rate_limit = any(k == b"x-ratelimit-limit" for k, _ in message.get("headers", []))
                if not has_rate_limit:
                    message = {
                        **message,
                        "headers": [*list(message.get("headers", [])), (b"x-ratelimit-policy", b"100/minute")],
                    }
            await send(message)

        await self.app(scope, receive, send_wrapper)
