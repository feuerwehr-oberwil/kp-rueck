"""The lock order of ``crud/locking.py``, checked with real overlapping transactions.

Auftrag before incident before resource: completing a stop used to lock the stop and
then its Auftrag while a reorder locked them the other way round (audit 2026-10, F08),
an archive did not lock the resource an assignment was being written for (F02),
writers of several resources locked them in their own order, and a personnel delete
wrote the incidents pointing at the person only after locking the person, and a /feld
takeover inserted its Meldung (key-sharing the reporter) before locking their Auftrag.
Independent, committed sessions (pattern from ``test_group_stop_undo_guard.py``) –
only a genuine second transaction shows who waits for whom.
"""

import asyncio
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app import schemas
from app.api import reko as reko_api
from app.crud import assignments as assignments_crud
from app.crud import auftrag_templates as auftrag_templates_crud
from app.crud import feld as feld_crud
from app.crud import group_assignments as group_assignments_crud
from app.crud import groups as groups_crud
from app.crud import incidents as incidents_crud
from app.crud import materials as materials_crud
from app.crud import personnel as personnel_crud
from app.crud import personnel_checkin as checkin_crud
from app.crud import reko_assignment as reko_assignment_crud
from app.crud.feld.melden import create_field_report
from app.crud.locking import lock_groups, lock_incident_with_group, lock_resource
from app.models import (
    AuditLog,
    AuftragTemplate,
    AuftragTemplateResource,
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    Personnel,
    User,
)


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


async def _wait_until_blocked(sessions: async_sessionmaker[AsyncSession], count: int = 1) -> None:
    """Until ``count`` other backends wait on a row lock – i.e. the tasks under test are queued."""
    async with sessions() as probe:
        for _ in range(100):
            waiting = await probe.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"
                    " AND pid <> pg_backend_pid()"
                )
            )
            # pg_stat_activity is a snapshot per transaction: end it to look again.
            await probe.rollback()
            if waiting >= count:
                return
            await asyncio.sleep(0.05)
    raise AssertionError("nothing ever waited for a lock")


@pytest_asyncio.fixture
async def board(test_engine: AsyncEngine) -> AsyncGenerator[Board]:
    """One Auftrag with one stop, an ungrouped incident, two materials and a person – committed for real."""
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
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


async def test_completing_a_stop_queues_behind_a_reorder_instead_of_deadlocking(board: Board):
    async with board.sessions() as reorder, board.sessions() as completion:
        # A reorder is under way: it holds the Auftrag and is about to write the stop.
        await reorder.execute(select(IncidentGroup.id).where(IncidentGroup.id == board.group_id).with_for_update())
        user = await completion.get(User, board.user_id)
        completing = asyncio.create_task(
            incidents_crud.update_incident_status(completion, board.stop_id, "complete", user, _request())
        )
        await _wait_until_blocked(board.sessions)

        # Completion must be waiting for the Auftrag, not sitting on the stop.
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
        await reorder.execute(select(IncidentGroup.id).where(IncidentGroup.id == board.group_id).with_for_update())
        stop = await reporting.get(Incident, board.stop_id)
        assert stop is not None
        actor = feld_crud.FieldActor(personnel_id=board.person_id, personnel_name="Muster Max")
        report = asyncio.create_task(
            feld_crud.record_field_complete(reporting, stop, actor=actor, at=datetime.now(UTC), request=_request())
        )
        await _wait_until_blocked(board.sessions)

        await asyncio.wait_for(groups_crud.reorder_group_stops(reorder, board.group_id, [board.stop_id]), timeout=5)
        await reorder.commit()

        assert await asyncio.wait_for(report, timeout=10)
        await reporting.commit()


async def test_a_stop_that_joins_an_auftrag_meanwhile_gets_that_auftrag_locked(board: Board):
    async with board.sessions() as mover, board.sessions() as locker, board.sessions() as probe:
        # Another request attaches the loose incident to the route and has not committed yet.
        await mover.execute(select(IncidentGroup.id).where(IncidentGroup.id == board.group_id).with_for_update())
        loose = await mover.get(Incident, board.loose_id)
        assert loose is not None
        loose.group_id, loose.group_position = board.group_id, 1
        await mover.flush()

        # Reads "no Auftrag", then queues for the incident behind the mover.
        locking = asyncio.create_task(lock_incident_with_group(locker, board.loose_id))
        await _wait_until_blocked(board.sessions)
        await mover.commit()
        locked = await asyncio.wait_for(locking, timeout=10)

        assert locked is not None
        assert locked.group_id == board.group_id
        # It started over and now holds the Auftrag it found the stop in.
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
        await _wait_until_blocked(board.sessions)
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
            await _wait_until_blocked(board.sessions)
            templates = asyncio.create_task(
                auftrag_templates_crud.instantiate_auto_templates(opening, board.event_id, board.user_id)
            )
            await _wait_until_blocked(board.sessions, count=2)
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


async def test_personnel_delete_locks_the_incidents_it_nulls_before_the_person(board: Board):
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
        await _wait_until_blocked(board.sessions)

        # The delete must be queued for the incident, not sitting on the person.
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
        await _wait_until_blocked(board.sessions)
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
        await holder.execute(select(Incident.id).where(Incident.id == board.loose_id).with_for_update())
        release = asyncio.create_task(
            reko_assignment_crud.unassign_reko_personnel_from_incident(
                releasing, board.loose_id, board.person_id, row.id
            )
        )
        await _wait_until_blocked(board.sessions)
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
        await _wait_until_blocked(board.sessions)
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
        await _wait_until_blocked(board.sessions)

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
        await _wait_until_blocked(board.sessions)
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
            await _wait_until_blocked(board.sessions)

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
