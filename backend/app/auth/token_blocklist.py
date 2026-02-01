"""Token blocklist for JWT revocation.

Provides proper logout functionality by tracking revoked token JTIs.
Uses in-memory storage with automatic cleanup of expired entries.

For distributed deployments, consider Redis or database storage.
"""

import asyncio
import logging
from datetime import UTC, datetime

logger = logging.getLogger(__name__)


class TokenBlocklist:
    """
    In-memory blocklist for revoked JWT tokens.

    Stores token JTIs (JWT IDs) with their expiration times.
    Automatically cleans up expired entries to prevent memory growth.

    Thread-safe for async operations.
    """

    def __init__(self) -> None:
        self._revoked: dict[str, datetime] = {}  # jti -> original token expiry
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None
        self._cleanup_interval = 3600  # Clean up every hour

    async def start_cleanup_task(self) -> None:
        """Start the background cleanup task."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("Token blocklist cleanup task started")

    async def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
            logger.info("Token blocklist cleanup task stopped")

    async def _cleanup_loop(self) -> None:
        """Background loop to clean up expired entries."""
        while True:
            try:
                await asyncio.sleep(self._cleanup_interval)
                await self.cleanup_expired()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Token blocklist cleanup error: {e}")

    async def revoke(self, jti: str, expires_at: datetime) -> None:
        """
        Add a token JTI to the blocklist.

        Args:
            jti: The JWT ID to revoke
            expires_at: When the original token expires (for cleanup)
        """
        async with self._lock:
            self._revoked[jti] = expires_at
            logger.debug(f"Token revoked: {jti[:8]}... (expires: {expires_at})")

    async def is_revoked(self, jti: str) -> bool:
        """
        Check if a token JTI has been revoked.

        Args:
            jti: The JWT ID to check

        Returns:
            True if the token has been revoked, False otherwise
        """
        return jti in self._revoked

    async def cleanup_expired(self) -> int:
        """
        Remove expired entries from the blocklist.

        Returns:
            Number of entries removed
        """
        now = datetime.now(UTC)
        async with self._lock:
            expired_jtis = [jti for jti, exp in self._revoked.items() if exp <= now]
            for jti in expired_jtis:
                del self._revoked[jti]

            if expired_jtis:
                logger.debug(f"Cleaned up {len(expired_jtis)} expired token blocklist entries")

            return len(expired_jtis)

    @property
    def size(self) -> int:
        """Current number of entries in the blocklist."""
        return len(self._revoked)


# Global singleton instance
token_blocklist = TokenBlocklist()
