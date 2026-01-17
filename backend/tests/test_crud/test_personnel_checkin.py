"""Tests for Personnel Check-in CRUD operations.

Tests cover:
- get_available_personnel: Get personnel with check-in status
- check_in_personnel: Check in personnel for an event
- check_out_personnel: Check out personnel from an event
"""

from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import personnel_checkin as checkin_crud
from app.models import (
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    Personnel,
    User,
)


# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="checkin_crud_editor",
        password_hash="hashed_password",
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Check-in CRUD Test Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_user: User, test_event: Event) -> Incident:
    """Create a test incident."""
    incident = Incident(
        id=uuid4(),
        title="Test Incident",
        type="brandbekaempfung",
        priority="high",
        location_address="Test Street 1",
        status="eingegangen",
        event_id=test_event.id,
        created_by=test_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Test Firefighter",
        role="atemschutz",
        availability="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def unavailable_personnel(db_session: AsyncSession) -> Personnel:
    """Create unavailable personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Unavailable Person",
        role="firefighter",
        availability="unavailable",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def multiple_personnel(db_session: AsyncSession) -> list[Personnel]:
    """Create multiple test personnel."""
    personnel_list = []
    for i, availability in enumerate(["available", "available", "available", "unavailable"]):
        person = Personnel(
            id=uuid4(),
            name=f"Person {i}",
            role="firefighter",
            availability=availability,
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
