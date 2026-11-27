"""Rule 1 of the row locks (docs/BACKEND.md «Row locks»), checked with real overlapping transactions.

Every writer of an Ereignis takes its lock first (``crud.locking.lock_ereignis``), so two writers
of one Ereignis take turns: the second queues for the Ereignis lock (``wait_for_ereignis_lock``
probes that key, not any lock) and goes on once the first commits. The tests near the end are the
cycles the lock replaced – they deadlocked on main – and the interleavings #435 could not keep
apart by ordering rows by hand. The ones on resource rows check rule 2. Independent, committed
sessions (pattern from ``test_group_stop_undo_guard.py``): only a genuine second transaction
shows who waits for whom.
"""

import asyncio
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio
from fastapi import BackgroundTasks
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import schemas
from app.api import divera as divera_api
from app.api import reko as reko_api
from app.api import standby as standby_api
from app.crud import assignments as assignments_crud
from app.crud import auftrag_templates as auftrag_templates_crud
from app.crud import events as events_crud
from app.crud import feld as feld_crud
from app.crud import group_assignments as group_assignments_crud
from app.crud import groups as groups_crud
from app.crud import incidents as incidents_crud
from app.crud import materials as materials_crud
from app.crud import personnel as personnel_crud
from app.crud import personnel_checkin as checkin_crud
from app.crud import reko_assignment as reko_assignment_crud
from app.crud.feld.melden import create_field_report
from app.crud.locking import lock_groups, lock_incident, lock_incident_with_group, lock_resource
from app.models import (
    AuditLog,
    AuftragTemplate,
    AuftragTemplateResource,
    DiveraEmergency,
    Event,
    EventSpecialFunction,
    FieldRequest,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    Notification,
    Personnel,
    User,
)
from app.services import duplicates, notification_service
from app.services.notification_service import dismiss_notification
from app.standby_sync import Op, apply_ops, event_tables, fetch_rows
from tests.conftest import wait_for_ereignis_lock, wait_until_blocked


def _request() -> MagicMock:
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


@dataclass
class Board:
    sessions: async_sessionmaker[AsyncSession]
    user_id: UUID
    event_id: UUID
    group_id: UUID
    stop_id: UUID
    loose_id: UUID
    material_id: UUID
    second_material_id: UUID
    person_id: UUID


