"""Rate limiting middleware using slowapi.

Provides protection against:
- Brute force attacks on authentication endpoints
- DoS attacks through resource-heavy endpoints
- API abuse

Configuration:
- Auth endpoints: Stricter limits (5/minute for login)
- General API: Moderate limits (100/minute)
- Health checks: No limits
"""

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.requests import Request
from starlette.responses import JSONResponse


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


# Create limiter instance with custom key function
limiter = Limiter(key_func=get_client_identifier)


# Rate limit constants - centralized for easy adjustment
class RateLimits:
    """Rate limit configurations."""

    # Authentication - strict to prevent brute force
    LOGIN = "5/minute"
    REGISTER = "3/minute"
    PASSWORD_RESET = "3/minute"

    # General API - moderate limits
    DEFAULT = "100/minute"

    # Resource-intensive endpoints
    EXPORT = "10/minute"
    BULK_OPERATIONS = "20/minute"

    # File uploads
    PHOTO_UPLOAD = "30/minute"


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """
    Custom handler for rate limit exceeded errors.

    Returns a user-friendly error message in German.
    """
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Zu viele Anfragen. Bitte warten Sie einen Moment.",
            "error": "rate_limit_exceeded",
            "retry_after": exc.detail,
        },
        headers={
            "Retry-After": str(exc.detail),
        },
    )
