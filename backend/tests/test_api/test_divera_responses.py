"""GET /api/divera/{events,incidents}/{id}/responses – the «Anrückend» block's data.

Stored snapshots in, merged summary out; the person mapping goes through the `divera`
external identity. Absent (not an empty block) when Divera is not configured or nothing on
the Ereignis/incident came from Divera. The access key is never echoed.
"""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.crud import external_identities as identities_crud
from app.models import DiveraEmergency, Event, Incident, Personnel, Setting
from app.services import divera_responses as dr

FIXTURES = Path(__file__).resolve().parents[1] / "test_services"
ALARMS = json.loads((FIXTURES / "divera_alarms_responses.json").read_text(encoding="utf-8"))
PULL_ALL = json.loads((FIXTURES / "divera_pull_all.json").read_text(encoding="utf-8"))
CATALOGUE = dr.parse_status_catalogue(PULL_ALL["data"]["cluster"])
KEY = "unit-key-that-must-not-be-echoed"


@pytest.fixture
def divera_configured(monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", KEY)


async def _roster(db: AsyncSession) -> dict[int, Personnel]:
    people: dict[int, Personnel] = {}
    for ucr in range(101, 107):
        person = Personnel(id=uuid4(), name=f"Muster {ucr}", role="Soldat", status="available", tags=["AS"])
        db.add(person)
        people[ucr] = person
    await db.commit()
    for ucr, person in people.items():
        await identities_crud.set_identity(db, person.id, "divera", str(ucr))
    await db.commit()
    return people


async def _alarm(db: AsyncSession, event: Event, incident: Incident | None, divera_id: int, item) -> DiveraEmergency:
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=divera_id,
        source="divera",
        source_id=str(divera_id),
        title="B2 Brand Wohnhaus",
        attached_to_event_id=event.id,
        created_incident_id=incident.id if incident else None,
    )
    db.add(emergency)
    await db.commit()
    await dr.store_snapshots(db, {divera_id: dr.snapshot_from_alarm(item, CATALOGUE)})
    return emergency


async def test_event_summary_merges_maps_and_counts(
    viewer_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident, divera_configured
):
    people = await _roster(db_session)
    await _alarm(db_session, test_event, test_incident, 4711, ALARMS["data"]["items"]["4711"])

    response = await viewer_client.get(f"/api/divera/events/{test_event.id}/responses")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] is True
    assert body["counts"] == {"coming": 4, "not_coming": 2, "other": 1}
    assert (body["addressed"], body["answered"], body["unanswered"], body["read"], body["unmapped"]) == (10, 7, 3, 8, 1)
    by_ucr = {p["ucr_id"]: p for p in body["people"]}
    assert by_ucr[101]["personnel_id"] == str(people[101].id)
    assert by_ucr[101]["name"] == "Muster 101"
    assert by_ucr[101]["role"] == "Soldat"
    assert by_ucr[101]["tags"] == ["AS"]
    assert by_ucr[999]["personnel_id"] is None
    assert by_ucr[104]["kind"] == "not_coming"
    assert by_ucr[104]["note"] == "Ferien"
    assert by_ucr[103]["eta"].startswith("2026-10-08T")  # 1791479490 = 08.10.2026 UTC
    assert body["updated_at"] is not None
    assert KEY not in response.text
    assert "accesskey" not in response.text


async def test_incident_summary_and_station_override(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident, divera_configured
):
    await _roster(db_session)
    await _alarm(db_session, test_event, test_incident, 4711, ALARMS["data"]["items"]["4711"])
    db_session.add(Setting(key=dr.RESPONSE_CLASSIFICATION_KEY, value=json.dumps({"17": "coming"})))
    await db_session.commit()

    body = (await editor_client.get(f"/api/divera/incidents/{test_incident.id}/responses")).json()
    assert body["available"] is True
    assert body["counts"] == {"coming": 5, "not_coming": 2, "other": 0}


async def test_storing_the_same_snapshot_again_is_no_change(
    db_session: AsyncSession, test_event: Event, test_incident: Incident
):
    item = ALARMS["data"]["items"]["4711"]
    await _alarm(db_session, test_event, test_incident, 4711, item)
    events, incidents = await dr.store_snapshots(db_session, {4711: dr.snapshot_from_alarm(item, CATALOGUE)})
    assert (events, incidents) == (set(), set())
    events, incidents = await dr.store_snapshots(db_session, {4711: dr.snapshot_from_alarm({"ucr_answered": []})})
    assert events == {test_event.id}
    assert incidents == {test_incident.id}


async def test_not_configured_is_absent(viewer_client: AsyncClient, test_event: Event, monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "")
    body = (await viewer_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert body["available"] is False
    assert body["reason"] == "not_configured"
    assert body["people"] == []


async def test_not_divera_linked_is_absent(
    viewer_client: AsyncClient, test_event: Event, test_incident: Incident, divera_configured
):
    body = (await viewer_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert (body["available"], body["reason"]) == (False, "not_linked")
    body = (await viewer_client.get(f"/api/divera/incidents/{test_incident.id}/responses")).json()
    assert (body["available"], body["reason"]) == (False, "not_linked")


async def test_a_linked_alarm_without_answers_yet_is_available_and_empty(
    viewer_client: AsyncClient, db_session: AsyncSession, test_event: Event, divera_configured
):
    db_session.add(DiveraEmergency(id=uuid4(), divera_id=5000, title="Alarm", attached_to_event_id=test_event.id))
    await db_session.commit()
    body = (await viewer_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert body["available"] is True
    assert body["alarm_count"] == 1
    assert body["answered"] == 0


async def test_unknown_event_and_incident_are_404(viewer_client: AsyncClient, divera_configured):
    assert (await viewer_client.get(f"/api/divera/events/{uuid4()}/responses")).status_code == 404
    assert (await viewer_client.get(f"/api/divera/incidents/{uuid4()}/responses")).status_code == 404


async def test_anonymous_is_refused(client: AsyncClient, test_event: Event, divera_configured):
    assert (await client.get(f"/api/divera/events/{test_event.id}/responses")).status_code == 401
