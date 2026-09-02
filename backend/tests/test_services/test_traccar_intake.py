"""Tests for the vehicle-tracking intake: `TraccarClient` (app/traccar.py) and
`TraccarPoller` (app/services/traccar_poller.py).

`TraccarClient` talks to Traccar over `httpx.AsyncClient()` with no injected transport, so
the only way to exercise its success paths without a live server is to swap in an
`httpx.MockTransport` for the duration of a test — exactly what `conftest.py`'s
`block_outbound_http` docstring points at ("mock the client at its module seam"). The
`traccar_unconfigured` fixture only blanks the *shared* `traccar_client` singleton, so tests
here build their own `TraccarClient()` instances against patched `settings` to stay isolated
from it and from each other.

`TraccarPoller` tests avoid touching the database entirely: `_run_automation` opens its own
session via `app.database.async_session_maker`, which is stubbed out rather than pointed at
the test database, since nothing here needs it.
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from app import traccar as traccar_module
from app.services import gps_simulation as gps_simulation_module
from app.services import traccar_poller as traccar_poller_module
from app.services.traccar_poller import TraccarPoller
from app.traccar import TraccarClient, TraccarDevice, TraccarPosition

gps_simulation = gps_simulation_module.gps_simulation

SESSION_COOKIE_HEADERS = {"set-cookie": "JSESSIONID=abc123; Path=/"}


def _configured_client(monkeypatch: pytest.MonkeyPatch) -> TraccarClient:
    """A `TraccarClient` with real-looking credentials, independent of the shared singleton."""
    monkeypatch.setattr(traccar_module.settings, "traccar_url", "https://gps.example.ch")
    monkeypatch.setattr(traccar_module.settings, "traccar_email", "kp@example.ch")
    monkeypatch.setattr(traccar_module.settings, "traccar_password", "secret")
    return TraccarClient()


def _mock_transport(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    """Route every `httpx.AsyncClient()` built during the test through `handler`.

    `httpx.MockTransport` is a different class from the two transports
    `block_outbound_http` blocks, so this is the sanctioned escape hatch for a test that
    genuinely wants a simulated response instead of the "no live requests" guard.
    """
    real_async_client = httpx.AsyncClient

    class _MockedAsyncClient(real_async_client):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _MockedAsyncClient)


def _session_ok(request: httpx.Request) -> httpx.Response | None:
    """Answer `/api/session`, or None if the request is for something else."""
    if request.url.path.endswith("/api/session"):
        return httpx.Response(200, headers=SESSION_COOKIE_HEADERS)
    return None


# ============================================
# TraccarClient — configuration guard
# ============================================


async def test_unconfigured_client_is_a_quiet_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing credentials means every method returns `[]` without attempting a request.

    No mock transport is installed here on purpose: if the guard were bypassed, the real
    `httpx.AsyncHTTPTransport` would fire and `block_outbound_http` would raise instead of
    letting the test pass — the absence of a mock IS the assertion.

    Settings are blanked explicitly rather than relying on the `traccar_unconfigured`
    fixture, which only neutralises the shared singleton — a fresh `TraccarClient()` here
    would otherwise pick up a developer's real `backend/.env` credentials.
    """
    monkeypatch.setattr(traccar_module.settings, "traccar_url", "")
    monkeypatch.setattr(traccar_module.settings, "traccar_email", "")
    monkeypatch.setattr(traccar_module.settings, "traccar_password", "")
    client = TraccarClient()
    assert not client.is_configured

    now = datetime.now(UTC)
    assert await client.get_devices() == []
    assert await client.get_positions() == []
    assert await client.get_position_history(1, now, now) == []
    assert await client.get_vehicle_positions() == []


# ============================================
# TraccarClient — parsing, units, orphans
# ============================================


