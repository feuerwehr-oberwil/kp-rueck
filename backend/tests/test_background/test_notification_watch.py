"""The rules are evaluated on a clock: a board on a live socket never asks by itself."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.background import notification_watch
from app.models import Event, Incident, Notification


@pytest.mark.asyncio
async def test_an_einsatz_that_becomes_overdue_is_noticed_and_the_boards_are_told_once(
    db_session: AsyncSession, test_editor, monkeypatch
):
    event = Event(id=uuid4(), name="Unwetter", training_flag=False)
    incident = Incident(
        id=uuid4(),
        title="Keller",
        type="elementarereignis",
        priority="high",
        status="incoming",
        event_id=event.id,
        created_by=test_editor.id,
    )
    db_session.add_all([event, incident])
    await db_session.commit()
    maker = async_sessionmaker(bind=db_session.bind, expire_on_commit=False, join_transaction_mode="create_savepoint")
    told = AsyncMock()
    monkeypatch.setattr(notification_watch, "broadcast_notification_update", told)
    monkeypatch.setattr(notification_watch, "_seen", {})

    # The first look has nothing to compare with.
    assert await notification_watch.evaluate_open_events(maker) == []

    # Two hours pass with nobody touching the board (the default threshold is 60 minutes).
    await db_session.execute(
        update(Incident).where(Incident.id == incident.id).values(created_at=datetime.now(UTC) - timedelta(hours=2))
    )
    await db_session.commit()

    assert await notification_watch.evaluate_open_events(maker) == [event.id]
    told.assert_awaited_once_with({"event_id": str(event.id)}, "refresh")
    overdue = await db_session.scalars(
        select(Notification).where(Notification.event_id == event.id, Notification.type == "time_overdue")
    )
    assert [n.incident_id for n in overdue] == [incident.id]

    # Nothing new: nobody is told again.
    assert await notification_watch.evaluate_open_events(maker) == []
    told.assert_awaited_once()


@pytest.mark.asyncio
async def test_an_archived_ereignis_is_left_alone(db_session: AsyncSession, monkeypatch):
    event = Event(id=uuid4(), name="Alt", training_flag=False, archived_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    maker = async_sessionmaker(bind=db_session.bind, expire_on_commit=False, join_transaction_mode="create_savepoint")
    seen: dict = {}
    monkeypatch.setattr(notification_watch, "_seen", seen)

    await notification_watch.evaluate_open_events(maker)

    assert event.id not in seen
