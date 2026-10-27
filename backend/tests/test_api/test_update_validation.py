"""An update is held to the create rules: a bad field is a 422, never a 500.

The update schemas used to be bare `X | None` fields, so a blank name, an out-of-range
coordinate or an explicit null on a NOT NULL column went straight to the database (or into
the response model) and came back as an internal error. They now share the field types of
`schemas/fields.py` with create and import. Omitted stays omitted; null clears only what
may be empty.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Material, Personnel, Vehicle

ROUTES = {"incident": "incidents", "personnel": "personnel", "vehicle": "vehicles", "material": "materials"}


async def _stored_row(db_session: AsyncSession, kind: str) -> str:
    """One row of `kind` named/titled «Before», committed; returns its id."""
    if kind == "incident":
        event = Event(id=uuid4(), name="Update validation", training_flag=False, last_activity_at=datetime.now(UTC))
        db_session.add(event)
        await db_session.flush()
        row: Any = Incident(
            id=uuid4(),
            event_id=event.id,
            title="Before",
            type="diverse_einsaetze",
            priority="low",
            status="incoming",
            description="Meldung",
            location_lat=47.5,
            location_lng=7.5,
        )
    elif kind == "personnel":
        row = Personnel(id=uuid4(), name="Before", role="AdF", status="available")
    elif kind == "vehicle":
        row = Vehicle(id=uuid4(), name="Before", type="TLF", radio_call_sign="23", display_order=0, status="available")
    else:
        row = Material(id=uuid4(), name="Before", type="Pump", location="Depot", status="available")
    db_session.add(row)
    await db_session.commit()
    return str(row.id)


async def _write(client: AsyncClient, kind: str, row_id: str, payload: dict[str, Any]):
    method = "PATCH" if kind == "incident" else "PUT"
    return await client.request(method, f"/api/{ROUTES[kind]}/{row_id}", json=payload)


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("incident", {"title": None}),
        ("incident", {"title": "   "}),
        ("incident", {"title": "x" * 201}),
        ("incident", {"type": None}),
        ("incident", {"status": None}),
        ("incident", {"nachbarhilfe": None}),
        ("incident", {"location_lat": "91"}),
        ("incident", {"location_lat": "NaN"}),
        ("incident", {"location_lng": "Infinity"}),
        ("incident", {"description": "x" * 2001}),
        ("incident", {"contact_phone": "1" * 51}),
        ("personnel", {"name": ""}),
        ("personnel", {"name": None}),
        ("personnel", {"name": "x" * 101}),
        ("personnel", {"status": "bogus"}),
        ("personnel", {"status": None}),
        ("personnel", {"role": "x" * 51}),
        ("personnel", {"role_sort_order": -1}),
        ("vehicle", {"display_order": -1}),
        ("vehicle", {"display_order": None}),
        ("vehicle", {"type": "   "}),
        ("vehicle", {"radio_call_sign": None}),
        ("material", {"name": ""}),
        ("material", {"type": "x" * 51}),
        ("material", {"location": None}),
        ("material", {"location_sort_order": -1}),
        ("material", {"consumable": None}),
    ],
)
async def test_an_invalid_update_is_refused_and_changes_nothing(
    editor_client: AsyncClient, db_session: AsyncSession, kind: str, payload: dict[str, Any]
):
    row_id = await _stored_row(db_session, kind)

    response = await _write(editor_client, kind, row_id, payload)

    assert response.status_code == 422, response.text
    after = await editor_client.get(f"/api/{ROUTES[kind]}/{row_id}")
    assert after.status_code == 200
    assert after.json()["title" if kind == "incident" else "name"] == "Before"


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        # What the board sends: «Koordinaten entfernen» and an emptied Meldung.
        ("incident", {"location_lat": None, "location_lng": None, "description": "", "contact_phone": None}),
        ("personnel", {"role": None, "tags": None}),
        ("material", {"description": None, "group_id": None}),
        # Readiness: a null `status` / `out_of_service` means "not sent".
        ("vehicle", {"status": None, "out_of_service": None}),
    ],
)
async def test_a_clearable_field_takes_null_and_the_rest_stays(
    editor_client: AsyncClient, db_session: AsyncSession, kind: str, payload: dict[str, Any]
):
    row_id = await _stored_row(db_session, kind)

    response = await _write(editor_client, kind, row_id, payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title" if kind == "incident" else "name"] == "Before"
    for field, value in payload.items():
        if value is not None or field in ("status", "out_of_service"):
            continue
        assert body[field] is None, field


@pytest.mark.asyncio
@pytest.mark.api
async def test_an_update_is_normalised_like_a_create(editor_client: AsyncClient, db_session: AsyncSession):
    row_id = await _stored_row(db_session, "personnel")

    response = await _write(editor_client, "personnel", row_id, {"name": "  Anna   Muster  ", "status": "off_duty"})

    assert response.status_code == 200
    assert response.json()["name"] == "Anna Muster"
    assert response.json()["status"] == "unavailable"


async def test_an_update_cannot_leave_half_a_coordinate_pair(editor_client: AsyncClient, test_incident: Incident):
    incident_id = test_incident.id  # the refused request rolls the shared session back
    response = await editor_client.patch(f"/api/incidents/{incident_id}", json={"location_lat": None})

    assert response.status_code == 422
    stored = await editor_client.get(f"/api/incidents/{incident_id}")
    assert stored.json()["location_lng"] is not None
