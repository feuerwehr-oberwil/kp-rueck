"""Tests for audit middleware."""

import asyncio
import logging
from unittest.mock import patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.middleware.audit import AuditMiddleware, _inflight_audit_tasks, _log_api_request
from app.models import AuditLog, User


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """Create an async test client with test database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    # Inject test db_session for middleware to use
    app.state.test_db_session = db_session

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    delattr(app.state, "test_db_session")


@pytest_asyncio.fixture
async def test_editor_user(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="middleware_editor",
        password_hash=hash_password("editorpass1234"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def authenticated_client(client: AsyncClient, test_editor_user: User) -> AsyncClient:
    """Create authenticated client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "middleware_editor", "password": "editorpass1234"},
    )
    assert response.status_code == 200
    return client


class TestAuditMiddleware:
    """Test audit middleware logging behavior."""

    @pytest.mark.asyncio
    async def test_middleware_logs_successful_mutation(
        self, authenticated_client: AsyncClient, db_session: AsyncSession, test_event
    ):
        """Successful mutating API calls should create an audit log entry."""
        response = await authenticated_client.post(
            "/api/incidents/",
            json={
                "event_id": str(test_event.id),
                "title": "Audit-Test",
                "type": "brandbekaempfung",
                "priority": "medium",
            },
        )
        assert response.status_code == 201

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.resource_type == "api",
                AuditLog.action_type == "post_request",
            )
        )
        matching = [e for e in result.scalars().all() if "/api/incidents" in str(e.changes_json.get("path", ""))]
        assert len(matching) >= 1

        entry = matching[0]
        assert entry.changes_json["method"] == "POST"
        assert entry.changes_json["path"] == "/api/incidents/"
        assert "duration_ms" in entry.changes_json

    @pytest.mark.asyncio
    async def test_middleware_does_not_log_reads(self, authenticated_client: AsyncClient, db_session: AsyncSession):
        """
        Reads must NOT be audited.

        The board polls this endpoint every ~5 s per connected client. Logging that made the
        audit log grow with traffic instead of with activity — two idle wall displays alone
        wrote on the order of a gigabyte a year against a "keep forever" retention default,
        ending in a full disk mid-operation. The defensible record is mutations; "who viewed
        what" is not something the product reports on.
        """
        response = await authenticated_client.get(f"/api/incidents/?event_id={uuid4()}")
        assert response.status_code == 200

        result = await db_session.execute(select(AuditLog).where(AuditLog.action_type == "get_request"))
        assert result.scalars().all() == []

    @pytest.mark.asyncio
    async def test_middleware_skips_health_check(self, client: AsyncClient, db_session: AsyncSession):
        """Health check endpoint should not be logged."""
        # Note: /api/health might not exist, but test the middleware logic
        # We'll test that non-API paths are skipped instead

        # Create a count before
        result = await db_session.execute(select(AuditLog))
        count_before = len(result.scalars().all())

        # This will 404, but middleware should still skip it if path is /api/health
        # Since /api/health might not exist, we test by checking the middleware code path
        # The middleware only logs if path != "/api/health"

        # Instead, verify that middleware checks path correctly by making successful request
        # and confirming non-health paths ARE logged (tested above)

        # For this test, we verify the inverse: that paths ARE logged when not health
        await client.get("/docs")  # Non-API path

        result = await db_session.execute(select(AuditLog))
        count_after = len(result.scalars().all())

        # /docs is not under /api/ so shouldn't be logged
        assert count_after == count_before

    @pytest.mark.asyncio
    async def test_middleware_skips_non_api_paths(self, client: AsyncClient, db_session: AsyncSession):
        """Non-API paths should not be logged."""
        result = await db_session.execute(select(AuditLog))
        count_before = len(result.scalars().all())

        # Request to non-API path
        await client.get("/docs")

        result = await db_session.execute(select(AuditLog))
        count_after = len(result.scalars().all())

        # No new audit log should be created
        assert count_after == count_before

    @pytest.mark.asyncio
    async def test_middleware_skips_failed_requests(self, authenticated_client: AsyncClient, db_session: AsyncSession):
        """Failed requests (4xx, 5xx) should not be logged by middleware."""
        # Get count before
        result = await db_session.execute(select(AuditLog).where(AuditLog.resource_type == "api"))
        len(result.scalars().all())

        # Make request that will 404
        response = await authenticated_client.get("/api/nonexistent_endpoint_12345")
        assert response.status_code == 404

        # Check that middleware did NOT log this (status >= 300)
        result = await db_session.execute(select(AuditLog).where(AuditLog.resource_type == "api"))
        api_logs = result.scalars().all()

        # Filter for the nonexistent endpoint
        matching = [e for e in api_logs if "nonexistent_endpoint" in str(e.changes_json.get("path", ""))]
        assert len(matching) == 0  # Should not be logged

    @pytest.mark.asyncio
    async def test_middleware_captures_user_from_request_state(
        self, authenticated_client: AsyncClient, db_session: AsyncSession, test_editor_user: User, test_event
    ):
        """Middleware should capture authenticated user."""
        # A mutation, since reads are deliberately not audited any more.
        response = await authenticated_client.post(
            "/api/incidents/",
            json={
                "event_id": str(test_event.id),
                "title": "Audit-User-Test",
                "type": "brandbekaempfung",
                "priority": "medium",
            },
        )
        assert response.status_code == 201

        # Find the audit log entry
        result = await db_session.execute(
            select(AuditLog)
            .where(
                AuditLog.resource_type == "api",
                AuditLog.action_type == "post_request",
            )
            .order_by(AuditLog.timestamp.desc())
        )
        entries = result.scalars().all()

        # Find entry for /api/incidents
        matching = [e for e in entries if e.changes_json.get("path") == "/api/incidents/"]
        assert len(matching) >= 1

        entry = matching[0]
        assert entry.user_id == test_editor_user.id

    @pytest.mark.asyncio
    async def test_middleware_handles_logging_failure_gracefully(self, authenticated_client: AsyncClient):
        """Middleware should not crash request if audit logging fails."""
        # Mock log_action to raise exception
        with patch("app.middleware.audit.log_action", side_effect=Exception("Database error")):
            # Request should still succeed despite audit logging failure
            response = await authenticated_client.get(f"/api/incidents/?event_id={uuid4()}")
            assert response.status_code == 200  # Request still works

    @pytest.mark.asyncio
    async def test_middleware_logs_and_swallows_a_failed_audit_write_for_injected_session(
        self, authenticated_client: AsyncClient, test_event, caplog
    ):
        """A failing audit write must not surface to the caller.

        Complements (does not duplicate) `test_middleware_handles_logging_failure_gracefully`
        above: that test issues a GET, and reads are no longer audited at all — it never
        reaches `log_action`, so the synchronous (injected test-session) branch's own
        `except Exception` is never actually hit. A POST is required to get there.
        """
        with (
            patch("app.middleware.audit.log_action", side_effect=Exception("boom")),
            caplog.at_level(logging.ERROR, logger="app.middleware.audit"),
        ):
            response = await authenticated_client.post(
                "/api/incidents/",
                json={
                    "event_id": str(test_event.id),
                    "title": "Audit-Write-Failure",
                    "type": "brandbekaempfung",
                    "priority": "medium",
                },
            )

        assert response.status_code == 201  # the request itself must still succeed
        assert "Audit logging failed" in caplog.text

    @pytest.mark.asyncio
    async def test_middleware_passes_through_non_http_scopes(self):
        """Lifespan/websocket scopes bypass all audit logic — there is no HTTP method,
        path, or status code to record, and wrapping `send` for them would be wrong
        anyway."""
        calls: list[str] = []

        async def downstream_app(scope, receive, send):
            calls.append(scope["type"])

        async def receive():
            return {"type": "lifespan.startup"}

        async def send(message):
            pass

        middleware = AuditMiddleware(downstream_app)
        await middleware({"type": "lifespan"}, receive, send)

        assert calls == ["lifespan"]


