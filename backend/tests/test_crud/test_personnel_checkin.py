"""Tests for Personnel Check-in CRUD operations.

Tests cover:
- get_available_personnel: Get personnel with check-in status
- check_in_personnel: Check in personnel for an event
- check_out_personnel: Check out personnel from an event
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.crud import personnel_checkin as checkin_crud
from app.models import (
    Event,
    EventAttendance,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    Personnel,
    User,
)

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def unavailable_personnel(db_session: AsyncSession) -> Personnel:
    """Create unavailable personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Unavailable Person",
        role="firefighter",
        status="unavailable",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def multiple_personnel(db_session: AsyncSession) -> list[Personnel]:
    """Create multiple test personnel."""
    personnel_list = []
    for i, status in enumerate(["available", "available", "available", "unavailable"]):
        person = Personnel(
            id=uuid4(),
            name=f"Person {i}",
            role="firefighter",
            status=status,
        )
        db_session.add(person)
        personnel_list.append(person)

    await db_session.commit()
    for p in personnel_list:
        await db_session.refresh(p)
    return personnel_list


@pytest.fixture
def mock_request():
    """Create a mock FastAPI request."""
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


# ============================================
# Test: get_available_personnel
# ============================================


class TestGetAvailablePersonnel:
    """Tests for get_available_personnel function."""

    async def test_returns_available_personnel(
        self,
        db_session: AsyncSession,
        test_event: Event,
        multiple_personnel: list[Personnel],
    ):
        """Test getting available personnel for an event."""
        result = await checkin_crud.get_available_personnel(
            db=db_session,
            event_id=test_event.id,
            include_checked_out=True,
        )

        # Should return 3 available personnel (not the unavailable one)
        assert len(result) == 3

    async def test_excludes_unavailable_personnel(
        self,
        db_session: AsyncSession,
        test_event: Event,
        unavailable_personnel: Personnel,
        test_personnel: Personnel,
    ):
        """Test that unavailable personnel are excluded."""
        result = await checkin_crud.get_available_personnel(
            db=db_session,
            event_id=test_event.id,
            include_checked_out=True,
        )

        ids = [p.id for p in result]
        assert test_personnel.id in ids
        assert unavailable_personnel.id not in ids

    async def test_shows_checked_in_status(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """Test that check-in status is correctly shown."""
        # Check in the personnel
        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        result = await checkin_crud.get_available_personnel(
            db=db_session,
            event_id=test_event.id,
            include_checked_out=True,
        )

        assert len(result) == 1
        assert result[0].checked_in is True
        assert result[0].checked_in_at is not None

    async def test_filter_checked_in_only(
        self,
        db_session: AsyncSession,
        test_event: Event,
        multiple_personnel: list[Personnel],
    ):
        """Test filtering to only checked-in personnel."""
        # Check in only the first person
        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=multiple_personnel[0].id,
        )

        result = await checkin_crud.get_available_personnel(
            db=db_session,
            event_id=test_event.id,
            include_checked_out=False,
        )

        assert len(result) == 1
        assert result[0].id == multiple_personnel[0].id

    async def test_shows_assignment_status(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_incident: Incident,
        test_personnel: Personnel,
        test_user: User,
    ):
        """Test that assignment status is correctly shown."""
        # Assign personnel to incident
        assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment)
        await db_session.commit()

        result = await checkin_crud.get_available_personnel(
            db=db_session,
            event_id=test_event.id,
            include_checked_out=True,
        )

        assert len(result) == 1
        assert result[0].is_assigned is True


# ============================================
# Test: check_in_personnel
# ============================================


