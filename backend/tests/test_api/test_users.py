"""Authorization tests for the user-administration endpoints.

`GET /api/users` is guarded by ``CurrentAdmin`` — the only place in the API where
*editor* is not enough. That guard had no test of its own: the editor-level guards are
covered (audit, Lageblatt, PDF report) and ``get_current_editor`` is unit-tested, but
nothing asserted that an editor is refused the user list.

The gap mattered because the settings page reads ``activeSection`` unfiltered from the
URL, so ``/settings?section=users`` is reachable by anyone who gets past
``ProtectedRoute``. What keeps the roster from leaking is this dependency, not the
sidebar — so it is worth a test that says so.
"""

import pytest
from httpx import AsyncClient


class TestListUsersAuthorization:
    """Who may read the user list."""

    @pytest.mark.asyncio
    async def test_admin_can_list_users(self, admin_client: AsyncClient):
        """The endpoint works at all — otherwise the refusals below prove nothing."""
        response = await admin_client.get("/api/users/")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_editor_is_refused(self, editor_client: AsyncClient):
        """Editor is not enough: this is the one admin-only read surface."""
        response = await editor_client.get("/api/users/")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_viewer_is_refused(self, viewer_client: AsyncClient):
        """A viewer reaching /settings?section=users must still see no roster."""
        response = await viewer_client.get("/api/users/")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_unauthenticated_is_refused(self, client: AsyncClient):
        response = await client.get("/api/users/")
        assert response.status_code == 401