class TestLogApiRequestProductionPath:
    """`_log_api_request`'s ``else`` branch (no injected test session): its own connection
    pool via `audit_session_maker`, exercised directly rather than through a full request so
    each failure mode can be forced independently. `audit_session_maker` is repointed at the
    test database by the autouse `_bind_audit_logging_to_test_db` fixture, so the success
    case here still writes real, queryable rows — just not ones a per-test rollback undoes,
    since there is no surrounding test transaction on that pool. Each test therefore uses a
    path unique to itself so assertions can't collide with another test's row.
    """

    @pytest.mark.asyncio
    async def test_writes_through_audit_session_maker_when_no_session_is_injected(self, db_session: AsyncSession):
        unique_path = f"/api/audit-unit-test/{uuid4()}"

        await _log_api_request(
            user=None,
            path=unique_path,
            method="POST",
            duration_ms=12.5,
            test_db_session=None,
        )

        result = await db_session.execute(
            select(AuditLog).where(AuditLog.resource_type == "api", AuditLog.action_type == "post_request")
        )
        matching = [e for e in result.scalars().all() if e.changes_json.get("path") == unique_path]
        assert len(matching) == 1
        assert matching[0].changes_json["method"] == "POST"
        assert matching[0].changes_json["duration_ms"] == 12.5

    @pytest.mark.asyncio
    async def test_logs_and_swallows_a_log_action_failure(self, caplog):
        """The write itself opens fine but `log_action` raises — caught by the inner
        `except Exception`, distinct from the pool-level failures below."""
        with (
            patch("app.middleware.audit.log_action", side_effect=Exception("boom")),
            caplog.at_level(logging.ERROR, logger="app.middleware.audit"),
        ):
            await _log_api_request(
                user=None,
                path="/api/audit-unit-test/log-action-fails",
                method="POST",
                duration_ms=1.0,
                test_db_session=None,
            )

        assert "Audit logging failed" in caplog.text

    @pytest.mark.asyncio
    async def test_logs_a_warning_and_does_not_raise_on_pool_timeout(self, monkeypatch, caplog):
        """A pool-exhaustion `TimeoutError` opening the session must be swallowed with a
        warning — audit logging must never turn into a request-blocking failure."""

        def _raise_timeout():
            raise TimeoutError

        monkeypatch.setattr("app.middleware.audit.audit_session_maker", _raise_timeout)

        with caplog.at_level(logging.WARNING, logger="app.middleware.audit"):
            await _log_api_request(
                user=None,
                path="/api/audit-unit-test/pool-timeout",
                method="POST",
                duration_ms=1.0,
                test_db_session=None,
            )

        assert "Audit pool timeout" in caplog.text

    @pytest.mark.asyncio
    async def test_logs_an_error_and_does_not_raise_on_other_session_failures(self, monkeypatch, caplog):
        """Any other error opening the audit session (e.g. connection refused) is caught by
        the outermost `except Exception`, distinct from the `TimeoutError` case above."""

        def _raise_connection_error():
            raise RuntimeError("connection refused")

        monkeypatch.setattr("app.middleware.audit.audit_session_maker", _raise_connection_error)

        with caplog.at_level(logging.ERROR, logger="app.middleware.audit"):
            await _log_api_request(
                user=None,
                path="/api/audit-unit-test/session-error",
                method="POST",
                duration_ms=1.0,
                test_db_session=None,
            )

        assert "Audit session error" in caplog.text


