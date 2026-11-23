"""The Chronik shows the facts a notification announced (owner round 23.11.2026, #1).

They are read from the incident's journal rows, so these tests write the facts the way the
app does and look at what `timeline` returns.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import feld as crud
from app.models import AuditLog, Event, Incident, Personnel, User
from app.services.incident_history import timeline
from app.services.vehicle_facts import record_vehicle_fact

pytestmark = pytest.mark.asyncio


async def test_field_facts_and_the_feld_reporter_are_in_the_chronik(
    db_session: AsyncSession, test_event: Event, test_user: User
):
    reporter = Personnel(id=uuid.uuid4(), name="Meier Anna", role="Feuerwehrmann", status="available")
    db_session.add(reporter)
    await db_session.flush()
    incident = Incident(
        id=uuid.uuid4(),
        title="Baum auf Strasse",
        type="elementarereignis",
        priority="medium",
        status="active",
        event_id=test_event.id,
        reported_by_personnel_id=reporter.id,
    )
    db_session.add(incident)
    await db_session.flush()
    # `crud/feld/melden` keeps the name as reported; a later rename does not rewrite it.
    db_session.add(
        AuditLog(
            action_type="create",
            resource_type="incident",
            resource_id=incident.id,
            changes_json={"source": "feld", "reported_by": "Meier Anna"},
        )
    )
    await db_session.commit()
    actor = crud.FieldActor(personnel_id=reporter.id, personnel_name=reporter.name)

    await crud.record_pickup(db_session, incident, actor=actor, needed=False)
    await record_vehicle_fact(
        db_session, incident_id=incident.id, fact="vehicle_down", vehicle_name="TLF 1", source="training"
    )
    await db_session.commit()

    facts = [
        (e.journal_data or {}).get("type") for e in await timeline(db_session, incident) if e.event_type == "journal"
    ]
    assert sorted(facts) == ["field_pickup_self", "field_reported", "vehicle_down"]
    reporter.name = "Meier-Huber Anna"
    await db_session.commit()
    events = {(e.journal_data or {}).get("type"): e for e in await timeline(db_session, incident)}
    assert events["field_reported"].actor_name == "Meier Anna"
    assert events["field_pickup_self"].actor_name == "Meier Anna"
    assert events["vehicle_down"].message == "TLF 1"


async def test_a_vehicle_fact_is_written_once_per_assignment(db_session: AsyncSession, test_incident: Incident):
    assignment_id = uuid.uuid4()
    for _ in range(2):
        await record_vehicle_fact(
            db_session,
            incident_id=test_incident.id,
            fact="vehicle_on_site",
            vehicle_name="TLF 1",
            source="gps",
            assignment_id=assignment_id,
        )
        await db_session.commit()
    rows = (
        await db_session.execute(
            select(AuditLog).where(AuditLog.resource_id == test_incident.id, AuditLog.action_type == "vehicle_on_site")
        )
    ).all()
    assert len(rows) == 1


async def test_a_rolled_back_vehicle_fact_is_written_on_the_next_poll(
    db_session: AsyncSession, test_incident: Incident
):
    # No process cache: a poll whose transaction fails must not make the next one skip it.
    assignment_id, incident_id = uuid.uuid4(), test_incident.id  # a rollback expires the row

    async def record() -> bool:
        return await record_vehicle_fact(
            db_session,
            incident_id=incident_id,
            fact="vehicle_on_site",
            vehicle_name="TLF 1",
            source="gps",
            assignment_id=assignment_id,
        )

    assert await record()
    await db_session.rollback()
    assert await record()
    await db_session.commit()
    assert not await record()
