"""Tests for the station logo endpoints.

``/api/settings/branding/logo`` — GET the PNG (any authenticated user), PUT a new one
and DELETE it (editors only). The logo lives in the settings table because the
reference deployment has no persistent disk, so these tests also pin the two rules
that keep a ~100 KB blob from leaking into the generic settings surface: it is not in
``GET /api/settings/``, and ``PATCH /api/settings/{key}`` refuses to write it.
"""

import io

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting
from app.services.branding import LOGO_SETTING_KEY


def _image_bytes(fmt: str = "PNG", size: tuple[int, int] = (400, 160)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (185, 28, 28)).save(buffer, fmt)
    return buffer.getvalue()


def _upload(content: bytes, filename: str = "logo.png", content_type: str = "image/png") -> dict:
    return {"file": (filename, content, content_type)}


class TestAuth:
    @pytest.mark.asyncio
    async def test_unauthenticated_cannot_read(self, client: AsyncClient):
        assert (await client.get("/api/settings/branding/logo")).status_code == 401

    @pytest.mark.asyncio
    async def test_viewer_cannot_upload(self, viewer_client: AsyncClient):
        response = await viewer_client.put("/api/settings/branding/logo", files=_upload(_image_bytes()))
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_viewer_cannot_delete(self, viewer_client: AsyncClient):
        assert (await viewer_client.delete("/api/settings/branding/logo")).status_code == 403


class TestRoundTrip:
    @pytest.mark.asyncio
    async def test_no_logo_is_a_404_not_an_error(self, editor_client: AsyncClient):
        """The <img> in Einstellungen reads this 404 as "no logo set"."""
        assert (await editor_client.get("/api/settings/branding/logo")).status_code == 404

    @pytest.mark.asyncio
    async def test_upload_then_read_returns_a_png(self, editor_client: AsyncClient):
        upload = await editor_client.put("/api/settings/branding/logo", files=_upload(_image_bytes()))
        assert upload.status_code == 200
        assert upload.json()["size"] > 0

        response = await editor_client.get("/api/settings/branding/logo")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content[:8] == b"\x89PNG\r\n\x1a\n"

    @pytest.mark.asyncio
    async def test_jpeg_is_stored_as_png(self, editor_client: AsyncClient):
        """One format out, whatever went in — the PDF builder never has to guess."""
        upload = await editor_client.put(
            "/api/settings/branding/logo",
            files=_upload(_image_bytes("JPEG"), "wappen.jpg", "image/jpeg"),
        )
        assert upload.status_code == 200
        response = await editor_client.get("/api/settings/branding/logo")
        assert Image.open(io.BytesIO(response.content)).format == "PNG"

    @pytest.mark.asyncio
    async def test_oversized_image_is_scaled_down(self, editor_client: AsyncClient):
        await editor_client.put("/api/settings/branding/logo", files=_upload(_image_bytes(size=(4000, 1600))))
        response = await editor_client.get("/api/settings/branding/logo")
        width, height = Image.open(io.BytesIO(response.content)).size
        assert width <= 900 and height <= 450

    @pytest.mark.asyncio
    async def test_delete_removes_it(self, editor_client: AsyncClient):
        await editor_client.put("/api/settings/branding/logo", files=_upload(_image_bytes()))
        assert (await editor_client.delete("/api/settings/branding/logo")).status_code == 204
        assert (await editor_client.get("/api/settings/branding/logo")).status_code == 404

    @pytest.mark.asyncio
    async def test_delete_without_a_logo_is_idempotent(self, editor_client: AsyncClient):
        assert (await editor_client.delete("/api/settings/branding/logo")).status_code == 204


class TestRejections:
    @pytest.mark.asyncio
    async def test_non_image_is_refused(self, editor_client: AsyncClient):
        response = await editor_client.put(
            "/api/settings/branding/logo", files=_upload(b"not an image at all", "x.png")
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_svg_is_refused_with_the_actual_reason(self, editor_client: AsyncClient):
        """ReportLab cannot read SVG and this backend has no rasteriser — say so."""
        svg = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
        response = await editor_client.put(
            "/api/settings/branding/logo", files=_upload(svg, "logo.svg", "image/svg+xml")
        )
        assert response.status_code == 400
        assert "SVG" in response.json()["detail"]


class TestGenericSettingsSurface:
    @pytest.mark.asyncio
    async def test_blob_is_absent_from_the_settings_dict(self, editor_client: AsyncClient, db_session: AsyncSession):
        await editor_client.put("/api/settings/branding/logo", files=_upload(_image_bytes()))
        stored = await db_session.execute(select(Setting).where(Setting.key == LOGO_SETTING_KEY))
        assert stored.scalar_one().value  # it really is in the table…

        body = (await editor_client.get("/api/settings/")).json()
        assert LOGO_SETTING_KEY not in body  # …and still not on the wire

    @pytest.mark.asyncio
    async def test_patch_refuses_to_write_the_logo_key(self, editor_client: AsyncClient):
        response = await editor_client.patch(
            f"/api/settings/{LOGO_SETTING_KEY}", json={"value": "bm90LWFuLWltYWdl"}
        )
        assert response.status_code == 403
        assert "branding/logo" in response.json()["detail"]
