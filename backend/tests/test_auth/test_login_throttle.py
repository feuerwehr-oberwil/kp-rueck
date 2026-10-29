"""Tests for the per-username login failure throttle.

The property that matters operationally: a command post NATs every device
behind one IP, so successful logins must NEVER consume anyone's budget. The
old per-IP limit counted them, which locked out the whole crew.
"""

from types import SimpleNamespace

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


@pytest.fixture
def clock(monkeypatch):
    """Advance the throttle's monotonic clock without sleeps or wall-clock changes."""
    now = [1000.0]
    monkeypatch.setattr("app.auth.login_throttle.time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(settings, "login_max_failed_attempts", 3)
    monkeypatch.setattr(settings, "login_failed_window_seconds", 100)
    monkeypatch.setattr(settings, "login_failed_lockout_seconds", 60)
    return now


async def test_lockout_expires_at_its_deadline(throttle, clock):
    await _fail(throttle, 3)
    assert await throttle.retry_after(IP, "anna") == 60
    clock[0] += 59.75
    assert await throttle.retry_after(IP, "anna") == 1
    clock[0] += 0.25
    assert await throttle.retry_after(IP, "anna") == 0


async def test_a_long_idle_gap_discards_old_failures(throttle, clock):
    await _fail(throttle, 2)
    clock[0] += 101
    await _fail(throttle, 1)
    assert await throttle.retry_after(IP, "anna") == 0
    await _fail(throttle, 2)
    assert await throttle.retry_after(IP, "anna") == 60


async def test_failure_window_is_measured_from_the_last_failure(throttle, clock):
    await _fail(throttle, 1)
    clock[0] += 99
    await _fail(throttle, 1)
    clock[0] += 2
    await _fail(throttle, 1)
    assert await throttle.retry_after(IP, "anna") == 60


async def test_failure_at_the_window_boundary_still_counts(throttle, clock):
    await _fail(throttle, 2)
    clock[0] += 100
    await _fail(throttle, 1)
    assert await throttle.retry_after(IP, "anna") == 60


async def test_expired_lockout_requires_a_fresh_run_of_failures(throttle, clock):
    await _fail(throttle, 3)
    clock[0] += 60
    await _fail(throttle, 2)
    assert await throttle.retry_after(IP, "anna") == 0
    await _fail(throttle, 1)
    assert await throttle.retry_after(IP, "anna") == 60


async def test_username_whitespace_cannot_bypass_lockout(throttle, clock):
    await _fail(throttle, 2)
    await throttle.record_failure(IP, "  ANNA\t")
    assert await throttle.retry_after(IP, " anna ") == 60
    await throttle.record_success(IP, " ANNA ")
    assert await throttle.retry_after(IP, "anna") == 0


async def test_prune_removes_only_idle_unlocked_entries(throttle, clock, monkeypatch):
    monkeypatch.setattr(settings, "login_failed_lockout_seconds", 200)
    await _fail(throttle, 3, username="locked")
    await _fail(throttle, 1, username="idle")
    clock[0] += 100
    await _fail(throttle, 1, username="recent")
    assert await throttle.prune() == 0
    clock[0] += 1
    assert await throttle.prune() == 1
    assert await throttle.retry_after(IP, "locked") == 99
    clock[0] += 99
    assert await throttle.prune() == 1
    assert await throttle.retry_after(IP, "locked") == 0
    assert await throttle.prune() == 0


async def test_reset_clears_all_accounts_and_addresses(throttle, clock):
    await _fail(throttle, 3)
    await _fail(throttle, 3, ip=OTHER_IP, username="bruno")
    await throttle.reset()
    assert await throttle.retry_after(IP, "anna") == 0
    assert await throttle.retry_after(OTHER_IP, "bruno") == 0
    assert await throttle.prune() == 0
