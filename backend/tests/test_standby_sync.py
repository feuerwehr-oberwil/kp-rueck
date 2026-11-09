"""The two-way standby sync: the merge rules the owner picked (09.11.2026), then a real round.

The merge is pure, so the rules are pinned on plain rows first. The round runs against two
real databases – the test database as the box, a scratch one as the hosted board – with the
push going straight into the hosted database through the same `apply_ops` its endpoint runs.
"""

import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base
from app.standby import install_guards, take_over
from app.standby_sync import (
    CONFLICTS,
    HOSTED,
    LEADS,
    STANDBY,
    LeadMovedError,
    Op,
    apply_ops,
    event_tables,
    fetch_rows,
    merge,
    settle_lead,
    sync_event,
)
from tests.conftest import create_scratch_database, drop_scratch_database, worker_database_url

EVENT = str(uuid.uuid4())
NOW = "2026-11-09T20:12:00+00:00"


def _incident(**over: object) -> dict:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "event_id": EVENT,
        "number": 7,
        "description": "Unterführung überflutet.",
        "status": "reko",
        "updated_at": "2026-11-09T19:40:00+00:00",
        **over,
    }


def _key(row: dict) -> tuple[str, str]:
    return ("incidents", row["id"])


def _merge(base: list[dict], lead: list[dict], other: list[dict], leader: str = STANDBY):
    rows = lambda rs: {_key(r): r for r in rs}
    return merge(rows(base), rows(lead), rows(other), event_id=EVENT, leader=leader, now=NOW)


def _conflicts(plan) -> list[dict]:
    return [op.row for op in plan.to_leader if op.table == CONFLICTS]


# --- the rules ---------------------------------------------------------------------------------


def test_different_fields_of_one_einsatz_are_both_kept():
    base = _incident()
    box = _incident(description="Fahrer gerettet, Auto bleibt.")
    phone = _incident(status="enroute")

    plan = _merge([base], [box], [phone])

    assert plan.merged[_key(base)] == _incident(description="Fahrer gerettet, Auto bleibt.", status="enroute")
    assert plan.conflicts == 0


def test_a_change_the_leader_never_touched_is_taken():
    base = _incident()
    plan = _merge([base], [base], [_incident(status="returning")])

    assert plan.merged[_key(base)]["status"] == "returning"
    assert [op.row["status"] for op in plan.to_leader if op.table == "incidents"] == ["returning"]
    assert plan.to_follower == []


def test_the_same_field_on_both_keeps_the_leaders_value_and_records_the_other():
    base = _incident()
    box = _incident(description="Fahrer gerettet, Auto bleibt.")
    phone = _incident(description="Polizei sperrt beidseitig.")

    plan = _merge([base], [box], [phone])

    assert plan.merged[_key(base)]["description"] == "Fahrer gerettet, Auto bleibt."
    [conflict] = _conflicts(plan)
    assert conflict["kind"] == "field" and conflict["kept_on"] == STANDBY
    assert conflict["columns"]["description"]["lost"] == "Polizei sperrt beidseitig."
    assert conflict["subject"] == {"incident_id": base["id"], "number": 7, "address": None}
    # The conflict is written to both systems.
    assert [op.table for op in plan.to_follower].count(CONFLICTS) == 1


def test_new_rows_from_either_side_are_added_to_the_other():
    mine, theirs = _incident(id=str(uuid.uuid4()), number=21), _incident(id=str(uuid.uuid4()), number=22)

    plan = _merge([], [mine], [theirs])

    assert [op.id for op in plan.to_follower] == [mine["id"]]
    assert [op.id for op in plan.to_leader] == [theirs["id"]]


def test_a_deletion_stands_when_the_other_side_did_not_touch_the_row():
    base = _incident()
    plan = _merge([base], [base], [])

    assert plan.merged[_key(base)] is None
    assert plan.to_leader == [Op("incidents", base["id"], None, base)]


def test_deleted_on_the_other_side_but_changed_by_the_leader_stays_and_is_a_conflict():
    base = _incident()
    box = _incident(description="Wasser bis 60 cm.")

    plan = _merge([base], [box], [])

    assert plan.merged[_key(base)] == box
    assert plan.to_follower[0] == Op("incidents", base["id"], box, None)
    [conflict] = _conflicts(plan)
    assert conflict["kind"] == "deleted" and conflict["deleted_on"] == HOSTED


def test_deleted_by_the_leader_but_changed_on_the_other_side_is_gone_and_is_a_conflict():
    base = _incident()
    phone = _incident(description="Noch Wasser im Keller.")

    plan = _merge([base], [], [phone])

    assert plan.merged[_key(base)] is None
    [conflict] = _conflicts(plan)
    assert conflict["deleted_on"] == STANDBY and conflict["row"] == phone


