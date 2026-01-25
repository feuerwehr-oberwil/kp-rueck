"""Divera247 API polling service for alarm fallback.

This service polls the Divera API for recent alarms as a fallback mechanism
when webhooks might be missed. Polling only occurs when users are actively
connected via WebSocket to avoid unnecessary API load.
"""

import asyncio
import logging
from datetime import datetime, timezone

import httpx

from ..config import settings
from .. import schemas

logger = logging.getLogger(__name__)


class DiveraPoller:
    """Polls Divera API for alarms when users are connected."""

    def __init__(self):
        self._polling_task: asyncio.Task | None = None
        self._should_poll = False
        self._http_client: httpx.AsyncClient | None = None
        self._last_poll_time: datetime | None = None
        self._poll_count = 0
        self._error_count = 0

    @property
    def is_configured(self) -> bool:
        """Check if Divera polling is configured."""
        return bool(settings.divera_access_key)

    @property
    def is_polling(self) -> bool:
        """Check if polling is currently active."""
        return self._polling_task is not None and not self._polling_task.done()

    @property
    def stats(self) -> dict:
        """Get polling statistics."""
        return {
            "configured": self.is_configured,
            "polling": self.is_polling,
            "last_poll": self._last_poll_time.isoformat() if self._last_poll_time else None,
            "poll_count": self._poll_count,
            "error_count": self._error_count,
        }

    async def start_polling(self, on_alarm_callback):
        """
        Start polling for alarms.

        Args:
            on_alarm_callback: Async function to call for each new alarm.
                               Signature: async def callback(payload: DiveraWebhookPayload) -> bool
                               Returns True if alarm was new, False if duplicate.
        """
        if not self.is_configured:
            logger.debug("Divera polling not configured (no access key)")
            return

        if self.is_polling:
            logger.debug("Divera polling already active")
            return

        self._should_poll = True
        self._http_client = httpx.AsyncClient(timeout=30.0)
        self._polling_task = asyncio.create_task(
            self._poll_loop(on_alarm_callback)
        )
        logger.info(
            f"Started Divera polling (interval: {settings.divera_poll_interval_seconds}s)"
        )

    async def stop_polling(self):
        """Stop polling for alarms."""
        if not self.is_polling:
            return

        self._should_poll = False

        if self._polling_task:
            self._polling_task.cancel()
            try:
                await self._polling_task
            except asyncio.CancelledError:
                pass
            self._polling_task = None

        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        logger.info("Stopped Divera polling")

    async def _poll_loop(self, on_alarm_callback):
        """Main polling loop."""
        while self._should_poll:
            try:
                await self._fetch_and_process_alarms(on_alarm_callback)
                self._last_poll_time = datetime.now(timezone.utc)
                self._poll_count += 1
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._error_count += 1
                logger.error(f"Error polling Divera: {e}")

            # Wait for next poll interval
            try:
                await asyncio.sleep(settings.divera_poll_interval_seconds)
            except asyncio.CancelledError:
                break

    async def _fetch_and_process_alarms(self, on_alarm_callback):
        """Fetch alarms from Divera API and process new ones."""
        if not self._http_client:
            return

        url = f"{settings.divera_api_url}/alarms"
        params = {"accesskey": settings.divera_access_key}

        try:
            response = await self._http_client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"Divera API error: {e.response.status_code}")
            raise
        except httpx.RequestError as e:
            logger.error(f"Divera API request failed: {e}")
            raise

        # Parse and process alarms
        alarms = self._parse_alarms_response(data)
        new_count = 0

        for alarm in alarms[: settings.divera_poll_max_alarms]:
            try:
                is_new = await on_alarm_callback(alarm)
                if is_new:
                    new_count += 1
            except Exception as e:
                logger.error(f"Error processing polled alarm {alarm.id}: {e}")

        if new_count > 0:
            logger.info(f"Divera poll: found {new_count} new alarm(s)")

    def _parse_alarms_response(self, data: dict) -> list[schemas.DiveraWebhookPayload]:
        """
        Parse Divera API response into webhook payload format.

        The API returns alarms in format:
        {
            "success": true,
            "data": {
                "items": {
                    "123": { alarm data },
                    "456": { alarm data }
                }
            }
        }
        """
        alarms = []

        if not data.get("success"):
            logger.warning("Divera API returned success=false")
            return alarms

        items = data.get("data", {}).get("items", {})

        # Items can be dict or list depending on Divera API version
        if isinstance(items, dict):
            items = list(items.values())

        for item in items:
            try:
                # Skip closed/archived alarms
                if item.get("closed") or item.get("archived"):
                    continue

                alarm = schemas.DiveraWebhookPayload(
                    id=int(item.get("id", 0)),
                    number=item.get("foreign_id") or item.get("number") or "",
                    title=item.get("title", ""),
                    text=item.get("text", ""),
                    address=item.get("address", ""),
                    lat=item.get("lat"),
                    lng=item.get("lng"),
                    cluster=item.get("cluster", []),
                    group=item.get("group", []),
                    vehicle=item.get("vehicle", []),
                    ts_create=item.get("ts_create") or item.get("date"),
                    ts_update=item.get("ts_update"),
                )
                alarms.append(alarm)
            except Exception as e:
                logger.warning(f"Failed to parse alarm: {e}")

        # Sort by creation time, newest first
        alarms.sort(key=lambda a: a.ts_create or 0, reverse=True)

        return alarms


# Global poller instance
divera_poller = DiveraPoller()
