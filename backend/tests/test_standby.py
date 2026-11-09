"""The standby mirror: which replicated rows the guards let through, and the takeover.

The guards are replica-only triggers, so the tests drive them the way the replication apply
worker does: in a session with `session_replication_role = replica`. Postgres fires exactly the
same triggers there, on the real schema, without needing a second database.
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from alembic.config import Config
from alembic.script import ScriptDirectory
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Event, Incident, Setting
from app.standby import event_links, install_guards, mirror_state, schema_covers, take_over

BACKEND = Path(__file__).resolve().parents[1]


async def _driver(db: AsyncSession) -> asyncpg.Connection:
    raw = await (await db.connection()).get_raw_connection()
    conn: asyncpg.Connection = raw.driver_connection
    return conn


async def _as_replication(conn: asyncpg.Connection, sql: str, *args: object) -> None:
    """Run one statement the way the apply worker does – only then do the guards fire."""
    await conn.execute("SET LOCAL session_replication_role = replica")
    await conn.execute(sql, *args)
    await conn.execute("SET LOCAL session_replication_role = origin")


def _incident(event: Event, title: str) -> Incident:
    return Incident(
        id=uuid4(),
        event_id=event.id,
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address="Dorfstrasse 4",
        status="incoming",
    )


@pytest_asyncio.fixture
async def two_events(db_session: AsyncSession) -> tuple[Event, Event, Incident, Incident]:
    """Two Ereignisse with one Einsatz each, on a box whose guards are installed."""
    a = Event(id=uuid4(), name="Unwetter", training_flag=False, created_at=datetime.now(UTC))
    b = Event(id=uuid4(), name="Übung", training_flag=True, created_at=datetime.now(UTC))
    db_session.add_all([a, b])
    await db_session.flush()
    ia, ib = _incident(a, "Keller A"), _incident(b, "Keller B")
    db_session.add_all([ia, ib])
    await db_session.flush()
    await install_guards(await _driver(db_session))
    return a, b, ia, ib


async def _titles(conn: asyncpg.Connection) -> dict[str, str]:
    return {
        r["event"]: r["title"]
        for r in await conn.fetch("SELECT e.name AS event, i.title FROM incidents i JOIN events e ON e.id = i.event_id")
    }


@pytest.mark.asyncio
async def test_a_detached_event_ignores_the_hosted_board_and_the_rest_keeps_mirroring(db_session, two_events):
    a, _, ia, _ = two_events
    conn = await _driver(db_session)
    await take_over(conn, a.id, "editor")

    await _as_replication(conn, "UPDATE incidents SET title = title || ' (hosted)'")
    await _as_replication(conn, "DELETE FROM incidents WHERE id = $1", ia.id)

    assert await _titles(conn) == {"Unwetter": "Keller A", "Übung": "Keller B (hosted)"}


@pytest.mark.asyncio
async def test_rows_reached_through_an_einsatz_follow_its_ereignis(db_session, two_events, test_editor):
    a, _, ia, ib = two_events
    conn = await _driver(db_session)
    await take_over(conn, a.id, "editor")
    person_id = await conn.fetchval(
        "INSERT INTO personnel (id, name, role, role_sort_order, status) VALUES ($1, 'Muster Hans', 'Mannschaft', 0, 'available') RETURNING id",
        uuid4(),
    )

    for incident in (ia, ib):
        await _as_replication(
            conn,
            "INSERT INTO incident_assignments "
            "(id, incident_id, resource_type, resource_id, assigned_by, driver_stay, is_leader) "
            "VALUES ($1, $2, 'personnel', $3, $4, false, false)",
            uuid4(),
            incident.id,
            person_id,
            test_editor.id,
        )

    assigned = {r["incident_id"] for r in await conn.fetch("SELECT incident_id FROM incident_assignments")}
    assert assigned == {ib.id}


@pytest.mark.asyncio
async def test_the_box_keeps_its_own_settings_and_a_default_it_wrote_first_gives_way(db_session):
    db_session.add_all([Setting(key="map_mode", value="auto"), Setting(key="funkrufname", value="Box")])
    await db_session.flush()
    conn = await _driver(db_session)
    await install_guards(conn)

    await _as_replication(conn, "UPDATE settings SET value = 'online' WHERE key = 'map_mode'")
    await _as_replication(conn, "INSERT INTO settings (key, value) VALUES ('funkrufname', 'Omega')")

    values = {r["key"]: r["value"] for r in await conn.fetch("SELECT key, value FROM settings")}
    assert values["map_mode"] == "auto"
    assert values["funkrufname"] == "Omega"


@pytest.mark.asyncio
async def test_the_boxs_own_writes_are_never_filtered(db_session, two_events):
    a, _, ia, _ = two_events
    conn = await _driver(db_session)
    await take_over(conn, a.id, "editor")

    await conn.execute("UPDATE incidents SET title = 'vor Ort geändert' WHERE id = $1", ia.id)

    assert (await _titles(conn))["Unwetter"] == "vor Ort geändert"


@pytest.mark.asyncio
async def test_the_boxs_own_journal_rows_never_take_a_seq_the_hosted_board_hands_out(db_session, two_events):
    """Replication carries `journal_entries.seq` values but not the sequence behind them."""
    a, *_ = two_events
    conn = await _driver(db_session)
    insert = "INSERT INTO journal_entries (id, event_id, kind, text) VALUES ($1, $2, 'manual', 'x') RETURNING seq"
    mirrored = "INSERT INTO journal_entries (id, seq, event_id, kind, text) VALUES ($1, $2, $3, 'manual', 'mirrored')"
    # A fresh box: its own sequence would hand out exactly the values the hosted board has
    # already given out when its rows replicate in. (Sequences outlive a test's rollback, so
    # it is put back to that state here.)
    start = await conn.fetchval("SELECT COALESCE(max(seq) FILTER (WHERE seq < 10^15), 0) + 1 FROM journal_entries")
    await conn.execute("SELECT setval(pg_get_serial_sequence('public.journal_entries', 'seq'), $1, false)", start)
    for seq in range(start, start + 3):
        await _as_replication(conn, mirrored, uuid4(), seq, a.id)

    await install_guards(conn)
    await take_over(conn, a.id, "editor")
    own = await conn.fetchval(insert, uuid4(), a.id)
    # Far above anything the hosted board will reach, so its next rows replicate in as well.
    assert own >= 10**15
    await _as_replication(conn, mirrored, uuid4(), start + 3, a.id)
    assert own < 2**53  # still exact as a JavaScript number


@pytest.mark.asyncio
async def test_event_links_follow_the_schema(db_session):
    links = await event_links(await _driver(db_session))

    assert links["incidents"] == "{row}.event_id"
    assert "public.incidents" in links["incident_assignments"]
    assert "public.incident_groups" in links["incident_group_assignments"]
    assert links["journal_entries"] == "{row}.event_id"
    assert "personnel" not in links and "settings" not in links


def test_schema_covers_only_ancestors():
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    head = script.get_current_head()
    parent = script.get_revision(head).down_revision

    assert schema_covers(script, head, head)
    assert schema_covers(script, head, parent)
    assert not schema_covers(script, parent, head)
    assert not schema_covers(script, head, "f00000000000")


# --- the endpoints and the look-only guard --------------------------------------------------


@pytest.fixture
def standby_role(monkeypatch, db_session):
    monkeypatch.setenv("DEPLOYMENT_ROLE", "standby")
    monkeypatch.setattr("app.middleware.standby_readonly.CACHE_SECONDS", 0)
    monkeypatch.setattr(
        "app.middleware.standby_readonly.async_session_maker",
        async_sessionmaker(bind=db_session.bind, expire_on_commit=False, join_transaction_mode="create_savepoint"),
    )


@pytest.mark.asyncio
async def test_a_hosted_board_is_no_mirror_and_has_nothing_to_take_over(editor_client: AsyncClient, two_events):
    a, *_ = two_events
    assert (await editor_client.get("/api/standby")).json() == {"mirror": False, "leads": []}
    assert (await editor_client.post(f"/api/standby/events/{a.id}/takeover")).status_code == 404


@pytest.mark.asyncio
async def test_the_mirror_is_look_only_until_an_ereignis_is_taken_offline(
    editor_client: AsyncClient, db_session, two_events, standby_role
):
    a, *_ = two_events
    write = {"name": "Neu Person", "role": "Mannschaft"}

    refused = await editor_client.post("/api/personnel/", json=write)
    assert refused.status_code == 403
    assert refused.json()["code"] == "standby_read_only"

    taken = await editor_client.post(f"/api/standby/events/{a.id}/takeover")
    assert taken.status_code == 200
    assert [d["event_id"] for d in taken.json()["detached"]] == [str(a.id)]
    assert (await editor_client.post("/api/personnel/", json=write)).status_code != 403

    state = await mirror_state(await _driver(db_session))
    assert set(state.detached) == {a.id}


@pytest.mark.asyncio
async def test_a_viewer_cannot_take_an_ereignis_offline(viewer_client: AsyncClient, two_events, standby_role):
    a, *_ = two_events
    assert (await viewer_client.post(f"/api/standby/events/{a.id}/takeover")).status_code == 403


@pytest.mark.asyncio
async def test_the_status_says_how_current_the_mirror_is(client: AsyncClient, db_session, standby_role):
    await install_guards(await _driver(db_session))

    body = (await client.get("/api/standby")).json()

    assert body["mirror"] is True
    assert body["configured"] is False  # no subscription in the test database
    assert body["current"] is False
    assert body["detached"] == []


@pytest.mark.asyncio
async def test_an_ereignis_created_on_the_mirror_is_offline_from_the_start(
    editor_client: AsyncClient, db_session, standby_role
):
    await install_guards(await _driver(db_session))

    created = await editor_client.post("/api/events/", json={"name": "Brand Magazin", "training_flag": False})

    assert created.status_code in (200, 201)
    state = await mirror_state(await _driver(db_session))
    assert str(next(iter(state.detached))) == created.json()["id"]
    # Led here from its first row, so the sync takes it to the hosted board.
    assert {str(e): lead.holder for e, lead in state.leads.items()} == {created.json()["id"]: "standby"}


@pytest.mark.asyncio
async def test_a_takeover_leads_here_records_who_and_writes_a_tagebuch_line(
    editor_client: AsyncClient, db_session, two_events, standby_role
):
    a, *_ = two_events

    body = (await editor_client.post(f"/api/standby/events/{a.id}/takeover")).json()

    [lead] = body["leads"]
    assert (lead["event_id"], lead["holder"]) == (str(a.id), "standby")
    conn = await _driver(db_session)
    assert await conn.fetchval("SELECT text FROM journal_entries WHERE event_id = $1 AND kind = 'manual'", a.id) == (
        "Führung übernommen auf KP Rück Offline"
    )
    # The state both systems agree on is what the box held at that moment.
    assert (
        await conn.fetchval("SELECT count(*) FROM standby.shadow WHERE event_id = $1 AND tbl = 'incidents'", a.id) == 1
    )


# --- the hosted board's side ------------------------------------------------------------------


@pytest.fixture
def sync_token(monkeypatch):
    monkeypatch.setattr("app.api.standby.settings.standby_sync_token", "s3cret-token-for-tests")
    return {"Authorization": "Bearer s3cret-token-for-tests"}


async def _led_by_box(db_session, event: Event) -> None:
    conn = await _driver(db_session)
    await conn.execute(
        "INSERT INTO event_leads (event_id, holder, since, taken_by) VALUES ($1, 'standby', now(), 'Koch René')",
        event.id,
    )


@pytest.mark.asyncio
async def test_the_sync_endpoint_does_not_exist_without_the_token(client: AsyncClient, two_events, sync_token):
    a, *_ = two_events
    body = {"event_id": str(a.id), "ops": []}

    assert (await client.post("/api/standby/sync", json=body)).status_code == 404
    assert (
        await client.post("/api/standby/sync", json=body, headers={"Authorization": "Bearer nope"})
    ).status_code == 404


@pytest.mark.asyncio
async def test_the_box_writes_its_ereignis_and_is_heard(client: AsyncClient, db_session, two_events, sync_token):
    a, _, ia, _ = two_events
    await _led_by_box(db_session, a)
    conn = await _driver(db_session)
    await conn.execute("SET TIME ZONE 'UTC'")
    current = await conn.fetchval("SELECT to_jsonb(i)::text FROM incidents i WHERE id = $1", ia.id)
    row = json.loads(current)
    op = {"table": "incidents", "id": str(ia.id), "row": {**row, "title": "Keller A (Magazin)"}, "expected": row}

    answer = await client.post(
        "/api/standby/sync", json={"event_id": str(a.id), "ops": [op], "pending": 3}, headers=sync_token
    )

    assert answer.json() == {"results": ["ok"]}
    assert (await _titles(conn))["Unwetter"] == "Keller A (Magazin)"
    [lead] = (await client.get("/api/standby")).json()["leads"]
    assert lead["pending"] == 3 and lead["contact_at"] is not None


@pytest.mark.asyncio
async def test_the_box_cannot_write_an_ereignis_it_never_took_over(client: AsyncClient, two_events, sync_token):
    a, *_ = two_events
    answer = await client.post("/api/standby/sync", json={"event_id": str(a.id), "ops": []}, headers=sync_token)
    assert answer.status_code == 403


@pytest.mark.asyncio
async def test_hier_uebernehmen_takes_it_back_only_from_the_box(editor_client: AsyncClient, db_session, two_events):
    a, b, *_ = two_events
    await _led_by_box(db_session, a)

    taken = await editor_client.post(f"/api/standby/events/{a.id}/lead")
    assert taken.status_code == 200
    assert [lead["holder"] for lead in taken.json()["leads"]] == ["hosted"]
    assert (await editor_client.post(f"/api/standby/events/{a.id}/lead")).status_code == 409
    assert (await editor_client.post(f"/api/standby/events/{b.id}/lead")).status_code == 409
    conn = await _driver(db_session)
    assert await conn.fetchval("SELECT text FROM journal_entries WHERE event_id = $1 AND kind = 'manual'", a.id) == (
        "Führung übernommen auf KP Rück Online"
    )


async def _conflict(db_session, event: Event, incident: Incident, kind: str = "field", **extra: object) -> str:
    conn = await _driver(db_session)
    columns = {"title": {"kept": incident.title, "lost": "Keller (Handy)", "text": True}}
    conflict_id = uuid4()
    await conn.execute(
        """
        INSERT INTO event_conflicts (id, event_id, table_name, row_id, kind, kept_on, deleted_on, columns, row)
        VALUES ($1, $2, 'incidents', $3, $4, 'hosted', $5, $6::jsonb, $7::jsonb)
        """,
        conflict_id,
        event.id,
        incident.id,
        kind,
        extra.get("deleted_on"),
        json.dumps(columns) if kind == "field" else None,
        json.dumps(extra.get("row")) if extra.get("row") else None,
    )
    return str(conflict_id)


@pytest.mark.asyncio
async def test_a_conflict_is_decided_where_the_ereignis_is_led(editor_client: AsyncClient, db_session, two_events):
    a, _, ia, _ = two_events
    conflict = await _conflict(db_session, a, ia)

    listed = (await editor_client.get(f"/api/standby/events/{a.id}/conflicts")).json()
    assert listed["decidable"] is True and listed["conflicts"][0]["columns"]["title"]["lost"] == "Keller (Handy)"

    both = await editor_client.post(
        f"/api/standby/conflicts/{conflict}/resolve",
        json={"choice": "both", "text": {"title": "Keller A / Keller (Handy)"}},
    )
    assert both.status_code == 200
    conn = await _driver(db_session)
    assert (await _titles(conn))["Unwetter"] == "Keller A / Keller (Handy)"
    assert (
        await editor_client.post(f"/api/standby/conflicts/{conflict}/resolve", json={"choice": "kept"})
    ).status_code == 409


@pytest.mark.asyncio
async def test_a_conflict_cannot_be_decided_on_the_system_that_follows(
    editor_client: AsyncClient, db_session, two_events
):
    a, _, ia, _ = two_events
    await _led_by_box(db_session, a)
    conflict = await _conflict(db_session, a, ia)

    assert (await editor_client.get(f"/api/standby/events/{a.id}/conflicts")).json()["decidable"] is False
    answer = await editor_client.post(f"/api/standby/conflicts/{conflict}/resolve", json={"choice": "other"})
    assert answer.status_code == 409


@pytest.mark.asyncio
async def test_taking_the_other_version_of_a_deleted_einsatz_deletes_it_here_too(
    editor_client: AsyncClient, db_session, two_events
):
    a, _, ia, _ = two_events
    conflict = await _conflict(db_session, a, ia, kind="deleted", deleted_on="standby")

    answer = await editor_client.post(f"/api/standby/conflicts/{conflict}/resolve", json={"choice": "other"})

    assert answer.status_code == 200
    assert "Unwetter" not in await _titles(await _driver(db_session))
