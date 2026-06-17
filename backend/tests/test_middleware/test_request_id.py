"""Tests for the request-ID middleware and global exception handler."""

import json
import logging

import pytest
from httpx import ASGITransport, AsyncClient

from app.logging_config import JSONFormatter, RequestIdFilter
from app.main import app


class TestRequestIdHeader:
    @pytest.mark.asyncio
    async def test_echoes_incoming_request_id(self, client: AsyncClient):
        response = await client.get("/api/health", headers={"X-Request-ID": "abc123"})
        assert response.headers["x-request-id"] == "abc123"

    @pytest.mark.asyncio
    async def test_generates_request_id_when_missing(self, client: AsyncClient):
        response = await client.get("/api/health")
        assert response.headers.get("x-request-id")


class TestUnhandledExceptionHandler:
    @pytest.mark.asyncio
    async def test_returns_json_500_and_logs_traceback(self, caplog):
        @app.get("/api/_test_boom")
        async def _boom():
            raise RuntimeError("boom")

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                with caplog.at_level(logging.ERROR):
                    response = await ac.get("/api/_test_boom")

            assert response.status_code == 500
            body = response.json()
            assert body["detail"] == "Interner Serverfehler"
            assert body["request_id"]

            error_records = [r for r in caplog.records if r.levelno == logging.ERROR and r.exc_info]
            assert error_records, "expected an ERROR record with traceback"
            assert "boom" in caplog.text
        finally:
            app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", None) != "/api/_test_boom"]


class TestLogCorrelation:
    @pytest.mark.asyncio
    async def test_log_records_carry_request_id(self, caplog):
        @app.get("/api/_test_log")
        async def _log():
            logging.getLogger("test.correlation").info("hello from request")
            return {"ok": True}

        # The app's filter sits on the stdout handler; attach one to caplog's
        # handler too so captured records get request_id stamped at emit time
        # (inside the request context), deterministically.
        rid_filter = RequestIdFilter()
        caplog.handler.addFilter(rid_filter)
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                with caplog.at_level(logging.INFO):
                    response = await ac.get("/api/_test_log", headers={"X-Request-ID": "corr-1"})

            assert response.status_code == 200
            records = [r for r in caplog.records if r.name == "test.correlation"]
            assert records
            assert any(getattr(r, "request_id", None) == "corr-1" for r in records)
        finally:
            caplog.handler.removeFilter(rid_filter)
            app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", None) != "/api/_test_log"]


class TestJSONFormatter:
    def test_includes_request_id_when_set(self):
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname=__file__, lineno=1, msg="msg", args=(), exc_info=None
        )
        record.request_id = "x"
        parsed = json.loads(JSONFormatter().format(record))
        assert parsed["request_id"] == "x"

    def test_omits_request_id_when_unset(self):
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname=__file__, lineno=1, msg="msg", args=(), exc_info=None
        )
        parsed = json.loads(JSONFormatter().format(record))
        assert "request_id" not in parsed
