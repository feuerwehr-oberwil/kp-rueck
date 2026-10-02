"""The Divera access key must never leave through an error path.

Divera authenticates every request with `?accesskey=` in the URL, so the key is part of any
rendering of that URL — httpx's own request log line, the text of an `HTTPStatusError`, a
traceback. Until 2026-09-23 three of those reached the outside: the members/groups endpoints
put `f"…{e}"` into their 502 detail (so any editor's browser received the key when Divera
answered 401), the poller logged the exception text, and httpx logged every poll at INFO.

Two layers, tested separately: the call sites (no URL in a response or a log line they write)
and the root log handler's filter (the backstop for whoever writes the next one).
"""

import logging
import sys
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from httpx import AsyncClient

from app.config import settings
from app.logging_config import SecretQueryFilter, redact_secrets
from app.services.divera_poller import DiveraPoller

KEY = "divera-key-that-must-not-leak-4711"


def _stub_client_class(handler: Callable[[httpx.Request], httpx.Response]) -> type[httpx.AsyncClient]:
    class _StubClient(httpx.AsyncClient):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    return _StubClient


@pytest.fixture
def divera_rejects_the_key(monkeypatch):
    """A configured key that Divera answers with HTTP 401 — the exact shape of the old leak."""
    monkeypatch.setattr(settings, "divera_access_key", KEY)
    monkeypatch.setattr(settings, "demo_mode", False)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["accesskey"] == KEY  # the key really was on the wire
        return httpx.Response(401, json={"success": False})

    monkeypatch.setattr(httpx, "AsyncClient", _stub_client_class(handler))


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/divera/members", None),
        ("GET", "/api/divera/groups", None),
        ("GET", "/api/divera/personnel-sync/preview", None),
        ("POST", "/api/divera/personnel-sync/execute", {"remove_stale": False}),
    ],
)
async def test_a_502_never_carries_the_access_key(
    editor_client: AsyncClient, divera_rejects_the_key, caplog, method, path, body
):
    with caplog.at_level(logging.DEBUG):
        response = await editor_client.request(method, path, json=body)

    assert response.status_code == 502
    assert KEY not in response.text
    assert "accesskey" not in response.text
    # …and the line the endpoint logs about it says what happened, not where it went.
    assert KEY not in caplog.text
    assert "HTTP 401" in caplog.text


async def test_the_poller_logs_neither_a_status_error_nor_a_network_error_with_the_key(monkeypatch, caplog):
    monkeypatch.setattr(settings, "divera_access_key", KEY)
    poller = DiveraPoller()

    async def sink(_alarm) -> bool:  # pragma: no cover - never reached
        return False

    for handler in (
        lambda request: httpx.Response(401, json={}),
        lambda request: (_ for _ in ()).throw(httpx.ConnectError("boom", request=request)),
    ):
        poller._http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with caplog.at_level(logging.DEBUG), pytest.raises(httpx.HTTPError):
            await poller._fetch_and_process_alarms(sink)
        await poller._http_client.aclose()

    assert caplog.text
    assert KEY not in caplog.text


def test_httpx_does_not_log_request_urls_at_info():
    """httpx writes «HTTP Request: GET https://…?accesskey=…» at INFO for every call."""
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
    assert logging.getLogger("httpcore").getEffectiveLevel() >= logging.WARNING


def test_the_root_handler_redacts_the_key_from_any_record():
    root_filters = [f for h in logging.getLogger().handlers for f in h.filters]
    # The app installs it at import (main.py → setup_logging); pytest only adds handlers beside it.
    assert any(isinstance(f, SecretQueryFilter) for f in root_filters)

    record = logging.LogRecord(
        "anything",
        logging.ERROR,
        "",
        0,
        "GET %s failed",
        (f"https://divera247.com/api/v2/alarms?accesskey={KEY}",),
        None,
    )
    assert SecretQueryFilter().filter(record)
    assert KEY not in record.getMessage()
    assert "accesskey=[redacted]" in record.getMessage()


def test_a_traceback_is_redacted_too():
    request = httpx.Request("GET", f"https://divera247.com/api/pull/all?foo=1&accesskey={KEY}")
    try:
        httpx.Response(401, request=request).raise_for_status()
    except httpx.HTTPStatusError:
        exc_info = sys.exc_info()
    assert KEY in str(exc_info[1])  # the premise: httpx does put the URL in the message

    record = logging.LogRecord("anything", logging.ERROR, "", 0, "failed", None, exc_info)
    SecretQueryFilter().filter(record)
    assert KEY not in (record.exc_text or "")
    assert "accesskey=[redacted]" in record.exc_text


def test_redaction_touches_query_strings_only():
    assert redact_secrets("the token was fine") == "the token was fine"
    assert redact_secrets("/api/x?secret=abc&keep=1") == "/api/x?secret=[redacted]&keep=1"
