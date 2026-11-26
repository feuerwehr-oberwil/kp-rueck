"""Socket.IO transport and the broadcast functions every writer calls.

A leaf: it knows the connected sessions and their rooms, and nothing of the jobs that send
through it (the pollers start from the lifespan job table, background/jobs.py).
"""

import asyncio
import contextlib
import logging
import time
from typing import Any, Literal

import socketio

from app.environment import is_production_environment

from .auth.socket_sessions import SocketIdentity, cookie_identity, current_socket_roles, socket_identity
from .config import settings

#: Every event the boards hear (`frontend/lib/websocket-client.ts` `WsEvents` holds the
#: same names with their payloads). A name no client listens to does not go out.
WsEvent = Literal[
    "incident_update",
    "group_update",
    "personnel_update",
    "vehicle_update",
    "material_update",
    "assignment_update",
    "planned_assignment_update",
    "special_function_update",
    "reko_update",
    "notification_update",
    "print_job_update",
    "kp_message_update",
    "journal_update",
    "divera_responses_update",
    "vehicle_positions_update",
    "vehicle_trails_update",
    "assignments_transferred",
    "divera_emergency_received",
    "gps_release_prompt",
    "gps_sim_status",
    "training_regie",
    "training_autogen",
]

logger = logging.getLogger(__name__)

# Session timeout constants
STALE_SESSION_TIMEOUT_SECONDS = 300  # 5 minutes without activity
CLEANUP_INTERVAL_SECONDS = 60  # Run cleanup every minute

# Roles allowed to join the admin room
ADMIN_ROOM_ROLES = ("admin", "editor")

# How long one recheck of the connected sessions (`current_socket_roles`, a DB
# session + two queries) answers for every emit after it. Without it every
# broadcast – Traccar ticks, bulk assignments – opened its own session. The cost:
# a session revoked in the DB keeps receiving for at most this long. Joining a
# room and connecting always check afresh.
ROLE_RECHECK_SECONDS = 2.0


# Create async Socket.IO server with explicit CORS whitelist
# Security: Explicit origins prevent Cross-Site WebSocket Hijacking
# Performance: Disable verbose logging in production to reduce noise
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.allowed_origins,
    cors_credentials=True,
    logger=not is_production_environment(),  # Disable in production
    engineio_logger=not is_production_environment(),  # Disable in production
)


