"""WebSocket manager for real-time updates."""

import asyncio
import os
import re
from typing import Dict, Set, Any
import socketio
from fastapi import HTTPException
import logging

from .config import settings

logger = logging.getLogger(__name__)


def get_websocket_cors_origins() -> list[str]:
    """
    Get allowed origins for WebSocket CORS.

    Security: Use explicit whitelist instead of wildcard to prevent
    Cross-Site WebSocket Hijacking (CSWSH) attacks.
    """
    origins = list(settings.cors_origins)

    # Add production domains
    origins.extend([
        "https://kp.fwo.li",
        "https://kp-api.fwo.li",
    ])

    # Add Railway domains only in production (more restrictive than wildcard)
    railway_frontend = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    railway_backend = os.getenv("RAILWAY_STATIC_URL", "")

    if railway_frontend:
        origins.append(f"https://{railway_frontend}")
    if railway_backend:
        origins.append(f"https://{railway_backend}")

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
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=get_websocket_cors_origins(),
    cors_credentials=True,
    logger=True,
    engineio_logger=True
)

class WebSocketManager:
    """Manages WebSocket connections and broadcasts."""

    def __init__(self):
        self.active_connections: Dict[str, Set[str]] = {
            "operations": set(),  # Users subscribed to operations updates
            "admin": set(),       # Admin users for system-wide updates
        }
        self.user_sessions: Dict[str, Dict[str, Any]] = {}  # sid -> user info

    async def connect(self, sid: str, environ: dict):
        """Handle new WebSocket connection."""
        logger.info(f"Client {sid} connected")
        # Store basic session info
        self.user_sessions[sid] = {
            "connected_at": asyncio.get_event_loop().time(),
            "rooms": set()
        }

    async def disconnect(self, sid: str):
        """Handle WebSocket disconnection."""
        logger.info(f"Client {sid} disconnected")
        # Remove from all rooms
        for room, sids in self.active_connections.items():
            sids.discard(sid)
        # Remove session info
        self.user_sessions.pop(sid, None)

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
    await sio.emit('connected', {'message': 'Connected to KP Rück WebSocket'}, to=sid)

@sio.event
async def disconnect(sid):
    """Handle client disconnection."""
    await ws_manager.disconnect(sid)

@sio.event
async def join(sid, data):
    """Handle room join requests."""
    room = data.get('room')
    if room:
        success = await ws_manager.join_room(sid, room)
        if success:
            await sio.enter_room(sid, room)
            await sio.emit('joined', {'room': room}, to=sid)
        else:
            await sio.emit('error', {'message': f'Invalid room: {room}'}, to=sid)

@sio.event
async def leave(sid, data):
    """Handle room leave requests."""
    room = data.get('room')
    if room:
        success = await ws_manager.leave_room(sid, room)
        if success:
            await sio.leave_room(sid, room)
            await sio.emit('left', {'room': room}, to=sid)

@sio.event
async def ping(sid):
    """Handle ping requests for connection keep-alive."""
    await sio.emit('pong', {'timestamp': asyncio.get_event_loop().time()}, to=sid)

# Broadcast functions for CRUD operations
async def broadcast_incident_update(incident_data: dict, action: str = "update"):
    """Broadcast incident updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        'incident_update',
        {
            'action': action,  # 'create', 'update', 'delete'
            'data': incident_data
        },
        room='operations'
    )

async def broadcast_personnel_update(personnel_data: dict, action: str = "update"):
    """Broadcast personnel updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        'personnel_update',
        {
            'action': action,
            'data': personnel_data
        },
        room='operations'
    )

async def broadcast_vehicle_update(vehicle_data: dict, action: str = "update"):
    """Broadcast vehicle updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        'vehicle_update',
        {
            'action': action,
            'data': vehicle_data
        },
        room='operations'
    )

async def broadcast_material_update(material_data: dict, action: str = "update"):
    """Broadcast material updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        'material_update',
        {
            'action': action,
            'data': material_data
        },
        room='operations'
    )

async def broadcast_assignment_update(assignment_data: dict, action: str = "update"):
    """Broadcast assignment updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        'assignment_update',
        {
            'action': action,
            'data': assignment_data
        },
        room='operations'
    )

async def broadcast_system_message(message: str, level: str = "info"):
    """Broadcast system messages to all connected clients."""
    await ws_manager.broadcast_update(
        'system_message',
        {
            'message': message,
            'level': level,  # 'info', 'warning', 'error'
            'timestamp': asyncio.get_event_loop().time()
        }
    )

async def broadcast_message(data: dict, room: str = 'operations'):
    """
    Generic broadcast function for custom messages.

    Args:
        data: Dictionary containing message type and payload
        room: Target room (default: 'operations')
    """
    message_type = data.get('type', 'update')
    await ws_manager.broadcast_update(
        message_type,
        data,
        room=room
    )