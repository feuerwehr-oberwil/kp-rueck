"""A walk-in «Person hinzufügen» is a guest of its Ereignis, not a roster member (#5, 19.11.2026).

The Fahrer picker's and the Appell's quick-add used to create a permanent roster row
(«Techniker», 31.08.2026, still in Settings ≫ Personal months later). With
`guest_event_id` the person is listed for that Ereignis only (`Personnel.in_scope`).
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event


async def _other_event(db: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Anderes Ereignis", training_flag=False)
    db.add(event)
    await db.commit()
    return event


def _names(response) -> set[str]:
    assert response.status_code == 200, response.text
    body = response.json()
    rows = body["personnel"] if isinstance(body, dict) else body
    return {row["name"] for row in rows}


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_guest_is_listed_for_its_ereignis_only(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
):
    other = await _other_event(db_session)
    other_id = other.id
    await editor_client.post("/api/personnel/", json={"name": "Muster Hans", "status": "available"})
    created = await editor_client.post(
        "/api/personnel/", json={"name": "Techniker", "status": "available", "guest_event_id": str(test_event.id)}
    )
    assert created.status_code == 201
    guest_id = created.json()["id"]

    # The roster (Settings ≫ Personal, the syncs, the export) never sees a guest.
    assert _names(await editor_client.get("/api/personnel/")) == {"Muster Hans"}
    # Its own Ereignis lists it with the roster – board, Appell and check-in list alike.
    assert _names(await editor_client.get(f"/api/personnel/?event_id={test_event.id}")) == {"Muster Hans", "Techniker"}
    assert "Techniker" in _names(await editor_client.get(f"/api/personnel/check-in/list?event_id={test_event.id}"))
    # Another Ereignis does not, and cannot check the guest in either.
    assert _names(await editor_client.get(f"/api/personnel/?event_id={other_id}")) == {"Muster Hans"}
    assert "Techniker" not in _names(await editor_client.get(f"/api/personnel/check-in/list?event_id={other_id}"))
    refused = await editor_client.post(f"/api/personnel/check-in/{guest_id}/in?event_id={other_id}")
    assert refused.status_code == 404
    # The row itself still resolves – rapport and history name the person.
    assert (await editor_client.get(f"/api/personnel/{guest_id}")).json()["name"] == "Techniker"


@pytest.mark.asyncio
@pytest.mark.api
async def test_guest_names_clash_only_within_the_lists_they_share(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
):
    other = await _other_event(db_session)
    await editor_client.post("/api/personnel/", json={"name": "Muster Hans", "status": "available"})

    def guest(name: str, event_id) -> dict:
        return {"name": name, "status": "available", "guest_event_id": str(event_id)}

    assert (await editor_client.post("/api/personnel/", json=guest("Techniker", test_event.id))).status_code == 201
    # Another Ereignis's «Techniker» is somebody else's guest – no clash.
    assert (await editor_client.post("/api/personnel/", json=guest("Techniker", other.id))).status_code == 201
    # The roster's name would stand twice in this Ereignis's lists.
    assert (await editor_client.post("/api/personnel/", json=guest("Muster Hans", test_event.id))).status_code == 409
    # An Ereignis that does not exist.
    assert (await editor_client.post("/api/personnel/", json=guest("Neu", uuid4()))).status_code == 404
