"""WebSocket manager for real-time updates."""

import asyncio
import logging
import os
import time
from typing import Any, Callable

import socketio

from .config import settings

logger = logging.getLogger(__name__)

# Callback for handling polled alarms - set by main.py during startup
_on_divera_poll_alarm: Callable | None = None

# Session timeout constants
STALE_SESSION_TIMEOUT_SECONDS = 300  # 5 minutes without activity
CLEANUP_INTERVAL_SECONDS = 60  # Run cleanup every minute


def _is_production() -> bool:
    """Check if running in production environment."""
    return os.getenv("RAILWAY_ENVIRONMENT") is not None


def get_websocket_cors_origins() -> list[str]:
    """
    Get allowed origins for WebSocket CORS.

    Security: Use explicit whitelist instead of wildcard to prevent
    Cross-Site WebSocket Hijacking (CSWSH) attacks.
    """
    origins = list(settings.cors_origins)

    # Add Railway domains from environment (more restrictive than wildcard)
    railway_frontend = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    railway_backend = os.getenv("RAILWAY_STATIC_URL", "")
    frontend_url = os.getenv("FRONTEND_URL", "")

    if railway_frontend:
        origins.append(f"https://{railway_frontend}")
    if railway_backend:
        origins.append(f"https://{railway_backend}")
    if frontend_url:
        origins.append(frontend_url)

    # Remove duplicates while preserving order
    seen = set()
    unique_origins = []
    for origin in origins:
        if origin not in seen:
            seen.add(origin)
            unique_origins.append(origin)

    return unique_origins


# Create async Socket.IO server with explicit CORS whitelist
# Security: Explicit origins prevent Cross-Site WebSocket Hijacking
# Performance: Disable verbose logging in production to reduce noise
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=get_websocket_cors_origins(),
    cors_credentials=True,
    logger=not _is_production(),  # Disable in production
    engineio_logger=not _is_production(),  # Disable in production
)