class TestCheckInPersonnel:
    """Tests for check_in_personnel function."""

    async def test_check_in_success(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """Test successfully checking in personnel."""
        result = await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        assert result is not None
        assert result.id == test_personnel.id
        assert result.checked_in is True
        assert result.checked_in_at is not None

    async def test_check_in_creates_attendance_record(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """Test that check-in creates an EventAttendance record."""
        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        # Verify attendance record exists
        result = await db_session.execute(
            select(EventAttendance).where(
                EventAttendance.event_id == test_event.id,
                EventAttendance.personnel_id == test_personnel.id,
            )
        )
        attendance = result.scalar_one_or_none()

        assert attendance is not None
        assert attendance.checked_in is True

    async def test_check_in_unavailable_fails(
        self,
        db_session: AsyncSession,
        test_event: Event,
        unavailable_personnel: Personnel,
    ):
        """Test that checking in unavailable personnel fails."""
        with pytest.raises(ValueError, match="unavailable"):
            await checkin_crud.check_in_personnel(
                db=db_session,
                event_id=test_event.id,
                personnel_id=unavailable_personnel.id,
            )

    async def test_check_in_nonexistent_returns_none(
        self,
        db_session: AsyncSession,
        test_event: Event,
    ):
        """Test that checking in nonexistent personnel returns None."""
        result = await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=uuid4(),
        )

        assert result is None

    async def test_check_in_already_checked_in(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """Test checking in already checked-in personnel returns current status."""
        # First check-in
        first_result = await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        # Second check-in should return same status
        second_result = await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        assert second_result.checked_in is True
        assert second_result.checked_in_at == first_result.checked_in_at

    async def test_re_check_in_after_check_out(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """Test checking in after checking out updates the record."""
        # Check in
        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        # Check out
        await checkin_crud.check_out_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        # Check in again
        result = await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        assert result.checked_in is True

    async def test_resume_takes_back_the_check_out(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """The board's undo of «Auschecken»: the same stint, its start and plan kept."""
        first = await checkin_crud.check_in_personnel(
            db=db_session, event_id=test_event.id, personnel_id=test_personnel.id
        )
        until = datetime.now(UTC) + timedelta(hours=3)
        await checkin_crud.set_attendance_plan(
            db_session, test_event.id, test_personnel.id, schemas.AttendancePlanUpdate(planned_until=until)
        )
        out = await checkin_crud.check_out_personnel(
            db=db_session, event_id=test_event.id, personnel_id=test_personnel.id
        )

        result = await checkin_crud.check_in_personnel(
            db=db_session, event_id=test_event.id, personnel_id=test_personnel.id, resume=out.checked_out_at
        )

        assert result.checked_in is True
        assert result.checked_out_at is None
        assert result.checked_in_at == first.checked_in_at
        assert result.planned_until == until

    async def test_resume_refuses_somebody_elses_later_departure(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """A checks out; B checks in and out again; A's undo must not reopen B's stint."""
        ids = {"db": db_session, "event_id": test_event.id, "personnel_id": test_personnel.id}
        await checkin_crud.check_in_personnel(**ids)
        a_out = await checkin_crud.check_out_personnel(**ids)
        await checkin_crud.check_in_personnel(**ids)
        await checkin_crud.check_out_personnel(**ids)

        with pytest.raises(checkin_crud.CheckOutChangedError):
            await checkin_crud.check_in_personnel(**ids, resume=a_out.checked_out_at)

    async def test_resume_after_a_cleared_row_is_refused(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """B cleared the attendance: the undo has nothing to take back, and checks nobody in."""
        ids = {"db": db_session, "event_id": test_event.id, "personnel_id": test_personnel.id}
        await checkin_crud.check_in_personnel(**ids)
        out = await checkin_crud.check_out_personnel(**ids)
        await checkin_crud.clear_personnel_attendance(**ids)

        with pytest.raises(checkin_crud.CheckOutChangedError):
            await checkin_crud.check_in_personnel(**ids, resume=out.checked_out_at)
        row = await db_session.scalar(select(EventAttendance).where(EventAttendance.personnel_id == test_personnel.id))
        assert row is None


# ============================================
# Test: check_out_personnel
# ============================================


class TestCheckOutPersonnel:
    """Tests for check_out_personnel function."""

    async def test_check_out_success(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """Test successfully checking out personnel."""
        # First check in
        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        # Then check out
        result = await checkin_crud.check_out_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        assert result is not None
        assert result.checked_in is False
        assert result.checked_out_at is not None

    async def test_check_out_nonexistent_returns_none(
        self,
        db_session: AsyncSession,
        test_event: Event,
    ):
        """Test checking out nonexistent personnel returns None."""
        result = await checkin_crud.check_out_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=uuid4(),
        )

        assert result is None

    async def test_check_out_assigned_fails(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_incident: Incident,
        test_personnel: Personnel,
        test_user: User,
    ):
        """Test checking out assigned personnel fails."""
        # Check in first
        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        # Assign to incident
        assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment)
        await db_session.commit()

        # Check out should fail
        with pytest.raises(ValueError, match="assigned to an incident"):
            await checkin_crud.check_out_personnel(
                db=db_session,
                event_id=test_event.id,
                personnel_id=test_personnel.id,
            )

    async def test_refuse_bound_stops_a_check_out_of_somebody_on_an_einsatz(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_incident: Incident,
        test_personnel: Personnel,
        test_user: User,
    ):
        """A stale popover showed the person free; the server knows better and says so."""
        ids = {"db": db_session, "event_id": test_event.id, "personnel_id": test_personnel.id}
        await checkin_crud.check_in_personnel(**ids)
        db_session.add(
            IncidentAssignment(
                incident_id=test_incident.id,
                resource_type="personnel",
                resource_id=test_personnel.id,
                assigned_by=test_user.id,
            )
        )
        await db_session.commit()

        with pytest.raises(checkin_crud.PersonStillBoundError):
            await checkin_crud.check_out_personnel(**ids, allow_assigned=True, refuse_bound=True)

    async def test_refuse_bound_counts_a_function(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """A function binds like an Einsatz: Kommandoposten is a reason to ask too."""
        ids = {"db": db_session, "event_id": test_event.id, "personnel_id": test_personnel.id}
        await checkin_crud.check_in_personnel(**ids)
        db_session.add(
            EventSpecialFunction(event_id=test_event.id, personnel_id=test_personnel.id, function_type="kommandoposten")
        )
        await db_session.commit()

        with pytest.raises(checkin_crud.PersonStillBoundError):
            await checkin_crud.check_out_personnel(**ids, allow_assigned=True, refuse_bound=True)

        free = await checkin_crud.check_out_personnel(**ids, allow_assigned=True)
        assert free.checked_in is False

    async def test_check_out_already_checked_out(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """Test checking out already checked-out personnel returns current status."""
        # Check in then check out
        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )
        first_result = await checkin_crud.check_out_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        # Check out again
        second_result = await checkin_crud.check_out_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        assert second_result.checked_in is False
        assert second_result.checked_out_at == first_result.checked_out_at
        # The second call wrote nothing: a stale popover must not offer to undo the first.
        assert first_result.changed is True
        assert second_result.changed is False

    async def test_check_out_never_checked_in(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ):
        """Test checking out personnel who was never checked in creates record."""
        result = await checkin_crud.check_out_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )

        assert result is not None
        assert result.checked_in is False
        assert result.checked_out_at is not None

        # Verify attendance record exists
        attendance_result = await db_session.execute(
            select(EventAttendance).where(
                EventAttendance.event_id == test_event.id,
                EventAttendance.personnel_id == test_personnel.id,
            )
        )
        attendance = attendance_result.scalar_one_or_none()
        assert attendance is not None
        assert attendance.checked_in is False


# ============================================
# Availability gates the check-in — and nothing else
# ============================================


class TestStatusGatesCheckIn:
    """`status` decides who is OFFERED a check-in. That is its whole job.

    It is deliberately not retroactive: somebody already checked in and working an Einsatz
    stays there when an officer flips the roster flag. Pulling a person off a running Einsatz
    because a setting changed would rewrite the crew list that gets read out on the radio and
    printed on the Einsatzzettel — the flag means "do not offer them next time", not "they are
    not here".

    Both directions below already worked; they are pinned here because nothing did so before,
    and because the honest answer to "why does the roster flag not affect the board?" is easier to
    trust with a test next to it.
    """

    @pytest.mark.asyncio
    async def test_unavailable_personnel_are_not_offered_for_checkin(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
        unavailable_personnel: Personnel,
    ):
        """They must not appear in the check-in list at all — refusing at submit is worse."""
        roster = await checkin_crud.get_available_personnel(db=db_session, event_id=test_event.id)
        names = {p.name for p in roster}
        assert test_personnel.name in names
        assert unavailable_personnel.name not in names

    @pytest.mark.asyncio
    async def test_checking_in_an_unavailable_person_is_refused(
        self,
        db_session: AsyncSession,
        test_event: Event,
        unavailable_personnel: Personnel,
    ):
        """Belt and braces: the roster hides them, and the call itself still says no."""
        with pytest.raises(ValueError, match="unavailable"):
            await checkin_crud.check_in_personnel(
                db=db_session,
                event_id=test_event.id,
                personnel_id=unavailable_personnel.id,
            )

    @pytest.mark.asyncio
    async def test_marking_unavailable_leaves_a_running_einsatz_alone(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_incident: Incident,
        test_personnel: Personnel,
        test_user: User,
    ):
        """The point of the whole class: a running Einsatz keeps its crew."""
        from app.crud import personnel as personnel_crud

        await checkin_crud.check_in_personnel(
            db=db_session,
            event_id=test_event.id,
            personnel_id=test_personnel.id,
        )
        assignment = IncidentAssignment(
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
        )
        db_session.add(assignment)
        await db_session.commit()

        await personnel_crud.update_personnel(
            db=db_session,
            personnel_id=test_personnel.id,
            personnel_data=schemas.PersonnelUpdate(status="unavailable"),
            current_user=test_user,
            request=MagicMock(client=MagicMock(host="127.0.0.1"), headers={}),
        )
        await db_session.commit()
        await db_session.refresh(assignment)

        attendance = (
            await db_session.execute(
                select(EventAttendance).where(
                    EventAttendance.event_id == test_event.id,
                    EventAttendance.personnel_id == test_personnel.id,
                )
            )
        ).scalar_one()

        assert assignment.unassigned_at is None, "they stay on the Einsatz"
        assert attendance.checked_in is True, "and stay checked in — they are still here"
