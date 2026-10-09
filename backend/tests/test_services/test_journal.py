"""Einsatztagebuch flush hook (services/journal.py) and the migration's backfill.

What is pinned: each fact worth keeping becomes exactly one row in the same transaction,
whatever path wrote it; the noise does not; a journal problem never fails the board write;
and the migration's backfill writes the same rows the live hook would have.
"""

import uuid
from datetime import UTC, datetime, timedelta

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
from app.services.audit_export_service import collect_event_report_data
from app.services.journal import journal_rows
from app.services.journal_backfill import backfill_journal
from app.services.pdf_report_service import build_journal_entries


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
        db_session.add(AuditLog(action_type="rapport_saved", resource_type="incident", resource_id=test_incident.id))
        # The bell is never a source: not the nags, and not the field bells either — their
        # facts come from the rows that record them once (see the next tests).
        for kind in ("time_overdue", "no_personnel", "field_message", "field_arrived", "vehicle_arrived"):
            db_session.add(
                Notification(
                    type=kind,
                    severity="info",
                    message=kind,
                    incident_id=test_incident.id,
                    event_id=test_incident.event_id,
                )
            )
        await db_session.commit()
        rows = [r for r in await _rows(db_session, test_incident.event_id) if r.kind != "incident"]
        assert rows == []

    async def test_field_facts_from_their_audit_rows_set_and_cleared(
        self, db_session: AsyncSession, test_incident: Incident, test_user: User
    ):
        radioed = datetime(2026, 6, 1, 9, 30, tzinfo=UTC)
        for action, changes in (
            ("field_arrived", {"arrived_at": radioed.isoformat(), "source": "kp"}),
            ("field_arrived_cleared", {"arrived_at": None, "source": "kp"}),
            ("field_pickup_requested", {"pickup_needed": True, "pickup_note": "3 Pers. beim Bach", "source": "feld"}),
            ("field_pickup_cleared", {"pickup_needed": False, "pickup_note": None, "source": "feld"}),
            ("field_complete", {"field_complete_reported_at": radioed.isoformat(), "source": "feld"}),
            ("rapport_submitted", {"is_draft": False, "source": "feld"}),
        ):
            db_session.add(
                AuditLog(
                    action_type=action,
                    resource_type="incident",
                    resource_id=test_incident.id,
                    user_id=test_user.id if changes["source"] == "kp" else None,
                    changes_json=changes,
                )
            )
        await db_session.commit()
        rows = {r.data["type"]: r for r in await _rows(db_session, test_incident.event_id) if r.kind == "field"}
        assert set(rows) == {
            "field_arrived",
            "field_arrived_cleared",
            "field_pickup_requested",
            "field_pickup_cleared",
            "field_complete",
            "rapport_submitted",
        }
        # a radioed arrival happened when the crew said, not when it was typed
        assert rows["field_arrived"].occurred_at == radioed
        assert rows["field_arrived"].author_name == "test_editor"
        assert rows["field_arrived"].data["source"] == "kp"
        assert rows["field_pickup_requested"].text == "3 Pers. beim Bach"
        assert rows["field_pickup_requested"].author_name is None

    async def test_gps_arrival_says_gps(self, db_session: AsyncSession, test_incident: Incident):
        from app.services.gps_automation import GPS_SYSTEM_USER_ID

        if await db_session.get(User, GPS_SYSTEM_USER_ID) is None:
            db_session.add(User(id=GPS_SYSTEM_USER_ID, username="gps-automation", password_hash="", role="editor"))
        db_session.add(
            AuditLog(
                action_type="field_arrived",
                resource_type="incident",
                resource_id=test_incident.id,
                user_id=GPS_SYSTEM_USER_ID,
                changes_json={"arrived_at": datetime.now(UTC).isoformat(), "source": "kp"},
            )
        )
        await db_session.commit()
        (row,) = [r for r in await _rows(db_session, test_incident.event_id) if r.kind == "field"]
        assert row.data["source"] == "gps"

    async def test_reko_arrival_once_per_change(self, db_session: AsyncSession, test_incident: Incident):
        reko = RekoReport(incident_id=test_incident.id, token="t", is_draft=True)
        db_session.add(reko)
        await db_session.commit()
        reko.arrived_at = datetime(2026, 6, 1, 9, 5, tzinfo=UTC)
        await db_session.commit()
        reko.summary_text = "unterwegs editiert"  # no new arrival line
        await db_session.commit()
        reko.arrived_at = None  # mis-heard on the radio
        await db_session.commit()
        types = [r.data["type"] for r in await _rows(db_session, test_incident.event_id) if r.kind == "field"]
        assert types == ["reko_arrived", "reko_arrived_cleared"]

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

    async def test_merge_and_unmerge_name_the_other_card(
        self, db_session: AsyncSession, test_event: Event, test_incident: Incident
    ):
        report = _incident(test_event, title="Meldung Hauptstr. 123")
        db_session.add(report)
        await db_session.commit()
        db_session.add(
            AuditLog(
                action_type="merge",
                resource_type="incident",
                resource_id=test_incident.id,
                changes_json={"merged_incident_id": str(report.id)},
            )
        )
        db_session.add(
            AuditLog(
                action_type="merged_into",
                resource_type="incident",
                resource_id=report.id,
                changes_json={"target_incident_id": str(test_incident.id)},
            )
        )
        for resource in (report.id, test_incident.id):
            db_session.add(
                AuditLog(
                    action_type="unmerge",
                    resource_type="incident",
                    resource_id=resource,
                    changes_json={"merged_incident_id": str(report.id), "target_incident_id": str(test_incident.id)},
                )
            )
        await db_session.commit()
        rows = [
            (r.incident_id, r.data["action"], r.data.get("other_title"))
            for r in await _rows(db_session, test_event.id)
            if r.kind == "incident" and r.data["action"] != "created"
        ]
        assert (test_incident.id, "merge", "Meldung Hauptstr. 123") in rows
        assert (report.id, "merged_into", "Wohnungsbrand") in rows
        assert (report.id, "unmerge", "Wohnungsbrand") in rows
        assert (test_incident.id, "unmerge", "Meldung Hauptstr. 123") in rows

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


