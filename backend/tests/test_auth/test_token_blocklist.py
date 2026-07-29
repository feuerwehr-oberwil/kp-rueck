"""Tests for token blocklist functionality.

The blocklist is DB-backed (``revoked_tokens``). It used to be a process-local dict, which
meant a revoked token silently became valid again after a restart or on a second instance —
the regression `test_revocation_survives_a_fresh_store` exists to catch.

Every case injects the test `session_factory` so the store's writes stay inside the test
transaction; the production singleton resolves `app.database.async_session_maker` instead.
"""

from datetime import UTC, datetime, timedelta

import pytest

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
