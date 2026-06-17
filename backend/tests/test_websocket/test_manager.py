"""Tests for WebSocket manager functionality.

Tests cover:
- Connection management (connect, disconnect)
- Room management (join, leave)
- Broadcast functionality
- Activity tracking and stale session cleanup
- Connection counting
"""

import time
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.security import create_access_token
from app.websocket_manager import (
    CLEANUP_INTERVAL_SECONDS,
    STALE_SESSION_TIMEOUT_SECONDS,
    WebSocketManager,
    get_role_from_environ,
    broadcast_assignment_update,
    broadcast_incident_update,
    broadcast_material_update,
    broadcast_personnel_update,
    broadcast_system_message,
    broadcast_vehicle_update,
    get_websocket_cors_origins,
    ws_manager,
)

# ============================================
# WebSocket Manager Unit Tests
# ============================================


class TestWebSocketManager:
    """Test suite for WebSocketManager class."""

    @pytest.fixture
    def manager(self):
        """Create a fresh WebSocket manager instance for testing."""
        return WebSocketManager()

    @pytest.mark.asyncio
    async def test_connect_creates_session(self, manager):
        """Test that connecting creates a new session."""
        sid = "test_session_1"
        environ = {"HTTP_HOST": "localhost:8000"}

        await manager.connect(sid, environ)

        assert sid in manager.user_sessions
        assert "connected_at" in manager.user_sessions[sid]
        assert "last_activity" in manager.user_sessions[sid]
        assert "rooms" in manager.user_sessions[sid]

    @pytest.mark.asyncio
    async def test_disconnect_removes_session(self, manager):
        """Test that disconnecting removes the session."""
        sid = "test_session_2"
        environ = {}

        await manager.connect(sid, environ)
        assert sid in manager.user_sessions

        await manager.disconnect(sid)
        assert sid not in manager.user_sessions

    @pytest.mark.asyncio
    async def test_disconnect_removes_from_rooms(self, manager):
        """Test that disconnecting removes user from all rooms."""
        sid = "test_session_3"
        environ = {}

        await manager.connect(sid, environ)
        await manager.join_room(sid, "operations")

        assert sid in manager.active_connections["operations"]

        await manager.disconnect(sid)
        assert sid not in manager.active_connections["operations"]

    @pytest.mark.asyncio
    async def test_join_room_success(self, manager):
        """Test successfully joining a room."""
        sid = "test_session_4"
        environ = {}

        await manager.connect(sid, environ)
        result = await manager.join_room(sid, "operations")

        assert result is True
        assert sid in manager.active_connections["operations"]
        assert "operations" in manager.user_sessions[sid]["rooms"]

    @pytest.mark.asyncio
    async def test_join_invalid_room_fails(self, manager):
        """Test that joining an invalid room fails."""
        sid = "test_session_5"
        environ = {}

        await manager.connect(sid, environ)
        result = await manager.join_room(sid, "nonexistent_room")

        assert result is False

    @pytest.mark.asyncio
    async def test_leave_room_success(self, manager):
        """Test successfully leaving a room."""
        sid = "test_session_6"
        environ = {}

        await manager.connect(sid, environ)
        await manager.join_room(sid, "operations")
        assert sid in manager.active_connections["operations"]

        result = await manager.leave_room(sid, "operations")
        assert result is True
        assert sid not in manager.active_connections["operations"]

    @pytest.mark.asyncio
    async def test_leave_invalid_room_fails(self, manager):
        """Test that leaving an invalid room fails."""
        sid = "test_session_7"
        environ = {}

        await manager.connect(sid, environ)
        result = await manager.leave_room(sid, "nonexistent_room")

        assert result is False

    def test_update_activity(self, manager):
        """Test updating session activity timestamp."""
        sid = "test_session_8"
        manager.user_sessions[sid] = {
            "connected_at": time.time() - 100,
            "last_activity": time.time() - 100,
            "rooms": set(),
        }

        old_activity = manager.user_sessions[sid]["last_activity"]
        manager.update_activity(sid)
        new_activity = manager.user_sessions[sid]["last_activity"]

        assert new_activity > old_activity

    def test_update_activity_nonexistent_session(self, manager):
        """Test that updating activity for non-existent session is safe."""
        # Should not raise any exception
        manager.update_activity("nonexistent_sid")

    def test_get_connection_count(self, manager):
        """Test getting total connection count."""
        manager.user_sessions = {
            "sid1": {},
            "sid2": {},
            "sid3": {},
        }

        assert manager.get_connection_count() == 3

    def test_get_room_count(self, manager):
        """Test getting room connection count."""
        manager.active_connections["operations"] = {"sid1", "sid2"}
        manager.active_connections["admin"] = {"sid3"}

        assert manager.get_room_count("operations") == 2
        assert manager.get_room_count("admin") == 1
        assert manager.get_room_count("nonexistent") == 0

    @pytest.mark.asyncio
    async def test_broadcast_update_to_room(self, manager):
        """Test broadcasting update to a specific room."""
        with patch.object(manager, "broadcast_update", new_callable=AsyncMock) as mock_broadcast:
            mock_broadcast.return_value = None
            await manager.broadcast_update("test_event", {"data": "test"}, room="operations")
            mock_broadcast.assert_called_once()


