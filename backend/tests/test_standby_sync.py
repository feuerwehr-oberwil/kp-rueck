"""The two-way standby sync: the merge rules the owner picked (09.11.2026), then a real round.

The merge is pure, so the rules are pinned on plain rows first. The round runs against two
real databases – the test database as the box, a scratch one as the hosted board – with the
push going straight into the hosted database through the same `apply_ops` its endpoint runs.
"""

import json
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

import asyncpg
import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base
from app.standby import install_guards, sync_once, take_over
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
TAKEOVER = "2026-11-09T19:42:00+00:00"


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
    return merge(rows(base), rows(lead), rows(other), event_id=EVENT, leader=leader, takeover=TAKEOVER, now=NOW)


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


HOSTED_REVOKE, BOX_REVOKE = 1 << 16, 1


@pytest.mark.parametrize(
    ("base", "lead", "other", "stands"),
    [
        pytest.param(0, BOX_REVOKE, HOSTED_REVOKE, HOSTED_REVOKE + BOX_REVOKE, id="both revoked once while apart"),
        pytest.param(0, 2 * BOX_REVOKE, HOSTED_REVOKE, HOSTED_REVOKE + 2 * BOX_REVOKE, id="the box twice, hosted once"),
        pytest.param(HOSTED_REVOKE, 0, HOSTED_REVOKE, HOSTED_REVOKE, id="the leader just got the column (0)"),
        pytest.param(0, 0, HOSTED_REVOKE, HOSTED_REVOKE, id="only the follower revoked"),
    ],
)
def test_share_link_revokes_of_both_systems_survive_the_merge(base: int, lead: int, other: int, stands: int):
    """Each system counts in its own half of the generation; the merge keeps the higher of each
    half, whoever leads, without a conflict. So no revoked link comes back, and a link either
    side issued before the other's revoke no longer matches."""
    key = ("events", EVENT)
    event = lambda generation: {key: {"id": EVENT, "name": "Sturm Musterdorf", "viewer_link_generation": generation}}

    plan = merge(event(base), event(lead), event(other), event_id=EVENT, leader=STANDBY, takeover=TAKEOVER, now=NOW)

    assert plan.merged[key]["viewer_link_generation"] == stands
    assert stands not in ({lead, other} - {stands}) and not _conflicts(plan)


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
    plan = lambda lead, now: merge(
        rows(base), lead, rows(theirs), event_id=EVENT, leader=STANDBY, takeover=TAKEOVER, now=now
    )

    [first] = _conflicts(plan(rows(mine), NOW))
    [again] = _conflicts(plan(rows(mine), "2026-11-09T20:12:05+00:00"))
    assert again["id"] == first["id"]

    recorded = {**rows(mine), (CONFLICTS, first["id"]): first}
    assert _conflicts(plan(recorded, "2026-11-09T20:12:10+00:00")) == []


def test_the_same_clash_in_a_later_takeover_is_a_new_conflict():
    """Takeover 1: Box and hosted board both change the Meldung; the clash is listed and decided.
    Takeover 2, a later outage: the very same two texts clash again. That is a new clash the
    operator has not seen, not the old, decided one."""
    base, mine, theirs = _incident(), _incident(description="Box."), _incident(description="Hosted.")
    rows = lambda *rs: {_key(r): r for r in rs}

    first_plan = merge(rows(base), rows(mine), rows(theirs), event_id=EVENT, leader=STANDBY, takeover=TAKEOVER, now=NOW)
    [first] = _conflicts(first_plan)
    decided = {**first, "resolved_at": "2026-11-09T20:30:00+00:00", "resolution": "kept"}
    recorded = {**rows(mine), (CONFLICTS, first["id"]): decided}

    second_takeover = "2026-11-12T07:55:00+00:00"
    later = merge(rows(base), recorded, rows(theirs), event_id=EVENT, leader=STANDBY, takeover=second_takeover, now=NOW)

    [second] = _conflicts(later)
    assert second["id"] != first["id"] and second["resolved_at"] is None


