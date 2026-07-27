"""The bulk Reko summary carries what the command post reads off it.

The photos the Reko takes on site are the most useful part of a Reko result, and
they used to live only inside the Reko form — the one surface the command post
never opens. The summary is what the board and the Anzeige-Ansichten read, so it
has to carry them.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.reko import get_reko_summaries_by_event
from app.models import Event, Incident, RekoReport, User


async def _incident(db: AsyncSession, event: Event, user: User) -> Incident:
    incident = Incident(
        id=uuid4(),
        title="Sturmschaden",
        type="elementarereignis",
        priority="medium",
        location_address="Poststrasse 6",
        status="reko",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    return incident


@pytest.mark.asyncio
async def test_summary_carries_the_photos_and_the_text(db_session: AsyncSession, test_user: User, test_event: Event):
    incident = await _incident(db_session, test_event, test_user)
    db_session.add(
        RekoReport(
            id=uuid4(),
            incident_id=incident.id,
            token="t",
            is_draft=False,
            submitted_at=datetime.now(UTC),
            summary_text="Dach abgedeckt, Ziegel auf der Strasse.",
            photos_json=["a.jpg", "b.jpg"],
        )
    )
    await db_session.commit()

    summaries = await get_reko_summaries_by_event(db_session, test_event.id)

    summary = summaries[incident.id]
    assert summary["has_completed_reko"] is True
    assert summary["photos_json"] == ["a.jpg", "b.jpg"]
    assert summary["summary_text"] == "Dach abgedeckt, Ziegel auf der Strasse."


@pytest.mark.asyncio
async def test_a_report_without_photos_reads_as_an_empty_list(
    db_session: AsyncSession, test_user: User, test_event: Event
):
    """Never None: the clients map straight onto `.length`."""
    incident = await _incident(db_session, test_event, test_user)
    db_session.add(
        RekoReport(
            id=uuid4(),
            incident_id=incident.id,
            token="t",
            is_draft=False,
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    summaries = await get_reko_summaries_by_event(db_session, test_event.id)

    assert summaries[incident.id]["photos_json"] == []


@pytest.mark.asyncio
async def test_an_incident_without_a_reko_still_has_an_entry(
    db_session: AsyncSession, test_user: User, test_event: Event
):
    incident = await _incident(db_session, test_event, test_user)

    summaries = await get_reko_summaries_by_event(db_session, test_event.id)

    assert summaries[incident.id]["has_completed_reko"] is False
    assert summaries[incident.id]["photos_json"] == []