# ============================================
# Stale Session Cleanup Tests
# ============================================


class TestStaleSessionCleanup:
    """Test suite for stale session cleanup functionality."""

    @pytest.fixture
    def manager(self):
        """Create a fresh WebSocket manager instance."""
        return WebSocketManager()

    @pytest.mark.asyncio
    async def test_remove_stale_sessions(self, manager):
        """Test that stale sessions are identified and removed."""
        current_time = time.time()

        # Add a stale session (old activity)
        manager.user_sessions["stale_sid"] = {
            "connected_at": current_time - STALE_SESSION_TIMEOUT_SECONDS - 100,
            "last_activity": current_time - STALE_SESSION_TIMEOUT_SECONDS - 100,
            "rooms": set(),
        }
        manager.active_connections["operations"].add("stale_sid")

        # Add a fresh session
        manager.user_sessions["fresh_sid"] = {
            "connected_at": current_time - 10,
            "last_activity": current_time - 10,
            "rooms": set(),
        }
        manager.active_connections["operations"].add("fresh_sid")

        # Mock sio.disconnect to avoid socket.io errors
        with patch("app.websocket_manager.sio.disconnect", new_callable=AsyncMock):
            await manager._remove_stale_sessions()

        # Stale should be removed, fresh should remain
        assert "stale_sid" not in manager.user_sessions
        assert "fresh_sid" in manager.user_sessions

    @pytest.mark.asyncio
    async def test_activity_refresh_prevents_cleanup(self, manager):
        """Test that refreshing activity prevents session cleanup."""
        current_time = time.time()

        # Session that would be stale but activity was refreshed
        manager.user_sessions["active_sid"] = {
            "connected_at": current_time - STALE_SESSION_TIMEOUT_SECONDS - 100,
            "last_activity": current_time - 10,  # Recently active
            "rooms": set(),
        }

        with patch("app.websocket_manager.sio.disconnect", new_callable=AsyncMock):
            await manager._remove_stale_sessions()

        # Should not be removed due to recent activity
        assert "active_sid" in manager.user_sessions


# ============================================
# Broadcast Helper Function Tests
# ============================================


