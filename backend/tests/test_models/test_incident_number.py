"""The per-Ereignis incident number («14»), assigned by the database trigger.

ORM inserts, raw SQL inserts and the API all get one without asking for it – the
number is what an operator types into ⌘K («14 tlf meier») and reads off the card.
"""

from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident


def _incident(event_id, **extra) -> Incident:
    return Incident(
        id=uuid4(),
        title="Wasser im Keller",
        type="elementarereignis",
        priority="medium",
        status="incoming",
        event_id=event_id,
        **extra,
    )


async def _event(db_session: AsyncSession, name: str) -> Event:
    event = Event(id=uuid4(), name=name, training_flag=False)
    db_session.add(event)
    await db_session.commit()
    return event


async def test_numbers_count_up_per_event(db_session: AsyncSession):
    first_event = await _event(db_session, "Unwetter A")
    other_event = await _event(db_session, "Unwetter B")

    a1 = _incident(first_event.id)
    db_session.add(a1)
    await db_session.commit()
    a2 = _incident(first_event.id)
    b1 = _incident(other_event.id)
    db_session.add_all([a2, b1])
    await db_session.commit()

    # Read back without a refresh: the ORM fetches the trigger's value on INSERT
    # (RETURNING), so an async caller never lazy-loads it.
    assert (a1.number, a2.number) == (1, 2)
    assert b1.number == 1


async def test_soft_deleted_numbers_are_not_reused(db_session: AsyncSession):
    event = await _event(db_session, "Sturm")
    first = _incident(event.id)
    db_session.add(first)
    await db_session.commit()
    await db_session.execute(text("UPDATE incidents SET deleted_at = now() WHERE id = :id"), {"id": first.id})

    second = _incident(event.id)
    db_session.add(second)
    await db_session.commit()
    assert second.number == 2


async def test_an_explicit_number_is_kept(db_session: AsyncSession):
    """A restored row brings its number along; the trigger only fills NULL."""
    event = await _event(db_session, "Wiederherstellung")
    restored = _incident(event.id, number=7)
    db_session.add(restored)
    await db_session.commit()
    after = _incident(event.id)
    db_session.add(after)
    await db_session.commit()
    assert (restored.number, after.number) == (7, 8)


async def test_raw_sql_inserts_are_numbered_too(db_session: AsyncSession):
    event = await _event(db_session, "Roh")
    await db_session.execute(
        text(
            "INSERT INTO incidents (id, event_id, title, type, priority, status, "
            "nachbarhilfe, am_warten, zu_fuss, pickup_needed, leader_manual) "
            "VALUES (:id, :event_id, 'x', 'elementarereignis', 'low', 'incoming', "
            "false, false, false, false, false)"
        ),
        {"id": uuid4(), "event_id": event.id},
    )
    numbers = (await db_session.execute(select(Incident.number).where(Incident.event_id == event.id))).scalars().all()
    assert numbers == [1]
