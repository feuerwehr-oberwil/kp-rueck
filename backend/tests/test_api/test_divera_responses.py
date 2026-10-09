"""GET /api/divera/{events,incidents}/{id}/responses – the «Anrückend» block's data.

Stored snapshots in, merged summary out; the person mapping goes through the `divera`
external identity. Absent (not an empty block) when Divera is not configured or nothing on
the Ereignis/incident came from Divera. The access key is never echoed.
"""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.crud import events as events_crud
from app.crud import external_identities as identities_crud
from app.models import DiveraEmergency, Event, EventAttendance, Incident, Personnel, Setting
from app.services import divera_responses as dr

FIXTURES = Path(__file__).resolve().parents[1] / "test_services"
ALARMS = json.loads((FIXTURES / "divera_alarms_responses.json").read_text(encoding="utf-8"))
PULL_ALL = json.loads((FIXTURES / "divera_pull_all.json").read_text(encoding="utf-8"))
CATALOGUE = dr.parse_status_catalogue(PULL_ALL["data"]["cluster"])
KEY = "unit-key-that-must-not-be-echoed"


# The fixture alarm went out at 1791478800; «Anrückend» shows alarms of the last 6 h.
ALARM_TIME = datetime.fromtimestamp(1791478800, tz=UTC)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    """Pin the service clock to ten minutes after the fixture alarm; tests move it."""
    now = [ALARM_TIME + timedelta(minutes=10)]
    monkeypatch.setattr(dr, "_now", lambda: now[0])
    return now


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
    await dr.store_snapshots(db, {divera_id: dr.parse_alarm(item, CATALOGUE)})
    await db.refresh(emergency)
    return emergency


async def test_event_summary_merges_maps_and_counts(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident, divera_configured
):
    people = await _roster(db_session)
    await _alarm(db_session, test_event, test_incident, 4711, ALARMS["data"]["items"]["4711"])

    response = await editor_client.get(f"/api/divera/events/{test_event.id}/responses")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["available"] is True
    # 999 is not on the roster (counted), 106 «Rückruf erbeten» is neither yes nor no (dropped).
    assert body["counts"] == {"coming": 4, "not_coming": 2}
    assert body["unmapped"] == 1
    by_name = {p["name"]: p for p in body["people"]}
    assert set(by_name) == {f"Muster {u}" for u in (101, 102, 103, 104, 105)}
    assert by_name["Muster 101"] == {
        "personnel_id": str(people[101].id),
        "name": "Muster 101",
        "role": "Soldat",
        "tags": ["AS"],
        "kind": "coming",
        "attended": False,
    }
    assert by_name["Muster 104"]["kind"] == "not_coming"
    assert body["updated_at"] is not None
    for gone in ("ucr_id", "note", "eta", "answered_at", "status", "Ferien", "addressed", "read"):
        assert gone not in response.text
    assert KEY not in response.text
    assert "accesskey" not in response.text


async def test_incident_summary_and_station_override(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident, divera_configured
):
    await _roster(db_session)
    # Classified at poll time: the override has to be there when the answers are stored.
    db_session.add(Setting(key=dr.RESPONSE_CLASSIFICATION_KEY, value=json.dumps({"17": "coming"})))
    await db_session.commit()
    await _alarm(db_session, test_event, test_incident, 4711, ALARMS["data"]["items"]["4711"])

    body = (await editor_client.get(f"/api/divera/incidents/{test_incident.id}/responses")).json()
    assert body["available"] is True
    assert body["counts"] == {"coming": 5, "not_coming": 2}


async def test_storing_the_same_snapshot_again_is_no_change(
    db_session: AsyncSession, test_event: Event, test_incident: Incident
):
    item = ALARMS["data"]["items"]["4711"]
    await _alarm(db_session, test_event, test_incident, 4711, item)
    events, incidents = await dr.store_snapshots(db_session, {4711: dr.parse_alarm(item, CATALOGUE)})
    assert (events, incidents) == (set(), set())
    events, incidents = await dr.store_snapshots(db_session, {4711: dr.parse_alarm({"ucr_answered": []})})
    assert events == {test_event.id}
    assert incidents == {test_incident.id}


