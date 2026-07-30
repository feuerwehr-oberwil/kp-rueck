"""Tests for reko dashboard personnel open/done counts."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.reko_dashboard import get_reko_personnel_for_event
from app.models import (
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    Personnel,
    RekoReport,
    User,
)


async def _make_incident(db: AsyncSession, event: Event, user: User, title: str) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="brandbekaempfung",
        priority="high",
        location_address="Teststrasse 1",
        location_lat=47.5,
        location_lng=7.5,
        status="incoming",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    return incident


async def _assign(db: AsyncSession, incident: Incident, personnel: Personnel) -> None:
    db.add(
        IncidentAssignment(
            id=uuid4(),
            incident_id=incident.id,
            resource_type="personnel",
            resource_id=personnel.id,
        )
    )
    await db.commit()


async def _complete_reko(db: AsyncSession, incident: Incident, personnel: Personnel) -> None:
    db.add(
        RekoReport(
            id=uuid4(),
            incident_id=incident.id,
            token="t",
            is_draft=False,
            submitted_by_personnel_id=personnel.id,
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_open_vs_done_counts(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """An active assignment to an incident with a completed reko counts as done, not open."""
    # Mark personnel as a reko person for the event
    db_session.add(
        EventSpecialFunction(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            function_type="reko",
        )
    )
    await db_session.commit()

    # One incident still open, one already "Beendet" (completed reko)
    open_incident = await _make_incident(db_session, test_event, test_user, "Offen")
    done_incident = await _make_incident(db_session, test_event, test_user, "Beendet")
    await _assign(db_session, open_incident, test_personnel)
    await _assign(db_session, done_incident, test_personnel)
    await _complete_reko(db_session, done_incident, test_personnel)

    result = await get_reko_personnel_for_event(db_session, test_event.id)

    assert len(result) == 1
    person = result[0]
    assert person["open_count"] == 1
    assert person["done_count"] == 1
    assert person["assignment_count"] == 2


@pytest.mark.asyncio
async def test_all_done_has_zero_open(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """A reko person whose only assignment is completed shows 0 open, 1 done."""
    db_session.add(
        EventSpecialFunction(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            function_type="reko",
        )
    )
    await db_session.commit()

    done_incident = await _make_incident(db_session, test_event, test_user, "Beendet")
    await _assign(db_session, done_incident, test_personnel)
    await _complete_reko(db_session, done_incident, test_personnel)

    result = await get_reko_personnel_for_event(db_session, test_event.id)

    assert result[0]["open_count"] == 0
    assert result[0]["done_count"] == 1
