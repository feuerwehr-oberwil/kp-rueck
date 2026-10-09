"""Einsatztagebuch API: read, append a manual line, correct one — append-only."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


def _cid() -> str:
    return uuid.uuid4().hex


async def test_read_returns_the_automatic_rows(editor_client: AsyncClient, test_incident: Incident):
    response = await editor_client.get(f"/api/events/{test_incident.event_id}/journal")
    assert response.status_code == 200
    body = response.json()
    (row,) = body["entries"]
    assert row["kind"] == "incident"
    assert row["category"] == "status"
    assert row["incident_title"] == "Wohnungsbrand"
    assert body["latest_seq"] == row["seq"]


async def test_unknown_event_is_404(editor_client: AsyncClient):
    response = await editor_client.get(f"/api/events/{uuid.uuid4()}/journal")
    assert response.status_code == 404


async def test_manual_line_without_and_with_incident(editor_client: AsyncClient, test_incident: Incident):
    url = f"/api/events/{test_incident.event_id}/journal"
    free = await editor_client.post(url, json={"client_id": _cid(), "text": "  Gemeindepräsident informiert "})
    assert free.status_code == 201, free.text
    assert free.json()["text"] == "Gemeindepräsident informiert"
    assert free.json()["incident_id"] is None
    assert free.json()["author_name"] == "fixture_editor"
    assert free.json()["category"] == "manual"

    linked = await editor_client.post(
        url, json={"client_id": _cid(), "text": "Anwohner evakuiert", "incident_id": str(test_incident.id)}
    )
    assert linked.status_code == 201
    assert linked.json()["incident_title"] == "Wohnungsbrand"


async def test_a_retried_post_writes_once(editor_client: AsyncClient, test_event: Event):
    url = f"/api/events/{test_event.id}/journal"
    cid = _cid()
    first = await editor_client.post(url, json={"client_id": cid, "text": "Strom Quartier Nord aus"})
    again = await editor_client.post(url, json={"client_id": cid, "text": "Strom Quartier Nord aus"})
    assert first.json()["id"] == again.json()["id"]
    rows = (await editor_client.get(url)).json()["entries"]
    assert [r["text"] for r in rows] == ["Strom Quartier Nord aus"]


async def test_incident_of_another_event_is_refused(
    editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession
):
    other = Event(id=uuid.uuid4(), name="Anderes Ereignis")
    db_session.add(other)
    await db_session.commit()
    response = await editor_client.post(
        f"/api/events/{other.id}/journal",
        json={"client_id": _cid(), "text": "x", "incident_id": str(test_incident.id)},
    )
    assert response.status_code == 422


async def test_empty_line_is_refused(editor_client: AsyncClient, test_event: Event):
    response = await editor_client.post(
        f"/api/events/{test_event.id}/journal", json={"client_id": _cid(), "text": "   "}
    )
    assert response.status_code == 422


async def test_a_viewer_reads_but_cannot_write(viewer_client: AsyncClient, test_event: Event):
    url = f"/api/events/{test_event.id}/journal"
    assert (await viewer_client.get(url)).status_code == 200
    assert (await viewer_client.post(url, json={"client_id": _cid(), "text": "x"})).status_code == 403


async def test_correction_appends_and_points_at_the_original(editor_client: AsyncClient, test_event: Event):
    url = f"/api/events/{test_event.id}/journal"
    original = (await editor_client.post(url, json={"client_id": _cid(), "text": "Strom Nord aus"})).json()
    fix1 = await editor_client.post(
        f"{url}/{original['id']}/corrections", json={"client_id": _cid(), "text": "Strom Süd aus"}
    )
    assert fix1.status_code == 201
    assert fix1.json()["corrects_id"] == original["id"]
    # a correction of the correction still points at the ORIGINAL line
    fix2 = await editor_client.post(
        f"{url}/{fix1.json()['id']}/corrections", json={"client_id": _cid(), "text": "Strom Süd und Ost aus"}
    )
    assert fix2.json()["corrects_id"] == original["id"]
    texts = [r["text"] for r in (await editor_client.get(url)).json()["entries"]]
    # nothing was overwritten
    assert texts == ["Strom Nord aus", "Strom Süd aus", "Strom Süd und Ost aus"]


async def test_automatic_rows_cannot_be_corrected(editor_client: AsyncClient, test_incident: Incident):
    url = f"/api/events/{test_incident.event_id}/journal"
    (auto,) = (await editor_client.get(url)).json()["entries"]
    response = await editor_client.post(f"{url}/{auto['id']}/corrections", json={"client_id": _cid(), "text": "x"})
    assert response.status_code == 422


async def test_since_seq_returns_what_is_new_plus_the_recent_overlap(editor_client: AsyncClient, test_event: Event):
    url = f"/api/events/{test_event.id}/journal"
    await editor_client.post(url, json={"client_id": _cid(), "text": "eins"})
    cursor = (await editor_client.get(url)).json()["latest_seq"]
    await editor_client.post(url, json={"client_id": _cid(), "text": "zwei"})
    page = (await editor_client.get(url, params={"since_seq": cursor})).json()
    # «zwei» is new; «eins» comes again because it is recent (services/journal.OVERLAP) —
    # the client merges by id. That is what keeps a late-committed row from being skipped.
    assert [r["text"] for r in page["entries"]] == ["eins", "zwei"]
    assert page["latest_seq"] > cursor
    # the cursor never goes backwards, even on an empty page
    empty = (await editor_client.get(url, params={"since_seq": page["latest_seq"] + 1000})).json()
    assert empty["latest_seq"] == page["latest_seq"] + 1000


async def test_there_is_no_edit_or_delete(editor_client: AsyncClient, test_event: Event):
    url = f"/api/events/{test_event.id}/journal"
    row = (await editor_client.post(url, json={"client_id": _cid(), "text": "eins"})).json()
    assert (await editor_client.delete(f"{url}/{row['id']}")).status_code in (404, 405)
    assert (await editor_client.put(f"{url}/{row['id']}", json={"text": "x"})).status_code in (404, 405)


async def test_same_id_with_a_different_line_is_a_conflict(editor_client: AsyncClient, test_event: Event):
    url = f"/api/events/{test_event.id}/journal"
    cid = _cid()
    assert (await editor_client.post(url, json={"client_id": cid, "text": "Strom Nord aus"})).status_code == 201
    edited = await editor_client.post(url, json={"client_id": cid, "text": "Strom Süd aus"})
    assert edited.status_code == 409
    texts = [r["text"] for r in (await editor_client.get(url)).json()["entries"]]
    assert texts == ["Strom Nord aus"]


async def test_two_copies_racing_into_the_index_answer_with_one_row(
    editor_client: AsyncClient, test_event: Event, db_session: AsyncSession, monkeypatch
):
    """The pre-check sees nothing (the other copy has not committed yet), the insert hits
    the unique index — the answer is the row the other copy wrote, not a 500."""
    from app.api import journal as journal_api
    from app.models import JournalEntry

    cid = _cid()
    db_session.add(JournalEntry(event_id=test_event.id, kind="manual", text="Doppelt getippt", client_id=cid))
    await db_session.commit()

    real = journal_api._by_client_id
    calls = {"n": 0}

    async def blind_first(db, event_id, client_id):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(db, event_id, client_id)

    monkeypatch.setattr(journal_api, "_by_client_id", blind_first)
    response = await editor_client.post(
        f"/api/events/{test_event.id}/journal", json={"client_id": cid, "text": "Doppelt getippt"}
    )
    assert response.status_code == 201, response.text
    assert response.json()["text"] == "Doppelt getippt"
    assert calls["n"] == 2
    # (read straight from the session: the request's rollback expired the shared test
    # session's objects, which a second request through the app would trip over)
    from sqlalchemy import func, select

    count = await db_session.scalar(select(func.count()).where(JournalEntry.client_id == cid))
    assert count == 1


async def test_a_deleted_einsatz_is_marked(
    editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession
):
    from datetime import UTC, datetime

    test_incident.deleted_at = datetime.now(UTC)
    await db_session.commit()
    (row,) = (await editor_client.get(f"/api/events/{test_incident.event_id}/journal")).json()["entries"]
    assert row["incident_deleted"] is True
    assert row["incident_title"] == "Wohnungsbrand"
