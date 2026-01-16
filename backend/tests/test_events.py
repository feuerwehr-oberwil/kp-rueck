"""Tests for event CRUD operations."""

from datetime import datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.crud import events as crud
from app.models import Incident


@pytest.mark.asyncio
async def test_create_event(db_session: AsyncSession):
    """Test creating a new event."""
    event_data = schemas.EventCreate(name="Test Event", training_flag=True)
    event = await crud.create_event(db_session, event_data)

    assert event.name == "Test Event"
    assert event.training_flag is True
    assert event.archived_at is None
    assert event.id is not None
    assert isinstance(event.created_at, datetime)
    assert isinstance(event.last_activity_at, datetime)


@pytest.mark.asyncio
async def test_get_events(db_session: AsyncSession):
    """Test getting all events."""
    # Create multiple events
    event1_data = schemas.EventCreate(name="Event 1", training_flag=False)
    event2_data = schemas.EventCreate(name="Event 2", training_flag=True)

    await crud.create_event(db_session, event1_data)
    await crud.create_event(db_session, event2_data)

    # Get all events
    events = await crud.get_events(db_session)

    assert len(events) == 2
    assert events[0].name in ["Event 1", "Event 2"]
    assert events[1].name in ["Event 1", "Event 2"]


@pytest.mark.asyncio
async def test_get_events_exclude_archived(db_session: AsyncSession):
    """Test that archived events are excluded by default."""
    # Create events
    event1_data = schemas.EventCreate(name="Active Event", training_flag=False)
    event2_data = schemas.EventCreate(name="Archived Event", training_flag=False)

    await crud.create_event(db_session, event1_data)
    event2 = await crud.create_event(db_session, event2_data)

    # Archive one event
    await crud.archive_event(db_session, event2.id)

    # Get events without archived
    events = await crud.get_events(db_session, include_archived=False)
    assert len(events) == 1
    assert events[0].name == "Active Event"

    # Get events with archived
    events_with_archived = await crud.get_events(db_session, include_archived=True)
    assert len(events_with_archived) == 2


@pytest.mark.asyncio
async def test_get_event_by_id(db_session: AsyncSession):
    """Test getting a single event by ID."""
    event_data = schemas.EventCreate(name="Specific Event", training_flag=False)
    created_event = await crud.create_event(db_session, event_data)

    # Retrieve by ID
    event = await crud.get_event_by_id(db_session, created_event.id)

    assert event is not None
    assert event.id == created_event.id
    assert event.name == "Specific Event"


@pytest.mark.asyncio
async def test_get_event_by_id_not_found(db_session: AsyncSession):
    """Test getting a non-existent event returns None."""
    import uuid

    fake_id = uuid.uuid4()
    event = await crud.get_event_by_id(db_session, fake_id)

    assert event is None


@pytest.mark.asyncio
async def test_update_event(db_session: AsyncSession):
    """Test updating an event."""
    event_data = schemas.EventCreate(name="Original Name", training_flag=False)
    event = await crud.create_event(db_session, event_data)

    # Update event
    update_data = schemas.EventUpdate(name="Updated Name", training_flag=True)
    updated_event = await crud.update_event(db_session, event.id, update_data)

    assert updated_event is not None
    assert updated_event.name == "Updated Name"
    assert updated_event.training_flag is True
    assert updated_event.id == event.id


@pytest.mark.asyncio
async def test_archive_event(db_session: AsyncSession):
    """Test archiving an event."""
    event_data = schemas.EventCreate(name="Archive Test", training_flag=False)
    event = await crud.create_event(db_session, event_data)

    # Archive event
    archived = await crud.archive_event(db_session, event.id)

    assert archived is not None
    assert archived.archived_at is not None
    assert isinstance(archived.archived_at, datetime)