def test_a_clash_found_again_is_the_same_conflict_and_is_not_listed_twice():
    """A losing write that keeps failing leaves the clash in place: every round finds it again
    (about twelve times a minute). It must be one row in the list, not one per round."""
    base, mine, theirs = _incident(), _incident(description="Box."), _incident(description="Hosted.")
    rows = lambda *rs: {_key(r): r for r in rs}
    plan = lambda lead, now: merge(rows(base), lead, rows(theirs), event_id=EVENT, leader=STANDBY, now=now)

    [first] = _conflicts(plan(rows(mine), NOW))
    [again] = _conflicts(plan(rows(mine), "2026-11-09T20:12:05+00:00"))
    assert again["id"] == first["id"]

    recorded = {**rows(mine), (CONFLICTS, first["id"]): first}
    assert _conflicts(plan(recorded, "2026-11-09T20:12:10+00:00")) == []


def test_bookkeeping_takes_the_later_value_and_never_clashes():
    base = _incident()
    plan = _merge(
        [base],
        [_incident(updated_at="2026-11-09T19:50:00+00:00")],
        [_incident(updated_at="2026-11-09T19:51:00.5+00:00")],
    )

    assert plan.merged[_key(base)]["updated_at"] == "2026-11-09T19:51:00.5+00:00"
    assert plan.conflicts == 0


def test_a_column_only_one_schema_has_never_clashes():
    base = _incident()
    newer = {**_incident(), "new_column": "x"}

    plan = _merge([base], [base], [newer])

    assert plan.merged[_key(base)]["new_column"] == "x"
    assert plan.conflicts == 0


def test_the_later_takeover_leads():
    box = {"holder": STANDBY, "since": "2026-11-09T19:42:00+00:00"}
    back = {"holder": HOSTED, "since": "2026-11-09T20:02:00+00:00"}

    assert settle_lead(box, back) == back
    assert settle_lead({**box, "since": "2026-11-09T20:05:00+00:00"}, back)["holder"] == STANDBY
    assert settle_lead(None, box) == box


def test_an_einsatz_number_given_out_on_both_sides_is_renumbered_with_a_tagebuch_line():
    box = _incident(id=str(uuid.uuid4()), number=21, created_at="2026-11-09T19:50:00+00:00")
    alarm = _incident(id=str(uuid.uuid4()), number=21, created_at="2026-11-09T19:51:00+00:00")

    plan = _merge([], [box], [alarm])

    assert plan.merged[_key(alarm)]["number"] == 22
    assert {op.row["number"] for op in plan.to_leader if op.table == "incidents"} == {22}
    assert any(op.row and op.row["number"] == 22 for op in plan.to_follower if op.table == "incidents")
    lines = [op.row["text"] for op in plan.to_follower if op.table == "journal_entries"]
    assert lines == ["Einsatz 21 heisst jetzt 22: beide Systeme hatten während der Trennung die Nummer 21 vergeben."]


# --- a real round: the box and the hosted board as two databases --------------------------------

HOSTED_URL = worker_database_url("_hosted")


