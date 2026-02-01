"""Tests for token blocklist functionality."""

from datetime import UTC, datetime, timedelta

import pytest

from app.auth.token_blocklist import TokenBlocklist


@pytest.fixture
def blocklist():
    """Create a fresh token blocklist for each test."""
    return TokenBlocklist()


@pytest.mark.asyncio
async def test_revoke_token(blocklist: TokenBlocklist):
    """Test adding a token to the blocklist."""
    jti = "test-token-id-123"
    expires_at = datetime.now(UTC) + timedelta(hours=1)

    await blocklist.revoke(jti, expires_at)

    assert await blocklist.is_revoked(jti) is True
    assert blocklist.size == 1


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
    assert blocklist.size == 3


@pytest.mark.asyncio
async def test_cleanup_expired_entries(blocklist: TokenBlocklist):
    """Test that expired entries are cleaned up."""
    # Add an expired token
    expired_time = datetime.now(UTC) - timedelta(hours=1)
    await blocklist.revoke("expired-token", expired_time)

    # Add a valid token
    valid_time = datetime.now(UTC) + timedelta(hours=1)
    await blocklist.revoke("valid-token", valid_time)

    assert blocklist.size == 2

    # Run cleanup
    removed = await blocklist.cleanup_expired()

    assert removed == 1
    assert blocklist.size == 1
    assert await blocklist.is_revoked("expired-token") is False
    assert await blocklist.is_revoked("valid-token") is True


@pytest.mark.asyncio
async def test_cleanup_removes_all_expired(blocklist: TokenBlocklist):
    """Test cleanup removes all expired entries."""
    expired_time = datetime.now(UTC) - timedelta(hours=1)

    await blocklist.revoke("expired-1", expired_time)
    await blocklist.revoke("expired-2", expired_time)
    await blocklist.revoke("expired-3", expired_time)

    removed = await blocklist.cleanup_expired()

    assert removed == 3
    assert blocklist.size == 0


@pytest.mark.asyncio
async def test_cleanup_returns_zero_when_nothing_expired(blocklist: TokenBlocklist):
    """Test cleanup returns zero when no entries are expired."""
    valid_time = datetime.now(UTC) + timedelta(hours=1)

    await blocklist.revoke("valid-token", valid_time)

    removed = await blocklist.cleanup_expired()

    assert removed == 0
    assert blocklist.size == 1


@pytest.mark.asyncio
async def test_size_property(blocklist: TokenBlocklist):
    """Test size property reflects current entry count."""
    assert blocklist.size == 0

    await blocklist.revoke("token-1", datetime.now(UTC) + timedelta(hours=1))
    assert blocklist.size == 1

    await blocklist.revoke("token-2", datetime.now(UTC) + timedelta(hours=1))
    assert blocklist.size == 2


@pytest.mark.asyncio
async def test_revoke_same_token_twice(blocklist: TokenBlocklist):
    """Test revoking the same token twice doesn't duplicate."""
    jti = "duplicate-token"
    expires_at = datetime.now(UTC) + timedelta(hours=1)

    await blocklist.revoke(jti, expires_at)
    await blocklist.revoke(jti, expires_at)

    assert blocklist.size == 1
    assert await blocklist.is_revoked(jti) is True
