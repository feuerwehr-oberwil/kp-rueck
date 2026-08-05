"""Tests for the Einsatzleiter (incident commander) rules.

The role is derived rather than entered: the highest-ranking person currently
assigned leads, re-picked on every crew change, until an operator names someone
by hand — after which the choice is pinned and left alone.

These cover the rules that are easy to get subtly wrong, and each one here
corresponds to a bug that actually shipped in review:

- a released person must not keep the flag (completion releases the crew one at
  a time, each release promoting the next, so the record ended up claiming
  everybody had led the incident)
- a transfer must re-derive on BOTH incidents
- only personnel may hold the role (the unique index is on incident_id alone, so
  a vehicle marked leader occupies the slot and the resolver cannot clear it)
- Reko personnel are out on reconnaissance and do not lead
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.crud import assignments as assignment_crud
from app.models import Event, EventSpecialFunction, Incident, IncidentAssignment, Personnel, User, Vehicle


def _mock_request() -> MagicMock:
    """A request the audit logger can read an IP and user-agent off."""
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


@pytest.fixture
def mock_request() -> MagicMock:
    return _mock_request()


@pytest_asyncio.fixture
async def user(db_session: AsyncSession) -> User:
    u = User(id=uuid4(), username="leader_test_editor", password_hash="x", role="editor")
    db_session.add(u)
    await db_session.commit()
    return u


@pytest_asyncio.fixture
async def event(db_session: AsyncSession) -> Event:
    e = Event(id=uuid4(), name="Leader Test Event", training_flag=False)
    db_session.add(e)
    await db_session.commit()
    return e


@pytest_asyncio.fixture
async def incident(db_session: AsyncSession, user: User, event: Event) -> Incident:
    i = Incident(
        id=uuid4(),
        title="Leader Test Incident",
        type="brandbekaempfung",
        priority="high",
        status="incoming",
        event_id=event.id,
        created_by=user.id,
    )
    db_session.add(i)
    await db_session.commit()
    return i


async def _person(db_session: AsyncSession, name: str, role: str, sort_order: int = 0) -> Personnel:
    p = Personnel(id=uuid4(), name=name, role=role, status="available", role_sort_order=sort_order)
    db_session.add(p)
    await db_session.commit()
    return p


async def _assign(db_session, incident, person, user, request=None) -> IncidentAssignment:
    return await assignment_crud.assign_resource(
        db=db_session,
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=person.id,
        current_user=user,
        request=request or _mock_request(),
    )


async def _leaders(db_session: AsyncSession, incident_id, *, active_only: bool = True) -> list[str]:
    """Names currently flagged as Einsatzleiter, newest state from the DB."""
    stmt = (
        select(Personnel.name)
        .join(IncidentAssignment, IncidentAssignment.resource_id == Personnel.id)
        .where(IncidentAssignment.incident_id == incident_id, IncidentAssignment.is_leader.is_(True))
    )
    if active_only:
        stmt = stmt.where(IncidentAssignment.unassigned_at.is_(None))
    return sorted((await db_session.execute(stmt)).scalars().all())


class TestAutomaticLeader:
    async def test_single_person_leads(self, db_session, incident, user, mock_request):
        p = await _person(db_session, "Solo Sarah", "Mannschaft")
        await _assign(db_session, incident, p, user, mock_request)
        assert await _leaders(db_session, incident.id) == ["Solo Sarah"]

    async def test_higher_rank_takes_over(self, db_session, incident, user, mock_request):
        await _assign(db_session, incident, await _person(db_session, "Mann Max", "Mannschaft"), user)
        await _assign(db_session, incident, await _person(db_session, "Offi Olivia", "Offizier"), user)
        assert await _leaders(db_session, incident.id) == ["Offi Olivia"]

    async def test_explicit_sort_order_beats_the_role_name_fallback(self, db_session, incident, user, mock_request):
        # A station that fills in role_sort_order must have it respected even
        # when the role name would say otherwise.
        await _assign(db_session, incident, await _person(db_session, "Ranked Rita", "Mannschaft", 1), user)
        await _assign(db_session, incident, await _person(db_session, "Offi Otto", "Offizier", 9), user)
        assert await _leaders(db_session, incident.id) == ["Ranked Rita"]

    async def test_reko_personnel_never_lead(self, db_session, incident, event, user, mock_request):
        reko = await _person(db_session, "Reko Rolf", "Offizier")
        db_session.add(EventSpecialFunction(id=uuid4(), event_id=event.id, personnel_id=reko.id, function_type="reko"))
        await db_session.commit()

        await _assign(db_session, incident, reko, user, mock_request)
        assert await _leaders(db_session, incident.id) == []

        await _assign(db_session, incident, await _person(db_session, "Mann Mia", "Mannschaft"), user)
        assert await _leaders(db_session, incident.id) == ["Mann Mia"]

    async def test_releasing_the_leader_hands_the_role_on_and_clears_the_released_row(
        self, db_session, incident, user, mock_request
    ):
        boss = await _person(db_session, "Offi Olga", "Offizier")
        rest = await _person(db_session, "Wacht Willi", "Wachtmeister")
        boss_assignment = await _assign(db_session, incident, boss, user, mock_request)
        await _assign(db_session, incident, rest, user, mock_request)
        assert await _leaders(db_session, incident.id) == ["Offi Olga"]

        await assignment_crud.unassign_resource(db_session, boss_assignment.id, user, mock_request)
        await db_session.commit()

        assert await _leaders(db_session, incident.id) == ["Wacht Willi"]
        # The crucial part: the released row must not keep the flag, or the
        # historical record shows two people having led the same incident.
        assert await _leaders(db_session, incident.id, active_only=False) == ["Wacht Willi"]

    async def test_completion_leaves_exactly_one_leader_in_the_record(self, db_session, incident, user, mock_request):
        for name, role in (("Offi Oskar", "Offizier"), ("Wacht Wanda", "Wachtmeister"), ("Mann Milo", "Mannschaft")):
            await _assign(db_session, incident, await _person(db_session, name, role), user)

        await assignment_crud.auto_release_incident_resources(
            db=db_session, incident_id=incident.id, current_user=user, request=mock_request
        )
        await db_session.commit()

        # Releases happen one at a time and each promotes the next person; if the
        # flag stuck to released rows the whole crew would read as leaders.
        assert await _leaders(db_session, incident.id, active_only=False) == []


class TestManualLeader:
    async def test_manual_pick_pins_and_survives_a_higher_rank_arriving(self, db_session, incident, user, mock_request):
        mann = await _person(db_session, "Mann Mara", "Mannschaft")
        assignment = await _assign(db_session, incident, mann, user, mock_request)

        await assignment_crud.update_assignment(db_session, assignment.id, schemas.AssignmentUpdate(is_leader=True))
        await db_session.refresh(incident)
        assert incident.leader_manual is True

        await _assign(db_session, incident, await _person(db_session, "Offi Ida", "Offizier"), user)
        assert await _leaders(db_session, incident.id) == ["Mann Mara"]

    async def test_explicit_demote_hands_the_choice_back_to_the_board(self, db_session, incident, user, mock_request):
        mann = await _person(db_session, "Mann Nils", "Mannschaft")
        assignment = await _assign(db_session, incident, mann, user, mock_request)
        await assignment_crud.update_assignment(db_session, assignment.id, schemas.AssignmentUpdate(is_leader=True))

        await assignment_crud.update_assignment(db_session, assignment.id, schemas.AssignmentUpdate(is_leader=False))
        await db_session.refresh(incident)
        assert incident.leader_manual is False
        # Automatic selection resumes immediately rather than leaving nobody.
        assert await _leaders(db_session, incident.id) == ["Mann Nils"]

    async def test_non_personnel_cannot_be_marked_leader(self, db_session, incident, user, mock_request):
        vehicle = Vehicle(id=uuid4(), name="TLF Test", type="TLF", status="available")
        db_session.add(vehicle)
        await db_session.commit()

        va = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=incident.id,
            resource_type="vehicle",
            resource_id=vehicle.id,
            current_user=user,
            request=mock_request,
        )

        with pytest.raises(ValueError, match="Einsatzleiter"):
            await assignment_crud.update_assignment(db_session, va.id, schemas.AssignmentUpdate(is_leader=True))

    async def test_update_rejects_an_assignment_from_another_incident(
        self, db_session, incident, user, event, mock_request
    ):
        other = Incident(
            id=uuid4(),
            title="Other",
            type="brandbekaempfung",
            priority="low",
            status="incoming",
            event_id=event.id,
            created_by=user.id,
        )
        db_session.add(other)
        await db_session.commit()

        assignment = await _assign(db_session, incident, await _person(db_session, "Cross Chris", "Mannschaft"), user)
        result = await assignment_crud.update_assignment(
            db_session, assignment.id, schemas.AssignmentUpdate(is_leader=True), incident_id=other.id
        )
        assert result is None


class TestTransfer:
    async def test_transfer_re_derives_on_both_incidents(self, db_session, incident, user, event, mock_request):
        target = Incident(
            id=uuid4(),
            title="Transfer Target",
            type="brandbekaempfung",
            priority="low",
            status="incoming",
            event_id=event.id,
            created_by=user.id,
        )
        db_session.add(target)
        await db_session.commit()

        await _assign(db_session, incident, await _person(db_session, "Offi Ove", "Offizier"), user)
        assert await _leaders(db_session, incident.id) == ["Offi Ove"]

        await assignment_crud.transfer_assignments(
            db=db_session,
            source_incident_id=incident.id,
            target_incident_id=target.id,
            current_user=user,
            request=mock_request,
        )

        assert await _leaders(db_session, incident.id) == []
        assert await _leaders(db_session, target.id) == ["Offi Ove"]
