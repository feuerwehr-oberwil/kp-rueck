"""The field auto-move (sweep 27 §P3.3).

«Angekommen» moves the card to EINSATZ, «Einsatz beendet» to BEENDET /
RÜCKFAHRT — the two moves the FieldStatusNudge used to ask about, applied
instead of asked. The rules worth pinning:

* only a genuine `/feld` tap moves anything — a KP radio entry keeps the nudge
  as its manual path, and the GPS automation runs its own advance;
* strictly forward — a report about a card already at or past the target must
  not drag it backwards;
* provenance is field-originated: the transition row carries no user, the
  audit entry says ``source: feld``;
* `complete` is never entered or left — closing stays the operator's.
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import feld as crud
from app.models import AuditLog, Event, Incident, Notification, Personnel, StatusTransition, User


async def _person(db: AsyncSession, name: str = "Muster Hans") -> Personnel:
    person = Personnel(id=uuid.uuid4(), name=name, role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _incident(db: AsyncSession, event: Event, user: User, status: str) -> Incident:
    incident = Incident(
        id=uuid.uuid4(),
        title="Keller unter Wasser",
        type="elementarereignis",
        priority="medium",
        location_address="Mühlemattstrasse 8, Oberwil",
        status=status,
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


def _field_actor(person: Personnel) -> crud.FieldActor:
    return crud.FieldActor(personnel_id=person.id, personnel_name=person.name)


async def _transitions(db: AsyncSession, incident_id: uuid.UUID) -> list[StatusTransition]:
    result = await db.execute(
        select(StatusTransition).where(StatusTransition.incident_id == incident_id).order_by(StatusTransition.timestamp)
    )
    return list(result.scalars().all())


class TestArrivalMovesTheCard:
    """Field «Angekommen» → EINSATZ."""

    @pytest.mark.asyncio
    async def test_a_field_arrival_moves_enroute_to_active(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "enroute")
        person = await _person(db_session)

        await crud.record_arrival(
            db_session, incident, actor=_field_actor(person), at=datetime.now(UTC), only_if_unset=True
        )

        await db_session.refresh(incident)
        assert incident.status == "active"

        # Field-originated provenance: no user on the transition, `source: feld`
        # on the audit entry, and the notes say who reported it.
        transitions = await _transitions(db_session, incident.id)
        assert len(transitions) == 1
        assert transitions[0].from_status == "enroute"
        assert transitions[0].to_status == "active"
        assert transitions[0].user_id is None
        assert "Muster Hans" in (transitions[0].notes or "")

        audit = await db_session.execute(
            select(AuditLog).where(
                AuditLog.resource_id == incident.id,
                AuditLog.action_type == "status_change",
            )
        )
        entries = list(audit.scalars().all())
        assert len(entries) == 1
        assert entries[0].user_id is None
        assert (entries[0].changes_json or {}).get("source") == "feld"

    @pytest.mark.asyncio
    async def test_the_toast_announces_the_move(self, db_session: AsyncSession, test_event: Event, test_user: User):
        incident = await _incident(db_session, test_event, test_user, "enroute")
        person = await _person(db_session)

        await crud.record_arrival(db_session, incident, actor=_field_actor(person), at=datetime.now(UTC))

        result = await db_session.execute(
            select(Notification).where(Notification.incident_id == incident.id, Notification.type == "field_arrived")
        )
        notification = result.scalar_one()
        assert "verschoben" in notification.message
        assert "Einsatz" in notification.message

    @pytest.mark.asyncio
    async def test_an_arrival_never_drags_a_card_backwards(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "returning")
        person = await _person(db_session)

        await crud.record_arrival(db_session, incident, actor=_field_actor(person), at=datetime.now(UTC))

        await db_session.refresh(incident)
        assert incident.status == "returning"
        assert await _transitions(db_session, incident.id) == []

    @pytest.mark.asyncio
    async def test_a_kp_radio_entry_moves_nothing(self, db_session: AsyncSession, test_event: Event, test_user: User):
        """The operator may be recording history, not news — the nudge stays."""
        incident = await _incident(db_session, test_event, test_user, "enroute")

        await crud.record_arrival(db_session, incident, actor=crud.FieldActor(user=test_user), at=datetime.now(UTC))

        await db_session.refresh(incident)
        assert incident.status == "enroute"
        assert await _transitions(db_session, incident.id) == []


class TestCompleteMovesTheCard:
    """Field «Einsatz beendet» → BEENDET / RÜCKFAHRT, never `complete`."""

    @pytest.mark.asyncio
    async def test_a_field_complete_moves_active_to_returning(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "active")
        person = await _person(db_session)

        await crud.record_field_complete(
            db_session, incident, actor=_field_actor(person), at=datetime.now(UTC), only_if_unset=True
        )

        await db_session.refresh(incident)
        assert incident.status == "returning"
        transitions = await _transitions(db_session, incident.id)
        assert [t.to_status for t in transitions] == ["returning"]
        assert transitions[0].user_id is None

    @pytest.mark.asyncio
    async def test_a_completed_card_stays_completed(self, db_session: AsyncSession, test_event: Event, test_user: User):
        """`complete` is past `returning` — the report changes nothing."""
        incident = await _incident(db_session, test_event, test_user, "complete")
        person = await _person(db_session)

        await crud.record_field_complete(db_session, incident, actor=_field_actor(person), at=datetime.now(UTC))

        await db_session.refresh(incident)
        assert incident.status == "complete"
        assert await _transitions(db_session, incident.id) == []

    @pytest.mark.asyncio
    async def test_a_kp_complete_entry_moves_nothing(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident = await _incident(db_session, test_event, test_user, "active")

        await crud.record_field_complete(
            db_session, incident, actor=crud.FieldActor(user=test_user), at=datetime.now(UTC)
        )

        await db_session.refresh(incident)
        assert incident.status == "active"
        assert await _transitions(db_session, incident.id) == []
