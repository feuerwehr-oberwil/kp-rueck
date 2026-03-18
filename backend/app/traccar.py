"""Traccar GPS tracking integration service."""

from datetime import datetime

import httpx
from pydantic import BaseModel

from app.config import settings


class TraccarDevice(BaseModel):
    """Traccar device model."""

    id: int
    name: str
    uniqueId: str
    status: str  # online, offline, unknown
    lastUpdate: datetime | None = None
    positionId: int | None = None
    category: str | None = None


class TraccarPosition(BaseModel):
    """Traccar position model."""

    id: int
    deviceId: int
    latitude: float
    longitude: float
    altitude: float | None = None
    speed: float | None = None  # in knots
    course: float | None = None  # heading in degrees
    accuracy: float | None = None
    deviceTime: datetime
    serverTime: datetime
    fixTime: datetime
    address: str | None = None
    attributes: dict | None = None


class VehiclePosition(BaseModel):
    """Combined vehicle and position data for frontend."""

    device_id: int
    device_name: str
    unique_id: str  # Can be used to match with local vehicles
    status: str  # online, offline
    latitude: float
    longitude: float
    speed: float | None = None  # in km/h
    course: float | None = None  # heading in degrees
    last_update: datetime
    address: str | None = None


class TraccarClient:
    """Client for Traccar API using basic authentication."""

    def __init__(self):
        self.base_url = settings.traccar_url.rstrip("/") if settings.traccar_url else ""
        self.email = settings.traccar_email
        self.password = settings.traccar_password

    @property
    def is_configured(self) -> bool:
        """Check if Traccar is configured."""
        return bool(self.base_url and self.email and self.password)

    async def _create_session(self, client: httpx.AsyncClient) -> httpx.Cookies:
        """Create a session using email/password authentication."""
        response = await client.post(
            f"{self.base_url}/api/session",
            data={"email": self.email, "password": self.password},
            timeout=10.0,
        )
        response.raise_for_status()
        return response.cookies

    async def get_devices(self) -> list[TraccarDevice]:
        """Get all devices from Traccar."""
        if not self.is_configured:
            return []

        async with httpx.AsyncClient() as client:
            cookies = await self._create_session(client)
            response = await client.get(
                f"{self.base_url}/api/devices",
                cookies=cookies,
                timeout=10.0,
            )
            response.raise_for_status()
            return [TraccarDevice(**d) for d in response.json()]

    async def get_positions(self) -> list[TraccarPosition]:
        """Get current positions of all devices."""
        if not self.is_configured:
            return []

        async with httpx.AsyncClient() as client:
            cookies = await self._create_session(client)
            response = await client.get(
                f"{self.base_url}/api/positions",
                cookies=cookies,
                timeout=10.0,
            )
            response.raise_for_status()
            return [TraccarPosition(**p) for p in response.json()]

    async def get_position_history(
        self, device_id: int, from_time: datetime, to_time: datetime
    ) -> list[TraccarPosition]:
        """Get historical positions for a device within a time range."""
        if not self.is_configured:
            return []

        async with httpx.AsyncClient() as client:
            cookies = await self._create_session(client)
            response = await client.get(
                f"{self.base_url}/api/positions",
                params={
                    "deviceId": device_id,
                    "from": from_time.isoformat() + "Z",
                    "to": to_time.isoformat() + "Z",
                },
                cookies=cookies,
                timeout=15.0,
            )
            response.raise_for_status()
            return [TraccarPosition(**p) for p in response.json()]

    async def get_vehicle_positions(self) -> list[VehiclePosition]:
        """Get combined device and position data for all vehicles."""
        if not self.is_configured:
            return []

        async with httpx.AsyncClient() as client:
            cookies = await self._create_session(client)

            # Get devices
            devices_response = await client.get(
                f"{self.base_url}/api/devices",
                cookies=cookies,
                timeout=10.0,
            )
            devices_response.raise_for_status()
            devices = {d["id"]: d for d in devices_response.json()}

            # Get positions
            positions_response = await client.get(
                f"{self.base_url}/api/positions",
                cookies=cookies,
                timeout=10.0,
            )
            positions_response.raise_for_status()
            positions = positions_response.json()

            # Combine device and position data
            result = []
            for pos in positions:
                device = devices.get(pos["deviceId"])
                if device:
                    # Convert speed from knots to km/h
                    speed_kmh = None
                    if pos.get("speed") is not None:
                        speed_kmh = pos["speed"] * 1.852  # 1 knot = 1.852 km/h

                    result.append(
                        VehiclePosition(
                            device_id=pos["deviceId"],
                            device_name=device["name"],
                            unique_id=device["uniqueId"],
                            status=device.get("status", "unknown"),
                            latitude=pos["latitude"],
                            longitude=pos["longitude"],
                            speed=speed_kmh,
                            course=pos.get("course"),
                            last_update=pos["deviceTime"],
                            address=pos.get("address"),
                        )
                    )

            return result


# Create singleton instance
traccar_client = TraccarClient()
