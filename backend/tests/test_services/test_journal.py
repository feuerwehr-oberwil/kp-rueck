"""Einsatztagebuch flush hook (services/journal.py) and the migration's backfill.

What is pinned: each fact worth keeping becomes exactly one row in the same transaction,
whatever path wrote it; the noise does not; a journal problem never fails the board write;
and the migration's backfill writes the same rows the live hook would have.
"""

import importlib.util
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    Event,
    Incident,
    IncidentAssignment,
    IncidentFieldMessage,
    JournalEntry,
    Notification,
    Personnel,
    RekoReport,
    StatusTransition,
    User,
    Vehicle,
)
from app.services import journal as journal_service


async def _rows(db: AsyncSession, event_id: uuid.UUID) -> list[JournalEntry]:
    result = await db.execute(select(JournalEntry).where(JournalEntry.event_id == event_id).order_by(JournalEntry.seq))
    return list(result.scalars().all())


def _incident(event: Event, **kw) -> Incident:
    return Incident(
        id=kw.pop("id", uuid.uuid4()),
        event_id=event.id,
        title=kw.pop("title", "Kellerbrand Gartenweg"),
        type="brandbekaempfung",
        priority="medium",
        status="incoming",
        **kw,
    )


pytestmark = pytest.mark.asyncio