async def test_not_configured_is_absent(editor_client: AsyncClient, test_event: Event, monkeypatch):
    monkeypatch.setattr(settings, "divera_access_key", "")
    body = (await editor_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert body["available"] is False
    assert body["reason"] == "not_configured"
    assert body["people"] == []


async def test_not_divera_linked_is_absent(
    editor_client: AsyncClient, test_event: Event, test_incident: Incident, divera_configured
):
    body = (await editor_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert (body["available"], body["reason"]) == (False, "not_linked")
    body = (await editor_client.get(f"/api/divera/incidents/{test_incident.id}/responses")).json()
    assert (body["available"], body["reason"]) == (False, "not_linked")


async def test_a_linked_alarm_without_any_response_data_is_absent(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, divera_configured
):
    """A unit key whose /alarms carries no ucr_* fields must not leave an empty block forever."""
    db_session.add(DiveraEmergency(id=uuid4(), divera_id=5000, title="Alarm", attached_to_event_id=test_event.id))
    await db_session.commit()
    body = (await editor_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert (body["available"], body["reason"]) == (False, "no_data")


async def test_a_linked_alarm_nobody_answered_yet_is_available_and_empty(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, divera_configured
):
    item = {"id": 5001, "date": 1791478800, "ucr_addressed": [101, 102], "ucr_answered": [], "ucr_read": []}
    await _alarm(db_session, test_event, None, 5001, item)
    body = (await editor_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert body["available"] is True
    assert body["counts"] == {"coming": 0, "not_coming": 0}
    assert body["people"] == []


async def test_alarms_older_than_six_hours_age_out(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
    divera_configured,
    clock,
):
    await _roster(db_session)
    await _alarm(db_session, test_event, test_incident, 4711, ALARMS["data"]["items"]["4711"])
    clock[0] = ALARM_TIME + timedelta(hours=5, minutes=59)
    assert (await editor_client.get(f"/api/divera/events/{test_event.id}/responses")).json()["available"] is True
    clock[0] = ALARM_TIME + timedelta(hours=6, minutes=1)
    body = (await editor_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    assert (body["available"], body["reason"]) == (False, "no_data")


async def test_checked_out_people_stay_flagged_as_attended(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident, divera_configured
):
    people = await _roster(db_session)
    await _alarm(db_session, test_event, test_incident, 4711, ALARMS["data"]["items"]["4711"])
    now = datetime.now(UTC)
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=people[101].id,
            checked_in=False,
            checked_in_at=now - timedelta(minutes=30),
            checked_out_at=now,
        )
    )
    await db_session.commit()
    body = (await editor_client.get(f"/api/divera/events/{test_event.id}/responses")).json()
    attended = {p["personnel_id"]: p["attended"] for p in body["people"]}
    assert attended[str(people[101].id)] is True  # went home: not «anrückend» again
    assert attended[str(people[103].id)] is False


async def test_an_unattached_pool_alarm_keeps_its_answers(db_session: AsyncSession):
    """Committed although no board shows it yet – attaching it later must find them."""
    emergency = DiveraEmergency(id=uuid4(), divera_id=4711, title="Alarm")
    db_session.add(emergency)
    await db_session.commit()
    changed = await dr.store_snapshots(db_session, {4711: dr.parse_alarm(ALARMS["data"]["items"]["4711"])})
    assert changed == (set(), set())
    await db_session.rollback()  # anything not committed is gone now
    await db_session.refresh(emergency)
    assert emergency.responses_json is not None


async def test_retention_deletes_after_48_hours_and_never_stores_again(
    db_session: AsyncSession, test_event: Event, test_incident: Incident, clock
):
    item = ALARMS["data"]["items"]["4711"]
    emergency = await _alarm(db_session, test_event, test_incident, 4711, item)
    clock[0] = emergency.received_at + timedelta(hours=47)
    assert await dr.purge_expired(db_session) == 0
    clock[0] = emergency.received_at + timedelta(hours=49)
    assert await dr.purge_expired(db_session) == 1
    await db_session.refresh(emergency)
    assert emergency.responses_json is None
    # Divera still lists the alarm: the next poll must not bring the answers back.
    await dr.store_snapshots(db_session, {4711: dr.parse_alarm(item, CATALOGUE)})
    await db_session.refresh(emergency)
    assert emergency.responses_json is None


async def test_archiving_the_ereignis_deletes_its_answers(
    db_session: AsyncSession, test_event: Event, test_incident: Incident
):
    item = ALARMS["data"]["items"]["4711"]
    emergency = await _alarm(db_session, test_event, test_incident, 4711, item)
    assert emergency.responses_json is not None
    await events_crud.archive_event(db_session, test_event.id)
    await db_session.refresh(emergency)
    assert emergency.responses_json is None
    await dr.store_snapshots(db_session, {4711: dr.parse_alarm(item, CATALOGUE)})
    await db_session.refresh(emergency)
    assert emergency.responses_json is None
    # The hourly sweep agrees.
    assert await dr.purge_expired(db_session) == 0


async def test_attaching_an_alarm_tells_the_board(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
):
    emergency = DiveraEmergency(id=uuid4(), divera_id=4800, source="divera", source_id="4800", title="B2 Brand")
    db_session.add(emergency)
    await db_session.commit()
    with (
        patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock),
        patch("app.websocket_manager.broadcast_divera_responses_update", new_callable=AsyncMock) as pushed,
    ):
        response = await editor_client.post(
            f"/api/divera/emergencies/{emergency.id}/attach", json={"event_id": str(test_event.id)}
        )
    assert response.status_code == 201, response.text
    pushed.assert_awaited()
    events, incidents = pushed.await_args.args
    assert events == {test_event.id}
    assert incidents == {UUID(response.json()["id"])}


async def test_unknown_event_and_incident_are_404(editor_client: AsyncClient, divera_configured):
    assert (await editor_client.get(f"/api/divera/events/{uuid4()}/responses")).status_code == 404
    assert (await editor_client.get(f"/api/divera/incidents/{uuid4()}/responses")).status_code == 404


async def test_anonymous_is_refused(client: AsyncClient, test_event: Event, divera_configured):
    assert (await client.get(f"/api/divera/events/{test_event.id}/responses")).status_code == 401


async def test_a_viewer_gets_403_on_both_endpoints(
    viewer_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident, divera_configured
):
    """Editors and admins only, as in KP Front: who is coming is for whoever checks people in."""
    await _roster(db_session)
    await _alarm(db_session, test_event, test_incident, 4711, ALARMS["data"]["items"]["4711"])
    for path in (
        f"/api/divera/events/{test_event.id}/responses",
        f"/api/divera/incidents/{test_incident.id}/responses",
    ):
        response = await viewer_client.get(path)
        assert response.status_code == 403, path
        assert "Muster" not in response.text
