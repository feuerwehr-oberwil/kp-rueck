"""The assignment-slip payload is a wire contract with the print agent.

Unlike the HTTP API it has no schema and no drift test — it is a hand-built `dict[str, Any]`
on this side and `payload.get(...)` on the other. That is exactly how it came to be missing
two fields the printed slip needed: `training_flag` (so an exercise slip says so) and
`contact_phone` (the slip printed `Tel: {contact}`, and `contact` is the reporter's name).

These tests pin the fields the agent's formatter reads. `tools/print-agent/test_formatters.py`
pins what it does with them.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.crud.print_jobs import build_assignment_payload
from app.models import Event, Incident


async def _incident(db: AsyncSession, *, training: bool) -> Incident:
    event = Event(id=uuid4(), name="Testlage", training_flag=training, created_at=datetime.now(UTC))
    db.add(event)
    await db.flush()

    incident = Incident(
        id=uuid4(),
        event_id=event.id,
        title="Rauch aus dem Dachstock",
        type="brandbekaempfung",
        priority="high",
        status="incoming",
        location_address="Hauptstrasse 12, Oberwil",
        contact="Frau Meier",
        contact_phone="061 401 22 33",
        created_at=datetime.now(UTC),
    )
    db.add(incident)
    await db.commit()

    # `build_assignment_payload` walks `incident.assignments`, so it must arrive loaded —
    # the production call sites fetch it the same way.
    loaded = await db.execute(
        select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident.id)
    )
    return loaded.scalar_one()


@pytest.mark.asyncio
async def test_payload_carries_the_reporters_phone_number(db_session: AsyncSession):
    """The slip has a `Tel:` line; the number has to reach it."""
    incident = await _incident(db_session, training=False)
    payload = await build_assignment_payload(db_session, incident)

    assert payload["contact_phone"] == "061 401 22 33"
    # And the name stays separate — it is not a phone number.
    assert payload["contact"] == "Frau Meier"


@pytest.mark.asyncio
async def test_payload_says_whether_this_is_an_exercise(db_session: AsyncSession):
    """A training slip must be distinguishable from a real one after it is torn off.

    The board-snapshot payload has always carried this; the assignment slip — the sheet a
    crew carries to an address — did not even receive the flag.
    """
    training = await _incident(db_session, training=True)
    live = await _incident(db_session, training=False)

    assert (await build_assignment_payload(db_session, training))["training_flag"] is True
    assert (await build_assignment_payload(db_session, live))["training_flag"] is False


@pytest.mark.asyncio
async def test_payload_identifies_the_incident(db_session: AsyncSession):
    """Already present, now actually printed — pinned so it stays."""
    incident = await _incident(db_session, training=False)
    payload = await build_assignment_payload(db_session, incident)

    assert payload["incident_id"] == str(incident.id)


@pytest.mark.asyncio
async def test_payload_keeps_the_fields_the_formatter_reads(db_session: AsyncSession):
    """A rename on this side is silent until paper comes out wrong on the other."""
    incident = await _incident(db_session, training=False)
    payload = await build_assignment_payload(db_session, incident)

    for key in (
        "incident_id",
        "training_flag",
        "type",
        "priority",
        "location",
        "description",
        "contact",
        "contact_phone",
        "created_at",
        "crew",
        "vehicles",
        "materials",
        "zu_fuss",
        "nachbarhilfe",
        "nachbarhilfe_note",
        "internal_notes",
    ):
        assert key in payload, f"the print agent reads {key!r} and it is not in the payload"