class TestHook:
    async def test_new_incident_is_recorded_with_title_and_source(self, db_session: AsyncSession, test_event: Event):
        db_session.add(_incident(test_event, source="intake"))
        await db_session.commit()
        (row,) = await _rows(db_session, test_event.id)
        assert row.kind == "incident"
        assert row.data == {"action": "created", "title": "Kellerbrand Gartenweg", "source": "intake"}

    async def test_status_change_records_from_to_and_who(
        self, db_session: AsyncSession, test_incident: Incident, test_user: User
    ):
        db_session.add(
            StatusTransition(
                incident_id=test_incident.id, from_status="incoming", to_status="reko", user_id=test_user.id
            )
        )
        await db_session.commit()
        rows = [r for r in await _rows(db_session, test_incident.event_id) if r.kind == "status"]
        assert len(rows) == 1
        assert rows[0].data == {"from_status": "incoming", "to_status": "reko"}
        assert rows[0].author_name == "test_editor"
        assert rows[0].incident_id == test_incident.id

    async def test_status_change_through_the_api(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_incident
    ):
        response = await editor_client.post(
            f"/api/incidents/{test_incident.id}/status",
            json={"from_status": "incoming", "to_status": "reko"},
        )
        assert response.status_code == 200, response.text
        kinds = [r.kind for r in await _rows(db_session, test_incident.event_id)]
        assert kinds.count("status") == 1

    async def test_assign_release_and_undo(self, db_session: AsyncSession, test_incident: Incident):
        vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available", radio_call_sign="Florian-1")
        db_session.add(vehicle)
        await db_session.commit()
        a = IncidentAssignment(incident_id=test_incident.id, resource_type="vehicle", resource_id=vehicle.id)
        db_session.add(a)
        await db_session.commit()
        a.unassigned_at = datetime.now(UTC)
        await db_session.commit()
        a.unassigned_at = None  # the release taken back
        await db_session.commit()

        rows = [r for r in await _rows(db_session, test_incident.event_id) if r.kind == "assignment"]
        assert [r.data["action"] for r in rows] == ["assigned", "unassigned", "assigned"]
        assert {r.data["resource_name"] for r in rows} == {"TLF 1 (Florian-1)"}

    async def test_other_assignment_edits_are_not_recorded(self, db_session: AsyncSession, test_incident: Incident):
        person = Personnel(id=uuid.uuid4(), name="Meier Anna", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()
        a = IncidentAssignment(incident_id=test_incident.id, resource_type="personnel", resource_id=person.id)
        db_session.add(a)
        await db_session.commit()
        a.is_leader = True
        await db_session.commit()
        rows = [r for r in await _rows(db_session, test_incident.event_id) if r.kind == "assignment"]
        assert len(rows) == 1

    async def test_reko_draft_is_not_recorded_until_filed(self, db_session: AsyncSession, test_incident: Incident):
        reko = RekoReport(incident_id=test_incident.id, token="t", is_draft=True, summary_text="Halb fertig")
        db_session.add(reko)
        await db_session.commit()
        assert not [r for r in await _rows(db_session, test_incident.event_id) if r.kind == "reko"]
        reko.is_draft = False
        reko.summary_text = "Wasser im Keller, 20 cm"
        await db_session.commit()
        (row,) = [r for r in await _rows(db_session, test_incident.event_id) if r.kind == "reko"]
        assert row.text == "Wasser im Keller, 20 cm"

    async def test_messages_both_directions(self, db_session: AsyncSession, test_incident: Incident):
        db_session.add(
            IncidentFieldMessage(incident_id=test_incident.id, message="Rückzug über Hauptstrasse", author_name="Dispo")
        )
        db_session.add(
            AuditLog(
                action_type="field_message",
                resource_type="incident",
                resource_id=test_incident.id,
                changes_json={"message": "Brand aus", "personnel_name": "Brunner Marco", "source": "feld"},
            )
        )
        await db_session.commit()
        rows = {r.data["direction"]: r for r in await _rows(db_session, test_incident.event_id) if r.kind == "message"}
        assert rows["to_field"].text == "Rückzug über Hauptstrasse"
        assert rows["to_field"].author_name == "Dispo"
        assert rows["from_field"].text == "Brand aus"
        assert rows["from_field"].author_name == "Brunner Marco"

    async def test_noise_stays_out(self, db_session: AsyncSession, test_incident: Incident):
        db_session.add(AuditLog(action_type="update", resource_type="incident", resource_id=test_incident.id))
        db_session.add(AuditLog(action_type="export", resource_type="incident", resource_id=test_incident.id))
        for kind in ("time_overdue", "no_personnel", "field_message"):
            db_session.add(
                Notification(
                    type=kind,
                    severity="info",
                    message=kind,
                    incident_id=test_incident.id,
                    event_id=test_incident.event_id,
                )
            )
        db_session.add(
            Notification(
                type="field_arrived",
                severity="info",
                message="Angekommen: Hauptstrasse 123",
                incident_id=test_incident.id,
                event_id=test_incident.event_id,
            )
        )
        await db_session.commit()
        rows = [r for r in await _rows(db_session, test_incident.event_id) if r.kind not in ("incident",)]
        assert [(r.kind, r.text) for r in rows] == [("field", "Angekommen: Hauptstrasse 123")]

    async def test_divera_alarm_and_delete_restore(self, db_session: AsyncSession, test_incident: Incident):
        db_session.add(
            AuditLog(
                action_type="divera_alarm",
                resource_type="incident",
                resource_id=test_incident.id,
                changes_json={"recipients": ["a", "b"]},
            )
        )
        db_session.add(AuditLog(action_type="delete", resource_type="incident", resource_id=test_incident.id))
        db_session.add(AuditLog(action_type="restore", resource_type="incident", resource_id=test_incident.id))
        await db_session.commit()
        rows = await _rows(db_session, test_incident.event_id)
        assert ("alarm", {"recipients": 2}) in [(r.kind, r.data) for r in rows]
        actions = [r.data["action"] for r in rows if r.kind == "incident"]
        assert "deleted" in actions and "restored" in actions

    async def test_a_journal_failure_never_fails_the_board_write(
        self, db_session: AsyncSession, test_incident: Incident, monkeypatch
    ):
        def boom(*_a, **_k):
            raise RuntimeError("journal broken")

        monkeypatch.setattr(journal_service, "resource_display_name", boom)
        person = Personnel(id=uuid.uuid4(), name="Meier Anna", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()
        db_session.add(
            IncidentAssignment(incident_id=test_incident.id, resource_type="personnel", resource_id=person.id)
        )
        await db_session.commit()  # does not raise
        saved = await db_session.execute(
            select(IncidentAssignment).where(IncidentAssignment.incident_id == test_incident.id)
        )
        assert saved.scalars().one()


def _backfill_statements() -> tuple[str, ...]:
    path = next(Path(__file__).parents[2].joinpath("alembic", "versions").glob("*_journal_entries.py"))
    spec = importlib.util.spec_from_file_location("journal_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.BACKFILL


async def _seed_history(db: AsyncSession, event: Event, user: User) -> None:
    """One Einsatz with a bit of everything, timestamps set explicitly."""
    t0 = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
    inc = _incident(event, created_at=t0, created_by=user.id, source="divera")
    vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available", radio_call_sign="Florian-1")
    person = Personnel(id=uuid.uuid4(), name="Meier Anna", role="Feuerwehrmann", status="available")
    db.add_all([inc, vehicle, person])
    await db.flush()
    db.add_all(
        [
            StatusTransition(
                incident_id=inc.id,
                from_status="incoming",
                to_status="enroute",
                user_id=user.id,
                timestamp=t0 + timedelta(minutes=1),
            ),
            IncidentAssignment(
                incident_id=inc.id,
                resource_type="vehicle",
                resource_id=vehicle.id,
                assigned_by=user.id,
                assigned_at=t0 + timedelta(minutes=2),
                unassigned_at=t0 + timedelta(minutes=40),
            ),
            IncidentAssignment(
                incident_id=inc.id,
                resource_type="personnel",
                resource_id=person.id,
                assigned_at=t0 + timedelta(minutes=3),
            ),
            RekoReport(
                incident_id=inc.id,
                token="x",
                is_draft=False,
                summary_text="Lage stabil",
                submitted_by_personnel_id=person.id,
                submitted_at=t0 + timedelta(minutes=10),
            ),
            IncidentFieldMessage(
                incident_id=inc.id,
                message="Bitte Rückmeldung",
                author_name="Dispo",
                created_at=t0 + timedelta(minutes=11),
            ),
            AuditLog(
                action_type="field_message",
                resource_type="incident",
                resource_id=inc.id,
                changes_json={"message": "Brand aus", "personnel_name": "Meier Anna", "source": "feld"},
                timestamp=t0 + timedelta(minutes=12),
            ),
            AuditLog(
                action_type="divera_alarm",
                resource_type="incident",
                resource_id=inc.id,
                user_id=user.id,
                changes_json={"recipients": ["a", "b", "c"]},
                timestamp=t0 + timedelta(minutes=1),
            ),
            Notification(
                type="field_arrived",
                severity="info",
                message="Angekommen",
                incident_id=inc.id,
                event_id=event.id,
                created_at=t0 + timedelta(minutes=5),
            ),
        ]
    )
    await db.commit()


def _shape(rows: list[JournalEntry]) -> list[tuple]:
    return sorted(
        (
            r.kind,
            r.occurred_at,
            r.text,
            tuple(sorted((r.data or {}).items())),
            r.author_name,
            (r.source_key or "").split(":")[0],
        )
        for r in rows
    )


async def test_backfill_writes_what_the_hook_writes(db_session: AsyncSession, test_user: User):
    live = Event(id=uuid.uuid4(), name="live")
    old = Event(id=uuid.uuid4(), name="old")
    db_session.add_all([live, old])
    await db_session.commit()

    await _seed_history(db_session, live, test_user)

    db_session.info["journal_disabled"] = True
    try:
        await _seed_history(db_session, old, test_user)
    finally:
        db_session.info["journal_disabled"] = False
    assert await _rows(db_session, old.id) == []

    # the migration's backfill, over everything in the (rolled-back) test transaction
    conn = await db_session.connection()
    live_ids = {r.id for r in await _rows(db_session, live.id)}
    for statement in _backfill_statements():
        await conn.exec_driver_sql(statement)
    backfilled_live = [r for r in await _rows(db_session, live.id) if r.id not in live_ids]

    hook_rows = [r for r in await _rows(db_session, live.id) if r.id in live_ids]
    old_rows = await _rows(db_session, old.id)
    assert len(old_rows) == len(hook_rows) == 10
    # Same facts, same wording data, same authors — only ids and the incident differ.
    assert _shape(old_rows) == _shape(hook_rows)
    # (and the backfill does not know which rows the hook already wrote — it runs once,
    # in the migration, on a table that is empty)
    assert len(backfilled_live) == len(hook_rows)