@pytest_asyncio.fixture
async def board(test_engine: AsyncEngine) -> AsyncGenerator[Board]:
    """One Auftrag with one stop, an ungrouped incident, two materials and a person – committed for real.

    A lock wait gives up after 15 s: a writer that skips its Ereignis lock fails its probe, and
    the transactions left waiting then fail too instead of hanging the clean-up.
    """
    patient = create_async_engine(
        test_engine.url.render_as_string(hide_password=False),
        poolclass=NullPool,
        connect_args={"server_settings": {"lock_timeout": "15s"}},
    )
    sessions = async_sessionmaker(patient, expire_on_commit=False)
    user_id, event_id, group_id, stop_id, loose_id, material_id, second_material_id, person_id = (
        uuid4() for _ in range(8)
    )
    material_ids = (material_id, second_material_id)
    async with sessions() as db:
        prior_audit_ids = set(await db.scalars(select(AuditLog.id)))
        db.add_all(
            [
                User(id=user_id, username=f"lock-order-{user_id}", password_hash=None, role="editor"),
                Event(id=event_id, name="Lock order", training_flag=False, created_at=datetime.now(UTC)),
                Material(id=material_id, name="Pumpe", type="Pumpe", location="Depot", status="available"),
                Material(id=second_material_id, name="Sauger", type="Sauger", location="Depot", status="available"),
                Personnel(id=person_id, name="Muster Max", status="available"),
            ]
        )
        await db.flush()
        db.add(IncidentGroup(id=group_id, event_id=event_id, name="Route"))
        await db.flush()
        for incident_id, grouped in ((stop_id, True), (loose_id, False)):
            db.add(
                Incident(
                    id=incident_id,
                    title="Stopp" if grouped else "Lose",
                    type="elementarereignis",
                    priority="medium",
                    status="active",
                    event_id=event_id,
                    created_by=user_id,
                    group_id=group_id if grouped else None,
                    group_position=0 if grouped else None,
                )
            )
        await db.commit()
    try:
        yield Board(
            sessions, user_id, event_id, group_id, stop_id, loose_id, material_id, second_material_id, person_id
        )
    finally:
        async with sessions() as db:
            await db.execute(
                delete(IncidentGroupAssignment).where(IncidentGroupAssignment.resource_id.in_(material_ids))
            )
            await db.execute(delete(Incident).where(Incident.event_id == event_id))
            await db.execute(delete(IncidentGroup).where(IncidentGroup.event_id == event_id))
            await db.execute(delete(Material).where(Material.id.in_(material_ids)))
            await db.execute(delete(Personnel).where(Personnel.id == person_id))
            await db.execute(delete(AuditLog).where(AuditLog.id.not_in(prior_audit_ids)))
            await db.execute(delete(Event).where(Event.id == event_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
        await patient.dispose()


async def test_completing_a_stop_queues_behind_a_reorder_instead_of_deadlocking(board: Board):
    async with board.sessions() as reorder, board.sessions() as completion:
        # A reorder is under way: it holds the Auftrag and is about to write the stop.
        await lock_groups(reorder, [board.group_id])  # the reorder's first lock: its Ereignis, the Auftrag
        user = await completion.get(User, board.user_id)
        completing = asyncio.create_task(
            incidents_crud.update_incident_status(completion, board.stop_id, "complete", user, _request())
        )
        await wait_for_ereignis_lock(board.sessions, board.event_id)

        await asyncio.wait_for(groups_crud.reorder_group_stops(reorder, board.group_id, [board.stop_id]), timeout=5)
        await reorder.commit()

        completed = await asyncio.wait_for(completing, timeout=10)
        await completion.commit()

    assert completed is not None
    assert completed.status == "complete"


async def test_a_field_report_on_a_stop_queues_behind_a_reorder_instead_of_deadlocking(board: Board):
    # «Einsatz beendet» from the crew writes the stop, then moves it (which takes the
    # Auftrag); it used to write the stop before the Auftrag lock (Sol review A2, S3).
    async with board.sessions() as reorder, board.sessions() as reporting:
        await lock_groups(reorder, [board.group_id])  # the reorder's first lock: its Ereignis, the Auftrag
        stop = await reporting.get(Incident, board.stop_id)
        assert stop is not None
        actor = feld_crud.FieldActor(personnel_id=board.person_id, personnel_name="Muster Max")
        report = asyncio.create_task(
            feld_crud.record_field_complete(reporting, stop, actor=actor, at=datetime.now(UTC), request=_request())
        )
        await wait_for_ereignis_lock(board.sessions, board.event_id)

        await asyncio.wait_for(groups_crud.reorder_group_stops(reorder, board.group_id, [board.stop_id]), timeout=5)
        await reorder.commit()

        assert await asyncio.wait_for(report, timeout=10)
        await reporting.commit()


async def test_a_stop_that_joins_an_auftrag_meanwhile_gets_that_auftrag_locked(board: Board):
    async with board.sessions() as mover, board.sessions() as locker, board.sessions() as probe:
        # Another request attaches the loose incident to the route and has not committed yet.
        await lock_groups(mover, [board.group_id])
        loose = await mover.get(Incident, board.loose_id)
        assert loose is not None
        loose.group_id, loose.group_position = board.group_id, 1
        await mover.flush()

        # Queues for the Ereignis behind the mover, then reads the stop's Auftrag.
        locking = asyncio.create_task(lock_incident_with_group(locker, board.loose_id))
        await wait_for_ereignis_lock(board.sessions, board.event_id)
        await mover.commit()
        locked = await asyncio.wait_for(locking, timeout=10)

        assert locked is not None
        assert locked.group_id == board.group_id
        # It holds the Auftrag it found the stop in.
        held = await probe.execute(
            text("SELECT 1 FROM incident_groups WHERE id = :id FOR UPDATE SKIP LOCKED"), {"id": board.group_id}
        )
        assert held.first() is None
        await locker.rollback()


async def test_archive_waits_for_an_inflight_auftrag_assignment_and_refuses(board: Board):
    async with board.sessions() as assigning, board.sessions() as archiving:
        user = await assigning.get(User, board.user_id)
        assert user is not None
        await group_assignments_crud.assign_group_resource(
            assigning, board.group_id, "material", board.material_id, user, _request()
        )

        archive_user = await archiving.get(User, board.user_id)
        assert archive_user is not None
        archive = asyncio.create_task(
            materials_crud.archive_material(archiving, board.material_id, archive_user, _request())
        )
        await wait_until_blocked(board.sessions)
        await assigning.commit()

        outcome = await asyncio.wait_for(archive, timeout=10)
        await archiving.rollback()

    assert isinstance(outcome, materials_crud.ArchiveRefused)
    assert outcome.active_incidents == 1


async def test_transfer_and_a_standard_auftrag_lock_shared_resources_in_one_order(board: Board):
    first, second = sorted([board.material_id, board.second_material_id])
    template_id = uuid4()
    async with board.sessions() as db:
        db.add_all(
            [
                IncidentAssignment(incident_id=board.loose_id, resource_type="material", resource_id=material_id)
                for material_id in (first, second)
            ]
        )
        db.add(AuftragTemplate(id=template_id, name="Pumpen", auto_create=True))
        await db.flush()
        # The template lists them against the sorted order – the order it used to lock in.
        db.add_all(
            [
                AuftragTemplateResource(
                    template_id=template_id, resource_type="material", resource_id=second, position=0
                ),
                AuftragTemplateResource(
                    template_id=template_id, resource_type="material", resource_id=first, position=1
                ),
            ]
        )
        await db.commit()
    try:
        async with board.sessions() as holder, board.sessions() as transferring, board.sessions() as opening:
            await holder.execute(select(Material.id).where(Material.id == first).with_for_update())
            user = await transferring.get(User, board.user_id)
            assert user is not None
            transfer = asyncio.create_task(
                assignments_crud.transfer_assignments(transferring, board.loose_id, board.stop_id, user, _request())
            )
            await wait_until_blocked(board.sessions)
            templates = asyncio.create_task(
                auftrag_templates_crud.instantiate_auto_templates(opening, board.event_id, board.user_id)
            )
            await wait_until_blocked(board.sessions, count=2)
            await holder.rollback()

            moved = await asyncio.wait_for(transfer, timeout=10)
            await transferring.commit()
            opened = await asyncio.wait_for(templates, timeout=10)
            await opening.commit()

        assert moved["transferred_count"] == 2
        assert len(opened) == 1
    finally:
        async with board.sessions() as db:
            await db.execute(delete(AuftragTemplate).where(AuftragTemplate.id == template_id))
            await db.commit()


async def test_personnel_delete_waits_for_the_ereignisse_it_writes_before_the_person(board: Board):
    async with board.sessions() as db:
        loose = await db.get(Incident, board.loose_id)
        assert loose is not None
        loose.leader_personnel_id = board.person_id
        await db.commit()

    async with board.sessions() as assigning, board.sessions() as deleting:
        # An assignment is under way: it holds the incident and is about to lock the person.
        await lock_incident_with_group(assigning, board.loose_id)
        user = await deleting.get(User, board.user_id)
        assert user is not None
        deletion = asyncio.create_task(personnel_crud.delete_personnel(deleting, board.person_id, user, _request()))
        await wait_for_ereignis_lock(board.sessions, board.event_id)

        # The delete must be queued for the Ereignis, not sitting on the person.
        person = await asyncio.wait_for(lock_resource(assigning, "personnel", board.person_id), timeout=5)
        assert person is not None
        await assigning.commit()

        outcome = await asyncio.wait_for(deletion, timeout=10)
        await deleting.commit()

    assert outcome == "deleted"
    async with board.sessions() as db:
        assert await db.scalar(select(Incident.leader_personnel_id).where(Incident.id == board.loose_id)) is None


async def test_clearing_attendance_waits_for_the_person_lock(board: Board):
    # A check-out undo holds the person while it reads the departure it takes back; the
    # Appell's «nicht anwesend» must queue behind it, not delete the row under it (→ 500).
    async with board.sessions() as undo, board.sessions() as clearing:
        await lock_resource(undo, "personnel", board.person_id)
        clear = asyncio.create_task(checkin_crud.clear_personnel_attendance(clearing, board.event_id, board.person_id))
        await wait_until_blocked(board.sessions)
        assert not clear.done()
        await undo.commit()

        assert await asyncio.wait_for(clear, timeout=10) is not None
        await clearing.rollback()


async def test_an_exact_reko_release_waits_for_the_incident_lock(board: Board):
    # A completion (or any release) holds the Einsatz: the popover's exact-row release
    # queues behind it and then finds the row already gone, instead of writing it anyway.
    async with board.sessions() as db:
        row = IncidentAssignment(
            incident_id=board.loose_id, resource_type="personnel", resource_id=board.person_id, purpose="reko"
        )
        db.add(row)
        await db.commit()
    async with board.sessions() as holder, board.sessions() as releasing:
        await lock_incident(holder, board.loose_id)
        release = asyncio.create_task(
            reko_assignment_crud.unassign_reko_personnel_from_incident(
                releasing, board.loose_id, board.person_id, row.id
            )
        )
        await wait_for_ereignis_lock(board.sessions, board.event_id)
        held = await holder.get(IncidentAssignment, row.id)
        assert held is not None
        held.unassigned_at = datetime.now(UTC)
        await holder.commit()

        assert await asyncio.wait_for(release, timeout=10) is False
        await releasing.rollback()


async def test_two_restores_serialize_and_recognize_their_shared_pump(board: Board):
    ids = (board.stop_id, board.loose_id)
    async with board.sessions() as setup:
        user = await setup.get(User, board.user_id)
        assert user is not None
        for incident_id in ids:
            await assignments_crud.assign_resource(setup, incident_id, "material", board.material_id, user, _request())
        await setup.commit()
        for incident_id in ids:
            assert await incidents_crud.delete_incident(setup, incident_id, user, _request())
            await setup.commit()

    async with board.sessions() as first, board.sessions() as second:
        user = await first.get(User, board.user_id)
        second_user = await second.get(User, board.user_id)
        assert user is not None and second_user is not None
        assert await incidents_crud.restore_incident(first, ids[0], user, _request())
        restoring = asyncio.create_task(incidents_crud.restore_incident(second, ids[1], second_user, _request()))
        await wait_until_blocked(board.sessions)
        await first.commit()
        assert await asyncio.wait_for(restoring, timeout=10)
        await second.commit()
        deployed_on = await first.scalars(
            select(Incident.id)
            .join(IncidentAssignment)
            .where(
                Incident.deleted_at.is_(None),
                IncidentAssignment.unassigned_at.is_(None),
                IncidentAssignment.resource_id == board.material_id,
            )
        )
        assert set(deployed_on) == set(ids)


async def _report_and_take_over(board: Board, db: AsyncSession) -> tuple[Incident, str]:
    """The /feld «Wir übernehmen» of ``board.person_id``, in ``db``."""
    person = await db.get(Personnel, board.person_id)
    assert person is not None
    payload = schemas.FeldIncidentCreate(title="Baum", type="elementarereignis", priority="medium", take_over=True)
    return await create_field_report(db, board.event_id, person, payload, _request())


async def test_a_field_takeover_queues_behind_a_board_assignment_instead_of_deadlocking(board: Board):
    async with board.sessions() as db:
        db.add(
            IncidentGroupAssignment(
                incident_group_id=board.group_id, resource_type="personnel", resource_id=board.person_id
            )
        )
        await db.commit()

    async with board.sessions() as assigning, board.sessions() as reporting:
        # A board assignment holds the reporter's Auftrag and is about to lock the person.
        await lock_groups(assigning, [board.group_id])
        report = asyncio.create_task(_report_and_take_over(board, reporting))
        await wait_until_blocked(board.sessions)

        # The report must be queued for the Auftrag, not key-sharing the person already.
        person = await asyncio.wait_for(lock_resource(assigning, "personnel", board.person_id), timeout=5)
        assert person is not None
        await assigning.commit()

        incident, mode = await asyncio.wait_for(report, timeout=10)
        await reporting.commit()

    assert mode == "stop"
    assert incident.group_id == board.group_id


async def test_a_field_takeover_onto_an_auftrag_deleted_meanwhile_takes_it_on_alone(board: Board):
    async with board.sessions() as db:
        db.add(IncidentAssignment(incident_id=board.stop_id, resource_type="personnel", resource_id=board.person_id))
        await db.commit()

    async with board.sessions() as deleting, board.sessions() as reporting:
        user = await deleting.get(User, board.user_id)
        assert user is not None
        # The Auftrag is being deleted: it is locked and its stop already detached.
        assert await groups_crud.soft_delete_group(deleting, board.group_id, user, _request()) is not None
        report = asyncio.create_task(_report_and_take_over(board, reporting))
        await wait_until_blocked(board.sessions)
        await deleting.commit()

        incident, mode = await asyncio.wait_for(report, timeout=10)
        await reporting.commit()

    # Not a stop of the deleted Auftrag: the reporter is on the new Schadenplatz alone.
    assert mode == "solo"
    assert incident.group_id is None
    async with board.sessions() as db:
        crew = await db.scalars(
            select(IncidentAssignment.resource_id).where(
                IncidentAssignment.incident_id == incident.id, IncidentAssignment.unassigned_at.is_(None)
            )
        )
        assert list(crew) == [board.person_id]


@pytest.mark.parametrize("route", ["replace", "handover"])
async def test_a_reko_replacement_locks_the_incoming_person_with_the_crew_it_may_promote(board: Board, route: str):
    # Replacing a Reko who sits on a crew row releases that row, which promotes the next
    # Einsatzleiter and key-shares their person row. It used to hold the incoming person
    # first: against an incident delete that locks both persons sorted (the successor
    # first, here), a deadlock. Now it queues for the successor and holds nobody yet.
    successor_id, outgoing_id, incoming_id = sorted(uuid4() for _ in range(3))
    async with board.sessions() as db:
        db.add_all(
            [
                Personnel(id=successor_id, name="Folger Fritz", status="available"),
                Personnel(id=outgoing_id, name="Alt Anna", status="available"),
                Personnel(id=incoming_id, name="Neu Nina", status="available"),
            ]
        )
        await db.flush()
        db.add_all(
            [
                EventSpecialFunction(event_id=board.event_id, personnel_id=person_id, function_type="reko")
                for person_id in (outgoing_id, incoming_id)
            ]
            + [
                IncidentAssignment(
                    incident_id=board.loose_id, resource_type="personnel", resource_id=person_id, purpose="crew"
                )
                for person_id in (successor_id, outgoing_id)
            ]
        )
        loose = await db.get(Incident, board.loose_id)
        assert loose is not None
        loose.status = "reko"
        await db.commit()
    try:
        async with board.sessions() as deleting, board.sessions() as replacing:
            # An incident delete holds the successor and goes for the incoming person next.
            await lock_resource(deleting, "personnel", successor_id)
            user = await replacing.get(User, board.user_id)
            assert user is not None
            if route == "replace":
                body = schemas.AssignRekoPersonnelRequest(personnel_id=incoming_id)
                write = reko_api.assign_reko_personnel(
                    board.loose_id, body, _request(), BackgroundTasks(), user, replacing
                )
            else:
                write = reko_api.transfer_reko_assignments(
                    _request(), BackgroundTasks(), user, outgoing_id, incoming_id, board.event_id, replacing
                )
            replacement = asyncio.create_task(write)
            await wait_until_blocked(board.sessions)

            assert await asyncio.wait_for(lock_resource(deleting, "personnel", incoming_id), timeout=5) is not None
            await deleting.commit()
            await asyncio.wait_for(replacement, timeout=10)
            await replacing.commit()

        async with board.sessions() as db:
            assert await db.scalar(select(Incident.leader_personnel_id).where(Incident.id == board.loose_id)) == (
                successor_id
            )
            active = await db.scalars(
                select(IncidentAssignment.resource_id).where(
                    IncidentAssignment.incident_id == board.loose_id, IncidentAssignment.unassigned_at.is_(None)
                )
            )
            assert set(active) == {successor_id, incoming_id}
    finally:
        async with board.sessions() as db:
            await db.execute(delete(IncidentAssignment).where(IncidentAssignment.incident_id == board.loose_id))
            await db.execute(delete(Personnel).where(Personnel.id.in_([successor_id, outgoing_id, incoming_id])))
            await db.commit()


def _alarm(alarm_id: UUID, divera_id: int, title: str, address: str, **link: object) -> DiveraEmergency:
    return DiveraEmergency(
        id=alarm_id,
        divera_id=divera_id,
        title=title,
        address=address,
        received_at=datetime.now(UTC),
        is_archived=False,
        **link,
    )


async def _alarms(board: Board, *alarms: DiveraEmergency) -> list[UUID]:
    """Commit pool alarms; the first one's address is the loose card's, so it is flagged as its duplicate."""
    async with board.sessions() as db:
        loose = await db.get(Incident, board.loose_id)
        assert loose is not None
        loose.location_address = alarms[0].address
        db.add_all(alarms)
        await db.commit()
    return [alarm.id for alarm in alarms]


async def _drop_alarms(board: Board, alarm_ids: list[UUID]) -> None:
    async with board.sessions() as db:
        await db.execute(delete(DiveraEmergency).where(DiveraEmergency.id.in_(alarm_ids)))
        await db.commit()


async def _archive(board: Board) -> None:
    async with board.sessions() as db:
        event = await db.get(Event, board.event_id)
        assert event is not None
        event.archived_at = datetime.now(UTC)
        await db.commit()


async def _raw(db: AsyncSession) -> asyncpg.Connection:
    """The asyncpg connection under ``db``, outside a transaction – the box's sync opens its own."""
    conn: asyncpg.Connection = (await (await db.connection()).get_raw_connection()).driver_connection
    return conn


async def _row(conn: asyncpg.Connection, board: Board, table: str, row_id: UUID) -> dict[str, object]:
    """A row as the sync sees it – what an op names as ``expected``."""
    tables = await event_tables(conn)
    return (await fetch_rows(conn, tables[table], board.event_id))[0][(table, str(row_id))]


# The three cycles the Ereignis lock replaces. Each ran into a deadlock (or a wrong dismissal,
# tests/test_services/test_notification_service.py) on main.


async def test_a_status_update_and_an_ereignis_delete_take_turns(board: Board):
    # The status update held its card, then stamped the Ereignis row. The delete locked the
    # Ereignis row first and reached the card in its cascade: each waited for the other.
    await _archive(board)
    async with board.sessions() as updating, board.sessions() as deleting:
        await lock_incident_with_group(updating, board.loose_id)
        user = await deleting.get(User, board.user_id)
        deletion = asyncio.create_task(events_crud.delete_event(deleting, board.event_id, user, _request()))
        await wait_for_ereignis_lock(board.sessions, board.event_id)

        await asyncio.wait_for(events_crud.update_event_activity(updating, board.event_id), timeout=5)
        await updating.commit()
        assert await asyncio.wait_for(deletion, timeout=10) is True
        await deleting.commit()


async def test_a_merge_report_and_a_bulk_attach_that_flags_its_target_take_turns(board: Board):
    # The merge-report locked its target, then took the numbering lock with its report's INSERT.
    # A bulk attach held that lock from its first card and flagged (key-shared) the same target
    # with its second: each waited for the other.
    alarm_ids = await _alarms(
        board,
        _alarm(uuid4(), 910_031, "Keller überflutet", "Hauptstrasse 1, 4104 Oberwil"),
        _alarm(uuid4(), 910_032, "Wasser im Keller", "Bahnhofstrasse 9, 4104 Oberwil"),
    )
    try:
        async with board.sessions() as merging, board.sessions() as attaching:
            target = await lock_incident(merging, board.loose_id)  # the merge-report's first lock
            assert target is not None
            user = await attaching.get(User, board.user_id)
            assert user is not None
            body = schemas.BulkAttachEmergenciesRequest(event_id=board.event_id, emergency_ids=alarm_ids[::-1])
            bulk = asyncio.create_task(divera_api.bulk_attach_emergencies(body, _request(), attaching, user))
            await wait_for_ereignis_lock(board.sessions, board.event_id)

            operator = await merging.get(User, board.user_id)
            assert operator is not None
            report = await incidents_crud.create_incident(
                merging,
                schemas.IncidentCreate(
                    title="Nachbar meldet Wasser", type="elementarereignis", priority="medium", event_id=board.event_id
                ),
                operator,
                _request(),
            )
            await duplicates.merge_report(merging, report=report, target=target, user=operator, request=_request())
            await merging.commit()
            attached = await asyncio.wait_for(bulk, timeout=10)
            await attaching.commit()

        assert attached.errors == []
        assert [card.possible_duplicate_of_id for card in attached.created] == [None, board.loose_id]
    finally:
        await _drop_alarms(board, alarm_ids)


# Sol's round-7 interleavings of #435, which the gate design could not keep apart.


async def test_a_box_batch_that_deletes_the_ereignis_and_an_archive_take_turns(board: Board):
    # The batch deleted a higher-id alarm before its `events` delete; the archive locked a lower-id
    # alarm and waited for the higher one; the batch then waited for the lower one in the delete.
    low, high = sorted((uuid4(), uuid4()))
    alarm_ids = await _alarms(
        board,
        *(
            _alarm(
                alarm_id,
                divera_id,
                "Wasser im Keller",
                "Hauptstrasse 1, 4104 Oberwil",
                attached_to_event_id=board.event_id,
                responses_json={"answers": []},
            )
            for alarm_id, divera_id in ((low, 910_061), (high, 910_062))
        ),
    )
    try:
        async with board.sessions() as syncing, board.sessions() as archiving:
            conn = await _raw(syncing)
            tables = await event_tables(conn)
            event, alarm = (
                await _row(conn, board, "events", board.event_id),
                await _row(conn, board, "divera_emergencies", high),
            )
            async with conn.transaction():  # the box's round: one transaction
                assert await apply_ops(
                    conn, tables, board.event_id, [Op("divera_emergencies", str(high), None, alarm)]
                ) == ["ok"]
                archive = asyncio.create_task(events_crud.archive_event(archiving, board.event_id))
                await wait_for_ereignis_lock(board.sessions, board.event_id)
                assert await apply_ops(
                    conn, tables, board.event_id, [Op("events", str(board.event_id), None, event)]
                ) == ["ok"]
            # The Ereignis is gone by the time the archive goes on: «not found», the route's 404.
            assert await asyncio.wait_for(archive, timeout=10) is None
            await archiving.rollback()
    finally:
        await _drop_alarms(board, alarm_ids)


async def _meldung(board: Board, *, seen: bool) -> tuple[UUID, UUID]:
    """A crew's Meldung on the loose card and its bell entry, committed."""
    notification_id, request_id = uuid4(), uuid4()
    async with board.sessions() as db:
        db.add(
            Notification(
                id=notification_id,
                type="field_message",
                severity="info",
                message="Wasser",
                event_id=board.event_id,
                incident_id=board.loose_id,
            )
        )
        await db.flush()
        db.add(
            FieldRequest(
                id=request_id,
                incident_id=board.loose_id,
                kind="message",
                text="Wasser",
                notification_id=notification_id,
                seen_at=datetime.now(UTC) if seen else None,
            )
        )
        await db.commit()
    return notification_id, request_id


async def test_dismissing_a_seen_meldung_and_completing_its_einsatz_take_turns(board: Board):
    # The dismissal locked the seen request, then waited for its bell entry; completing the Einsatz
    # locked the Einsatz, wrote the bell entry, then waited for the request at the audit flush.
    notification_id, request_id = await _meldung(board, seen=True)
    async with board.sessions() as db:
        seen_at = await db.scalar(select(FieldRequest.seen_at).where(FieldRequest.id == request_id))
    async with board.sessions(autoflush=False) as dismissing, board.sessions(autoflush=False) as completing:
        assert await dismiss_notification(dismissing, notification_id, board.user_id) is not None
        user = await completing.get(User, board.user_id)
        completion = asyncio.create_task(
            incidents_crud.update_incident_status(completing, board.loose_id, "complete", user, _request())
        )
        await wait_for_ereignis_lock(board.sessions, board.event_id)
        await dismissing.commit()
        completed = await asyncio.wait_for(completion, timeout=10)
        await completing.commit()

    assert completed is not None and completed.status == "complete"
    async with board.sessions() as db:
        request = await db.get(FieldRequest, request_id)
        assert request is not None
        # Seen before: the dismissal left it alone, the completion closed it.
        assert (request.seen_at, request.status) == (seen_at, "done")


async def test_a_synced_bell_delete_and_a_dismissal_take_turns(board: Board):
    # The dismissal locked the seen request and waited for its bell entry; the synced delete
    # locked the entry, deleted it, and waited for the request when the key set notification_id NULL.
    notification_id, _request_id = await _meldung(board, seen=True)
    async with board.sessions() as syncing, board.sessions() as dismissing:
        conn = await _raw(syncing)
        tables = await event_tables(conn)
        row = await _row(conn, board, "notifications", notification_id)
        async with conn.transaction():
            assert await apply_ops(
                conn, tables, board.event_id, [Op("notifications", str(notification_id), None, row)]
            ) == ["ok"]
            dismissal = asyncio.create_task(dismiss_notification(dismissing, notification_id, board.user_id))
            await wait_for_ereignis_lock(board.sessions, board.event_id)
        assert await asyncio.wait_for(dismissal, timeout=10) is None
        await dismissing.rollback()


# The pairs #435 kept apart by hand, and their neighbours: the second writer queues for the
# Ereignis lock, whatever it locks after it.


async def test_a_bulk_attach_and_a_status_update_on_a_flagged_card_take_turns(board: Board):
    alarm_ids = await _alarms(
        board,
        _alarm(uuid4(), 910_002, "Keller überflutet", "Hauptstrasse 1, 4104 Oberwil"),
        _alarm(uuid4(), 910_001, "Wasser im Keller", "Bahnhofstrasse 9, 4104 Oberwil"),
    )
    try:
        async with board.sessions() as moving, board.sessions() as attaching:
            mover = await moving.get(User, board.user_id)
            moved = await incidents_crud.update_incident_status(moving, board.loose_id, "enroute", mover, _request())
            user = await attaching.get(User, board.user_id)
            assert user is not None
            body = schemas.BulkAttachEmergenciesRequest(event_id=board.event_id, emergency_ids=alarm_ids[::-1])
            bulk = asyncio.create_task(divera_api.bulk_attach_emergencies(body, _request(), attaching, user))
            await wait_for_ereignis_lock(board.sessions, board.event_id)
            await moving.commit()
            attached = await asyncio.wait_for(bulk, timeout=10)
            await attaching.commit()

        assert moved is not None and moved.status == "enroute"
        assert attached.errors == []
        assert [card.possible_duplicate_of_id for card in attached.created] == [None, board.loose_id]
    finally:
        await _drop_alarms(board, alarm_ids)


async def test_a_bulk_attach_and_a_single_attach_of_one_of_its_alarms_take_turns(board: Board):
    first_alarm, second_alarm = sorted((uuid4(), uuid4()))
    alarm_ids = await _alarms(
        board,
        _alarm(first_alarm, 910_011, "Wasser im Keller", "Bahnhofstrasse 9, 4104 Oberwil"),
        _alarm(second_alarm, 910_012, "Baum auf Strasse", "Mühlemattstrasse 3, 4104 Oberwil"),
    )
    try:
        async with board.sessions() as single, board.sessions() as bulk_db:
            operator = await single.get(User, board.user_id)
            assert operator is not None
            card = await divera_api.attach_emergency_to_event(
                second_alarm,
                schemas.AttachEmergencyRequest(event_id=board.event_id),
                _request(),
                MagicMock(),
                single,
                operator,
            )
            user = await bulk_db.get(User, board.user_id)
            assert user is not None
            body = schemas.BulkAttachEmergenciesRequest(event_id=board.event_id, emergency_ids=alarm_ids)
            bulk = asyncio.create_task(divera_api.bulk_attach_emergencies(body, _request(), bulk_db, user))
            await wait_for_ereignis_lock(board.sessions, board.event_id)
            await single.commit()
            attached = await asyncio.wait_for(bulk, timeout=10)
            await bulk_db.commit()

        assert card.title == "Baum auf Strasse"
        assert attached.errors == ["«Baum auf Strasse»: Alarm ist diesem Ereignis bereits zugeordnet"]
        assert [created.title for created in attached.created] == ["Wasser im Keller"]
    finally:
        await _drop_alarms(board, alarm_ids)


async def test_a_card_reorder_and_an_ereignis_delete_take_turns(board: Board):
    await _archive(board)
    async with board.sessions(autoflush=False) as reordering, board.sessions() as deleting:
        await incidents_crud.reorder_incidents(reordering, board.event_id, sorted((board.stop_id, board.loose_id)))
        user = await deleting.get(User, board.user_id)
        deletion = asyncio.create_task(events_crud.delete_event(deleting, board.event_id, user, _request()))
        await wait_for_ereignis_lock(board.sessions, board.event_id)
        await reordering.commit()
        assert await asyncio.wait_for(deletion, timeout=10) is True
        await deleting.commit()


async def test_an_ereignis_delete_and_a_hosted_sync_op_that_deletes_it_take_turns(board: Board):
    await _archive(board)
    async with board.sessions() as deleting, board.sessions() as syncing:
        conn = await standby_api._driver(syncing)  # inside the request's transaction, as the route runs it
        tables = await event_tables(conn)
        event = await _row(conn, board, "events", board.event_id)
        user = await deleting.get(User, board.user_id)
        assert await events_crud.delete_event(deleting, board.event_id, user, _request()) is True
        batch = asyncio.create_task(
            apply_ops(conn, tables, board.event_id, [Op("events", str(board.event_id), None, event)])
        )
        await wait_for_ereignis_lock(board.sessions, board.event_id)
        await deleting.commit()
        assert await asyncio.wait_for(batch, timeout=10) == ["ok"]  # nothing left to delete
        await syncing.commit()


async def test_a_synced_ereignis_delete_and_a_bell_poll_take_turns(board: Board):
    async with board.sessions() as syncing, board.sessions(autoflush=False) as polling:
        conn = await _raw(syncing)
        tables = await event_tables(conn)
        event = await _row(conn, board, "events", board.event_id)
        async with conn.transaction():
            assert await apply_ops(conn, tables, board.event_id, [Op("events", str(board.event_id), None, event)]) == [
                "ok"
            ]
            poll = asyncio.create_task(notification_service.evaluate_notifications(polling, board.event_id))
            await wait_for_ereignis_lock(board.sessions, board.event_id)
        # The Ereignis is gone by the time the poll goes on: nothing to warn about.
        assert await asyncio.wait_for(poll, timeout=10) == []
        await polling.rollback()
