"""Weather layer for the map: radar frames and the official warnings at the station.

`GET /weather/` reads the poller's last state (app/services/weather/service.py) – it never
fetches anything itself, so it answers instantly whatever the feeds are doing. A logged-in
session or a viewer token (the wall display's `?token=`) may read it: the warnings are filtered
to the station's region, which is board context.

`GET /weather/radar/{key}.png` is deliberately open. A frame is MeteoSwiss's public radar image,
coloured – it carries nothing about the station, is served from memory (an anonymous caller
cannot make this backend fetch anything), and MapLibre loads it as a plain image request, which
in the development setup is cross-origin and would not carry the session cookie.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from app.auth.dependencies import get_optional_user
from app.models import User
from app.services.tokens import validate_viewer_token
from app.services.weather.service import weather_enabled, weather_service

router = APIRouter(prefix="/weather", tags=["weather"])


class WeatherSourceStatus(BaseModel):
    last_attempt_at: str | None = None
    last_success_at: str | None = None
    last_error: str | None = None
    last_error_at: str | None = None
    stale: bool | None = None


class RadarFrameOut(BaseModel):
    key: str
    time: str


class RadarLegendStep(BaseModel):
    min_mm_h: float
    color: str


class RadarOut(BaseModel):
    frames: list[RadarFrameOut]
    #: MapLibre image-source corners: top-left, top-right, bottom-right, bottom-left as [lon, lat].
    coordinates: list[list[float]] | None
    data_time: str | None
    stale: bool
    stale_after_seconds: int
    status: WeatherSourceStatus
    legend: list[RadarLegendStep]
    attribution: str
    source_url: str


class WarningText(BaseModel):
    """Verbatim from the source – the board must not reword an official warning."""

    event: str
    headline: str
    description: str
    instructions: list[str]


class WeatherWarningOut(BaseModel):
    id: str
    source: str  # "meteoswiss" | "alertswiss"
    level: int  # 1 minor … 4 red
    color: str | None = None
    kind: str | None = None
    sent: str | None = None
    onset: str | None = None
    expires: str | None = None
    sender: str
    link: str | None = None
    region: str
    texts: dict[str, WarningText]
    fetched_at: str | None = None


class WarningsOut(BaseModel):
    items: list[WeatherWarningOut]
    sources: dict[str, WeatherSourceStatus]
    stale_after_seconds: int


class WeatherOut(BaseModel):
    enabled: bool
    station_configured: bool = False
    generated_at: str | None = None
    radar: RadarOut | None = None
    warnings: WarningsOut | None = None


async def require_board_or_viewer_token(
    user: Annotated[User | None, Depends(get_optional_user)],
    token: Annotated[str | None, Query(description="Viewer token (wall display)")] = None,
) -> None:
    if user is not None:
        return
    if token and validate_viewer_token(token) is not None:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nicht angemeldet")


@router.get("/", response_model=WeatherOut, dependencies=[Depends(require_board_or_viewer_token)])
async def get_weather() -> WeatherOut:
    """Radar frames + warnings for the station, as last polled. `enabled: false` when the
    deployment switched the layer off (WEATHER_ENABLED=false)."""
    if not weather_enabled():
        return WeatherOut(enabled=False)
    return WeatherOut.model_validate(weather_service.snapshot())


@router.get(
    "/radar/{key}.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, 404: {"description": "Frame not (or no longer) cached"}},
)
async def get_radar_frame(key: str) -> Response:
    """One radar frame as a transparent PNG in Web Mercator. Immutable: a key is a 5-minute slot."""
    png = weather_service.frame_png(key) if weather_enabled() else None
    if png is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Radarbild nicht vorhanden")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )
