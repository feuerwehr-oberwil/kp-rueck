"""Request-ID middleware for log correlation.

Honors an incoming X-Request-ID header (Railway's proxy may set one),
otherwise generates a short ID. The ID is stored in a ContextVar so log
records emitted anywhere during the request can carry it, and is echoed
back on every response as X-Request-ID.

Uses pure ASGI middleware (not BaseHTTPMiddleware) to avoid
TaskGroup/ExceptionGroup crashes when stacked with other middlewares.
"""

from contextvars import ContextVar
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    """Return the request ID for the current request context, if any."""
    return request_id_var.get()


class RequestIDMiddleware:
    """Assign a request ID to each HTTP request and echo it in the response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break

        rid = incoming or uuid4().hex[:12]
        token = request_id_var.set(rid)
        # Also stash in scope state: the global Exception handler runs in
        # ServerErrorMiddleware (outside this middleware), after the finally
        # below has already reset the ContextVar.
        scope.setdefault("state", {})["request_id"] = rid

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                message = {
                    **message,
                    "headers": [*list(message.get("headers", [])), (b"x-request-id", rid.encode("latin-1"))],
                }
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            request_id_var.reset(token)