class WebSocketManager:
    """Manages WebSocket connections and broadcasts."""

    def __init__(self) -> None:
        self.active_connections: dict[str, set[str]] = {
            "operations": set(),  # Users subscribed to operations updates
            "admin": set(),  # Admin users for system-wide updates
        }
        self.user_sessions: dict[str, dict[str, Any]] = {}  # sid -> user info
        self.session_identities: dict[str, SocketIdentity] = {}
        # (checked at, identities checked, roles of those that passed) – see ROLE_RECHECK_SECONDS.
        self._roles_memo: tuple[float, frozenset[SocketIdentity], dict[SocketIdentity, str]] | None = None
        self._cleanup_task: asyncio.Task[None] | None = None

    async def start_cleanup_task(self) -> None:
        """Start the background stale session cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_stale_sessions())
            logger.info("Started WebSocket stale session cleanup task")

    async def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._cleanup_task
            logger.info("Stopped WebSocket stale session cleanup task")

    async def _cleanup_stale_sessions(self) -> None:
        """Background task to clean up stale sessions periodically."""
        while True:
            try:
                await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
                await self._remove_stale_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in stale session cleanup: {e}")

    async def _remove_stale_sessions(self) -> None:
        """Remove sessions that haven't had activity within the timeout period."""
        await self.revalidate_sessions()
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

    def update_activity(self, sid: str) -> None:
        """Update the last activity timestamp for a session."""
        if sid in self.user_sessions:
            self.user_sessions[sid]["last_activity"] = time.time()

    async def connect(
        self, sid: str, environ: dict[str, Any], role: str | None = None, identity: SocketIdentity | None = None
    ) -> None:
        """Handle new WebSocket connection.

        The network handler supplies a database-verified role and identity.
        Direct callers without credentials are anonymous, never cookie-authorized.
        """
        if identity is not None:
            self.session_identities[sid] = identity
        if role is None:
            # Logged so post-launch logs show whether strict mode (WS_REQUIRE_AUTH) is feasible
            logger.info(f"Client {sid} connected unauthenticated (origin: {environ.get('HTTP_ORIGIN', 'unknown')})")
        else:
            logger.info(f"Client {sid} connected (role: {role})")
        current_time = time.time()
        # Store basic session info with activity tracking
        self.user_sessions[sid] = {
            "connected_at": current_time,
            "last_activity": current_time,
            "rooms": set(),
            "role": role,
        }

    async def disconnect(self, sid: str) -> None:
        """Handle WebSocket disconnection."""
        logger.info(f"Client {sid} disconnected")
        # Remove from all rooms
        for _room, sids in self.active_connections.items():
            sids.discard(sid)
        # Remove session info
        self.user_sessions.pop(sid, None)
        self.session_identities.pop(sid, None)

    async def _socket_roles(self, identities: list[SocketIdentity], *, fresh: bool) -> dict[SocketIdentity, str]:
        """`current_socket_roles`, answered from the last recheck while it is recent.

        The memo only answers for identities it actually checked (a socket that
        connected since forces a new query), and a login's expiry is applied on
        every read, so a keepalive can never stretch it.
        """
        now = time.time()
        memo = self._roles_memo
        if not fresh and memo is not None and now - memo[0] < ROLE_RECHECK_SECONDS and memo[1].issuperset(identities):
            return {i: memo[2][i] for i in identities if i in memo[2] and i.expires_at > now}
        roles = await current_socket_roles(identities)
        self._roles_memo = (now, frozenset(identities), roles)
        return roles

    async def revalidate_sessions(self, sid: str | None = None, *, fresh: bool = False) -> None:
        """Recheck delivery recipients, or just the client sending a keepalive.

        ``fresh`` skips the short memo (``ROLE_RECHECK_SECONDS``); joining a room uses it.
        """
        if sid is None:
            identities = dict(self.session_identities)
        else:
            identity = self.session_identities.get(sid)
            identities = {sid: identity} if identity is not None else {}
        try:
            roles = await self._socket_roles(list(identities.values()), fresh=fresh)
        except Exception:
            logger.warning("Socket authorization unavailable; closing authenticated sessions")
            self._roles_memo = None
            roles = {}
        for sid, identity in identities.items():
            role = roles.get(identity)
            if role is None:
                try:
                    await self.disconnect(sid)
                    await sio.disconnect(sid)
                except Exception:
                    # Application membership is removed before transport cleanup.
                    # Delivery uses that membership, even if transport cleanup fails.
                    logger.warning("Failed to close revoked socket %s", sid)
            elif sid in self.user_sessions:
                self.user_sessions[sid]["role"] = role
                if role not in ADMIN_ROOM_ROLES and sid in self.active_connections["admin"]:
                    self.active_connections["admin"].discard(sid)
                    self.user_sessions[sid]["rooms"].discard("admin")
                    try:
                        await sio.leave_room(sid, "admin")
                    except Exception:
                        logger.warning("Failed to remove socket %s from transport admin room", sid)

    async def join_room(self, sid: str, room: str) -> bool:
        """Add a client to a room for targeted updates."""
        await self.revalidate_sessions(fresh=True)
        if sid not in self.user_sessions:
            return False
        if room not in self.active_connections:
            return False
        if room == "admin":
            role = self.user_sessions.get(sid, {}).get("role")
            if role not in ADMIN_ROOM_ROLES:
                logger.warning(f"Client {sid} denied join to admin room (role: {role})")
                return False
        self.active_connections[room].add(sid)
        if sid in self.user_sessions:
            self.user_sessions[sid]["rooms"].add(room)
        logger.info(f"Client {sid} joined room {room}")
        return True

    async def leave_room(self, sid: str, room: str) -> bool:
        """Remove a client from a room."""
        if room in self.active_connections:
            self.active_connections[room].discard(sid)
            if sid in self.user_sessions:
                self.user_sessions[sid]["rooms"].discard(room)
            logger.info(f"Client {sid} left room {room}")
            return True
        return False

    async def broadcast_update(self, event: WsEvent, data: Any, room: str | None = None) -> None:
        """Broadcast an update to all connected clients or specific room."""
        try:
            await self.revalidate_sessions()
            # Transport rooms can retain a revoked SID when disconnect fails. Address
            # only recipients still present in the revalidated application membership.
            candidates = self.active_connections.get(room, set()) if room else self.user_sessions
            recipients = [sid for sid in candidates if sid in self.user_sessions]
            if recipients:
                await sio.emit(event, data, to=recipients)
            logger.debug("Broadcasted %s to %s recipients", event, len(recipients))
        except Exception as e:
            logger.error(f"Error broadcasting {event}: {e}")

    def get_connection_count(self) -> int:
        """Get the total number of connected clients."""
        return len(self.user_sessions)

    def get_room_count(self, room: str) -> int:
        """Get the number of clients in a specific room."""
        return len(self.active_connections.get(room, set()))


