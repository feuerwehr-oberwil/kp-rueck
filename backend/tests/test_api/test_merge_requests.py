"""Requests from the field follow a merge (owner decision 09.10.2026, R2 × R13).

A card with field requests — open or done, an Abholung included — is mergeable:
the requests move to the surviving card with their whole history, their bell
entries follow, the journal says «übernommen von …», the crew's `/feld` view
follows, and «Trennen» moves them back. One open Abholung per Einsatz: when
both cards have one, the surviving card's stays open with both notes and the
duplicate's is answered by the merge.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.feld.visibility import visible_by_personnel
from app.models import (
    AuditLog,
    Event,
    FieldRequest,
    Incident,
    IncidentAssignment,
    JournalEntry,
    Notification,
    Personnel,
)

LAT, LNG = Decimal("47.51500000"), Decimal("7.55600000")


@pytest.fixture(autouse=True)
def _quiet_broadcasts():
    with (
        patch("app.api.incidents.broadcast_incident_update", new_callable=AsyncMock),
        patch("app.api.incidents.trigger_sync_background", new_callable=AsyncMock),
    ):
        yield


async def _card(db: AsyncSession, event: Event, title: str, **fields: object) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="elementarereignis",
        priority="low",
        location_address=title,
        location_lat=LAT,
        location_lng=LNG,
        status="incoming",
        event_id=event.id,
        **fields,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _pair(db: AsyncSession, event: Event) -> tuple[UUID, UUID]:
    target = await _card(db, event, "Hauptstrasse 6")
    dup = await _card(db, event, "Hauptstr. 6", possible_duplicate_of_id=target.id)
    return target.id, dup.id


async def _pickup(client: AsyncClient, incident_id: UUID, note: str) -> None:
    response = await client.post(
        f"/api/incidents/{incident_id}/field-report", json={"pickup_needed": True, "pickup_note": note}
    )
    assert response.status_code == 200, response.text


async def _merge(client: AsyncClient, dup_id: UUID, target_id: UUID) -> dict:
    response = await client.post(f"/api/incidents/{dup_id}/merge", json={"target_id": str(target_id)})
    assert response.status_code == 200, response.text
    return response.json()


async def _unmerge(client: AsyncClient, dup_id: UUID) -> dict:
    response = await client.post(f"/api/incidents/{dup_id}/unmerge")
    assert response.status_code == 200, response.text
    return response.json()


async def _requests(db: AsyncSession, incident_id: UUID) -> list[FieldRequest]:
    rows = await db.execute(
        select(FieldRequest)
        .where(FieldRequest.incident_id == incident_id)
        .order_by(FieldRequest.created_at)
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars().all())


async def _incident(db: AsyncSession, incident_id: UUID) -> Incident:
    return await db.get(Incident, incident_id, populate_existing=True)


class TestRequestsMove:
    async def test_requests_open_and_done_move_with_history_and_come_back(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target_id, dup_id = await _pair(db_session, test_event)
        material = await editor_client.post(
            f"/api/incidents/{dup_id}/field-requests", json={"kind": "material", "item": "Tauchpumpe", "quantity": 2}
        )
        message = await editor_client.post(
            f"/api/incidents/{dup_id}/field-requests", json={"message": "Zufahrt hinten"}
        )
        assert material.status_code == message.status_code == 201
        done = await editor_client.patch(
            f"/api/incidents/{dup_id}/field-requests/{message.json()['id']}", json={"status": "done"}
        )
        assert done.status_code == 200, done.text
        # A bell entry that announced one of them.
        bell = Notification(
            type="field_message", severity="info", message="Material nötig", incident_id=dup_id, event_id=test_event.id
        )
        db_session.add(bell)
        await db_session.commit()
        bell_id = bell.id

        body = await _merge(editor_client, dup_id, target_id)

        moved = await _requests(db_session, target_id)
        assert {r.label for r in moved} == {"Material: Tauchpumpe ×2", "Zufahrt hinten"}
        by_label = {r.label: r for r in moved}
        # History intact: the handled one is still handled, by whom it was.
        assert by_label["Zufahrt hinten"].status == "done"
        assert by_label["Zufahrt hinten"].done_at is not None
        assert by_label["Material: Tauchpumpe ×2"].status == "open"
        assert await _requests(db_session, dup_id) == []
        # The card shows them where the work now is.
        assert {r["label"] for r in body["target"]["field_requests"]} == {"Material: Tauchpumpe ×2"}
        # The bell follows.
        assert (await db_session.get(Notification, bell_id, populate_existing=True)).incident_id == target_id
        # Audited and in the journal: «übernommen von …».
        moves = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.action_type == "field_request_moved", AuditLog.resource_id == target_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(moves) == 2
        journal = (
            (
                await db_session.execute(
                    select(JournalEntry).where(JournalEntry.incident_id == target_id, JournalEntry.kind == "field")
                )
            )
            .scalars()
            .all()
        )
        moved_lines = [j for j in journal if (j.data or {}).get("type") == "field_request_moved"]
        assert len(moved_lines) == 2
        assert all(j.data["other_title"] == "Hauptstr. 6" for j in moved_lines)

        await _unmerge(editor_client, dup_id)
        assert {r.label for r in await _requests(db_session, dup_id)} == {"Material: Tauchpumpe ×2", "Zufahrt hinten"}
        assert await _requests(db_session, target_id) == []
        assert (await db_session.get(Notification, bell_id, populate_existing=True)).incident_id == dup_id

    async def test_the_verlauf_of_the_surviving_card_carries_the_duplicates_messages(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target_id, dup_id = await _pair(db_session, test_event)
        db_session.add(
            AuditLog(
                action_type="field_message",
                resource_type="incident",
                resource_id=dup_id,
                changes_json={"message": "Wasser steigt", "personnel_name": "Frey Marc"},
            )
        )
        await db_session.commit()
        await _merge(editor_client, dup_id, target_id)
        events = (await editor_client.get(f"/api/incidents/{target_id}/timeline")).json()["events"]
        assert any(e["event_type"] == "field_message" and e["message"] == "Wasser steigt" for e in events)


class TestOneAbholung:
    async def test_only_the_duplicate_waits_the_surviving_card_now_does(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target_id, dup_id = await _pair(db_session, test_event)
        await _pickup(editor_client, dup_id, "3 Personen beim Bach")

        body = await _merge(editor_client, dup_id, target_id)
        assert body["target"]["pickup_needed"] is True
        assert body["target"]["pickup_note"] == "3 Personen beim Bach"
        (row,) = await _requests(db_session, target_id)
        assert (row.kind, row.status) == ("pickup", "open")

        await _unmerge(editor_client, dup_id)
        target, dup = await _incident(db_session, target_id), await _incident(db_session, dup_id)
        assert target.pickup_needed is False
        assert dup.pickup_needed is True
        (back,) = await _requests(db_session, dup_id)
        assert (back.kind, back.status) == ("pickup", "open")

    async def test_both_wait_one_abholung_with_both_notes(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target_id, dup_id = await _pair(db_session, test_event)
        await _pickup(editor_client, target_id, "2 Personen")
        await _pickup(editor_client, dup_id, "3 Personen beim Bach")

        body = await _merge(editor_client, dup_id, target_id)
        assert body["target"]["pickup_note"] == "2 Personen + 3 Personen beim Bach"
        rows = await _requests(db_session, target_id)
        open_pickups = [r for r in rows if r.kind == "pickup" and r.status in ("open", "in_progress")]
        assert len(open_pickups) == 1  # the partial unique index holds
        assert open_pickups[0].text == "2 Personen + 3 Personen beim Bach"
        closed = [r for r in rows if r.kind == "pickup" and r.status == "done"]
        assert len(closed) == 1 and closed[0].done_at is not None
        # The duplicate's «Abholung nötig» bells are answered; the surviving card's are not.
        bells = (
            (
                await db_session.execute(
                    select(Notification)
                    .where(Notification.incident_id == target_id, Notification.type == "field_pickup")
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        assert any(not b.dismissed for b in bells)

        # Separated while still waiting: each card waits for its own car again.
        await _unmerge(editor_client, dup_id)
        target, dup = await _incident(db_session, target_id), await _incident(db_session, dup_id)
        assert target.pickup_note == "2 Personen"
        assert dup.pickup_needed is True
        (dup_row,) = await _requests(db_session, dup_id)
        assert dup_row.status == "open"

    async def test_a_joint_abholung_handled_before_trennen_stays_handled(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target_id, dup_id = await _pair(db_session, test_event)
        await _pickup(editor_client, target_id, "2 Personen")
        await _pickup(editor_client, dup_id, "3 Personen")
        await _merge(editor_client, dup_id, target_id)
        cleared = await editor_client.post(f"/api/incidents/{target_id}/field-report", json={"pickup_needed": False})
        assert cleared.status_code == 200

        await _unmerge(editor_client, dup_id)
        dup = await _incident(db_session, dup_id)
        assert dup.pickup_needed is False
        assert [r.status for r in await _requests(db_session, dup_id)] == ["done"]

    async def test_a_copied_abholung_handled_on_the_surviving_card_comes_back_handled(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target_id, dup_id = await _pair(db_session, test_event)
        await _pickup(editor_client, dup_id, "3 Personen")
        await _merge(editor_client, dup_id, target_id)
        await editor_client.post(f"/api/incidents/{target_id}/field-report", json={"pickup_needed": False})

        await _unmerge(editor_client, dup_id)
        dup = await _incident(db_session, dup_id)
        assert dup.pickup_needed is False
        assert [r.status for r in await _requests(db_session, dup_id)] == ["done"]


class TestTheCrewFollows:
    async def test_a_released_crew_finds_the_surviving_card_on_feld(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        from datetime import UTC, datetime

        target_id, dup_id = await _pair(db_session, test_event)
        person = Personnel(id=uuid4(), name="Frey Marc", role="Feuerwehrmann", status="available")
        db_session.add(person)
        db_session.add(
            IncidentAssignment(
                incident_id=dup_id,
                resource_type="personnel",
                resource_id=person.id,
                purpose="crew",
                unassigned_at=datetime.now(UTC),
            )
        )
        await db_session.commit()
        person_id = person.id
        await editor_client.post(f"/api/incidents/{dup_id}/field-requests", json={"message": "Pumpe läuft"})

        await _merge(editor_client, dup_id, target_id)
        visible = await visible_by_personnel(db_session, test_event.id)
        assert target_id in visible[person_id]
        assert dup_id not in visible[person_id]
