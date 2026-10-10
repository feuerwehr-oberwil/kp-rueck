"""Duplicate reports: candidates, merge, «Trennen» and the automatic doors' flag.

The rules under test (services/duplicates.py):

- a candidate is an OPEN card of the SAME Ereignis within 50 m or at a
  normalised-equal address — closed, deleted, merged cards and other
  Ereignisse never are;
- a merge appends the second report to the first card's «Notizen», fills an
  empty Melder, keeps the report's own row (soft-deleted, provenance intact)
  and is audited; «Trennen» undoes exactly that and nothing an operator
  changed since;
- the automatic doors (webhook auto-attach, public /alarm, bulk attach) never
  merge — they create the card and flag it.
"""

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    DiveraEmergency,
    Event,
    Incident,
    Personnel,
    Setting,
    User,
)
from app.services.tokens import generate_alarm_token
from tests.conftest import feld_device_token

# Oberwil, Hauptstrasse. 0.0001° of latitude is ~11 m.
LAT, LNG = Decimal("47.51500000"), Decimal("7.55600000")


def _offset(metres_north: float) -> Decimal:
    return (LAT + Decimal(str(metres_north / 111_195))).quantize(Decimal("0.00000001"))


async def _card(
    db: AsyncSession,
    event: Event,
    *,
    address: str | None = "Hauptstrasse 6, 4104 Oberwil",
    lat: Decimal | None = LAT,
    lng: Decimal | None = LNG,
    status: str = "incoming",
    priority: str = "low",
    **fields: object,
) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=address or "Baum",
        type="elementarereignis",
        priority=priority,
        location_address=address,
        location_lat=lat,
        location_lng=lng if lat is not None else None,
        status=status,
        event_id=event.id,
        **fields,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _candidates(client: AsyncClient, event: Event, **params: object) -> list[dict]:
    query = {"event_id": str(event.id), **{k: str(v) for k, v in params.items()}}
    response = await client.get("/api/incidents/duplicate-candidates", params=query)
    assert response.status_code == 200, response.text
    return response.json()["candidates"]


def _new_report(event: Event, **fields: object) -> dict:
    return {
        "event_id": str(event.id),
        "title": "Hauptstr. 6",
        "type": "elementarereignis",
        "priority": "low",
        "location_address": "Hauptstr. 6",
        "location_lat": str(_offset(40)),
        "location_lng": str(LNG),
        "status": "incoming",
        "description": "Wasser im Keller",
        "contact": "Meier",
        "contact_phone": "079 123 45 67",
        "source": "intake",
        **fields,
    }


@pytest.fixture(autouse=True)
def _quiet_broadcasts():
    """Nobody is connected; the broadcasts would only try."""
    with (
        patch("app.api.incidents.broadcast_incident_update", new_callable=AsyncMock),
        patch("app.api.incidents.trigger_sync_background", new_callable=AsyncMock),
    ):
        yield


