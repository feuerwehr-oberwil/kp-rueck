"""Security headers middleware for HTTP response hardening.

Uses pure ASGI middleware (not BaseHTTPMiddleware) to avoid
TaskGroup/ExceptionGroup crashes when stacked with other middlewares.
"""

import os

from starlette.types import ASGIApp, Message, Receive, Scope, Send


def _is_production() -> bool:
    """Check if we're running in production (Railway)."""
    railway_indicators = [
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_PROJECT_ID",
        "RAILWAY_SERVICE_ID",
    ]
    return any(os.getenv(indicator) is not None for indicator in railway_indicators)


class SecurityHeadersMiddleware:
    """
    Add security headers to all HTTP responses (pure ASGI middleware).

    Headers added:
    - X-Content-Type-Options: Prevents MIME type sniffing
    - X-Frame-Options: Prevents clickjacking
    - X-XSS-Protection: Legacy XSS protection (still useful for older browsers)
    - Referrer-Policy: Controls referrer information
    - Permissions-Policy: Restricts browser features
    - Strict-Transport-Security: Forces HTTPS (production only)
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.is_production = _is_production()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = dict(message.get("headers", []))
                extra_headers = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"x-xss-protection", b"1; mode=block"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"permissions-policy", b"geolocation=(self), camera=(), microphone=()"),
                ]
                if self.is_production:
                    extra_headers.append(
                        (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
                    )
                message = {
                    **message,
                    "headers": list(message.get("headers", [])) + extra_headers,
                }
            await send(message)

        await self.app(scope, receive, send_wrapper)
