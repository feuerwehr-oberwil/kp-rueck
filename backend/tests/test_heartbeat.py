"""The dead-man's switch must be genuinely absent when unconfigured, and must never be able
to take the app down with it.

The failure it exists to catch (kp-front, 2026-08-03) was a healthy container stopped with
nothing replacing it — 25 minutes of 502 found by a person, not by monitoring. The failure it
must not CAUSE is the mirror image: a station whose board stops working because a monitoring
endpoint is unreachable would be a strictly worse bug than the one being fixed.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.background import heartbeat


@pytest.mark.asyncio
async def test_no_url_configured_does_not_ping():
    """Unset → not merely a silent failure, but no outbound request at all."""
    with patch.object(heartbeat.settings, "healthcheck_ping_url", ""), patch("httpx.AsyncClient") as client:
        assert await heartbeat.ping() is False
        client.assert_not_called()


@pytest.mark.asyncio
async def test_pings_the_configured_url():
    url = "https://hc-ping.com/deadbeef"
    with patch.object(heartbeat.settings, "healthcheck_ping_url", url):
        get = AsyncMock()
        with patch("httpx.AsyncClient") as client:
            client.return_value.__aenter__.return_value.get = get
            assert await heartbeat.ping() is True
        get.assert_awaited_once_with(url)


@pytest.mark.asyncio
async def test_a_dead_monitor_never_raises():
    """The whole point of fail-open: healthchecks.io being down is not our outage."""
    with (
        patch.object(heartbeat.settings, "healthcheck_ping_url", "https://hc-ping.com/x"),
        patch("httpx.AsyncClient") as client,
    ):
        client.return_value.__aenter__.return_value.get = AsyncMock(side_effect=OSError("network unreachable"))
        assert await heartbeat.ping() is False  # swallowed, not raised


def test_scheduler_not_started_without_a_url():
    """No URL → no job, rather than a job that pings nothing every 60 s forever."""
    heartbeat.stop_heartbeat_scheduler()
    with patch.object(heartbeat.settings, "healthcheck_ping_url", ""):
        heartbeat.start_heartbeat_scheduler()
    assert heartbeat.scheduler is None


@pytest.mark.asyncio
async def test_scheduler_starts_and_stops_when_configured():
    # async: AsyncIOScheduler.start() binds to the running loop and raises without one —
    # which is also why lifespan starts it inside the app's loop rather than at import.
    heartbeat.stop_heartbeat_scheduler()
    with patch.object(heartbeat.settings, "healthcheck_ping_url", "https://hc-ping.com/x"):
        heartbeat.start_heartbeat_scheduler()
        assert heartbeat.scheduler is not None
        assert heartbeat.scheduler.get_job("heartbeat") is not None
        # idempotent: a second start must not stack a second job or a second scheduler
        first = heartbeat.scheduler
        heartbeat.start_heartbeat_scheduler()
        assert heartbeat.scheduler is first
    heartbeat.stop_heartbeat_scheduler()
    assert heartbeat.scheduler is None
