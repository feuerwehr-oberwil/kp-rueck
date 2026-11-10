"""Look-only until the box leads an Ereignis: refuses writes on a standby mirror.

On `DEPLOYMENT_ROLE=standby` the board shows the hosted board's data as it replicates in, and a
write would be overwritten by the next change from there – or stop the replication outright
with a duplicate key. So while the box leads no Ereignis (app/api/standby.py), every
POST/PUT/PATCH/DELETE under /api is answered 403, except logging in and the takeover itself.
While it leads one, the box is a board again and writes go through; the frontend keeps the
mirrored Ereignisse look-only (`StandbyProvider`). Once the hosted board has taken every one
back, the box is look-only again.

Pure ASGI, like the other middlewares here (BaseHTTPMiddleware breaks when stacked). The
"anything taken offline yet?" answer is cached for a few seconds, so a busy board does not ask
the database once per request.

While the box leads one, writes go through for every Ereignis – the API does not tell them
apart; the frontend does.
"""

import json
import time

from sqlalchemy import text
from starlette.types import ASGIApp, Receive, Scope, Send

from ..database import async_session_maker
from ..environment import ROLE_STANDBY, deployment_role

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Logging in and out, the first-run claim, and the takeover must work on a mirror – and so must
# creating an Ereignis: one made on the box is offline from the start (app/standby.py,
# `standby_local_event`), for the outage that begins before the hosted board had it.
ALLOWED_PREFIXES = ("/api/auth/", "/api/setup", "/api/standby")
ALLOWED_EXACT = frozenset({("POST", "/api/events/"), ("POST", "/api/events")})
CACHE_SECONDS = 3.0

DETAIL = (
    "Dieses System ist ein Spiegel von KP Rück Online – hier wird nur angesehen. "
    "Erst ein offline übernommenes Ereignis kann hier bearbeitet werden."
)


class StandbyReadOnlyMiddleware:
    """Refuse API writes on a standby box until an Ereignis has been taken offline."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._leads = False
        self._checked_at = 0.0

    async def _leads_any(self) -> bool:
        if time.monotonic() - self._checked_at < CACHE_SECONDS:
            return self._leads
        async with async_session_maker() as db:
            # Two statements: Postgres resolves a table name when it plans the query, so naming
            # a table that does not exist yet fails even behind `to_regclass(...) AND`.
            exists = await db.scalar(text("SELECT to_regclass('public.event_leads') IS NOT NULL"))
            if exists:
                exists = await db.scalar(
                    text("SELECT EXISTS (SELECT 1 FROM public.event_leads WHERE holder = 'standby')")
                )
        self._checked_at = time.monotonic()
        self._leads = bool(exists)
        return self._leads

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] not in WRITE_METHODS
            or not scope["path"].startswith("/api/")
            or scope["path"].startswith(ALLOWED_PREFIXES)
            or (scope["method"], scope["path"]) in ALLOWED_EXACT
            or deployment_role() != ROLE_STANDBY
            or await self._leads_any()
        ):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": DETAIL, "code": "standby_read_only"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})