def test_two_einsatzleiter_named_in_the_gap_keep_the_leaders_and_the_other_stays_in_the_crew():
    incident = _incident()["id"]
    named = lambda person: {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, person)),
        "incident_id": incident,
        "resource_id": person,
        "is_leader": True,
        "unassigned_at": None,
    }
    box, phone = named("Koch"), named("Frei")
    key = lambda r: ("incident_assignments", r["id"])

    plan = merge({}, {key(box): box}, {key(phone): phone}, event_id=EVENT, leader=STANDBY, takeover=TAKEOVER, now=NOW)

    assert plan.merged[key(box)]["is_leader"] is True
    assert plan.merged[key(phone)] == {**phone, "is_leader": False}
    assert [op.row for op in plan.to_leader if op.table == "incident_assignments"] == [plan.merged[key(phone)]]
    [conflict] = _conflicts(plan)
    assert conflict["row_id"] == phone["id"] and conflict["columns"]["is_leader"]["lost"] is True


def test_one_gps_question_raised_on_both_sides_during_a_lead_change_is_asked_once():
    """In the seconds before the lead rows agree, both systems ask «Ist TLF angekommen?» for the
    same Einsatz (the same `params.key`). The leader's question stays, the copy goes where it came
    from. A question somebody already answered (dismissed) is never touched."""
    asked = lambda name, **over: {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, name)),
        "event_id": EVENT,
        "type": "gps_arrival",
        "dismissed": False,
        "params": {"vehicle": "TLF", "key": "arrival:incident-7"},
        **over,
    }
    box, phone, answered = asked("box"), asked("phone"), asked("earlier", dismissed=True)
    key = lambda r: ("notifications", r["id"])

    plan = merge(
        {key(answered): answered},
        {key(box): box, key(answered): answered},
        {key(phone): phone, key(answered): answered},
        event_id=EVENT,
        leader=STANDBY,
        takeover=TAKEOVER,
        now=NOW,
    )

    assert plan.merged[key(box)] == box and plan.merged[key(answered)] == answered
    assert plan.merged[key(phone)] is None
    assert [op for op in plan.to_leader if op.table == "notifications"] == []
    assert [op for op in plan.to_follower if op.table == "notifications"] == [
        Op("notifications", box["id"], box, None),
        Op("notifications", phone["id"], None, phone),
    ]
    assert plan.conflicts == 0


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
BOX_URL = worker_database_url("_box")


async def _scratch_board(url: str) -> AsyncGenerator[str, None]:
    """A scratch database with the app's schema, for one module; yields its asyncpg URL."""
    await create_scratch_database(url)
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    yield url.replace("postgresql+asyncpg://", "postgresql://", 1)
    await drop_scratch_database(url)


@pytest_asyncio.fixture(scope="module")
async def hosted_database() -> AsyncGenerator[str, None]:
    async for url in _scratch_board(HOSTED_URL):
        yield url


@pytest_asyncio.fixture(scope="module")
async def box_database() -> AsyncGenerator[str, None]:
    """The box as the sidecar sees it: committed rows behind its own connection."""
    async for url in _scratch_board(BOX_URL):
        yield url


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
    event_id, incident_id = await _same_on_both(box, hosted)
    await install_guards(box)
    await take_over(box, event_id, "Koch René")
    return box, hosted, event_id, incident_id


async def _same_on_both(box: asyncpg.Connection, hosted: asyncpg.Connection) -> tuple[uuid.UUID, uuid.UUID]:
    """One Ereignis with one Einsatz, written identically to both. Returns their ids."""
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
    return event_id, incident_id


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


GROUP_SQL = (
    "INSERT INTO incident_groups (id, event_id, name, position, leader_manual, created_at, updated_at) "
    "VALUES ($1, $2, 'Route West', 0, false, $3, $3)"
)
STOP_SQL = (
    "INSERT INTO incidents (id, event_id, number, title, type, priority, location_address, status, "
    "nachbarhilfe, am_warten, zu_fuss, leader_manual, group_id, group_position) VALUES ($1, $2, $3, 'Baum', "
    "'elementarereignis', 'medium', $4, 'incoming', false, false, false, false, $5, 0)"
)


