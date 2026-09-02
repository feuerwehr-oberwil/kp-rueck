"""Tests for token blocklist functionality.

The blocklist is DB-backed (``revoked_tokens``). It used to be a process-local dict, which
meant a revoked token silently became valid again after a restart or on a second instance —
the regression `test_revocation_survives_a_fresh_store` exists to catch.

Every case injects the test `session_factory` so the store's writes stay inside the test
transaction; the production singleton resolves `app.database.async_session_maker` instead.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

import pytest

from app import database as database_module
from app.auth.token_blocklist import TokenBlocklist
from app.models import RevokedToken


@pytest.fixture
def blocklist(session_factory) -> TokenBlocklist:
    """Create a fresh token blocklist bound to the test database."""
    return TokenBlocklist(session_factory=session_factory)


@pytest.mark.asyncio
async def test_revoke_token(blocklist: TokenBlocklist):
    """Test adding a token to the blocklist."""
    jti = "test-token-id-123"
    expires_at = datetime.now(UTC) + timedelta(hours=1)

    await blocklist.revoke(jti, expires_at)

    assert await blocklist.is_revoked(jti) is True


@pytest.mark.asyncio
async def test_is_revoked_returns_false_for_unknown_token(blocklist: TokenBlocklist):
    """Test that unknown tokens are not marked as revoked."""
    assert await blocklist.is_revoked("unknown-token") is False


@pytest.mark.asyncio
async def test_revoke_multiple_tokens(blocklist: TokenBlocklist):
    """Test revoking multiple tokens."""
    expires_at = datetime.now(UTC) + timedelta(hours=1)

    await blocklist.revoke("token-1", expires_at)
    await blocklist.revoke("token-2", expires_at)
    await blocklist.revoke("token-3", expires_at)

    assert await blocklist.is_revoked("token-1") is True
    assert await blocklist.is_revoked("token-2") is True
    assert await blocklist.is_revoked("token-3") is True


@pytest.mark.asyncio
async def test_revocation_survives_a_fresh_store(session_factory):
    """A second TokenBlocklist instance — a restart, or a second container — still sees the
    revocation, because it lives in the database rather than in process memory.

    This is the whole point of the table. If it ever fails, logout has quietly gone back to
    being advisory.
    """
    jti = "jti-restart-1"
    expires_at = datetime.now(UTC) + timedelta(hours=1)

    writer = TokenBlocklist(session_factory=session_factory)
    await writer.revoke(jti, expires_at)

    reader = TokenBlocklist(session_factory=session_factory)
    assert await reader.is_revoked(jti) is True
    assert await reader.is_revoked("never-revoked") is False


@pytest.mark.asyncio
async def test_cleanup_expired_entries(blocklist: TokenBlocklist, session_factory):
    """Test that expired entries are cleaned up while live ones survive."""
    valid_time = datetime.now(UTC) + timedelta(hours=1)
    await blocklist.revoke("valid-token", valid_time)

    # Written directly: revoke() prunes expired rows opportunistically, so an
    # already-expired entry inserted through it would be swept before cleanup ran.
    async with session_factory() as session:
        session.add(RevokedToken(jti="expired-token", expires_at=datetime.now(UTC) - timedelta(hours=1)))
        await session.commit()

    removed = await blocklist.cleanup_expired()

    assert removed == 1
    assert await blocklist.is_revoked("expired-token") is False
    assert await blocklist.is_revoked("valid-token") is True


@pytest.mark.asyncio
async def test_cleanup_removes_all_expired(blocklist: TokenBlocklist, session_factory):
    """Test cleanup removes all expired entries."""
    expired_time = datetime.now(UTC) - timedelta(hours=1)

    async with session_factory() as session:
        for jti in ("expired-1", "expired-2", "expired-3"):
            session.add(RevokedToken(jti=jti, expires_at=expired_time))
        await session.commit()

    removed = await blocklist.cleanup_expired()

    assert removed == 3


@pytest.mark.asyncio
async def test_cleanup_returns_zero_when_nothing_expired(blocklist: TokenBlocklist):
    """Test cleanup returns zero when no entries are expired."""
    valid_time = datetime.now(UTC) + timedelta(hours=1)

    await blocklist.revoke("valid-token", valid_time)

    removed = await blocklist.cleanup_expired()

    assert removed == 0
    assert await blocklist.is_revoked("valid-token") is True


@pytest.mark.asyncio
async def test_revoke_same_token_twice(blocklist: TokenBlocklist):
    """A double logout is a no-op, never an IntegrityError on the auth hot path."""
    jti = "duplicate-token"
    expires_at = datetime.now(UTC) + timedelta(hours=1)

    await blocklist.revoke(jti, expires_at)
    await blocklist.revoke(jti, expires_at)  # must not raise

    assert await blocklist.is_revoked(jti) is True


@pytest.mark.asyncio
async def test_revoking_prunes_expired_rows(blocklist: TokenBlocklist, session_factory):
    """Writes prune opportunistically, so the table can't grow between hourly sweeps."""
    async with session_factory() as session:
        session.add(RevokedToken(jti="stale", expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await session.commit()

    await blocklist.revoke("fresh", datetime.now(UTC) + timedelta(hours=1))

    assert await blocklist.is_revoked("stale") is False
    assert await blocklist.is_revoked("fresh") is True


# --- _factory() default resolution --------------------------------------------------


def test_factory_defaults_to_the_module_session_maker():
    """A blocklist built with no factory (as the production singleton is) resolves
    ``app.database.async_session_maker`` lazily on first use. This only checks the object
    identity that `_factory()` returns and caches — it never opens a session, so it can't
    touch a real database."""
    blocklist = TokenBlocklist()
    assert blocklist._session_factory is None

    factory = blocklist._factory()

    assert factory is database_module.async_session_maker
    assert blocklist._session_factory is database_module.async_session_maker


# --- fail-open vs. fail-closed on a database outage ----------------------------------


@pytest.mark.asyncio
async def test_is_revoked_fails_closed_when_the_database_is_unreachable():
    """Security-relevant behaviour, pinned deliberately: `is_revoked` has no try/except of
    its own, so a database outage makes it raise rather than silently return ``False``.

    Every caller (`auth/dependencies.py`, `api/auth.py`) awaits this with nothing catching
    it, so the request fails (500) instead of being treated as "not revoked" — a revoked
    token can never be let through just because the blocklist itself is unreachable. This is
    "fail closed". Flip this test only if that trade-off is being deliberately reversed.
    """

    def _broken_factory():
        raise ConnectionError("database unreachable")

    blocklist = TokenBlocklist(session_factory=_broken_factory)

    with pytest.raises(ConnectionError):
        await blocklist.is_revoked("some-jti")


# --- non-postgres fallback (select-then-insert) --------------------------------------


@pytest.mark.asyncio
async def test_revoke_falls_back_to_select_then_insert_on_non_postgres(blocklist, session_factory, monkeypatch):
    """Non-postgres backends (SQLite, per the module docstring) can't use
    ``ON CONFLICT DO NOTHING``, so `_revoke` takes a select-then-insert path instead.

    The test database is postgres, so this fakes the dialect *name* the code branches on
    while keeping the real (postgres) connection underneath — the fallback query itself is
    plain SQL that works on any backend. Exercises both halves of the branch: the first
    call inserts (`exists is None`), the second is a no-op (`exists is not None`), matching
    the double-logout guarantee the postgres path already has a test for.
    """
    jti = "fallback-path"
    expires_at = datetime.now(UTC) + timedelta(hours=1)

    async with session_factory() as session:
        monkeypatch.setattr(session.bind.dialect, "name", "sqlite")
        await blocklist._revoke(session, jti, expires_at)
        await blocklist._revoke(session, jti, expires_at)  # no-op, must not raise
        await session.commit()

    assert await blocklist.is_revoked(jti) is True


# --- background cleanup task lifecycle ------------------------------------------------


@pytest.mark.asyncio
async def test_start_cleanup_task_is_idempotent(blocklist: TokenBlocklist):
    """A second start while one is already running must not spawn a second task."""
    await blocklist.start_cleanup_task()
    first_task = blocklist._cleanup_task

    await blocklist.start_cleanup_task()

    assert blocklist._cleanup_task is first_task
    await blocklist.stop_cleanup_task()


@pytest.mark.asyncio
async def test_stop_cleanup_task_without_a_running_task_is_a_noop(blocklist: TokenBlocklist):
    assert blocklist._cleanup_task is None
    await blocklist.stop_cleanup_task()  # must not raise
    assert blocklist._cleanup_task is None


@pytest.mark.asyncio
async def test_stop_cleanup_task_cancels_and_clears(blocklist: TokenBlocklist):
    await blocklist.start_cleanup_task()
    task = blocklist._cleanup_task
    assert task is not None

    await blocklist.stop_cleanup_task()

    assert task.done()
    assert blocklist._cleanup_task is None


@pytest.mark.asyncio
async def test_cleanup_loop_survives_a_transient_error(blocklist: TokenBlocklist, caplog):
    """A single failed sweep (e.g. a dropped DB connection) must not kill the background
    loop — it logs the error and tries again next interval rather than leaving the table to
    grow unbounded until the process restarts."""
    calls: list[None] = []

    async def flaky_cleanup_expired() -> int:
        calls.append(None)
        if len(calls) == 1:
            raise RuntimeError("boom")
        return 0

    blocklist.cleanup_expired = flaky_cleanup_expired  # type: ignore[method-assign]
    blocklist._cleanup_interval = 0  # spin as fast as possible instead of waiting an hour

    with caplog.at_level(logging.ERROR, logger="app.auth.token_blocklist"):
        await blocklist.start_cleanup_task()
        for _ in range(200):
            if len(calls) >= 2:
                break
            await asyncio.sleep(0.005)
        await blocklist.stop_cleanup_task()

    assert len(calls) >= 2, "loop must keep iterating after a failed sweep"
    assert "Token blocklist cleanup error" in caplog.text
