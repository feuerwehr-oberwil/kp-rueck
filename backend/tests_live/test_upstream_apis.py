"""Are the outside APIs the weather layer reads still shaped the way our parsers expect?

These call the real services, so they live outside `tests/` (whose conftest blocks the network
and needs a database) and never gate a merge: `.github/workflows/upstream-apis.yml` runs them
daily and opens an issue when one goes red. Run by hand with `cd backend && uv run pytest tests_live`.

Why they exist: MeteoSwiss renamed its radar files on 13.10.2026 (`…vl.001.h5` → `…rl.001.h5`)
and the board showed no radar for days without one red test – the unit tests mock the feeds.
"""

from datetime import UTC, datetime

from app.services.weather.service import RADAR_STALE_AFTER, WeatherService

OBERWIL = (47.514, 7.556)


async def test_meteoswiss_radar_frames_are_found_and_decode():
    service = WeatherService()
    now = datetime.now(UTC)
    await service.poll_radar(now=now)
    radar = service.snapshot(now)["radar"]
    assert radar["status"]["last_error"] is None
    assert radar["frames"], "no radar frame in the last hour"
    assert radar["stale"] is False, f"newest frame {radar['data_time']} is older than {RADAR_STALE_AFTER}"
    assert service.frame_png(radar["frames"][-1]["key"]).startswith(b"\x89PNG")


async def test_meteoalarm_and_alertswiss_feeds_parse():
    service = WeatherService()
    now = datetime.now(UTC)
    await service.poll_warnings(OBERWIL, now=now)
    sources = service.snapshot(now)["warnings"]["sources"]
    for name in ("meteoswiss", "alertswiss"):
        assert sources[name]["last_error"] is None, f"{name}: {sources[name]['last_error']}"
        assert sources[name]["stale"] is False
