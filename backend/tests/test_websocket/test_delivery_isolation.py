"""Transport cleanup failures must never restore revoked recipients to broadcasts."""

import time
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import socketio

from app.auth.security import create_access_token
from app.auth.socket_sessions import socket_identity
from app.websocket_manager import WebSocketManager


@pytest.fixture
def transport(monkeypatch):
    """Keep real Socket.IO membership and packet routing, replacing only network IO."""
    server = socketio.AsyncServer(async_mode="asgi")
    monkeypatch.setattr("app.websocket_manager.sio", server)
    monkeypatch.setattr(server, "_send_eio_packet", AsyncMock())
    return server


async def register_recipient(manager, transport, name, room):
    sid = await transport.manager.connect(name, "/")
    await transport.enter_room(sid, room)
    identity = socket_identity(
        create_access_token({"sub": str(uuid4()), "family_jti": str(uuid4()), "family_exp": time.time() + 3600}),
        "access",
    )
    assert identity is not None
    # Admission is tested separately; seed both membership stores to exercise delivery.
    manager.user_sessions[sid] = {"rooms": {room}, "role": "editor"}
    manager.session_identities[sid] = identity
    manager.active_connections[room].add(sid)
    return sid, identity


@pytest.mark.parametrize("broadcast_room", ["operations", None])
async def test_failed_disconnect_never_delivers_again(transport, monkeypatch, broadcast_room):
    manager = WebSocketManager()
    revoked_sid, _ = await register_recipient(manager, transport, "revoked-engine", "operations")
    _, healthy_identity = await register_recipient(manager, transport, "healthy-engine", "operations")
    monkeypatch.setattr(
        "app.websocket_manager.current_socket_roles", AsyncMock(return_value={healthy_identity: "editor"})
    )
    monkeypatch.setattr(transport, "disconnect", AsyncMock(side_effect=RuntimeError("transport unavailable")))

    await manager.broadcast_update("incident_update", {"sequence": 1}, room=broadcast_room)
    assert revoked_sid in dict(transport.manager.get_participants("/", "operations"))
    await manager.broadcast_update("incident_update", {"sequence": 2}, room=broadcast_room)

    assert revoked_sid not in manager.user_sessions
    assert [call.args[0] for call in transport._send_eio_packet.await_args_list] == [
        "healthy-engine",
        "healthy-engine",
    ]


async def test_failed_admin_room_leave_never_delivers_again(transport, monkeypatch):
    manager = WebSocketManager()
    downgraded_sid, downgraded_identity = await register_recipient(manager, transport, "viewer-engine", "admin")
    _, healthy_identity = await register_recipient(manager, transport, "editor-engine", "admin")
    monkeypatch.setattr(
        "app.websocket_manager.current_socket_roles",
        AsyncMock(return_value={downgraded_identity: "viewer", healthy_identity: "editor"}),
    )
    monkeypatch.setattr(transport, "leave_room", AsyncMock(side_effect=RuntimeError("transport unavailable")))

    await manager.broadcast_update("admin_update", {"sequence": 1}, room="admin")
    assert downgraded_sid in dict(transport.manager.get_participants("/", "admin"))
    await manager.broadcast_update("admin_update", {"sequence": 2}, room="admin")

    assert manager.user_sessions[downgraded_sid]["role"] == "viewer"
    assert [call.args[0] for call in transport._send_eio_packet.await_args_list] == [
        "editor-engine",
        "editor-engine",
    ]