# Create global WebSocket manager instance
ws_manager = WebSocketManager()


# Socket.IO event handlers.
# `@sio.event` carries no annotations in python-socketio, so under strict mode it makes
# every handler it wraps "untyped" — the handlers below are annotated; the gap is the
# library's. Drop these ignores if python-socketio ever ships type information.
@sio.event  # type: ignore[untyped-decorator]
async def connect(sid: str, environ: dict[str, Any], auth: dict[str, Any] | None = None) -> bool | None:
    """Handle client connection.

    Two credentials, either is enough (sweep 27 §P3.4): the `access_token`
    cookie (same-origin deployments, unchanged) or a short-lived `ws` token in
    the Socket.IO `auth` payload (split-origin, where the cookie never arrives).
    """
    identities = []
    cookie = cookie_identity(environ.get("HTTP_COOKIE", ""))
    if cookie:
        identities.append(cookie)
    if auth and isinstance(auth.get("token"), str):
        handshake = socket_identity(auth["token"], "ws")
        if handshake:
            identities.append(handshake)
    try:
        roles = await current_socket_roles(identities)
    except Exception:
        logger.warning("Socket authorization unavailable; rejecting connection")
        return False
    identity = next((candidate for candidate in identities if candidate in roles), None)
    role = roles.get(identity) if identity else None
    if settings.ws_require_auth and role is None:
        logger.info(
            f"Rejected unauthenticated WebSocket connect: {sid} (origin: {environ.get('HTTP_ORIGIN', 'unknown')})"
        )
        return False
    await ws_manager.connect(sid, environ, role=role, identity=identity)
    await sio.emit("connected", {"message": "Connected to KP Rück WebSocket"}, to=sid)
    return True


@sio.event  # type: ignore[untyped-decorator]
async def disconnect(sid: str) -> None:
    """Handle client disconnection."""
    await ws_manager.disconnect(sid)


@sio.event  # type: ignore[untyped-decorator]
async def join(sid: str, data: dict[str, Any]) -> None:
    """Handle room join requests."""
    room = data.get("room")
    if room:
        success = await ws_manager.join_room(sid, room)
        if success:
            await sio.enter_room(sid, room)
            await sio.emit("joined", {"room": room}, to=sid)
        else:
            await sio.emit("error", {"message": f"Invalid room: {room}"}, to=sid)


@sio.event  # type: ignore[untyped-decorator]
async def leave(sid: str, data: dict[str, Any]) -> None:
    """Handle room leave requests."""
    room = data.get("room")
    if room:
        success = await ws_manager.leave_room(sid, room)
        if success:
            await sio.leave_room(sid, room)
            await sio.emit("left", {"room": room}, to=sid)


@sio.event  # type: ignore[untyped-decorator]
async def ping(sid: str) -> None:
    """Handle ping requests for connection keep-alive."""
    await ws_manager.revalidate_sessions(sid)
    if sid not in ws_manager.user_sessions:
        return
    ws_manager.update_activity(sid)  # Refresh activity on ping
    await sio.emit("pong", {"timestamp": time.time()}, to=sid)


# Broadcast functions for CRUD operations
async def broadcast_incident_update(incident_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast incident updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        "incident_update",
        {
            "action": action,  # 'create', 'update', 'delete'
            "data": incident_data,
        },
        room="operations",
    )


