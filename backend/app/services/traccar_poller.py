"""Traccar GPS polling service for real-time vehicle position broadcasts.

Polls Traccar server-side and broadcasts positions/trails via WebSocket,
replacing N independent client-side polls with a single server-side poll.
Only runs when WebSocket clients are connected.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from ..traccar import traccar_client

logger = logging.getLogger(__name__)

POSITIONS_INTERVAL_SECONDS = 10
TRAILS_INTERVAL_SECONDS = 30
TRAILS_HISTORY_MINUTES = 30


class TraccarPoller:
    """Polls Traccar for positions/trails and broadcasts via WebSocket."""

    def __init__(self):
        self._positions_task: asyncio.Task | None = None
        self._trails_task: asyncio.Task | None = None
        self._should_poll = False

    @property
    def is_configured(self) -> bool:
        return traccar_client.is_configured

    @property
    def is_polling(self) -> bool:
        return self._positions_task is not None and not self._positions_task.done()

    async def start_polling(self):
        """Start polling for positions and trails."""
        if not self.is_configured or self.is_polling:
            return

        self._should_poll = True
        self._positions_task = asyncio.create_task(self._poll_positions())
        self._trails_task = asyncio.create_task(self._poll_trails())
        logger.info("Started Traccar polling (positions: %ds, trails: %ds)", POSITIONS_INTERVAL_SECONDS, TRAILS_INTERVAL_SECONDS)

    async def stop_polling(self):
        """Stop polling."""
        self._should_poll = False
        for task in (self._positions_task, self._trails_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._positions_task = None
        self._trails_task = None
        logger.info("Stopped Traccar polling")

    async def _poll_positions(self):
        """Poll vehicle positions and broadcast."""
        from ..websocket_manager import broadcast_vehicle_positions

        while self._should_poll:
            try:
                positions = await traccar_client.get_vehicle_positions()
                positions_data = [
                    {
                        "device_id": p.device_id,
                        "device_name": p.device_name,
                        "unique_id": p.unique_id,
                        "status": p.status,
                        "latitude": p.latitude,
                        "longitude": p.longitude,
                        "speed": p.speed,
                        "course": p.course,
                        "last_update": p.last_update.isoformat(),
                        "address": p.address,
                    }
                    for p in positions
                ]
                await broadcast_vehicle_positions(positions_data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug("Traccar position poll failed: %s", e)

            try:
                await asyncio.sleep(POSITIONS_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                break

    async def _poll_trails(self):
        """Poll vehicle trails and broadcast."""
        from ..websocket_manager import broadcast_vehicle_trails

        while self._should_poll:
            try:
                now = datetime.now(UTC)
                from_time = now - timedelta(minutes=TRAILS_HISTORY_MINUTES)
                devices = await traccar_client.get_devices()

                trails_data = []
                for device in devices:
                    try:
                        positions = await traccar_client.get_position_history(device.id, from_time, now)
                        if not positions:
                            continue
                        trails_data.append(
                            {
                                "device_id": device.id,
                                "device_name": device.name,
                                "points": [
                                    {
                                        "latitude": p.latitude,
                                        "longitude": p.longitude,
                                        "speed": p.speed * 1.852 if p.speed is not None else None,
                                        "timestamp": p.deviceTime.isoformat(),
                                    }
                                    for p in positions
                                ],
                            }
                        )
                    except Exception as e:
                        logger.debug("Failed to get trail for device %s: %s", device.name, e)

                await broadcast_vehicle_trails(trails_data)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug("Traccar trails poll failed: %s", e)

            try:
                await asyncio.sleep(TRAILS_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                break


traccar_poller = TraccarPoller()