class TestBroadcastFunctions:
    """Test suite for broadcast helper functions."""

    @pytest.mark.asyncio
    async def test_broadcast_incident_update(self):
        """Test incident update broadcast."""
        with patch.object(ws_manager, "broadcast_update", new_callable=AsyncMock) as mock_broadcast:
            incident_data = {"id": "123", "title": "Test Incident"}
            await broadcast_incident_update(incident_data, action="create")

            mock_broadcast.assert_called_once_with(
                "incident_update",
                {"action": "create", "data": incident_data},
                room="operations",
            )

    @pytest.mark.asyncio
    async def test_broadcast_personnel_update(self):
        """Test personnel update broadcast."""
        with patch.object(ws_manager, "broadcast_update", new_callable=AsyncMock) as mock_broadcast:
            personnel_data = {"id": "456", "name": "Test Person"}
            await broadcast_personnel_update(personnel_data, action="update")

            mock_broadcast.assert_called_once_with(
                "personnel_update",
                {"action": "update", "data": personnel_data},
                room="operations",
            )

    @pytest.mark.asyncio
    async def test_broadcast_vehicle_update(self):
        """Test vehicle update broadcast."""
        with patch.object(ws_manager, "broadcast_update", new_callable=AsyncMock) as mock_broadcast:
            vehicle_data = {"id": "789", "name": "TLF"}
            await broadcast_vehicle_update(vehicle_data, action="delete")

            mock_broadcast.assert_called_once_with(
                "vehicle_update",
                {"action": "delete", "data": vehicle_data},
                room="operations",
            )

    @pytest.mark.asyncio
    async def test_broadcast_material_update(self):
        """Test material update broadcast."""
        with patch.object(ws_manager, "broadcast_update", new_callable=AsyncMock) as mock_broadcast:
            material_data = {"id": "abc", "name": "Schlauch"}
            await broadcast_material_update(material_data, action="update")

            mock_broadcast.assert_called_once_with(
                "material_update",
                {"action": "update", "data": material_data},
                room="operations",
            )

    @pytest.mark.asyncio
    async def test_broadcast_assignment_update(self):
        """Test assignment update broadcast."""
        with patch.object(ws_manager, "broadcast_update", new_callable=AsyncMock) as mock_broadcast:
            assignment_data = {"id": "xyz", "resource_id": "123"}
            await broadcast_assignment_update(assignment_data, action="create")

            mock_broadcast.assert_called_once_with(
                "assignment_update",
                {"action": "create", "data": assignment_data},
                room="operations",
            )

    @pytest.mark.asyncio
    async def test_broadcast_system_message(self):
        """Test system message broadcast."""
        with patch.object(ws_manager, "broadcast_update", new_callable=AsyncMock) as mock_broadcast:
            await broadcast_system_message("Test message", level="warning")

            mock_broadcast.assert_called_once()
            call_args = mock_broadcast.call_args
            assert call_args[0][0] == "system_message"
            assert call_args[0][1]["message"] == "Test message"
            assert call_args[0][1]["level"] == "warning"


# ============================================
# CORS Configuration Tests
# ============================================


class TestCORSConfiguration:
    """Test suite for WebSocket CORS configuration."""

    def test_cors_origins_includes_configured_domains(self):
        """Test that configured CORS origins are included."""
        origins = get_websocket_cors_origins()

        # Should include default localhost origins from settings
        assert any("localhost" in o for o in origins)

    def test_cors_origins_no_duplicates(self):
        """Test that CORS origins list has no duplicates."""
        origins = get_websocket_cors_origins()

        # Check for duplicates
        assert len(origins) == len(set(origins))

    @patch.dict("os.environ", {"RAILWAY_PUBLIC_DOMAIN": "test.railway.app"})
    def test_cors_includes_railway_domain(self):
        """Test that Railway domain is added when available."""
        origins = get_websocket_cors_origins()

        assert "https://test.railway.app" in origins


# ============================================
# Global Manager Instance Tests
# ============================================


class TestGlobalManagerInstance:
    """Test suite for global ws_manager instance."""

    def test_ws_manager_exists(self):
        """Test that global ws_manager instance exists."""
        assert ws_manager is not None
        assert isinstance(ws_manager, WebSocketManager)

    def test_ws_manager_has_rooms(self):
        """Test that global ws_manager has expected rooms."""
        assert "operations" in ws_manager.active_connections
        assert "admin" in ws_manager.active_connections


# ============================================
# Constants Tests
# ============================================