class WebSocketManager:
    """Manages WebSocket connections and broadcasts."""

    def __init__(self):
        self.active_connections: dict[str, set[str]] = {
            "operations": set(),  # Users subscribed to operations updates
            "admin": set(),  # Admin users for system-wide updates
        }
        self.user_sessions: dict[str, dict[str, Any]] = {}  # sid -> user info
        self._cleanup_task: asyncio.Task | None = None
        self._divera_poller = None  # Lazy import to avoid circular dependencies
        self._traccar_poller = None  # Lazy import to avoid circular dependencies

    async def start_cleanup_task(self):
        """Start the background stale session cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_stale_sessions())
            logger.info("Started WebSocket stale session cleanup task")

    async def stop_cleanup_task(self):
        """Stop the background cleanup task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            logger.info("Stopped WebSocket stale session cleanup task")

    async def _cleanup_stale_sessions(self):
        """Background task to clean up stale sessions periodically."""
        while True:
            try:
                await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
                await self._remove_stale_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in stale session cleanup: {e}")

    async def _remove_stale_sessions(self):
        """Remove sessions that haven't had activity within the timeout period."""
        current_time = time.time()
        stale_sids = []

        for sid, session in self.user_sessions.items():
            last_activity = session.get("last_activity", session.get("connected_at", 0))
            if current_time - last_activity > STALE_SESSION_TIMEOUT_SECONDS:
                stale_sids.append(sid)

        for sid in stale_sids:
            logger.warning(f"Removing stale session: {sid}")
            await self.disconnect(sid)
            # Disconnect from Socket.IO as well
            try:
                await sio.disconnect(sid)
            except Exception as e:
                logger.debug(f"Error disconnecting stale session {sid}: {e}")

        if stale_sids:
            logger.info(f"Cleaned up {len(stale_sids)} stale sessions")

    def update_activity(self, sid: str):
        """Update the last activity timestamp for a session."""
        if sid in self.user_sessions:
            self.user_sessions[sid]["last_activity"] = time.time()

    async def connect(self, sid: str, environ: dict):
        """Handle new WebSocket connection."""
        logger.info(f"Client {sid} connected")
        current_time = time.time()
        # Store basic session info with activity tracking
        self.user_sessions[sid] = {"connected_at": current_time, "last_activity": current_time, "rooms": set()}

        # Start pollers when first user connects
        await self._maybe_start_divera_polling()
        await self._maybe_start_traccar_polling()

    async def disconnect(self, sid: str):
        """Handle WebSocket disconnection."""
        logger.info(f"Client {sid} disconnected")
        # Remove from all rooms
        for room, sids in self.active_connections.items():
            sids.discard(sid)
        # Remove session info
        self.user_sessions.pop(sid, None)

        # Stop pollers when last user disconnects
        await self._maybe_stop_divera_polling()
        await self._maybe_stop_traccar_polling()

    async def _maybe_start_divera_polling(self):
        """Start Divera polling if users are connected and polling is configured."""
        if self._divera_poller is None:
            # Lazy import to avoid circular dependencies
            try:
                from .services.divera_poller import divera_poller
                self._divera_poller = divera_poller
            except ImportError:
                logger.debug("Divera poller not available")
                return

        if not self._divera_poller.is_configured:
            return

        if self.get_connection_count() == 1 and not self._divera_poller.is_polling:
            # First user connected, start polling
            if _on_divera_poll_alarm:
                await self._divera_poller.start_polling(_on_divera_poll_alarm)
                logger.info("Started Divera polling (user connected)")

    async def _maybe_stop_divera_polling(self):
        """Stop Divera polling if no users are connected."""
        if self._divera_poller is None or not self._divera_poller.is_polling:
            return

        if self.get_connection_count() == 0:
            # Last user disconnected, stop polling
            await self._divera_poller.stop_polling()
            logger.info("Stopped Divera polling (no users connected)")

    async def _maybe_start_traccar_polling(self):
        """Start Traccar polling if users are connected and Traccar is configured."""
        if self._traccar_poller is None:
            try:
                from .services.traccar_poller import traccar_poller

                self._traccar_poller = traccar_poller
            except ImportError:
                logger.debug("Traccar poller not available")
                return

        if not self._traccar_poller.is_configured:
            return

        if self.get_connection_count() == 1 and not self._traccar_poller.is_polling:
            await self._traccar_poller.start_polling()

    async def _maybe_stop_traccar_polling(self):
        """Stop Traccar polling if no users are connected."""
        if self._traccar_poller is None or not self._traccar_poller.is_polling:
            return

        if self.get_connection_count() == 0:
            await self._traccar_poller.stop_polling()
            logger.info("Stopped Traccar polling (no users connected)")

    async def join_room(self, sid: str, room: str):
        """Add a client to a room for targeted updates."""
        if room in self.active_connections:
            self.active_connections[room].add(sid)
            if sid in self.user_sessions:
                self.user_sessions[sid]["rooms"].add(room)
            logger.info(f"Client {sid} joined room {room}")
            return True
        return False

    async def leave_room(self, sid: str, room: str):
        """Remove a client from a room."""
        if room in self.active_connections:
            self.active_connections[room].discard(sid)
            if sid in self.user_sessions:
                self.user_sessions[sid]["rooms"].discard(room)
            logger.info(f"Client {sid} left room {room}")
            return True
        return False

    async def broadcast_update(self, event: str, data: Any, room: str = None):
        """Broadcast an update to all connected clients or specific room."""
        try:
            if room:
                await sio.emit(event, data, room=room)
                logger.info(f"Broadcasted {event} to room {room}")
            else:
                await sio.emit(event, data)
                logger.info(f"Broadcasted {event} to all clients")
        except Exception as e:
            logger.error(f"Error broadcasting {event}: {e}")

    async def send_to_client(self, sid: str, event: str, data: Any):
        """Send a message to a specific client."""
        try:
            await sio.emit(event, data, to=sid)
            logger.info(f"Sent {event} to client {sid}")
        except Exception as e:
            logger.error(f"Error sending {event} to {sid}: {e}")

    def get_connection_count(self) -> int:
        """Get the total number of connected clients."""
        return len(self.user_sessions)

    def get_room_count(self, room: str) -> int:
        """Get the number of clients in a specific room."""
        return len(self.active_connections.get(room, set()))


# Create global WebSocket manager instance
ws_manager = WebSocketManager()


# Socket.IO event handlers
@sio.event
async def connect(sid, environ):
    """Handle client connection."""
    await ws_manager.connect(sid, environ)
    await sio.emit("connected", {"message": "Connected to KP Rück WebSocket"}, to=sid)


@sio.event
async def disconnect(sid):
    """Handle client disconnection."""
    await ws_manager.disconnect(sid)


