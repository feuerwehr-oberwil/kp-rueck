"""Per-username login failure throttle.

Why this exists alongside the slowapi per-IP limit:

A command post NATs every tablet, laptop and wall display behind a single
public IP. The slowapi limiter keys on that IP and counts EVERY login attempt,
successful ones included — so four operators signing in during the same minute
locked the whole crew out, with no recovery but waiting. Raising the ceiling
would have fixed the lockout by giving up the brute-force protection that was
the point of the limit.

Splitting the two concerns keeps both properties:

* slowapi keeps a loose per-IP ceiling (``login_rate_limit_per_ip``) purely to
  blunt username spraying from one host.
* This module throttles on (client IP, username) and counts ONLY failures.
  Successful logins clear the counter, so honest operators never consume each
  other's budget no matter how many share an IP — while an attacker guessing
  one account is cut off after a handful of tries, which is tighter than the
  old 3/minute ever was.

In-memory, like ``TokenBlocklist``: single-process deployments only. A
multi-replica backend would need Redis, and the failure would be permissive
(each replica tracking its own counts) rather than a lockout.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

from ..config import settings

logger = logging.getLogger(__name__)


@dataclass
class _Attempts:
    """Failure bookkeeping for one (ip, username) pair."""

    count: int = 0
    # Monotonic timestamp of the most recent failure.
    last_failure_at: float = field(default_factory=time.monotonic)
    # Set when the cap is hit; attempts are refused until this passes.
    locked_until: float = 0.0


class LoginThrottle:
    """Tracks consecutive failed logins per (client IP, username)."""

    def __init__(self) -> None:
        self._attempts: dict[tuple[str, str], _Attempts] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task[None] | None = None
        self._cleanup_interval = 600  # Prune stale entries every 10 minutes

    # ── lifecycle ──────────────────────────────────────────────────────

    async def start_cleanup_task(self) -> None:
        """Start the background pruning task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("Login throttle cleanup task started")

    async def stop_cleanup_task(self) -> None:
        """Stop the background pruning task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        self._cleanup_task = None

    async def _cleanup_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._cleanup_interval)
                await self.prune()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Login throttle cleanup error: {e}")

    # ── throttling ─────────────────────────────────────────────────────

    @staticmethod
    def _key(ip: str, username: str) -> tuple[str, str]:
        # Usernames are matched case-insensitively so an attacker cannot reset
        # the counter by varying capitalisation.
        return (ip, username.strip().lower())

    async def retry_after(self, ip: str, username: str) -> int:
        """Seconds the caller must wait, or 0 when the attempt may proceed."""
        now = time.monotonic()
        async with self._lock:
            entry = self._attempts.get(self._key(ip, username))
            if entry is None or entry.locked_until <= now:
                return 0
            return max(1, int(entry.locked_until - now))

    async def record_failure(self, ip: str, username: str) -> None:
        """Count a failed attempt, locking the pair out once it hits the cap."""
        now = time.monotonic()
        key = self._key(ip, username)
        async with self._lock:
            entry = self._attempts.get(key)
            # A long-idle entry starts over: the window exists so a slow
            # trickle of typos over an afternoon never accumulates a lockout.
            if entry is None or now - entry.last_failure_at > settings.login_failed_window_seconds:
                entry = _Attempts()
                self._attempts[key] = entry

            entry.count += 1
            entry.last_failure_at = now

            if entry.count >= settings.login_max_failed_attempts:
                entry.locked_until = now + settings.login_failed_lockout_seconds
                entry.count = 0  # Next lockout requires a fresh run of failures
                logger.warning(
                    "Login throttle: locked out user '%s' from %s for %ds",
                    key[1],
                    ip,
                    settings.login_failed_lockout_seconds,
                )

    async def record_success(self, ip: str, username: str) -> None:
        """Clear the counter — a correct password proves this isn't an attack."""
        async with self._lock:
            self._attempts.pop(self._key(ip, username), None)

    async def prune(self) -> int:
        """Drop entries that are neither locked nor within the failure window."""
        now = time.monotonic()
        async with self._lock:
            stale = [
                key
                for key, entry in self._attempts.items()
                if entry.locked_until <= now and now - entry.last_failure_at > settings.login_failed_window_seconds
            ]
            for key in stale:
                del self._attempts[key]
        return len(stale)

    async def reset(self) -> None:
        """Clear all state (tests)."""
        async with self._lock:
            self._attempts.clear()


login_throttle = LoginThrottle()