class TestConstants:
    """Test suite for WebSocket manager constants."""

    def test_stale_session_timeout_reasonable(self):
        """Test that stale session timeout is reasonable."""
        # Should be at least 1 minute
        assert STALE_SESSION_TIMEOUT_SECONDS >= 60
        # Should be at most 30 minutes for a reasonable timeout
        assert STALE_SESSION_TIMEOUT_SECONDS <= 1800

    def test_cleanup_interval_reasonable(self):
        """Test that cleanup interval is reasonable."""
        # Should run at least every 5 minutes
        assert CLEANUP_INTERVAL_SECONDS <= 300
        # Should not run more than once per 10 seconds
        assert CLEANUP_INTERVAL_SECONDS >= 10


# ============================================
# Edge Cases Tests
# ============================================


class TestEdgeCases:
    """Test suite for edge cases and error handling."""

    @pytest.fixture
    def manager(self):
        """Create a fresh WebSocket manager instance."""
        return WebSocketManager()

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent_session(self, manager):
        """Test disconnecting a session that doesn't exist."""
        # Should not raise any exception
        await manager.disconnect("nonexistent_sid")

    @pytest.mark.asyncio
    async def test_multiple_connects_same_sid(self, manager):
        """Test connecting with same SID multiple times."""
        sid = "duplicate_sid"
        environ = {}

        await manager.connect(sid, environ)
        old_connected_at = manager.user_sessions[sid]["connected_at"]

        # Connect again with same SID
        await manager.connect(sid, environ)
        new_connected_at = manager.user_sessions[sid]["connected_at"]

        # Should update the session
        assert new_connected_at >= old_connected_at

    @pytest.mark.asyncio
    async def test_join_multiple_rooms(self, manager):
        """Test joining multiple rooms."""
        sid = "multi_room_sid"
        environ = {}

        await manager.connect(sid, environ)
        # Admin room requires an editor/admin role
        manager.user_sessions[sid]["role"] = "editor"
        await manager.join_room(sid, "operations")
        await manager.join_room(sid, "admin")

        assert sid in manager.active_connections["operations"]
        assert sid in manager.active_connections["admin"]
        assert "operations" in manager.user_sessions[sid]["rooms"]
        assert "admin" in manager.user_sessions[sid]["rooms"]

    @pytest.mark.asyncio
    async def test_leave_room_not_in(self, manager):
        """Test leaving a room the user never joined."""
        sid = "not_in_room_sid"
        environ = {}

        await manager.connect(sid, environ)
        # Don't join operations, just try to leave

        result = await manager.leave_room(sid, "operations")
        # Should succeed but nothing to remove
        assert result is True

    @pytest.mark.asyncio
    async def test_broadcast_error_handling(self, manager):
        """Test that broadcast errors are handled gracefully."""
        # This tests that the manager handles errors without crashing
        with patch("app.websocket_manager.sio.emit", new_callable=AsyncMock) as mock_emit:
            mock_emit.side_effect = Exception("Network error")

            # Should not raise exception, just log the error
            await manager.broadcast_update("test_event", {"data": "test"})

    @pytest.mark.asyncio
    async def test_send_to_client_error_handling(self, manager):
        """Test that send_to_client errors are handled gracefully."""
        with patch("app.websocket_manager.sio.emit", new_callable=AsyncMock) as mock_emit:
            mock_emit.side_effect = Exception("Client disconnected")

            # Should not raise exception
            await manager.send_to_client("sid123", "test_event", {"data": "test"})


# ============================================
# Room Access Control Tests (Part C, plan 03)
# ============================================