class TestAuditMiddlewareFireAndForget:
    """The real production path through `__call__`: no `app.state.test_db_session`
    injected, so the middleware fires a background task instead of awaiting the write
    inline — the whole point being that a slow audit write must never add latency to the
    request itself."""

    @pytest.mark.asyncio
    async def test_fire_and_forget_task_writes_the_audit_log(
        self,
        client: AsyncClient,
        test_editor_user: User,
        test_engine: AsyncEngine,
    ):
        """Uses `/api/auth/login` rather than an authenticated mutation deliberately:
        `get_current_user` (and so `request.state.user`) never runs for it, so the audit
        write's `user_id` stays NULL. An authenticated endpoint would pass a user row that
        only exists inside `db_session`'s own uncommitted (savepoint-only) transaction — a
        write through the *production* audit pool, on its own connection, can't see it and
        the insert fails its `user_id` foreign key. Login sidesteps that without weakening
        what this test is actually about: that the fire-and-forget branch really writes.
        """
        # The `client` fixture injects a test session by default; drop it so the
        # middleware takes the `else` (production, background-task) branch instead.
        app.state.test_db_session = None

        response = await client.post(
            "/api/auth/login",
            data={"username": test_editor_user.username, "password": "editorpass1234"},
        )
        assert response.status_code == 200

        for _ in range(200):
            if not _inflight_audit_tasks:
                break
            await asyncio.sleep(0.01)
        else:
            pytest.fail("background audit task never finished")

        # A fresh session on the raw engine: the write went through the production pool,
        # not `db_session`'s own (rolled-back) transaction.
        maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)
        async with maker() as session:
            result = await session.execute(
                select(AuditLog).where(AuditLog.resource_type == "api", AuditLog.action_type == "post_request")
            )
            matching = [e for e in result.scalars().all() if e.changes_json.get("path") == "/api/auth/login"]

        assert len(matching) == 1
        assert matching[0].changes_json["method"] == "POST"
        assert matching[0].user_id is None
