"""Request-body ceiling for the backend itself (pure ASGI, like its neighbours).

Caddy (`deploy/Caddyfile`, 32 MiB) and the Next `/backend-api` proxy already cap bodies, but
on Railway the backend is its own public origin: a request can arrive without passing either,
and FastAPI reads and parses a body before a route's secret check or rate limit runs. Same
number as the two layers in front, so a request that got through them is never refused here.
"""

from fastapi import HTTPException, status
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: 25 MiB Excel imports and 10 MiB photos fit, including multipart overhead (as in the Caddyfile).
MAX_BODY_BYTES = 32 * 1024 * 1024

_TOO_LARGE = "Anfrage zu gross."


class BodyLimitMiddleware:
    """Refuse a request body above `max_bytes` with 413.

    A declared Content-Length is refused before a byte is read. A body without one (chunked)
    is counted as it streams; passing the ceiling raises the 413 inside the route's own body
    read, where FastAPI turns it into the response.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = next((value for name, value in scope["headers"] if name == b"content-length"), None)
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            response = JSONResponse({"detail": _TOO_LARGE}, status_code=status.HTTP_413_CONTENT_TOO_LARGE)
            await response(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=_TOO_LARGE)
            return message

        await self.app(scope, counting_receive, send)