async def _seed_history(db: AsyncSession, event: Event, user: User) -> Incident:
    """One Einsatz with a bit of everything, plus a duplicate report merged into it and then
    deleted; timestamps set explicitly. Returns the duplicate."""
    t0 = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
    inc = _incident(event, created_at=t0, created_by=user.id, source="divera")
    dup = _incident(event, title="Meldung Gartenweg", created_at=t0 + timedelta(minutes=2), source="intake")
    vehicle = Vehicle(id=uuid.uuid4(), name="TLF 1", type="TLF", status="available", radio_call_sign="Florian-1")
    person = Personnel(id=uuid.uuid4(), name="Meier Anna", role="Feuerwehrmann", status="available")
    db.add_all([inc, dup, vehicle, person])
    await db.flush()
    at = lambda m: t0 + timedelta(minutes=m)
    db.add_all(
        [
            StatusTransition(
                incident_id=inc.id, from_status="incoming", to_status="enroute", user_id=user.id, timestamp=at(1)
            ),
            IncidentAssignment(
                incident_id=inc.id,
                resource_type="vehicle",
                resource_id=vehicle.id,
                assigned_by=user.id,
                assigned_at=at(2),
                unassigned_at=at(40),
            ),
            IncidentAssignment(incident_id=inc.id, resource_type="personnel", resource_id=person.id, assigned_at=at(3)),
            RekoReport(
                incident_id=inc.id,
                token="x",
                is_draft=False,
                summary_text="Lage stabil",
                submitted_by_personnel_id=person.id,
                submitted_at=at(10),
                arrived_at=at(6),
                arrived_reported_by_user_id=user.id,
            ),
            IncidentFieldMessage(
                incident_id=inc.id, message="Bitte Rückmeldung", author_name="Dispo", created_at=at(11)
            ),
            AuditLog(
                action_type="field_message",
                resource_type="incident",
                resource_id=inc.id,
                changes_json={"message": "Brand aus", "personnel_name": "Meier Anna", "source": "feld"},
                timestamp=at(12),
            ),
            AuditLog(
                action_type="divera_alarm",
                resource_type="incident",
                resource_id=inc.id,
                user_id=user.id,
                changes_json={"recipients": ["a", "b", "c"]},
                timestamp=at(1),
            ),
            AuditLog(
                action_type="field_arrived",
                resource_type="incident",
                resource_id=inc.id,
                changes_json={"arrived_at": at(5).isoformat(), "source": "feld"},
                timestamp=at(5),
            ),
            AuditLog(
                action_type="field_pickup_requested",
                resource_type="incident",
                resource_id=inc.id,
                user_id=user.id,
                changes_json={"pickup_needed": True, "pickup_note": "beim Bach", "source": "kp"},
                timestamp=at(50),
            ),
            AuditLog(
                action_type="merge",
                resource_type="incident",
                resource_id=inc.id,
                user_id=user.id,
                changes_json={"merged_incident_id": str(dup.id)},
                timestamp=at(4),
            ),
            AuditLog(
                action_type="merged_into",
                resource_type="incident",
                resource_id=dup.id,
                user_id=user.id,
                changes_json={"target_incident_id": str(inc.id)},
                timestamp=at(4),
            ),
            # the bell is not a source — neither for the hook nor for the backfill
            Notification(
                type="vehicle_arrived",
                severity="info",
                message="TLF 1 vor Ort",
                incident_id=inc.id,
                event_id=event.id,
                created_at=at(5),
            ),
        ]
    )
    dup.deleted_at = at(4)
    await db.commit()
    return dup


