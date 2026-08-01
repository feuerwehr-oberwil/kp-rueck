"""Tests for the position cache on TraccarPoller.

The cache exists for one reason: request handlers must never call Traccar themselves.
`GET /api/notifications/` holds a pooled DB connection for its whole duration and is polled
every 10 s by every connected board, so an unreachable GPS server used to park one connection
per client per round and drain the pool (20 + 10 overflow) in well under a minute.

These tests pin the three properties a reader depends on: fresh positions come back, stale ones
do not, and stopping the poller drops the cache rather than leaving it to age out.
"""

from datetime import UTC, datetime, timedelta

from app.services.traccar_poller import POSITION_CACHE_MAX_AGE_SECONDS, TraccarPoller
from app.traccar import VehiclePosition


def _position(name: str = "TLF") -> VehiclePosition:
    return VehiclePosition(
        device_id=1,
        device_name=name,
        unique_id="tlf-1",
        status="online",
        latitude=47.5,
        longitude=7.6,
        last_update=datetime.now(UTC),
    )


def test_cache_is_empty_before_the_first_poll() -> None:
    """A reader that arrives before any poll gets nothing — not a stale default, not None."""
    assert TraccarPoller().cached_positions() == []


def test_fresh_positions_are_returned() -> None:
    poller = TraccarPoller()
    poller._last_positions = [_position()]
    poller._last_positions_at = datetime.now(UTC)

    cached = poller.cached_positions()
    assert len(cached) == 1
    assert cached[0].device_name == "TLF"


def test_positions_older_than_the_window_are_withheld() -> None:
    """Past the window the answer is "nothing", never a position from a different phase of
    the incident. A geofence alert computed from a stale fix is worse than no alert."""
    poller = TraccarPoller()
    poller._last_positions = [_position()]
    poller._last_positions_at = datetime.now(UTC) - timedelta(seconds=POSITION_CACHE_MAX_AGE_SECONDS + 1)

    assert poller.cached_positions() == []


def test_the_window_is_configurable_per_reader() -> None:
    poller = TraccarPoller()
    poller._last_positions = [_position()]
    poller._last_positions_at = datetime.now(UTC) - timedelta(seconds=30)

    assert poller.cached_positions(max_age_seconds=60) != []
    assert poller.cached_positions(max_age_seconds=10) == []


async def test_stopping_the_poller_drops_the_cache() -> None:
    """Not just left to age out: once polling stops nothing refreshes the cache, and a reader
    arriving inside the freshness window would otherwise be handed positions from before the
    gap — which look current and are not."""
    poller = TraccarPoller()
    poller._last_positions = [_position()]
    poller._last_positions_at = datetime.now(UTC)
    assert poller.cached_positions() != []

    await poller.stop_polling()

    assert poller.cached_positions() == []
    assert poller._last_positions_at is None
