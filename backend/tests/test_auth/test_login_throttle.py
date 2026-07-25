"""Tests for the per-username login failure throttle.

The property that matters operationally: a command post NATs every device
behind one IP, so successful logins must NEVER consume anyone's budget. The
old per-IP limit counted them, which locked out the whole crew.
"""

import pytest

from app.auth.login_throttle import LoginThrottle
from app.config import settings

IP = "203.0.113.10"
OTHER_IP = "203.0.113.11"


@pytest.fixture
def throttle() -> LoginThrottle:
    return LoginThrottle()


async def _fail(throttle: LoginThrottle, times: int, ip: str = IP, username: str = "anna") -> None:
    for _ in range(times):
        await throttle.record_failure(ip, username)


async def test_allows_attempts_below_the_cap(throttle: LoginThrottle):
    await _fail(throttle, settings.login_max_failed_attempts - 1)
    assert await throttle.retry_after(IP, "anna") == 0


async def test_locks_out_at_the_cap(throttle: LoginThrottle):
    await _fail(throttle, settings.login_max_failed_attempts)

    retry_after = await throttle.retry_after(IP, "anna")
    assert retry_after > 0
    assert retry_after <= settings.login_failed_lockout_seconds


async def test_success_clears_the_counter(throttle: LoginThrottle):
    """A few typos before signing in correctly must leave nothing behind."""
    await _fail(throttle, settings.login_max_failed_attempts - 1)
    await throttle.record_success(IP, "anna")

    # A full fresh run of failures should be needed to lock out again.
    await _fail(throttle, settings.login_max_failed_attempts - 1)
    assert await throttle.retry_after(IP, "anna") == 0


async def test_lockout_is_scoped_to_one_username(throttle: LoginThrottle):
    """Regression: the whole command post shares one public IP.

    Locking Anna out must not touch Bruno, who is on the same NAT.
    """
    await _fail(throttle, settings.login_max_failed_attempts, username="anna")

    assert await throttle.retry_after(IP, "anna") > 0
    assert await throttle.retry_after(IP, "bruno") == 0


async def test_lockout_is_scoped_to_one_ip(throttle: LoginThrottle):
    await _fail(throttle, settings.login_max_failed_attempts, ip=IP)

    assert await throttle.retry_after(IP, "anna") > 0
    assert await throttle.retry_after(OTHER_IP, "anna") == 0


async def test_username_matching_is_case_insensitive(throttle: LoginThrottle):
    """Varying capitalisation must not reset the counter."""
    await _fail(throttle, settings.login_max_failed_attempts - 1, username="anna")
    await throttle.record_failure(IP, "ANNA")

    assert await throttle.retry_after(IP, "Anna") > 0


async def test_prune_keeps_active_lockouts(throttle: LoginThrottle):
    await _fail(throttle, settings.login_max_failed_attempts)

    await throttle.prune()
    assert await throttle.retry_after(IP, "anna") > 0