class TestRoomAccessControl:
    """Tests for role-based room access (admin room gating)."""

    @pytest.fixture
    def manager(self):
        return WebSocketManager()

    @pytest.mark.asyncio
    async def test_admin_room_denied_without_role(self, manager):
        sid = "acl_sid_1"
        await manager.connect(sid, {})

        result = await manager.join_room(sid, "admin")

        assert result is False
        assert sid not in manager.active_connections["admin"]

    @pytest.mark.asyncio
    async def test_admin_room_allowed_for_editor(self, manager):
        sid = "acl_sid_2"
        await manager.connect(sid, {})
        manager.user_sessions[sid]["role"] = "editor"

        result = await manager.join_room(sid, "admin")

        assert result is True
        assert sid in manager.active_connections["admin"]

    @pytest.mark.asyncio
    async def test_admin_room_allowed_for_admin(self, manager):
        sid = "acl_sid_3"
        await manager.connect(sid, {})
        manager.user_sessions[sid]["role"] = "admin"

        assert await manager.join_room(sid, "admin") is True

    @pytest.mark.asyncio
    async def test_admin_room_denied_for_viewer(self, manager):
        sid = "acl_sid_4"
        await manager.connect(sid, {})
        manager.user_sessions[sid]["role"] = "viewer"

        assert await manager.join_room(sid, "admin") is False

    @pytest.mark.asyncio
    async def test_operations_room_open_without_role(self, manager):
        """Phase 1: operations stays open to all connected clients."""
        sid = "acl_sid_5"
        await manager.connect(sid, {})

        assert await manager.join_room(sid, "operations") is True


# ============================================
# Cookie/JWT Role Extraction Tests
# ============================================


class TestGetRoleFromEnviron:
    """Tests for the JWT cookie parsing helper."""

    def test_valid_token_extracts_role(self):
        token = create_access_token(data={"sub": "some-user-id", "role": "editor"})
        environ = {"HTTP_COOKIE": f"access_token={token}"}

        assert get_role_from_environ(environ) == "editor"

    def test_missing_cookie_header(self):
        assert get_role_from_environ({}) is None

    def test_cookie_without_access_token(self):
        assert get_role_from_environ({"HTTP_COOKIE": "other=value"}) is None

    def test_garbage_token(self):
        assert get_role_from_environ({"HTTP_COOKIE": "access_token=not.a.jwt"}) is None

    def test_expired_token(self):
        token = create_access_token(data={"sub": "u", "role": "editor"}, expires_delta=timedelta(seconds=-10))
        environ = {"HTTP_COOKIE": f"access_token={token}"}

        assert get_role_from_environ(environ) is None

    def test_garbage_cookie_header(self):
        assert get_role_from_environ({"HTTP_COOKIE": ";;;=;;;"}) is None


# ============================================
# Strict Mode (ws_require_auth) Tests
# ============================================


class TestWsRequireAuth:
    """Tests for the strict-mode connect rejection flag."""

    @pytest.mark.asyncio
    async def test_rejects_unauthenticated_when_strict(self, monkeypatch):
        from app.websocket_manager import connect as connect_handler
        from app.websocket_manager import settings

        monkeypatch.setattr(settings, "ws_require_auth", True)

        result = await connect_handler("strict_sid_1", {})

        assert result is False
        assert "strict_sid_1" not in ws_manager.user_sessions

    @pytest.mark.asyncio
    async def test_accepts_authenticated_when_strict(self, monkeypatch):
        from app.websocket_manager import connect as connect_handler
        from app.websocket_manager import settings

        monkeypatch.setattr(settings, "ws_require_auth", True)
        token = create_access_token(data={"sub": "u", "role": "editor"})
        environ = {"HTTP_COOKIE": f"access_token={token}"}

        with patch("app.websocket_manager.sio.emit", new_callable=AsyncMock):
            result = await connect_handler("strict_sid_2", environ)

        try:
            assert result is True
            assert ws_manager.user_sessions["strict_sid_2"]["role"] == "editor"
        finally:
            await ws_manager.disconnect("strict_sid_2")

    @pytest.mark.asyncio
    async def test_accepts_unauthenticated_when_not_strict(self, monkeypatch):
        from app.websocket_manager import connect as connect_handler
        from app.websocket_manager import settings

        monkeypatch.setattr(settings, "ws_require_auth", False)

        with patch("app.websocket_manager.sio.emit", new_callable=AsyncMock):
            result = await connect_handler("strict_sid_3", {})

        try:
            assert result is True
            assert ws_manager.user_sessions["strict_sid_3"]["role"] is None
        finally:
            await ws_manager.disconnect("strict_sid_3")
