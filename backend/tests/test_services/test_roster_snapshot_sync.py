"""KP Rück's roster-snapshot ingestion against a real schema (services/roster_snapshot_sync.py).

The matching rules are tested pure in ``tests/test_roster_snapshot_ingest.py`` (byte-identical
with KP Front's). This file is the part that is KP Rück's own: a plan lands in ``personnel`` +
``personnel_external_identities``; «deactivated» means unavailable AND marked, so an operator's
own «unavailable» is never undone by a feed; rank keys become role words; nothing is deleted;
a failure leaves the roster and the last good snapshot alone; the cap holds until an admin
releases it; and on a station without a source nothing at all happens.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from app.background import roster_snapshot as bg
from app.config import settings
from app.models import Personnel, PersonnelExternalIdentity, Setting
from app.roster_snapshot import EXAMPLE_SNAPSHOT, medical_shaped
from app.services import roster_snapshot_sync as sync
from app.services.settings import get_all_settings


@pytest.fixture
def source(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "roster.json"
    path.write_text(json.dumps(EXAMPLE_SNAPSHOT), encoding="utf-8")
    monkeypatch.setattr(settings, "roster_snapshot_source", str(path))
    monkeypatch.setattr(settings, "roster_snapshot_token", "")
    return path


def _write(path: Path, doc: dict[str, Any]) -> None:
    path.write_text(json.dumps(doc), encoding="utf-8")


async def _people(db) -> dict[str, Personnel]:
    rows = (await db.execute(select(Personnel))).scalars().all()
    for r in rows:
        await db.refresh(r)
    return {r.name: r for r in rows}


async def _identities(db) -> set[tuple[str, str, str]]:
    names = {p.id: n for n, p in (await _people(db)).items()}
    rows = (await db.execute(select(PersonnelExternalIdentity))).scalars().all()
    return {(names[r.personnel_id], r.provider, r.external_id) for r in rows}


async def test_without_a_source_nothing_is_scheduled(monkeypatch):
    monkeypatch.setattr(settings, "roster_snapshot_source", "")
    bg.start_roster_snapshot_scheduler()
    assert bg.scheduler is None


async def test_a_first_run_creates_people_with_roles_and_identities(db_session, source):
    status = await sync.run(db_session, trigger="manual")

    assert status["outcome"]["created"] == 3
    people = await _people(db_session)
    assert set(people) == {"Muster Hans", "Beispiel Anna", "Dorfmatt Peter"}
    assert people["Muster Hans"].role == "Offizier"  # maj
    assert people["Beispiel Anna"].role == "Wachtmeister"  # wm
    assert all(p.status == "available" for p in people.values())
    idents = await _identities(db_session)
    assert ("Muster Hans", "musterdorf-personalstamm", "pers-0001") in idents
    assert ("Muster Hans", "alarmierung", "4711") in idents
    assert status["lastGood"]["count"] == 4 and status["lastError"] is None


async def test_the_same_file_twice_changes_nothing(db_session, source):
    await sync.run(db_session, trigger="manual")
    before = {n: (p.id, p.role, p.status) for n, p in (await _people(db_session)).items()}
    idents = await _identities(db_session)

    status = await sync.run(db_session, trigger="manual")

    assert status["outcome"]["created"] == 0 and status["outcome"]["updated"] == 0
    assert {n: (p.id, p.role, p.status) for n, p in (await _people(db_session)).items()} == before
    assert await _identities(db_session) == idents
    assert (await sync.run(db_session, trigger="scheduled", skip_unchanged=True))["unchanged"]


async def test_a_divera_linked_person_is_adopted_and_keeps_the_link(db_session, source):
    doc = copy.deepcopy(EXAMPLE_SNAPSHOT)
    doc["people"][0]["identities"] = [{"provider": "divera", "external_id": "4711"}]
    _write(source, doc)
    hans = Personnel(name="Muster Hans", role="Offizier", status="available", tags=[])
    db_session.add(hans)
    await db_session.flush()
    db_session.add(PersonnelExternalIdentity(personnel_id=hans.id, provider="divera", external_id="4711"))
    await db_session.commit()

    await sync.run(db_session, trigger="manual")

    people = await _people(db_session)
    assert people["Muster Hans"].id == hans.id
    idents = await _identities(db_session)
    assert ("Muster Hans", "divera", "4711") in idents
    assert ("Muster Hans", "musterdorf-personalstamm", "pers-0001") in idents


async def test_deactivation_is_unavailable_plus_a_mark_and_never_undoes_an_operator(db_session, source):
    people = [
        {"external_id": f"p{i}", "display_name": f"Person{i:02d} Vorname", "active": True, "identities": []}
        for i in range(6)
    ]
    _write(source, {**EXAMPLE_SNAPSHOT, "people": people, "count": 6})
    await sync.run(db_session, trigger="manual")
    rows = await _people(db_session)
    rows["Person05 Vorname"].status = "unavailable"  # an operator: on holiday, still on the roster
    await db_session.commit()

    # p0 leaves (inactive in the file)
    people[0] = {**people[0], "active": False}
    _write(source, {**EXAMPLE_SNAPSHOT, "people": people, "count": 6, "generated_at": "2026-08-03T04:00:00+00:00"})
    status = await sync.run(db_session, trigger="manual")
    assert status["outcome"]["deactivated"] == 1
    rows = await _people(db_session)
    assert rows["Person00 Vorname"].status == "unavailable"
    assert rows["Person05 Vorname"].status == "unavailable"  # untouched, and not «re-activated» below

    # p0 comes back
    people[0] = {**people[0], "active": True}
    _write(source, {**EXAMPLE_SNAPSHOT, "people": people, "count": 6, "generated_at": "2026-08-04T04:00:00+00:00"})
    await sync.run(db_session, trigger="manual")
    rows = await _people(db_session)
    assert rows["Person00 Vorname"].status == "available"
    assert rows["Person05 Vorname"].status == "unavailable"
    assert len(rows) == 6  # nobody deleted, nobody duplicated


async def test_a_failed_fetch_keeps_the_roster_and_the_last_good_snapshot(db_session, source):
    await sync.run(db_session, trigger="manual")
    good = (await sync.read_status(db_session))["lastGood"]
    roster = {n: p.status for n, p in (await _people(db_session)).items()}

    source.unlink()
    status = await sync.run(db_session, trigger="scheduled")

    assert status["lastError"] == "file not found"
    assert status["lastGood"] == good
    assert {n: p.status for n, p in (await _people(db_session)).items()} == roster


async def test_an_invalid_file_changes_nothing(db_session, source):
    _write(source, {**EXAMPLE_SNAPSHOT, "count": 99})
    status = await sync.run(db_session, trigger="manual")
    assert "count" in status["outcome"]["refused"]
    assert await _people(db_session) == {}


async def test_a_medical_key_writes_nothing_and_stores_nothing_medical(db_session, source):
    doc = copy.deepcopy(EXAMPLE_SNAPSHOT)
    doc["people"][0]["tauglichkeit_bis"] = "2027-01-01"
    _write(source, doc)

    status = await sync.run(db_session, trigger="manual")

    assert "medical" in status["outcome"]["refused"]
    assert await _people(db_session) == {}

    def keys(node: Any) -> list[str]:
        if isinstance(node, dict):
            return [str(k) for k in node] + [k for v in node.values() for k in keys(v)]
        if isinstance(node, list):
            return [k for v in node for k in keys(v)]
        return []

    stored = await sync.read_status(db_session)
    assert [k for k in keys(stored) if medical_shaped(k)] == []
    assert "2027-01-01" not in json.dumps(stored)


async def test_the_cap_holds_until_an_admin_releases_it(db_session, admin_client, source):
    people = [
        {"external_id": f"p{i}", "display_name": f"Person{i:02d} Vorname", "active": True, "identities": []}
        for i in range(10)
    ]
    _write(source, {**EXAMPLE_SNAPSHOT, "people": people, "count": 10})
    await sync.run(db_session, trigger="manual")
    _write(source, {**EXAMPLE_SNAPSHOT, "people": people[:6], "count": 6, "generated_at": "2026-08-03T04:00:00+00:00"})

    status = await sync.run(db_session, trigger="scheduled")
    assert status["held"] is True and status["pendingDeactivations"] == 4
    assert all(p.status == "available" for p in (await _people(db_session)).values())

    r = await admin_client.get("/api/integrations/roster-snapshot")
    assert r.status_code == 200 and r.json()["status"]["held"] is True

    r = await admin_client.post("/api/integrations/roster-snapshot/sync", json={"force": True})
    assert r.status_code == 200, r.text
    assert r.json()["outcome"]["deactivated"] == 4
    assert sum(p.status == "available" for p in (await _people(db_session)).values()) == 6


async def test_sync_is_admin_only(editor_client, source):
    r = await editor_client.post("/api/integrations/roster-snapshot/sync", json={})
    assert r.status_code == 403


async def test_the_status_row_stays_out_of_the_settings_page(db_session, source):
    await sync.run(db_session, trigger="manual")
    assert (await db_session.execute(select(Setting).where(Setting.key == sync.STATUS_KEY))).scalar_one()
    assert sync.STATUS_KEY not in await get_all_settings(db_session)


async def test_the_registry_reports_the_source(source):
    from app.api.integrations import integrations

    reg = integrations()
    entry = next(p for p in reg.known_providers if p.provider == "roster-snapshot")
    assert entry.implemented is True and entry.configured is True