@sio.event
async def join(sid, data):
    """Handle room join requests."""
    room = data.get("room")
    if room:
        success = await ws_manager.join_room(sid, room)
        if success:
            await sio.enter_room(sid, room)
            await sio.emit("joined", {"room": room}, to=sid)
        else:
            await sio.emit("error", {"message": f"Invalid room: {room}"}, to=sid)


@sio.event
async def leave(sid, data):
    """Handle room leave requests."""
    room = data.get("room")
    if room:
        success = await ws_manager.leave_room(sid, room)
        if success:
            await sio.leave_room(sid, room)
            await sio.emit("left", {"room": room}, to=sid)


@sio.event
async def ping(sid):
    """Handle ping requests for connection keep-alive."""
    ws_manager.update_activity(sid)  # Refresh activity on ping
    await sio.emit("pong", {"timestamp": time.time()}, to=sid)


# Broadcast functions for CRUD operations
async def broadcast_incident_update(incident_data: dict, action: str = "update"):
    """Broadcast incident updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        "incident_update",
        {
            "action": action,  # 'create', 'update', 'delete'
            "data": incident_data,
        },
        room="operations",
    )


async def broadcast_personnel_update(personnel_data: dict, action: str = "update"):
    """Broadcast personnel updates to all clients in operations room."""
    await ws_manager.broadcast_update("personnel_update", {"action": action, "data": personnel_data}, room="operations")


async def broadcast_vehicle_update(vehicle_data: dict, action: str = "update"):
    """Broadcast vehicle updates to all clients in operations room."""
    await ws_manager.broadcast_update("vehicle_update", {"action": action, "data": vehicle_data}, room="operations")


async def broadcast_material_update(material_data: dict, action: str = "update"):
    """Broadcast material updates to all clients in operations room."""
    await ws_manager.broadcast_update("material_update", {"action": action, "data": material_data}, room="operations")


async def broadcast_assignment_update(assignment_data: dict, action: str = "update"):
    """Broadcast assignment updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        "assignment_update", {"action": action, "data": assignment_data}, room="operations"
    )


async def broadcast_notification_update(notification_data: dict, action: str = "create"):
    """Broadcast notification updates to all clients in operations room."""
    await ws_manager.broadcast_update("notification_update", {"action": action, "data": notification_data}, room="operations")


async def broadcast_special_function_update(data: dict, action: str = "update"):
    """Broadcast special function updates (driver assignments etc.) to all clients in operations room."""
    await ws_manager.broadcast_update("special_function_update", {"action": action, "data": data}, room="operations")


async def broadcast_reko_update(reko_data: dict, action: str = "update"):
    """Broadcast reko report updates to all clients in operations room."""
    await ws_manager.broadcast_update("reko_update", {"action": action, "data": reko_data}, room="operations")


async def broadcast_vehicle_positions(positions_data: list[dict]):
    """Broadcast GPS position updates to all clients in operations room."""
    await ws_manager.broadcast_update("vehicle_positions_update", {"data": positions_data}, room="operations")


async def broadcast_vehicle_trails(trails_data: list[dict]):
    """Broadcast GPS trail updates to all clients in operations room."""
    await ws_manager.broadcast_update("vehicle_trails_update", {"data": trails_data}, room="operations")


async def broadcast_system_message(message: str, level: str = "info"):
    """Broadcast system messages to all connected clients."""
    await ws_manager.broadcast_update(
        "system_message",
        {
            "message": message,
            "level": level,  # 'info', 'warning', 'error'
            "timestamp": asyncio.get_event_loop().time(),
        },
    )


async def broadcast_message(data: dict, room: str = "operations"):
    """
    Generic broadcast function for custom messages.

    Args:
        data: Dictionary containing message type and payload
        room: Target room (default: 'operations')
    """
    message_type = data.get("type", "update")
    await ws_manager.broadcast_update(message_type, data, room=room)


def set_divera_poll_callback(callback: Callable):
    """
    Set the callback for processing polled Divera alarms.

    This should be called during app startup with a callback that:
    1. Creates a database session
    2. Checks for duplicates via divera_id
    3. Saves new alarms to the database
    4. Broadcasts via WebSocket

    Args:
        callback: Async function with signature:
                  async def callback(payload: DiveraWebhookPayload) -> bool
    """
    global _on_divera_poll_alarm
    _on_divera_poll_alarm = callback
    logger.info("Divera poll callback configured")


def get_divera_poller_stats() -> dict | None:
    """Get Divera poller statistics, or None if not available."""
    try:
        from .services.divera_poller import divera_poller
        return divera_poller.stats
    except ImportError:
        return None