async def test_get_devices_parses_response(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _configured_client(monkeypatch)
    device_payload = {
        "id": 1,
        "name": "TLF 1",
        "uniqueId": "tlf-1",
        "status": "online",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/devices"):
            return httpx.Response(200, json=[device_payload])
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    devices = await client.get_devices()
    assert devices == [TraccarDevice(**device_payload)]


async def test_get_vehicle_positions_converts_knots_and_drops_orphans(monkeypatch: pytest.MonkeyPatch) -> None:
    """The knot->km/h conversion and the "no matching device" drop, in one real round trip.

    `positions` carries a second reading for `deviceId=999`, which no device in `devices`
    claims — it must not appear in the result, and must not blow up the ones that do.
    """
    client = _configured_client(monkeypatch)
    now_iso = datetime.now(UTC).isoformat()
    devices = [{"id": 1, "name": "TLF 1", "uniqueId": "tlf-1", "status": "online"}]
    positions = [
        {
            "id": 10,
            "deviceId": 1,
            "latitude": 47.5,
            "longitude": 7.5,
            "speed": 10.0,  # knots
            "course": 90.0,
            "deviceTime": now_iso,
            "serverTime": now_iso,
            "fixTime": now_iso,
            "address": "Bahnhofstrasse 1",
        },
        {
            "id": 11,
            "deviceId": 999,  # orphan: no such device below
            "latitude": 1.0,
            "longitude": 1.0,
            "speed": None,
            "course": None,
            "deviceTime": now_iso,
            "serverTime": now_iso,
            "fixTime": now_iso,
            "address": None,
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/devices"):
            return httpx.Response(200, json=devices)
        if request.url.path.endswith("/api/positions"):
            return httpx.Response(200, json=positions)
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    result = await client.get_vehicle_positions()

    assert len(result) == 1
    assert result[0].device_id == 1
    assert result[0].speed == pytest.approx(10.0 * 1.852)


async def test_get_positions_parses_response(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _configured_client(monkeypatch)
    now_iso = datetime.now(UTC).isoformat()
    payload = [
        {
            "id": 1,
            "deviceId": 1,
            "latitude": 47.5,
            "longitude": 7.5,
            "deviceTime": now_iso,
            "serverTime": now_iso,
            "fixTime": now_iso,
        }
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/positions"):
            return httpx.Response(200, json=payload)
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    result = await client.get_positions()
    assert result == [TraccarPosition(**payload[0])]


async def test_get_vehicle_positions_empty_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _configured_client(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/devices"):
            return httpx.Response(200, json=[])
        if request.url.path.endswith("/api/positions"):
            return httpx.Response(200, json=[])
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    assert await client.get_vehicle_positions() == []


# ============================================
# TraccarClient — a bad upstream
# ============================================


async def test_non_200_from_upstream_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _configured_client(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/positions"):
            return httpx.Response(503, text="Service Unavailable")
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    with pytest.raises(httpx.HTTPStatusError):
        await client.get_positions()


async def test_timeout_from_upstream_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _configured_client(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/positions"):
            raise httpx.ReadTimeout("Traccar did not answer in time", request=request)
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    with pytest.raises(httpx.ReadTimeout):
        await client.get_positions()


async def test_get_position_history_sends_device_and_time_range(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _configured_client(monkeypatch)
    now_iso = datetime.now(UTC).isoformat()
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/positions"):
            captured.update(request.url.params)
            return httpx.Response(
                200,
                json=[
                    {
                        "id": 1,
                        "deviceId": 1,
                        "latitude": 47.5,
                        "longitude": 7.5,
                        "deviceTime": now_iso,
                        "serverTime": now_iso,
                        "fixTime": now_iso,
                    }
                ],
            )
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    from_time = datetime(2026, 9, 2, 10, 0, 0)
    to_time = datetime(2026, 9, 2, 11, 0, 0)
    result = await client.get_position_history(1, from_time, to_time)

    assert captured["deviceId"] == "1"
    assert captured["from"] == from_time.isoformat() + "Z"
    assert captured["to"] == to_time.isoformat() + "Z"
    assert len(result) == 1


@pytest.mark.xfail(
    strict=True,
    reason=(
        "BUG: get_position_history() builds its 'from'/'to' query params as "
        "`dt.isoformat() + 'Z'`. That is only valid for a naive datetime — every real "
        "caller (_poll_trails uses `datetime.now(UTC)`) passes a tz-aware one, whose "
        "isoformat() already ends in '+00:00', so the literal 'Z' is appended on top: "
        "'2026-09-02T10:00:00+00:00Z'. That string is not valid ISO 8601 (double "
        "timezone marker) and Python's own `datetime.fromisoformat` rejects it. Trail "
        "polling (services/traccar_poller.py::_poll_trails) has been sending this to "
        "Traccar on every tick since UTC-aware datetimes were adopted; whether the "
        "server tolerates the trailing 'Z' or silently returns no rows is unverified "
        "here, but the format is wrong either way."
    ),
)
async def test_get_position_history_timestamps_are_valid_iso8601(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _configured_client(monkeypatch)
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if (resp := _session_ok(request)) is not None:
            return resp
        if request.url.path.endswith("/api/positions"):
            captured.update(request.url.params)
            return httpx.Response(200, json=[])
        raise AssertionError(f"unexpected request to {request.url}")

    _mock_transport(monkeypatch, handler)

    now = datetime.now(UTC)
    await client.get_position_history(1, now, now)

    datetime.fromisoformat(captured["from"])
    datetime.fromisoformat(captured["to"])


# ============================================
# TraccarPoller — start/stop lifecycle
# ============================================


async def test_start_polling_is_a_noop_when_unconfigured_and_no_simulation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neither a real Traccar nor an active training drive: polling never starts."""
    monkeypatch.setattr(gps_simulation, "any_active", lambda: False)
    poller = TraccarPoller()

    await poller.start_polling()

    assert poller.is_polling is False
    assert poller._positions_task is None
    assert poller._trails_task is None


async def test_start_polling_twice_reuses_the_running_task(monkeypatch: pytest.MonkeyPatch) -> None:
    """A second `start_polling()` while already running must not spawn a second pair of tasks."""
    monkeypatch.setattr(gps_simulation, "any_active", lambda: True)
    monkeypatch.setattr(traccar_poller_module, "POSITIONS_INTERVAL_SECONDS", 60)
    monkeypatch.setattr(traccar_poller_module, "TRAILS_INTERVAL_SECONDS", 60)
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_positions", AsyncMock())
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_trails", AsyncMock())

    poller = TraccarPoller()
    monkeypatch.setattr(poller, "_run_automation", AsyncMock())

    await poller.start_polling()
    first_positions_task = poller._positions_task
    first_trails_task = poller._trails_task

    await poller.start_polling()

    assert poller._positions_task is first_positions_task
    assert poller._trails_task is first_trails_task

    await poller.stop_polling()


async def test_start_and_stop_polling_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    """A full start -> a couple of ticks -> stop, against an unconfigured (simulation-only)
    client so no HTTP is involved. Exercises the CancelledError branches in both poll loops
    and the cache-clearing side of `stop_polling`."""
    monkeypatch.setattr(gps_simulation, "any_active", lambda: True)
    monkeypatch.setattr(traccar_poller_module, "POSITIONS_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(traccar_poller_module, "TRAILS_INTERVAL_SECONDS", 0.01)
    broadcast_positions = AsyncMock()
    broadcast_trails = AsyncMock()
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_positions", broadcast_positions)
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_trails", broadcast_trails)

    poller = TraccarPoller()
    monkeypatch.setattr(poller, "_run_automation", AsyncMock())

    await poller.start_polling()
    assert poller.is_polling is True

    for _ in range(50):
        if broadcast_positions.await_count and broadcast_trails.await_count:
            break
        await asyncio.sleep(0.01)
    assert broadcast_positions.await_count >= 1
    assert broadcast_trails.await_count >= 1
    # The underlying client is unconfigured, so every broadcast tick carried no positions.
    assert poller.cached_positions() == []

    await poller.stop_polling()

    assert poller.is_polling is False
    assert poller._positions_task is None
    assert poller._trails_task is None
    assert poller.cached_positions() == []


# ============================================
# TraccarPoller — resilience
# ============================================


async def test_poll_positions_survives_repeated_upstream_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    """A broken upstream must not crash the loop, and a failed tick must never populate the
    cache — a request handler reading `cached_positions()` should see "no data", not a
    half-built result from a tick that actually failed."""
    monkeypatch.setattr(traccar_poller_module, "POSITIONS_INTERVAL_SECONDS", 0)
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_positions", AsyncMock())

    poller = TraccarPoller()
    attempts = 0

    async def always_fails() -> list:
        nonlocal attempts
        attempts += 1
        if attempts >= 3:
            poller._should_poll = False
        raise RuntimeError("Traccar unreachable")

    monkeypatch.setattr(traccar_poller_module.traccar_client, "get_vehicle_positions", always_fails)

    poller._should_poll = True
    await poller._poll_positions()

    assert attempts == 3
    assert poller.cached_positions() == []


async def test_poll_positions_stops_on_cancellation_mid_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    """A cancellation landing while `get_vehicle_positions()` is in flight breaks the loop
    cleanly instead of falling into the catch-all `except Exception`, which would swallow it
    and keep the poller running past its own cancellation."""
    monkeypatch.setattr(traccar_poller_module, "POSITIONS_INTERVAL_SECONDS", 0)

    async def cancelled() -> list:
        raise asyncio.CancelledError

    monkeypatch.setattr(traccar_poller_module.traccar_client, "get_vehicle_positions", cancelled)

    poller = TraccarPoller()
    poller._should_poll = True
    await poller._poll_positions()  # returns normally (via `break`), does not re-raise

    assert poller.cached_positions() == []


async def test_poll_trails_builds_points_and_survives_a_bad_device(monkeypatch: pytest.MonkeyPatch) -> None:
    """Three devices: one with a trail, one with no recent fix, one that errors out. Only
    the first is broadcast — an empty history is dropped rather than sent as an empty
    trail, and a failing device is logged and skipped rather than aborting the whole tick."""
    monkeypatch.setattr(traccar_poller_module, "TRAILS_INTERVAL_SECONDS", 0)
    broadcast_trails = AsyncMock()
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_trails", broadcast_trails)

    poller = TraccarPoller()
    device_ok = TraccarDevice(id=1, name="TLF 1", uniqueId="tlf-1", status="online")
    device_empty = TraccarDevice(id=2, name="TLF 2", uniqueId="tlf-2", status="online")
    device_bad = TraccarDevice(id=3, name="TLF 3", uniqueId="tlf-3", status="online")
    device_time = datetime.now(UTC)

    async def get_devices() -> list[TraccarDevice]:
        poller._should_poll = False  # stop after this one iteration
        return [device_ok, device_empty, device_bad]

    async def get_position_history(device_id: int, from_time: datetime, to_time: datetime) -> list:
        if device_id == 1:
            return [
                TraccarPosition(
                    id=1,
                    deviceId=1,
                    latitude=47.5,
                    longitude=7.5,
                    speed=10.0,  # knots
                    deviceTime=device_time,
                    serverTime=device_time,
                    fixTime=device_time,
                )
            ]
        if device_id == 2:
            return []  # no recent fix: dropped, not broadcast as an empty trail
        raise RuntimeError("device 3 unreachable")

    monkeypatch.setattr(traccar_poller_module.traccar_client, "get_devices", get_devices)
    monkeypatch.setattr(traccar_poller_module.traccar_client, "get_position_history", get_position_history)

    poller._should_poll = True
    await poller._poll_trails()

    broadcast_trails.assert_awaited_once()
    (trails_data,), _ = broadcast_trails.await_args
    assert len(trails_data) == 1
    assert trails_data[0]["device_id"] == 1
    assert trails_data[0]["points"][0]["speed"] == pytest.approx(10.0 * 1.852)


async def test_poll_trails_survives_get_devices_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(traccar_poller_module, "TRAILS_INTERVAL_SECONDS", 0)
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_trails", AsyncMock())

    poller = TraccarPoller()
    attempts = 0

    async def failing_get_devices() -> list:
        nonlocal attempts
        attempts += 1
        if attempts >= 2:
            poller._should_poll = False
        raise RuntimeError("Traccar unreachable")

    monkeypatch.setattr(traccar_poller_module.traccar_client, "get_devices", failing_get_devices)

    poller._should_poll = True
    await poller._poll_trails()

    assert attempts == 2


async def test_poll_trails_stops_on_cancellation_mid_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Same guarantee as positions: a cancellation while `get_devices()` is in flight breaks
    the loop rather than being absorbed by the catch-all `except Exception`."""
    monkeypatch.setattr(traccar_poller_module, "TRAILS_INTERVAL_SECONDS", 0)

    async def cancelled() -> list:
        raise asyncio.CancelledError

    monkeypatch.setattr(traccar_poller_module.traccar_client, "get_devices", cancelled)

    poller = TraccarPoller()
    poller._should_poll = True
    await poller._poll_trails()  # returns normally (via `break`), does not re-raise


async def test_poll_trails_stops_on_cancellation_during_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """The between-ticks sleep is cancellable too: no devices configured, so the tick body
    finishes instantly and the very next await is the sleep — cancelling there must also
    break cleanly rather than loop forever."""

    async def no_devices() -> list:
        return []

    async def cancelled_sleep(_seconds: float) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(traccar_poller_module.traccar_client, "get_devices", no_devices)
    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_trails", AsyncMock())
    monkeypatch.setattr(traccar_poller_module.asyncio, "sleep", cancelled_sleep)

    poller = TraccarPoller()
    poller._should_poll = True
    await poller._poll_trails()  # returns normally (via `break`), does not re-raise


async def test_run_automation_swallows_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """`_run_automation` must never let a failure in the automation rules break the poll
    loop that calls it — it owns its own session and its own try/except for exactly that
    reason."""

    class _FakeSession:
        async def __aenter__(self) -> "_FakeSession":
            return self

        async def __aexit__(self, *exc_info: object) -> bool:
            return False

    async def boom(db: object, positions: list) -> None:
        raise RuntimeError("automation rule blew up")

    monkeypatch.setattr("app.database.async_session_maker", lambda: _FakeSession())
    monkeypatch.setattr("app.services.gps_automation.run_automation_tick", boom)

    poller = TraccarPoller()
    await poller._run_automation([])  # must not raise
