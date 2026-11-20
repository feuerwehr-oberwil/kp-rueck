"""«Link widerrufen»: a check-in, viewer or alarm link can be taken back (services/share_links.py)."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from httpx import AsyncClient

from app.config import get_settings
from app.models import Event

# kind -> (the route that issues the link, a route the link opens)
LINKS = {
    "checkin": ("/api/personnel/check-in/generate-link", "/api/personnel/check-in/list"),
    "viewer": ("/api/viewer/generate-link", "/api/viewer/data"),
    "alarm": ("/api/intake/generate-link", "/api/intake/context"),
}
KINDS = sorted(LINKS)


async def _new_link(editor_client: AsyncClient, kind: str, event: Event) -> str:
    response = await editor_client.post(LINKS[kind][0], params={"event_id": str(event.id)})
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def _opens(client: AsyncClient, kind: str, token: str) -> int:
    return (await client.get(LINKS[kind][1], params={"token": token})).status_code


async def _revoke(editor_client: AsyncClient, kind: str, event_id: object) -> int:
    return (await editor_client.post(f"/api/events/{event_id}/share-links/{kind}/revoke")).status_code


@pytest.mark.parametrize("kind", KINDS)
async def test_a_revoked_link_stops_and_a_new_one_works(editor_client: AsyncClient, test_event: Event, kind: str):
    old = await _new_link(editor_client, kind, test_event)
    assert await _opens(editor_client, kind, old) == 200

    assert await _revoke(editor_client, kind, test_event.id) == 204

    assert await _opens(editor_client, kind, old) == 401
    new = await _new_link(editor_client, kind, test_event)
    assert await _opens(editor_client, kind, new) == 200


@pytest.mark.parametrize("kind", KINDS)
async def test_a_link_from_before_the_change_works_until_it_is_revoked(
    editor_client: AsyncClient, test_event: Event, kind: str
):
    """Such a token carries no generation: it counts as 0, what every Ereignis starts with."""
    claims = {"event_id": str(test_event.id), "exp": datetime.now(UTC) + timedelta(hours=1), "type": kind}
    legacy = jwt.encode(claims, get_settings().secret_key, algorithm="HS256")
    assert await _opens(editor_client, kind, legacy) == 200

    assert await _revoke(editor_client, kind, test_event.id) == 204

    assert await _opens(editor_client, kind, legacy) == 401


async def test_revoking_one_kind_leaves_the_others(editor_client: AsyncClient, test_event: Event):
    links = {kind: await _new_link(editor_client, kind, test_event) for kind in KINDS}

    assert await _revoke(editor_client, "viewer", test_event.id) == 204

    assert {kind: await _opens(editor_client, kind, token) for kind, token in links.items()} == {
        "alarm": 200,
        "checkin": 200,
        "viewer": 401,
    }


async def test_revoke_answers_for_what_is_not_there(editor_client: AsyncClient, test_event: Event):
    assert await _revoke(editor_client, "viewer", uuid4()) == 404
    assert await _revoke(editor_client, "feld", test_event.id) == 422


async def test_a_box_and_the_hosted_board_count_their_revokes_apart(db_session, test_event, monkeypatch):
    """Both start from the same number and revoke while apart. Counted in one counter, both
    would land on «1», and a link issued after the one revoke would survive the other. Each
    system has its own half of the number; the standby sync takes the higher of each half."""
    from sqlalchemy import select

    from app.services import share_links
    from app.standby_sync import merge_link_generations

    async def revoked_on(role: str) -> int:
        await db_session.execute(Event.__table__.update().values(viewer_link_generation=0))
        monkeypatch.setenv("DEPLOYMENT_ROLE", role)
        assert await share_links.revoke(db_session, "viewer", test_event.id)
        return await db_session.scalar(select(Event.viewer_link_generation).where(Event.id == test_event.id))

    box, hosted = await revoked_on("standby"), await revoked_on("production")

    assert box != hosted
    # After the sync neither side's number is the current one: links of both are dead.
    assert merge_link_generations(box, hosted) not in (box, hosted)