async def broadcast_group_update(group_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast Auftrag (incident group) updates to all clients in operations room.

    Membership/stop changes additionally ride the existing incident_update path
    (a stop's group_id changing is an incident update).
    """
    await ws_manager.broadcast_update("group_update", {"action": action, "data": group_data}, room="operations")


async def broadcast_personnel_update(personnel_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast personnel updates to all clients in operations room."""
    await ws_manager.broadcast_update("personnel_update", {"action": action, "data": personnel_data}, room="operations")


async def broadcast_divera_responses_update(event_ids: set[Any], incident_ids: set[Any]) -> None:
    """Tell the boards that Divera Rückmeldungen changed; they re-read the summary themselves.

    Ids only: the summary carries names, and every client may be looking at another Ereignis.
    """
    await ws_manager.broadcast_update(
        "divera_responses_update",
        {"event_ids": sorted(str(e) for e in event_ids), "incident_ids": sorted(str(i) for i in incident_ids)},
        room="operations",
    )


async def broadcast_vehicle_update(vehicle_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast vehicle updates to all clients in operations room."""
    await ws_manager.broadcast_update("vehicle_update", {"action": action, "data": vehicle_data}, room="operations")


async def broadcast_material_update(material_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast material updates to all clients in operations room."""
    await ws_manager.broadcast_update("material_update", {"action": action, "data": material_data}, room="operations")


async def broadcast_assignment_update(assignment_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast assignment updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        "assignment_update", {"action": action, "data": assignment_data}, room="operations"
    )


async def broadcast_planned_assignment_update(event_id: str) -> None:
    """A Danach changed in this Ereignis (planned, removed, promoted, dismissed): boards refetch
    ``/planned-assignments/`` (Jetzt / Danach, 24.11.2026)."""
    await ws_manager.broadcast_update("planned_assignment_update", {"event_id": event_id}, room="operations")


async def broadcast_print_job_update(job_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast print job status changes to all clients in operations room.

    This is what turns "Druckauftrag gesendet" into an answer: the client that
    queued a slip keeps its toast on screen until the agent reports the job
    `completed` or `failed`, and a failure carries the agent's own message
    ("Papier leer", "Drucker nicht erreichbar") to the person standing at the
    printer instead of parking it under Einstellungen → Drucker.
    """
    await ws_manager.broadcast_update("print_job_update", {"action": action, "data": job_data}, room="operations")


async def broadcast_notification_update(notification_data: dict[str, Any], action: str = "create") -> None:
    """Broadcast notification updates to all clients in operations room."""
    await ws_manager.broadcast_update(
        "notification_update", {"action": action, "data": notification_data}, room="operations"
    )


async def broadcast_special_function_update(data: dict[str, Any], action: str = "update") -> None:
    """Broadcast special function updates (driver assignments etc.) to all clients in operations room."""
    await ws_manager.broadcast_update("special_function_update", {"action": action, "data": data}, room="operations")


async def broadcast_reko_update(reko_data: dict[str, Any], action: str = "update") -> None:
    """Broadcast reko report updates to all clients in operations room."""
    await ws_manager.broadcast_update("reko_update", {"action": action, "data": reko_data}, room="operations")


async def broadcast_kp_message_update(message_data: dict[str, Any], action: str = "created") -> None:
    """Broadcast a KP → Trupp message (sweep 27 §P3.2) to the operations room.

    Keeps a second open board's Meldungen thread in step without a refetch; the
    squad's phone itself reads the message off its 10s assignments poll.
    """
    await ws_manager.broadcast_update("kp_message_update", {"action": action, "data": message_data}, room="operations")


async def broadcast_journal_update(data: dict[str, Any]) -> None:
    """A manual Einsatztagebuch line (or its correction) was written. An open journal
    drawer fetches `since_seq` at once instead of waiting for its next poll."""
    await ws_manager.broadcast_update("journal_update", {"action": "created", "data": data}, room="operations")


async def broadcast_vehicle_positions(positions_data: list[dict[str, Any]]) -> None:
    """Broadcast GPS position updates to all clients in operations room."""
    await ws_manager.broadcast_update("vehicle_positions_update", {"data": positions_data}, room="operations")


async def broadcast_vehicle_trails(trails_data: list[dict[str, Any]]) -> None:
    """Broadcast GPS trail updates to all clients in operations room."""
    await ws_manager.broadcast_update("vehicle_trails_update", {"data": trails_data}, room="operations")


async def broadcast_message(event: WsEvent, data: dict[str, Any], room: str = "operations") -> None:
    """Send `event` with a flat payload; the payload also carries the name as ``type``."""
    await ws_manager.broadcast_update(event, {"type": event, **data}, room=room)