# 2 created, status, 3 assignment lines, Reko + its arrival, 2 Meldungen, alarm,
# arrival, pickup, merge + merged_into
ROWS_PER_HISTORY = 15


def _shape(rows: list[JournalEntry]) -> list[tuple]:
    return sorted(
        (
            r.kind,
            r.occurred_at,
            r.text,
            tuple(sorted((k, v) for k, v in (r.data or {}).items() if k != "other_incident_id")),
            r.author_name,
            (r.source_key or "").split(":")[0],
        )
        for r in rows
    )


async def _run_backfill(db: AsyncSession) -> int:
    return await backfill_journal(await db.connection())


async def test_backfill_writes_what_the_hook_writes_and_only_once(db_session: AsyncSession, test_user: User):
    live = Event(id=uuid.uuid4(), name="live")
    old = Event(id=uuid.uuid4(), name="old")
    db_session.add_all([live, old])
    await db_session.commit()

    await _seed_history(db_session, live, test_user)

    # «old»: the same history written by an instance that had no hook
    db_session.info["journal_disabled"] = True
    try:
        await _seed_history(db_session, old, test_user)
    finally:
        db_session.info["journal_disabled"] = False
    assert await _rows(db_session, old.id) == []

    hook_rows = await _rows(db_session, live.id)
    assert len(hook_rows) == ROWS_PER_HISTORY

    # the boot backfill fills the old Ereignis and adds NOTHING to the live one — same keys
    assert await _run_backfill(db_session) == ROWS_PER_HISTORY
    assert len(await _rows(db_session, live.id)) == ROWS_PER_HISTORY
    old_rows = await _rows(db_session, old.id)
    # Same facts, same wording data, same authors — only ids and the incident differ.
    assert _shape(old_rows) == _shape(hook_rows)

    # every later boot: nothing to do
    assert await _run_backfill(db_session) == 0


async def test_pdf_marks_merged_and_deleted_lines(db_session: AsyncSession, test_user: User):
    event = Event(id=uuid.uuid4(), name="pdf")
    db_session.add(event)
    await db_session.commit()
    dup = await _seed_history(db_session, event, test_user)
    gone = _incident(event, title="Fehlalarm Schulhaus")
    db_session.add(gone)
    await db_session.commit()
    gone.deleted_at = datetime.now(UTC)
    await db_session.commit()

    data = await collect_event_report_data(db_session, event.id)
    refs = {e.incident_ref for e in build_journal_entries(data)}
    assert "Meldung Gartenweg (zusammengeführt in «Kellerbrand Gartenweg»)" in refs
    assert "Fehlalarm Schulhaus (gelöscht)" in refs
    assert "Kellerbrand Gartenweg" in refs
    texts = {e.text for e in build_journal_entries(data)}
    assert "Meldung «Meldung Gartenweg» zusammengeführt" in texts
    assert "Vor Ort gemeldet" in texts
    assert "Abholung nötig: beim Bach (im KP erfasst)" in texts
    assert "Reko vor Ort (im KP erfasst)" in texts
    assert dup.id in {r.incident_id for r in data.journal}


async def test_a_reader_past_its_cursor_also_gets_the_last_two_minutes(
    db_session: AsyncSession, test_incident: Incident
):
    """`seq` is handed out at INSERT, a transaction commits later: a row with a LOWER seq
    can become visible after the reader moved past it. The overlap brings it back."""
    old = JournalEntry(
        event_id=test_incident.event_id,
        kind="manual",
        text="vor langer Zeit",
        created_at=datetime.now(UTC) - timedelta(minutes=10),
    )
    db_session.add(old)
    await db_session.commit()
    rows = await journal_rows(db_session, test_incident.event_id)
    cursor = max(r.seq for r in rows)
    again = await journal_rows(db_session, test_incident.event_id, since_seq=cursor)
    # the recent ones come again (the client merges by id), the old one does not
    assert {r.id for r in again} == {r.id for r in rows if r.text != "vor langer Zeit"}
    assert again
