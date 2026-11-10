"""A viewer is strictly read-only – proven over the route table, not route by route."""

import re
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.main import app

#: Writes that do NOT answer a viewer session with 403, by the reason. None of them trusts the
#: board session for its right to write: each has a door of its own, tested where it lives.
#: Everything else that is not a GET must refuse a viewer – a new route is in the sweep by
#: existing, and lands here only with an argument.
OWN_DOOR: dict[str, list[str]] = {
    "signing in and out is for every role, and for nobody yet": [
        "POST /api/auth/login",
        "POST /api/auth/logout",
        "POST /api/auth/refresh",
        "POST /api/auth/local-login",
        "POST /api/auth/microsoft-start",
        "POST /api/auth/microsoft-login",
        "POST /api/setup",
    ],
    "Feld: the Feld-Code and the person's own session (test_field_surface_registry.py)": [
        "POST /api/feld/unlock",
        "POST /api/feld/claim",
        "POST /api/feld/logout",
        "POST /api/feld/incidents",
        "POST /api/feld/attendance/{personnel_id}",
        "POST /api/feld/incidents/{incident_id}/arrived",
        "POST /api/feld/incidents/{incident_id}/complete",
        "POST /api/feld/incidents/{incident_id}/message",
        "POST /api/feld/incidents/{incident_id}/photos",
        "DELETE /api/feld/incidents/{incident_id}/photos/{filename}",
        "POST /api/feld/incidents/{incident_id}/pickup",
        "POST /api/feld/incidents/{incident_id}/reko-link",
        "PUT /api/feld/incidents/{incident_id}/rapport",
        "PUT /api/feld/incidents/{incident_id}/report",
    ],
    "Reko form: its link token, or an editor cookie checked in the handler (test_field_surface_registry.py)": [
        "POST /api/reko/",
        "PATCH /api/reko/{report_id}",
        "POST /api/reko/generate-link",
        "POST /api/reko/{incident_id}/arrived",
        "POST /api/reko/{incident_id}/photos",
        "DELETE /api/reko/{incident_id}/photos/{filename}",
    ],
    "check-in and the public Meldeformular: their link tokens (test_field_surface_registry.py)": [
        "POST /api/personnel/check-in/{personnel_id}/in",
        "POST /api/personnel/check-in/{personnel_id}/out",
        "POST /api/intake/alarm",
        "PUT /api/intake/alarm/{incident_id}",
    ],
    "machines with a shared secret: alarm webhooks, the standby box": [
        "POST /api/alarms",
        "POST /api/divera/webhook",
        "POST /api/firehub/webhook",
        "POST /api/standby/sync",
        "POST /api/standby/photos/missing",
        "PUT /api/standby/photos/{incident_id}/{name}",
    ],
    "the client-error sink takes a report from any page, signed in or not": ["POST /api/diag/client-error"],
    "exists only in demo mode (404 otherwise) and resets a visitor's own sandbox": ["POST /api/demo/sandbox"],
}
NOT_REFUSED = {key for keys in OWN_DOOR.values() for key in keys}


def _writes() -> list[tuple[str, str]]:
    table = []
    for route in app.routes:
        methods, path = getattr(route, "methods", None), getattr(route, "path", None)
        if not methods or not path or not path.startswith("/api/"):
            continue
        table += [(m, path) for m in sorted(set(methods) - {"GET", "HEAD", "OPTIONS"})]
    return table


def _concrete(path: str) -> str:
    """The path with every parameter filled in: the role check must answer before a lookup."""
    return re.sub(r"\{[^}]+\}", lambda _: str(uuid4()), path)


@pytest.mark.asyncio
@pytest.mark.security
async def test_every_write_refuses_a_viewer(viewer_client: AsyncClient):
    answered: dict[str, int] = {}
    for method, path in _writes():
        response = await viewer_client.request(method, _concrete(path), json={})
        answered[f"{method} {path}"] = response.status_code

    open_to_viewer = {key: code for key, code in answered.items() if code != 403 and key not in NOT_REFUSED}
    assert not open_to_viewer, "writes that do not refuse a viewer (fix the route, or list it with the reason):\n" + (
        "\n".join(f"  {key} -> {code}" for key, code in sorted(open_to_viewer.items()))
    )
    stale = sorted(key for key in NOT_REFUSED if answered.get(key) == 403 or key not in answered)
    assert stale == [], "NOT_REFUSED entries that are refused now, or no longer exist"