@pytest.mark.asyncio
async def test_delete_archived_event(db_session: AsyncSession):
    """Test deleting an archived event."""
    event_data = schemas.EventCreate(name="Delete Test", training_flag=False)
    event = await crud.create_event(db_session, event_data)

    # Archive first
    await crud.archive_event(db_session, event.id)

    # Delete
    success = await crud.delete_event(db_session, event.id)
    assert success is True

    # Verify deleted
    deleted_event = await crud.get_event_by_id(db_session, event.id)
    assert deleted_event is None


@pytest.mark.asyncio
async def test_delete_non_archived_event_fails(db_session: AsyncSession):
    """Test that deleting a non-archived event raises an error."""
    event_data = schemas.EventCreate(name="Delete Fail Test", training_flag=False)
    event = await crud.create_event(db_session, event_data)

    # Try to delete without archiving first
    with pytest.raises(ValueError, match="must be archived"):
        await crud.delete_event(db_session, event.id)


@pytest.mark.asyncio
async def test_get_event_incident_count(db_session: AsyncSession, test_user):
    """Test getting incident count for an event."""
    # Create event
    event_data = schemas.EventCreate(name="Count Test", training_flag=False)
    event = await crud.create_event(db_session, event_data)

    # Initially should be 0
    count = await crud.get_event_incident_count(db_session, event.id)
    assert count == 0

    # Add some incidents
    incident1 = Incident(
        event_id=event.id,
        title="Incident 1",
        type="brandbekaempfung",
        priority="high",
        status="eingegangen",
    )
    incident2 = Incident(
        event_id=event.id,
        title="Incident 2",
        type="strassenrettung",
        priority="medium",
        status="eingegangen",
    )

    db_session.add(incident1)
    db_session.add(incident2)
    await db_session.commit()

    # Now count should be 2
    count = await crud.get_event_incident_count(db_session, event.id)
    assert count == 2


@pytest.mark.asyncio
async def test_cascade_delete_incidents(db_session: AsyncSession):
    """Test that deleting an event cascades to incidents."""
    # Create event
    event_data = schemas.EventCreate(name="Cascade Test", training_flag=False)
    event = await crud.create_event(db_session, event_data)

    # Create incident
    incident = Incident(
        event_id=event.id,
        title="Test Incident",
        type="brandbekaempfung",
        priority="medium",
        status="eingegangen",
    )
    db_session.add(incident)
    await db_session.commit()
    incident_id = incident.id

    # Archive and delete event
    await crud.archive_event(db_session, event.id)
    await crud.delete_event(db_session, event.id)

    # Verify incident is also deleted (cascade)
    from sqlalchemy import select

    result = await db_session.execute(select(Incident).where(Incident.id == incident_id))
    deleted_incident = result.scalar_one_or_none()
    assert deleted_incident is None


@pytest.mark.asyncio
async def test_update_event_activity(db_session: AsyncSession):
    """Test updating event activity timestamp."""
    event_data = schemas.EventCreate(name="Activity Test", training_flag=False)
    event = await crud.create_event(db_session, event_data)

    original_activity = event.last_activity_at

    # Wait a tiny bit to ensure timestamp difference
    import asyncio

    await asyncio.sleep(0.01)

    # Update activity
    await crud.update_event_activity(db_session, event.id)

    # Refresh and check
    await db_session.refresh(event)
    assert event.last_activity_at > original_activity


@pytest.mark.asyncio
async def test_events_ordered_by_activity(db_session: AsyncSession):
    """Test that events are returned ordered by last_activity_at descending."""
    # Create events with different activity timestamps
    event1_data = schemas.EventCreate(name="Event 1", training_flag=False)
    event2_data = schemas.EventCreate(name="Event 2", training_flag=False)
    event3_data = schemas.EventCreate(name="Event 3", training_flag=False)

    await crud.create_event(db_session, event1_data)
    event2 = await crud.create_event(db_session, event2_data)
    await crud.create_event(db_session, event3_data)

    # Update activity on event2 (make it most recent)
    import asyncio

    await asyncio.sleep(0.01)
    await crud.update_event_activity(db_session, event2.id)

    # Get events
    events = await crud.get_events(db_session)

    # First should be event2 (most recent activity)
    assert events[0].id == event2.id
