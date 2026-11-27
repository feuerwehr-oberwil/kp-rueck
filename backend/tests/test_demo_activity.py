"""When the public demo counts as unused (app/demo_activity.py), and what then stays quiet.

The demo sleeps on Railway Serverless once it sends nothing for 5–10 min. Every job that reads
Postgres or calls out on the demo asks `demo_idle()` first – a wrong answer here keeps it awake
all day, or stops the work a connected visitor is looking at.
"""

import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest

from app import demo_activity
from app.background import demo_reset
from app.websocket_manager import ws_manager


@pytest.fixture
def demo(monkeypatch: pytest.MonkeyPatch):
    """Demo mode, booted long ago, nobody connected."""
    monkeypatch.setattr(demo_activity.settings, "demo_mode", True)
    monkeypatch.setattr(demo_activity, "_booted_at", time.monotonic() - demo_activity.BOOT_GRACE_SECONDS - 1)
    monkeypatch.setattr(ws_manager, "user_sessions", {})


def test_a_station_is_never_idle(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(demo_activity.settings, "demo_mode", False)
    monkeypatch.setattr(ws_manager, "user_sessions", {})
    assert not demo_activity.demo_idle()
    assert not demo_activity.demo_unwatched()


@pytest.mark.usefixtures("demo")
def test_the_demo_is_idle_with_no_board_connected_after_the_boot_grace():
    assert demo_activity.demo_idle()


@pytest.mark.usefixtures("demo")
def test_a_connected_board_keeps_the_demo_busy(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(ws_manager, "user_sessions", {"sid": {}})
    assert not demo_activity.demo_idle()
    assert not demo_activity.demo_unwatched()


@pytest.mark.usefixtures("demo")
def test_the_first_minutes_after_a_boot_count_as_used(monkeypatch: pytest.MonkeyPatch):
    # A wake is caused by a visitor whose board is still loading.
    monkeypatch.setattr(demo_activity, "_booted_at", time.monotonic())
    assert not demo_activity.demo_idle()
    assert demo_activity.demo_unwatched()


@pytest.mark.asyncio
@pytest.mark.usefixtures("demo")
async def test_the_midnight_reset_skips_an_unused_demo():
    with patch.object(demo_reset, "reset_demo", AsyncMock()) as reset:
        await demo_reset.scheduled_demo_reset()
    reset.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.usefixtures("demo")
async def test_the_midnight_reset_runs_while_a_board_is_connected(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(ws_manager, "user_sessions", {"sid": {}})
    with patch.object(demo_reset, "reset_demo", AsyncMock()) as reset:
        await demo_reset.scheduled_demo_reset()
    reset.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_boot_resets_the_demo_before_it_serves_then_schedules_midnight():
    scheduler = AsyncMock()
    with (
        patch.object(demo_reset, "reset_demo", AsyncMock()) as reset,
        patch.object(demo_reset, "schedule") as schedule,
    ):
        await demo_reset.start(scheduler)
    reset.assert_awaited_once()
    schedule.assert_called_once_with(scheduler)


@pytest.mark.asyncio
@pytest.mark.usefixtures("demo")
async def test_on_an_idle_demo_the_timed_jobs_touch_neither_database_nor_network(monkeypatch: pytest.MonkeyPatch):
    from app.background import notification_watch, telemetry_flush, weather

    reached: list[str] = []

    def forbidden(*_args, **_kwargs):
        reached.append("called")  # recorded: the notification loop swallows what it raises
        raise AssertionError("an idle demo reached the database or the network")

    monkeypatch.setattr(telemetry_flush, "async_session_maker", forbidden)
    monkeypatch.setattr(weather, "async_session_maker", forbidden)
    monkeypatch.setattr(weather.weather_service, "poll_radar", forbidden)
    monkeypatch.setattr(weather.weather_service, "poll_warnings", forbidden)
    monkeypatch.setattr(notification_watch, "evaluate_open_events", forbidden)
    monkeypatch.setattr(demo_reset, "reset_demo", forbidden)

    assert await telemetry_flush.flush_outbox() == 0
    await weather.poll_radar()
    await weather.poll_warnings()
    await demo_reset.scheduled_demo_reset()
    # The notification loop: one turn with a zero interval, then stop it.
    monkeypatch.setattr(notification_watch, "INTERVAL_SECONDS", 0)
    notification_watch.start_notification_watch()
    await asyncio.sleep(0.05)
    await notification_watch.stop_notification_watch()
    assert reached == []
