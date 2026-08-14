"""Guards that the test suite never calls the station's live GPS server.

`backend/.env` configures a real Traccar (`https://gps.fwo.li`) and `TraccarClient`
snapshots those credentials at import time, so before the `traccar_unconfigured` /
`block_outbound_http` fixtures in conftest, every test that rendered a viewer or display
payload issued real requests to a production server (`api/viewer.py::
_viewer_vehicle_positions` → `/api/session`, `/api/devices`, `/api/positions`).

These two tests keep both halves of that fix honest: the client stays unconfigured, and
anything that still tries to reach the network fails loudly instead of silently.
"""

import httpx
import pytest

from app.api.viewer import _viewer_vehicle_positions
from app.traccar import traccar_client


@pytest.mark.asyncio
async def test_viewer_gps_takes_the_offline_path():
    """Whatever the developer's .env says, the shared client is neutralised in tests."""
    assert not traccar_client.is_configured
    assert await _viewer_vehicle_positions() == []


@pytest.mark.asyncio
async def test_outbound_http_is_blocked():
    """A real socket is refused, so a reintroduced live call cannot pass unnoticed."""
    async with httpx.AsyncClient() as client:
        with pytest.raises(RuntimeError, match="live HTTP request"):
            await client.get("https://gps.fwo.li/api/session")
