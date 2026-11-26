"""`/feld` errors carry a stable code beside the German detail (`app/utils/error_codes.py`).

Two halves: the wire shape (``detail`` unchanged, ``code`` added), and the tie to the
frontend catalogues — every code has a German and a French sentence, read from the
frontend sources themselves so the list cannot drift (same idea as
``test_settings_allowlist.py``).
"""

import ast
import json
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.services.tokens import generate_feld_token
from app.utils.error_codes import ErrorCode

MESSAGES = Path(__file__).resolve().parents[3] / "frontend" / "messages"


@pytest.mark.asyncio
@pytest.mark.api
async def test_bad_token_has_a_code_and_keeps_the_german_detail(client: AsyncClient):
    response = await client.get("/api/feld/personnel?token=not-a-token")
    assert response.status_code == 401
    assert response.json() == {"detail": "Ungültiger oder abgelaufener Zugriffscode", "code": "feld_token_invalid"}


@pytest.mark.asyncio
@pytest.mark.api
async def test_unknown_event_has_a_code(client: AsyncClient):
    response = await client.get(f"/api/feld/context?token={generate_feld_token(uuid4())}")
    assert response.status_code == 404
    assert response.json() == {"detail": "Ereignis nicht gefunden", "code": "feld_event_not_found"}


@pytest.mark.asyncio
@pytest.mark.api
async def test_plain_http_exceptions_are_unchanged(client: AsyncClient):
    """Only the coded subclass gets a `code` — every other route answers as before."""
    response = await client.post(f"/api/notifications/{uuid4()}/dismiss")
    assert "code" not in response.json()


@pytest.mark.skipif(not (MESSAGES / "de.json").exists(), reason="frontend sources not present")
@pytest.mark.parametrize("locale", ["de", "fr"])
def test_every_code_has_a_sentence_in_the_shipped_locales(locale: str):
    codes = json.loads((MESSAGES / f"{locale}.json").read_text())["errors"]["codes"]
    missing = sorted(code.value for code in ErrorCode if not codes.get(code.value))
    assert not missing, f"errors.codes.* missing in {locale}.json: {missing}"


# Routers whose every refusal carries a code. Add a router here once it has none left.
FULLY_CODED_ROUTERS = ("divera.py", "incidents.py", "print.py")


@pytest.mark.parametrize("router", FULLY_CODED_ROUTERS)
def test_fully_coded_routers_raise_no_plain_http_exception(router: str):
    """A plain `HTTPException` has no `code`, so the client can only show its German `detail`."""
    source = (Path(__file__).resolve().parents[2] / "app" / "api" / router).read_text(encoding="utf-8")
    plain = [
        node.lineno
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "HTTPException"
    ]
    assert not plain, f"app/api/{router} raises a plain HTTPException on lines {plain}: use CodedHTTPException"