@pytest_asyncio.fixture(scope="module")
async def hosted_database() -> AsyncGenerator[str, None]:
    await create_scratch_database(HOSTED_URL)
    engine = create_async_engine(HOSTED_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    yield HOSTED_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    await drop_scratch_database(HOSTED_URL)


@pytest_asyncio.fixture
async def hosted(hosted_database: str) -> AsyncGenerator[asyncpg.Connection, None]:
    conn = await asyncpg.connect(hosted_database, server_settings={"timezone": "UTC"})
    tables = [r["tablename"] for r in await conn.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")]
    await conn.execute("TRUNCATE " + ", ".join(f'public."{t}"' for t in tables) + " CASCADE")
    yield conn
    await conn.close()


async def _driver(db: AsyncSession) -> asyncpg.Connection:
    raw = await (await db.connection()).get_raw_connection()
    conn: asyncpg.Connection = raw.driver_connection
    await conn.execute("SET TIME ZONE 'UTC'")
    return conn


EVENT_SQL = "INSERT INTO events (id, name, training_flag, auto_attach_divera, feld_code) VALUES ($1, 'Unwetter', false, false, '1234')"
INCIDENT_SQL = (
    "INSERT INTO incidents (id, event_id, number, title, type, priority, location_address, status, description, "
    "nachbarhilfe, am_warten, zu_fuss, leader_manual) VALUES ($1, $2, 7, 'Keller', 'elementarereignis', 'medium', "
    "'Bahnhofstrasse 22', 'reko', 'Unterführung überflutet.', false, false, false, false)"
)


@pytest_asyncio.fixture
async def mirrored(db_session: AsyncSession, hosted: asyncpg.Connection):
    """One Ereignis with one Einsatz, the same on both – what the mirror holds – taken over on the box."""
    box = await _driver(db_session)
    event_id, incident_id = uuid.uuid4(), uuid.uuid4()
    for conn in (box, hosted):
        await conn.execute(EVENT_SQL, event_id)
        await conn.execute(INCIDENT_SQL, incident_id, event_id)
        # Same timestamps on both, as replication copies them.
        await conn.execute(
            "UPDATE events SET created_at = $2, updated_at = $2, last_activity_at = $2 WHERE id = $1",
            event_id,
            datetime(2026, 11, 9, 19, 0, tzinfo=UTC),
        )
        await conn.execute(
            "UPDATE incidents SET created_at = $2, updated_at = $2 WHERE id = $1",
            incident_id,
            datetime(2026, 11, 9, 19, 0, tzinfo=UTC),
        )
    await install_guards(box)
    await take_over(box, event_id, "Koch René")
    return box, hosted, event_id, incident_id


def _push(hosted: asyncpg.Connection):
    async def push(event_id: uuid.UUID, ops: list[Op], pending: int) -> list[str]:
        async with hosted.transaction():
            results = await apply_ops(hosted, await event_tables(hosted), event_id, ops)
            if any(op.required and r != "ok" for op, r in zip(ops, results, strict=True)):
                raise LeadMovedError
        return results

    return push


async def _description(conn: asyncpg.Connection, incident_id: uuid.UUID) -> str:
    value: str = await conn.fetchval("SELECT description FROM incidents WHERE id = $1", incident_id)
    return value


@pytest.mark.asyncio
async def test_a_round_carries_the_box_work_up_and_the_hosted_boards_new_rows_down(mirrored):
    box, hosted, event_id, incident_id = mirrored
    await box.execute("UPDATE incidents SET description = 'Fahrer gerettet.' WHERE id = $1", incident_id)
    await hosted.execute(
        "INSERT INTO journal_entries (id, event_id, kind, text, author_name) VALUES ($1, $2, 'manual', 'Strasse gesperrt', 'Frei Marc')",
        uuid.uuid4(),
        event_id,
    )

    result = await sync_event(box, hosted, _push(hosted), event_id)

    assert result.leader == STANDBY and result.pending == 0 and result.held == []
    assert await _description(hosted, incident_id) == "Fahrer gerettet."
    assert await hosted.fetchval("SELECT holder FROM event_leads WHERE event_id = $1", event_id) == STANDBY
    texts = {r["text"]: r["seq"] for r in await box.fetch("SELECT text, seq FROM journal_entries")}
    assert "Strasse gesperrt" in texts and texts["Strasse gesperrt"] >= 10**15  # the box's own seq
    # Nothing left to do: a second round writes nothing.
    again = await sync_event(box, hosted, _push(hosted), event_id)
    assert (again.written_here, again.written_there) == (0, 0)


@pytest.mark.asyncio
async def test_both_changing_the_meldung_keeps_the_box_version_and_lists_the_other_on_both(mirrored):
    box, hosted, event_id, incident_id = mirrored
    await box.execute("UPDATE incidents SET description = 'Fahrer gerettet.' WHERE id = $1", incident_id)
    await hosted.execute(
        "UPDATE incidents SET description = 'Polizei sperrt.', status = 'enroute' WHERE id = $1", incident_id
    )

    result = await sync_event(box, hosted, _push(hosted), event_id)

    assert result.conflicts == 1
    for conn in (box, hosted):
        assert await _description(conn, incident_id) == "Fahrer gerettet."
        assert await conn.fetchval("SELECT status FROM incidents WHERE id = $1", incident_id) == "enroute"
        lost = await conn.fetchval("SELECT columns->'description'->>'lost' FROM event_conflicts")
        assert lost == "Polizei sperrt."


@pytest.mark.asyncio
async def test_a_take_back_on_the_hosted_board_wins_and_the_late_box_edit_becomes_its_conflict(mirrored):
    box, hosted, event_id, incident_id = mirrored
    await sync_event(box, hosted, _push(hosted), event_id)  # the hosted board learns of the takeover
    # The box goes dark and keeps working; meanwhile the hosted board takes it back and edits.
    await box.execute("UPDATE incidents SET description = 'Atemschutz abgelöst.' WHERE id = $1", incident_id)
    later = datetime.now(UTC) + timedelta(minutes=5)
    await hosted.execute("UPDATE event_leads SET holder = 'hosted', since = $2 WHERE event_id = $1", event_id, later)
    await hosted.execute("UPDATE incidents SET description = 'Gemeindehaus führt.' WHERE id = $1", incident_id)

    result = await sync_event(box, hosted, _push(hosted), event_id)

    assert result.leader == HOSTED
    assert await box.fetchval("SELECT holder FROM event_leads WHERE event_id = $1", event_id) == HOSTED
    assert await _description(box, incident_id) == "Gemeindehaus führt."
    kept_on, lost = await hosted.fetchrow("SELECT kept_on, columns->'description'->>'lost' FROM event_conflicts")
    assert (kept_on, lost) == (HOSTED, "Atemschutz abgelöst.")


@pytest.mark.asyncio
async def test_a_taken_back_ereignis_with_nothing_to_send_does_not_call_the_hosted_board(mirrored):
    box, hosted, event_id, _ = mirrored
    await sync_event(box, hosted, _push(hosted), event_id)
    await hosted.execute(
        "UPDATE event_leads SET holder = 'hosted', since = now() + interval '1 minute' WHERE event_id = $1", event_id
    )
    await sync_event(box, hosted, _push(hosted), event_id)  # the box learns it
    calls: list[list[Op]] = []

    async def counting(event_id: uuid.UUID, ops: list[Op], pending: int) -> list[str]:
        calls.append(ops)
        return await _push(hosted)(event_id, ops, pending)

    result = await sync_event(box, hosted, counting, event_id)

    assert result.leader == HOSTED and calls == []


@pytest.mark.asyncio
async def test_a_row_this_schema_refuses_is_held_and_the_rest_of_the_batch_lands(mirrored, hosted):
    """Version skew: the other side sends a value this side's CHECK does not know yet. That
    one row waits; it used to fail the batch – and the Ereignis's whole sync – every round."""
    _, _, event_id, incident_id = mirrored
    tables = await event_tables(hosted)
    current = (await fetch_rows(hosted, tables["incidents"], event_id))[0][("incidents", str(incident_id))]
    line = {
        "id": str(uuid.uuid4()),
        "event_id": str(event_id),
        "kind": "manual",
        "text": "Strasse gesperrt.",
        "occurred_at": NOW,
        "created_at": NOW,
    }

    async with hosted.transaction():
        results = await apply_ops(
            hosted,
            tables,
            event_id,
            [
                Op("incidents", str(incident_id), {**current, "priority": "a-priority-from-the-future"}, current),
                Op("journal_entries", line["id"], line, None),
            ],
        )

    assert results == ["held", "ok"]
    assert await hosted.fetchval("SELECT priority FROM incidents WHERE id = $1", incident_id) == "medium"
    assert await hosted.fetchval("SELECT count(*) FROM journal_entries") == 1


@pytest.mark.asyncio
async def test_the_hosted_side_never_takes_a_row_of_another_ereignis(mirrored, hosted):
    _, _, event_id, _ = mirrored
    other_event = uuid.uuid4()
    await hosted.execute(EVENT_SQL, other_event)
    stray = {
        "id": str(uuid.uuid4()),
        "event_id": str(other_event),
        "kind": "manual",
        "text": "x",
        "occurred_at": NOW,
        "created_at": NOW,
    }

    async with hosted.transaction():
        [result] = await apply_ops(
            hosted, await event_tables(hosted), event_id, [Op("journal_entries", stray["id"], stray, None)]
        )

    assert result == "refused"
    assert await hosted.fetchval("SELECT count(*) FROM journal_entries") == 0


@pytest.mark.asyncio
async def test_a_lead_row_that_moved_meanwhile_stops_the_round(mirrored):
    box, hosted, event_id, _ = mirrored
    await sync_event(box, hosted, _push(hosted), event_id)

    async def racing(event_id: uuid.UUID, ops: list[Op], pending: int) -> list[str]:
        # The hosted board takes it back between the box's read and its write.
        await hosted.execute(
            "UPDATE event_leads SET since = now() + interval '1 hour', holder = 'hosted' WHERE event_id = $1", event_id
        )
        return await _push(hosted)(event_id, ops, pending)

    await box.execute("UPDATE event_leads SET since = now() + interval '2 hours' WHERE event_id = $1", event_id)
    with pytest.raises(LeadMovedError):
        await sync_event(box, hosted, racing, event_id)
    # Nothing of the refused batch landed: the hosted board keeps its own takeover.
    assert await hosted.fetchval(f"SELECT holder FROM {LEADS} WHERE event_id = $1", event_id) == HOSTED