class TestCandidates:
    async def test_within_50_m_matches_and_says_how_far(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        card = await _card(db_session, test_event, address=None)
        found = await _candidates(editor_client, test_event, lat=_offset(40), lng=LNG)
        assert [c["id"] for c in found] == [str(card.id)]
        assert found[0]["match"] == "distance"
        assert 38 <= found[0]["distance_m"] <= 42

    async def test_beyond_50_m_does_not(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        await _card(db_session, test_event, address=None)
        assert await _candidates(editor_client, test_event, lat=_offset(60), lng=LNG) == []

    async def test_the_same_address_matches_without_any_pin(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        card = await _card(db_session, test_event, lat=None)
        found = await _candidates(editor_client, test_event, address="Hauptstr. 6")
        assert [(c["id"], c["match"], c["distance_m"]) for c in found] == [(str(card.id), "address", None)]
        # Another house on the street is not the same door.
        assert await _candidates(editor_client, test_event, address="Hauptstrasse 8") == []

    async def test_closed_deleted_and_merged_cards_are_never_candidates(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        open_card = await _card(db_session, test_event)
        await _card(db_session, test_event, status="complete")
        await _card(db_session, test_event, deleted_at=datetime.now(UTC))
        await _card(db_session, test_event, merged_into_id=open_card.id, deleted_at=datetime.now(UTC))
        found = await _candidates(editor_client, test_event, lat=LAT, lng=LNG, address="Hauptstrasse 6")
        assert [c["id"] for c in found] == [str(open_card.id)]
        assert found[0]["match"] == "both"

    async def test_another_ereignis_is_never_a_candidate(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        other = Event(id=uuid4(), name="Anderes Ereignis", training_flag=False)
        db_session.add(other)
        await db_session.commit()
        await _card(db_session, other)
        assert await _candidates(editor_client, test_event, lat=LAT, lng=LNG, address="Hauptstrasse 6") == []

    async def test_nearest_first(self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event) -> None:
        far = await _card(db_session, test_event, address=None, lat=_offset(45))
        near = await _card(db_session, test_event, address=None, lat=_offset(5))
        found = await _candidates(editor_client, test_event, lat=LAT, lng=LNG)
        assert [c["id"] for c in found] == [str(near.id), str(far.id)]


async def _merge_new(client: AsyncClient, event: Event, target: Incident, **fields: object):
    return await client.post(
        "/api/incidents/merge-report", json={"target_id": str(target.id), "incident": _new_report(event, **fields)}
    )


async def _audit(db: AsyncSession, resource_id: UUID, action: str) -> list[AuditLog]:
    rows = await db.execute(select(AuditLog).where(AuditLog.resource_id == resource_id, AuditLog.action_type == action))
    return list(rows.scalars().all())


class TestMergeBeforeACardExists:
    async def test_the_report_becomes_a_nachtrag_and_no_card(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, internal_notes="Zufahrt hinten")
        response = await _merge_new(editor_client, test_event, target)
        assert response.status_code == 200, response.text
        body = response.json()

        notes = body["target"]["internal_notes"]
        assert notes.startswith("Zufahrt hinten\nWeitere Meldung ")
        assert "(Telefon): Wasser im Keller · Hauptstr. 6 · Melder: Meier, 079 123 45 67" in notes
        # The empty Melder on the card is filled; the card's own data is not touched otherwise.
        assert body["target"]["contact"] == "Meier"
        assert body["target"]["contact_phone"] == "079 123 45 67"
        assert body["target"]["location_address"] == "Hauptstrasse 6, 4104 Oberwil"

        # No new card on the board…
        board = await editor_client.get("/api/incidents/", params={"event_id": str(test_event.id)})
        assert [i["id"] for i in board.json()] == [str(target.id)]
        # …but the report row exists, hidden, pointing at the card, provenance intact.
        report = await db_session.get(Incident, UUID(body["merged_incident_id"]))
        await db_session.refresh(report)
        assert report.merged_into_id == target.id
        assert report.deleted_at is not None
        assert report.source == "intake"
        assert report.contact_phone == "079 123 45 67"

        # Audited on both rows — without the PII.
        (merge,) = await _audit(db_session, target.id, "merge")
        assert merge.changes_json["merged_incident_id"] == str(report.id)
        assert merge.changes_json["filled_fields"] == ["contact", "contact_phone"]
        # The phone number, not «079»: the row also carries UUIDs, and one of them containing
        # «079» failed main CI on 09.10. (2363b290).
        assert "079 123 45 67" not in str(merge.changes_json)
        assert "Meier" not in str(merge.changes_json)
        assert await _audit(db_session, report.id, "merged_into")

    async def test_a_filled_melder_is_never_overwritten(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, contact="Huber", contact_phone="061 000 00 00")
        body = (await _merge_new(editor_client, test_event, target)).json()
        assert body["target"]["contact"] == "Huber"
        assert body["target"]["contact_phone"] == "061 000 00 00"
        assert "Melder: Meier, 079 123 45 67" in body["target"]["internal_notes"]

    async def test_refused_into_another_ereignis(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        other = Event(id=uuid4(), name="Anderes Ereignis", training_flag=False)
        db_session.add(other)
        await db_session.commit()
        target = await _card(db_session, other)
        response = await _merge_new(editor_client, test_event, target)
        assert response.status_code == 404
        rows = await db_session.execute(select(Incident).where(Incident.event_id == test_event.id))
        assert rows.scalars().all() == []

    async def test_viewer_cannot_merge(
        self, viewer_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        assert (await _merge_new(viewer_client, test_event, target)).status_code == 403


class TestMergeAFlaggedCardAndUndo:
    async def test_merge_hides_the_card_and_unmerge_brings_it_back(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        dup = await _card(
            db_session,
            test_event,
            address="Hauptstr. 6",
            lat=_offset(30),
            description="Keller voll",
            contact="Meier",
            source="divera",
            source_ref="4711",
            possible_duplicate_of_id=target.id,
        )

        merged = await editor_client.post(f"/api/incidents/{dup.id}/merge", json={"target_id": str(target.id)})
        assert merged.status_code == 200, merged.text
        assert "(Divera 4711): Keller voll" in merged.json()["target"]["internal_notes"]
        assert merged.json()["target"]["contact"] == "Meier"

        # The Verlauf of the target says so, and offers «Trennen».
        timeline = (await editor_client.get(f"/api/incidents/{target.id}/timeline")).json()["events"]
        (merge_event,) = [e for e in timeline if e["event_type"] == "merge"]
        assert merge_event["merged_incident_id"] == str(dup.id)
        assert merge_event["merge_active"] is True
        assert "Keller voll" in merge_event["message"]

        # A plain restore would leave the report on the board twice.
        assert (await editor_client.post(f"/api/incidents/{dup.id}/restore")).status_code == 409

        # The operator typed under the Nachtrag meanwhile — that line survives the undo.
        await editor_client.patch(
            f"/api/incidents/{target.id}",
            json={"internal_notes": merged.json()["target"]["internal_notes"] + "\nSchlüssel beim Hauswart"},
        )

        undone = await editor_client.post(f"/api/incidents/{dup.id}/unmerge")
        assert undone.status_code == 200, undone.text
        body = undone.json()
        assert body["note_removed"] is True
        assert body["restored"]["id"] == str(dup.id)
        assert body["restored"]["source_ref"] == "4711"
        # Back next to the card, still flagged — the reason it was merged has not gone away.
        assert body["restored"]["possible_duplicate_of_id"] == str(target.id)
        assert body["target"]["internal_notes"] == "Schlüssel beim Hauswart"
        assert body["target"]["contact"] is None

        board = await editor_client.get("/api/incidents/", params={"event_id": str(test_event.id)})
        assert {i["id"] for i in board.json()} == {str(target.id), str(dup.id)}

        # Twice is a 409, not a second restore.
        assert (await editor_client.post(f"/api/incidents/{dup.id}/unmerge")).status_code == 409
        timeline = (await editor_client.get(f"/api/incidents/{target.id}/timeline")).json()["events"]
        assert [e["merge_active"] for e in timeline if e["event_type"] == "merge"] == [False]
        assert [e["event_type"] for e in timeline if e["event_type"] == "unmerge"] == ["unmerge"]

    async def test_an_edited_nachtrag_stays_where_the_operator_left_it(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        body = (await _merge_new(editor_client, test_event, target)).json()
        await editor_client.patch(
            f"/api/incidents/{target.id}",
            json={"internal_notes": body["target"]["internal_notes"] + " – erledigt"},
        )
        undone = (await editor_client.post(f"/api/incidents/{body['merged_incident_id']}/unmerge")).json()
        assert undone["note_removed"] is False
        assert undone["target"]["internal_notes"].endswith(" – erledigt")

    async def test_kein_duplikat_clears_the_flag_and_is_audited(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        dup = await _card(db_session, test_event, possible_duplicate_of_id=target.id)
        response = await editor_client.post(f"/api/incidents/{dup.id}/not-duplicate")
        assert response.status_code == 200
        assert response.json()["possible_duplicate_of_id"] is None
        assert await _audit(db_session, dup.id, "duplicate_dismissed")


class TestAutomaticDoorsFlagAndNeverMerge:
    async def test_public_alarm_creates_and_flags(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        token = generate_alarm_token(test_event.id)
        response = await client.post(
            f"/api/intake/alarm?token={token}",
            json={
                "title": "Wasser im Keller",
                "type": "elementarereignis",
                "priority": "low",
                "location_address": "Hauptstrasse 6",
                "description": "Wasser",
            },
        )
        assert response.status_code == 201, response.text
        created = await db_session.get(Incident, UUID(response.json()["id"]))
        await db_session.refresh(created)
        assert created.deleted_at is None
        assert created.possible_duplicate_of_id == target.id
        await db_session.refresh(target)
        assert target.internal_notes is None

    async def test_webhook_auto_attach_creates_and_flags(self, client: AsyncClient, db_session: AsyncSession) -> None:
        event = Event(
            id=uuid4(), name="Unwetter", training_flag=False, auto_attach_divera=True, created_at=datetime.now(UTC)
        )
        db_session.add(event)
        db_session.add(Setting(key="alarm_webhook_secret", value="s3cret"))
        await db_session.commit()
        target = await _card(db_session, event)

        with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
            response = await client.post(
                "/api/alarms?secret=s3cret",
                json={
                    "source": "leitstelle",
                    "source_id": "A-1",
                    "title": "ELEMENTAR Wasser",
                    "address": "Hauptstr. 6, 4104 Oberwil",
                    "lat": float(_offset(20)),
                    "lng": float(LNG),
                },
            )
        assert response.status_code == 200, response.text
        incident_id = response.json()["auto_attached_incident_id"]
        created = await db_session.get(Incident, UUID(incident_id))
        await db_session.refresh(created)
        assert created.possible_duplicate_of_id == target.id
        assert created.deleted_at is None

    async def test_an_alarm_far_away_is_not_flagged(self, client: AsyncClient, db_session: AsyncSession) -> None:
        event = Event(
            id=uuid4(), name="Unwetter", training_flag=False, auto_attach_divera=True, created_at=datetime.now(UTC)
        )
        db_session.add(event)
        db_session.add(Setting(key="alarm_webhook_secret", value="s3cret"))
        await db_session.commit()
        await _card(db_session, event)
        with patch("app.api.alarms.broadcast_emergency_received", new_callable=AsyncMock):
            response = await client.post(
                "/api/alarms?secret=s3cret",
                json={
                    "source": "leitstelle",
                    "source_id": "A-2",
                    "title": "ELEMENTAR Wasser",
                    "address": "Bahnhofstrasse 1, 4104 Oberwil",
                    "lat": float(_offset(500)),
                    "lng": float(LNG),
                },
            )
        created = await db_session.get(Incident, UUID(response.json()["auto_attached_incident_id"]))
        await db_session.refresh(created)
        assert created.possible_duplicate_of_id is None


class TestPoolAttach:
    async def test_attach_with_merge_links_the_alarm_and_makes_no_card(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        emergency = DiveraEmergency(
            id=uuid4(),
            divera_id=777,
            title="ELEMENTAR Wasser im Keller",
            text="Keller überflutet",
            address="Hauptstr. 6, 4104 Oberwil",
            latitude=str(_offset(15)),
            longitude=str(LNG),
            received_at=datetime.now(UTC),
            source="divera",
            source_id="777",
        )
        db_session.add(emergency)
        await db_session.commit()

        with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
            response = await editor_client.post(
                f"/api/divera/emergencies/{emergency.id}/attach",
                json={"event_id": str(test_event.id), "merge_into_incident_id": str(target.id)},
            )
        assert response.status_code == 201, response.text
        assert response.json()["id"] == str(target.id)
        assert "(Divera 777): ELEMENTAR Wasser im Keller · Keller überflutet" in response.json()["internal_notes"]

        await db_session.refresh(emergency)
        assert emergency.attached_to_event_id == test_event.id
        report = await db_session.get(Incident, emergency.created_incident_id)
        await db_session.refresh(report)
        assert report.merged_into_id == target.id
        assert report.source_ref == "777"


class TestFeld:
    async def test_candidates_and_merge_from_the_field(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ) -> None:
        target = await _card(db_session, test_event)
        person = Personnel(id=uuid4(), name="Brunner Marco", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()
        token = await feld_device_token(db_session, test_event.id, person.id)

        found = await client.get(
            "/api/feld/duplicates",
            params={"token": token, "personnel_id": str(person.id), "lat": str(_offset(25)), "lng": str(LNG)},
        )
        assert found.status_code == 200, found.text
        assert [c["id"] for c in found.json()["candidates"]] == [str(target.id)]

        with patch("app.api.feld.broadcast_incident_update", new_callable=AsyncMock):
            response = await client.post(
                f"/api/feld/incidents?token={token}&personnel_id={person.id}",
                json={
                    "title": "Hauptstr. 6",
                    "type": "elementarereignis",
                    "priority": "low",
                    "location_address": "Hauptstr. 6",
                    "description": "Ast auf Fahrbahn",
                    "take_over": True,
                    "merge_into_incident_id": str(target.id),
                },
            )
        assert response.status_code == 201, response.text
        assert response.json()["merged_into"] == str(target.id)
        assert response.json()["takeover"] == "none"
        await db_session.refresh(target)
        assert "(Feld · Brunner Marco): Ast auf Fahrbahn" in target.internal_notes
        # The take-over is not run on a merged Meldung.
        assert target.status == "incoming"
        # The bell says «Nachtrag» on the card it went into, as facts the client words.
        from app.models import Notification

        bell = (
            await db_session.execute(select(Notification).where(Notification.incident_id == target.id))
        ).scalar_one()
        assert bell.type == "field_report"
        assert bell.message == "Nachtrag vom Feld: Hauptstrasse 6, 4104 Oberwil (Brunner Marco)"
        assert bell.params == {"place": "Hauptstrasse 6, 4104 Oberwil", "by": "Brunner Marco", "merged": True}

    async def test_feld_cannot_merge_into_a_closed_card(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, status="complete")
        person = Personnel(id=uuid4(), name="Frey Marc", role="Feuerwehrmann", status="available")
        db_session.add(person)
        await db_session.commit()
        token = await feld_device_token(db_session, test_event.id, person.id)
        response = await client.post(
            f"/api/feld/incidents?token={token}&personnel_id={person.id}",
            json={
                "title": "Hauptstr. 6",
                "type": "elementarereignis",
                "priority": "low",
                "location_address": "Hauptstr. 6",
                "merge_into_incident_id": str(target.id),
            },
        )
        assert response.status_code == 409
        # Said in the crew's language on the phone; the German sentence stays the detail.
        assert response.json() == {
            "detail": "Dieser Einsatz ist nicht mehr offen. Bitte neu melden.",
            "code": "feld_merge_target_closed",
        }


class TestEinsatzNumbersAcrossMergeAndTrennen:
    """The Einsatz number (#168, «14 tlf meier») and R2's merge: a number is never
    handed out twice, «Trennen» brings a card back under its own number, and a merged
    card is not on the board, so ⌘K cannot reach it by its number."""

    async def test_trennen_keeps_the_number_and_nothing_is_reused(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        dup = await _card(db_session, test_event, address="Hauptstr. 6", possible_duplicate_of_id=target.id)
        assert target.number is not None and dup.number == target.number + 1
        dup_id, dup_number = dup.id, dup.number

        assert (
            await editor_client.post(f"/api/incidents/{dup_id}/merge", json={"target_id": str(target.id)})
        ).status_code == 200
        board = (await editor_client.get("/api/incidents/", params={"event_id": str(test_event.id)})).json()
        assert dup_number not in [i["number"] for i in board]

        # A report merged before it had a card takes a number too – and keeps it to itself.
        assert (await _merge_new(editor_client, test_event, target)).status_code == 200
        fresh = await _card(db_session, test_event, address="Bachweg 3")
        assert fresh.number == dup_number + 2

        assert (await editor_client.post(f"/api/incidents/{dup_id}/unmerge")).status_code == 200
        restored = await db_session.get(Incident, dup_id, populate_existing=True)
        assert restored.number == dup_number
        numbers = [
            i["number"]
            for i in (await editor_client.get("/api/incidents/", params={"event_id": str(test_event.id)})).json()
        ]
        assert sorted(numbers) == sorted(set(numbers))


class TestWhatAMergeMustNotDo:
    """Review round 1: a merge never hides work, never lands on a closed card,
    and never lets anything be put onto a card that is gone."""

    async def test_never_into_a_closed_card(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        closed = await _card(db_session, test_event, status="complete")
        closed_id = closed.id  # the refused request rolls the shared session back
        assert (await _merge_new(editor_client, test_event, closed)).status_code == 409
        await db_session.refresh(test_event)
        dup = await _card(db_session, test_event, possible_duplicate_of_id=closed_id)
        dup_id = dup.id
        response = await editor_client.post(f"/api/incidents/{dup_id}/merge", json={"target_id": str(closed_id)})
        assert response.status_code == 409
        assert "abgeschlossen" in response.json()["detail"]
        assert (await db_session.get(Incident, dup_id, populate_existing=True)).deleted_at is None

    async def test_a_closed_card_is_never_merged_away(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        """Any OPEN card may be merged (owner decision 10.10.2026) — a closed one may not."""
        target = await _card(db_session, test_event)
        dup = await _card(db_session, test_event, status="complete", possible_duplicate_of_id=target.id)
        response = await editor_client.post(f"/api/incidents/{dup.id}/merge", json={"target_id": str(target.id)})
        assert response.status_code == 409
        assert "abgeschlossen" in response.json()["detail"]

    async def test_nothing_can_be_assigned_to_a_merged_card(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_personnel: Personnel,
    ) -> None:
        target = await _card(db_session, test_event)
        body = (await _merge_new(editor_client, test_event, target)).json()
        response = await editor_client.post(
            f"/api/incidents/{body['merged_incident_id']}/assign",
            json={"resource_type": "personnel", "resource_id": str(test_personnel.id)},
        )
        assert response.status_code == 409
        assert "zusammengeführt" in response.json()["detail"]

    async def test_the_more_urgent_priority_wins_and_the_undo_gives_it_back(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, priority="low")
        body = (await _merge_new(editor_client, test_event, target, priority="high")).json()
        assert body["target"]["priority"] == "high"
        undone = (await editor_client.post(f"/api/incidents/{body['merged_incident_id']}/unmerge")).json()
        assert undone["target"]["priority"] == "low"

    async def test_a_priority_set_since_the_merge_survives_the_undo(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event, priority="low")
        body = (await _merge_new(editor_client, test_event, target, priority="medium")).json()
        await editor_client.patch(f"/api/incidents/{target.id}", json={"priority": "high"})
        undone = (await editor_client.post(f"/api/incidents/{body['merged_incident_id']}/unmerge")).json()
        assert undone["target"]["priority"] == "high"

    async def test_flags_that_pointed_at_the_merged_card_move_and_are_broadcast(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        dup = await _card(db_session, test_event, possible_duplicate_of_id=target.id)
        third = await _card(db_session, test_event, possible_duplicate_of_id=dup.id)
        with patch("app.api.incidents.broadcast_incident_update", new_callable=AsyncMock) as broadcast:
            response = await editor_client.post(f"/api/incidents/{dup.id}/merge", json={"target_id": str(target.id)})
        assert response.status_code == 200
        await db_session.refresh(third)
        assert third.possible_duplicate_of_id == target.id
        updated = [call.args[0]["id"] for call in broadcast.call_args_list if call.args[1] == "update"]
        assert str(third.id) in updated

    async def test_the_demo_cap_holds_for_a_merge_too(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, monkeypatch
    ) -> None:
        target = await _card(db_session, test_event)
        db_session.add_all(
            Incident(
                title=f"X {i}", type="elementarereignis", priority="low", status="complete", event_id=test_event.id
            )
            for i in range(49)
        )
        await db_session.commit()
        monkeypatch.setattr("app.api.incidents.settings.demo_mode", True)
        assert (await _merge_new(editor_client, test_event, target)).status_code == 403


class TestTiesAndTheFeldDoor:
    async def test_ties_go_to_the_oldest_unflagged_card(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        oldest = await _card(db_session, test_event, address=None, created_at=datetime(2026, 10, 8, 10, tzinfo=UTC))
        await _card(db_session, test_event, address=None, created_at=datetime(2026, 10, 8, 11, tzinfo=UTC))
        await _card(
            db_session,
            test_event,
            address=None,
            created_at=datetime(2026, 10, 8, 9, tzinfo=UTC),
            possible_duplicate_of_id=oldest.id,
        )
        found = await _candidates(editor_client, test_event, lat=LAT, lng=LNG)
        assert found[0]["id"] == str(oldest.id)

    async def _feld(self, db: AsyncSession, event: Event) -> tuple[Personnel, str]:
        person = Personnel(id=uuid4(), name="Frey Marc", role="Feuerwehrmann", status="available")
        db.add(person)
        await db.commit()
        return person, await feld_device_token(db, event.id, person.id)

    async def test_feld_needs_a_pin_and_gets_the_minimum(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        card = await _card(db_session, test_event)
        person, token = await self._feld(db_session, test_event)
        base = {"token": token, "personnel_id": str(person.id)}
        # No address-only lookup from a login-less door.
        assert (
            await client.get("/api/feld/duplicates", params={**base, "address": "Hauptstrasse 6"})
        ).status_code == 422
        found = (await client.get("/api/feld/duplicates", params={**base, "lat": str(LAT), "lng": str(LNG)})).json()
        (candidate,) = found["candidates"]
        assert candidate["id"] == str(card.id)
        assert set(candidate) == {"id", "title", "location_display", "distance_m", "match", "created_at"}

    async def test_feld_address_match_only_near_the_pin(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        await _card(db_session, test_event, lat=_offset(400))
        person, token = await self._feld(db_session, test_event)
        found = await client.get(
            "/api/feld/duplicates",
            params={
                "token": token,
                "personnel_id": str(person.id),
                "lat": str(LAT),
                "lng": str(LNG),
                "address": "Hauptstrasse 6",
            },
        )
        assert found.json()["candidates"] == []

    async def test_feld_new_report_is_flagged_and_a_merged_one_stays_in_my_list(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ) -> None:
        target = await _card(db_session, test_event)
        person, token = await self._feld(db_session, test_event)
        report = {
            "title": "Hauptstr. 6",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Hauptstr. 6",
        }
        with patch("app.api.feld.broadcast_incident_update", new_callable=AsyncMock):
            new = await client.post(f"/api/feld/incidents?token={token}&personnel_id={person.id}", json=report)
            merged = await client.post(
                f"/api/feld/incidents?token={token}&personnel_id={person.id}",
                json={**report, "merge_into_incident_id": str(target.id)},
            )
        flagged = await db_session.get(Incident, UUID(new.json()["incident_id"]))
        await db_session.refresh(flagged)
        assert flagged.possible_duplicate_of_id == target.id

        mine = (await client.get(f"/api/feld/assignments/{person.id}?token={token}")).json()["reports"]
        by_id = {r["incident_id"]: r for r in mine}
        merged_row = by_id[merged.json()["incident_id"]]
        assert merged_row["merged_into_id"] == str(target.id)
        assert merged_row["merged_into_label"]
        assert merged_row["editable"] is False
