"""GET /api/weather/ and the radar frame route: who may read, and the off switch."""

import pathlib
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.config import settings
from app.services.tokens import generate_viewer_token
from app.services.weather import radar
from app.services.weather.service import weather_service

RZC = pathlib.Path(__file__).parents[1] / "test_services" / "weather_fixtures" / "rzc262811700vl.001.h5"


@pytest.fixture
def one_frame():
    weather_service.reset()
    frame = radar.render_frame(radar.parse_rzc(RZC.read_bytes()))
    weather_service.state.frames[frame.key] = frame
    yield frame
    weather_service.reset()


async def test_weather_needs_a_session_or_a_viewer_token(client: AsyncClient, one_frame):
    assert (await client.get("/api/weather/")).status_code == 401
    assert (await client.get("/api/weather/?token=forged")).status_code == 401
    token = generate_viewer_token(uuid4())
    response = await client.get(f"/api/weather/?token={token}")
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["radar"]["frames"] == [{"key": "202610081700", "time": "2026-10-08T17:00:00+00:00"}]
    assert body["radar"]["attribution"] == "MeteoSchweiz"
    assert len(body["radar"]["coordinates"]) == 4


async def test_logged_in_board_reads_weather(editor_client: AsyncClient, one_frame):
    response = await editor_client.get("/api/weather/")
    assert response.status_code == 200
    assert response.json()["radar"]["legend"][0] == {"min_mm_h": 0.1, "color": "#9bd7ff"}


async def test_radar_frame_is_an_immutable_public_png(client: AsyncClient, one_frame):
    response = await client.get(f"/api/weather/radar/{one_frame.key}.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "immutable" in response.headers["cache-control"]
    assert response.content == one_frame.png
    assert (await client.get("/api/weather/radar/202001010000.png")).status_code == 404


async def test_weather_disabled_by_the_deployment(editor_client: AsyncClient, one_frame, monkeypatch):
    monkeypatch.setattr(settings, "weather_enabled", False)
    response = await editor_client.get("/api/weather/")
    assert response.json() == {
        "enabled": False,
        "station_configured": False,
        "generated_at": None,
        "radar": None,
        "warnings": None,
    }
    assert (await editor_client.get(f"/api/weather/radar/{one_frame.key}.png")).status_code == 404
