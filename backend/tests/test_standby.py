"""The standby mirror: which replicated rows the guards let through, and the takeover.

The guards are replica-only triggers, so the tests drive them the way the replication apply
worker does: in a session with `session_replication_role = replica`. Postgres fires exactly the
same triggers there, on the real schema, without needing a second database.
"""

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
from app.standby import detach_event, event_links, install_guards, mirror_state, schema_covers

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
    await detach_event(conn, a.id, "editor")

    await _as_replication(conn, "UPDATE incidents SET title = title || ' (hosted)'")
    await _as_replication(conn, "DELETE FROM incidents WHERE id = $1", ia.id)

    assert await _titles(conn) == {"Unwetter": "Keller A", "Übung": "Keller B (hosted)"}


@pytest.mark.asyncio
async def test_rows_reached_through_an_einsatz_follow_its_ereignis(db_session, two_events, test_editor):
    a, _, ia, ib = two_events
    conn = await _driver(db_session)
    await detach_event(conn, a.id, "editor")
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
    await detach_event(conn, a.id, "editor")

    await conn.execute("UPDATE incidents SET title = 'vor Ort geändert' WHERE id = $1", ia.id)

    assert (await _titles(conn))["Unwetter"] == "vor Ort geändert"


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
    assert (await editor_client.get("/api/standby")).json() == {"mirror": False}
    assert (await editor_client.post(f"/api/standby/events/{a.id}/takeover")).status_code == 404


@pytest.mark.asyncio
async def test_the_mirror_is_look_only_until_an_ereignis_is_taken_offline(
    editor_client: AsyncClient, db_session, two_events, standby_role
):
    a, *_ = two_events
    write = {"name": "Neu", "training_flag": False}

    refused = await editor_client.post("/api/events/", json=write)
    assert refused.status_code == 403
    assert refused.json()["code"] == "standby_read_only"

    taken = await editor_client.post(f"/api/standby/events/{a.id}/takeover")
    assert taken.status_code == 200
    assert [d["event_id"] for d in taken.json()["detached"]] == [str(a.id)]
    assert (await editor_client.post("/api/events/", json=write)).status_code != 403

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