@pytest.mark.asyncio
async def test_two_stops_added_at_the_same_place_of_one_auftrag_are_both_kept(mirrored):
    """The phone (hosted) and the box each add a stop as the Auftrag's first one in the gap. A
    clash on the position is not the same Einsatz twice: neither may be deleted."""
    box, hosted, event_id, _ = mirrored
    group_id = uuid.uuid4()
    for conn in (box, hosted):
        await conn.execute(GROUP_SQL, group_id, event_id, datetime(2026, 11, 9, 19, 30, tzinfo=UTC))
    on_box, on_phone = uuid.uuid4(), uuid.uuid4()
    await box.execute(STOP_SQL, on_box, event_id, 8, "Hauptstrasse 1", group_id)
    await hosted.execute(STOP_SQL, on_phone, event_id, 9, "Mühleweg 4", group_id)

    result = await sync_event(box, hosted, _push(hosted), event_id)

    for conn in (box, hosted):
        stops = dict(await conn.fetch("SELECT id, group_position FROM incidents WHERE group_id = $1", group_id))
        assert stops == {on_box: 0, on_phone: 1}  # the leader's stop keeps its place
    assert result.pending == 0 and result.held == []


@pytest.mark.asyncio
async def test_a_new_row_that_clashes_on_a_place_rather_than_a_copy_is_held_not_a_duplicate(mirrored, hosted):
    """Only `duplicate` makes the round delete the row where it came from."""
    _, _, event_id, _ = mirrored
    group_id = uuid.uuid4()
    await hosted.execute(GROUP_SQL, group_id, event_id, datetime(2026, 11, 9, 19, 30, tzinfo=UTC))
    await hosted.execute(STOP_SQL, uuid.uuid4(), event_id, 8, "Hauptstrasse 1", group_id)
    tables = await event_tables(hosted)
    rows, _ = await fetch_rows(hosted, tables["incidents"], event_id)
    [stop] = [r for r in rows.values() if r["group_id"]]
    other = {**stop, "id": str(uuid.uuid4()), "number": 9}

    async with hosted.transaction():
        [result] = await apply_ops(hosted, tables, event_id, [Op("incidents", other["id"], other, None)])

    assert result == "held"


@pytest.mark.asyncio
async def test_the_sidecar_round_counts_what_waits_offline_and_sends_it_once_online(
    box_database: str, hosted_database: str, hosted: asyncpg.Connection, monkeypatch: pytest.MonkeyPatch
):
    """`sync_once` as the box's sidecar runs it: its own connections, the hosted board over HTTP."""
    box = await asyncpg.connect(box_database, server_settings={"timezone": "UTC"})
    try:
        event_id, incident_id = await _same_on_both(box, hosted)
        await install_guards(box)
        async with box.transaction():
            await take_over(box, event_id, "Koch René")
        await box.execute("UPDATE incidents SET description = 'Fahrer gerettet.' WHERE id = $1", incident_id)

        async def hosted_api(request: httpx.Request) -> httpx.Response:
            """What `POST /api/standby/sync` does with a batch (app/api/standby.py)."""
            assert request.url.path == "/api/standby/sync"
            assert request.headers["Authorization"] == "Bearer s3cret"
            body = json.loads(request.content)
            ops = [Op.from_json(raw) for raw in body["ops"]]
            async with hosted.transaction():
                results = await apply_ops(hosted, await event_tables(hosted), uuid.UUID(body["event_id"]), ops)
            return httpx.Response(200, json={"results": results})

        client = httpx.AsyncClient
        monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: client(**kw, transport=httpx.MockTransport(hosted_api)))
        monkeypatch.setenv("DATABASE_URL", box_database)
        monkeypatch.setenv("STANDBY_SOURCE_API", "http://hosted.test")
        monkeypatch.setenv("STANDBY_SYNC_TOKEN", "s3cret")
        status = "SELECT leader, pending, contact_at, message FROM standby.sync_status WHERE event_id = $1"

        monkeypatch.setenv("STANDBY_SOURCE_URL", "postgresql://nobody@127.0.0.1:1/kprueck")  # no internet
        assert await sync_once() == 0
        offline = await box.fetchrow(status, event_id)
        assert (offline["pending"], offline["contact_at"]) == (1, None) and offline["message"]

        monkeypatch.setenv("STANDBY_SOURCE_URL", hosted_database)
        assert await sync_once() == 1
        assert await _description(hosted, incident_id) == "Fahrer gerettet."
        online = await box.fetchrow(status, event_id)
        assert (online["leader"], online["pending"], online["message"]) == (STANDBY, 0, None)
        assert online["contact_at"] is not None
    finally:
        await box.close()
