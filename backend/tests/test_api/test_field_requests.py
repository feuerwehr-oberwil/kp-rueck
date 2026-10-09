"""Workable requests from the field (R13).

Every Meldung from `/feld` is a ``FieldRequest`` with a state the card, the
detail, the sidebar and the crew's phone all read:

* open → in_progress → done, with who/when on done, and back to open;
* dismissing the bell entry is «gesehen», never «erledigt»;
* «erledigt» takes the bell entry with it;
* the Abholung's work item and ``Incident.pickup_needed`` are one fact.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    Event,
    FieldRequest,
    Incident,
    IncidentAssignment,
    Material,
    Notification,
    Personnel,
    Setting,
    User,
    field_request_label,
)
from tests.conftest import feld_device_token

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


@dataclass(frozen=True)
class Ref:
    """A plain id: the shared session commits inside every API call and expires ORM rows."""

    id: UUID


async def _setup(db: AsyncSession, event: Event, user: User) -> tuple[Ref, Ref, dict[str, str]]:
    incident = Incident(
        id=uuid4(),
        title="Keller Wasser",
        type="elementarereignis",
        priority="medium",
        location_address="Hauptstrasse 1, Oberwil",
        status="active",
        event_id=event.id,
        created_by=user.id,
    )
    person = Personnel(id=uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
    db.add_all([incident, person])
    await db.commit()
    db.add(IncidentAssignment(incident_id=incident.id, resource_type="personnel", resource_id=person.id))
    await db.commit()
    incident_ref, person_ref = Ref(incident.id), Ref(person.id)
    params = {"token": await feld_device_token(db, event.id, person.id), "personnel_id": str(person.id)}
    return incident_ref, person_ref, params


async def _requests(db: AsyncSession, incident: Ref) -> list[FieldRequest]:
    result = await db.execute(
        select(FieldRequest)
        .where(FieldRequest.incident_id == incident.id)
        .order_by(FieldRequest.created_at)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def _board_card(client: AsyncClient, incident: Ref) -> dict:
    response = await client.get(f"/api/incidents/{incident.id}")
    assert response.status_code == 200
    return response.json()


class TestLabel:
    def test_material_with_quantity_and_note(self):
        assert field_request_label("material", "Tauchpumpe Gr.", 2, "in den Keller") == (
            "Material: Tauchpumpe Gr. ×2 – in den Keller"
        )

    def test_personnel(self):
        assert field_request_label("personnel", "Atemschutz", 2, None) == "Verstärkung: 2 Personen Atemschutz"
        assert field_request_label("personnel", None, 1, None) == "Verstärkung: 1 Person"
        assert field_request_label("personnel", None, None, "dringend") == "Verstärkung – dringend"

    def test_message_is_its_text(self):
        assert field_request_label("message", None, None, "Pumpe läuft") == "Pumpe läuft"


class TestCreate:
    async def test_a_sentence_becomes_an_open_work_item(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        response = await editor_client.post(
            f"/api/feld/incidents/{incident.id}/message", params=params, json={"message": "Pumpe läuft"}
        )
        assert response.status_code == 204

        [row] = await _requests(db_session, incident)
        assert (row.kind, row.status, row.text, row.created_by_name) == (
            "message",
            "open",
            "Pumpe läuft",
            "Muster Hans",
        )
        notification = await db_session.get(Notification, row.notification_id)
        assert notification is not None and notification.type == "field_message"

        # The board card carries it as owed.
        card = await _board_card(editor_client, incident)
        assert [r["label"] for r in card["field_requests"]] == ["Pumpe läuft"]
        assert card["field_requests"][0]["from_field"] is True

    async def test_structured_material_request(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        response = await editor_client.post(
            f"/api/feld/incidents/{incident.id}/message",
            params=params,
            json={"kind": "material", "item": "Tauchpumpe Gr.", "quantity": 2},
        )
        assert response.status_code == 204

        [row] = await _requests(db_session, incident)
        assert (row.kind, row.item, row.quantity, row.text) == ("material", "Tauchpumpe Gr.", 2, None)
        notification = await db_session.get(Notification, row.notification_id)
        assert notification is not None
        assert notification.message.endswith(": Material: Tauchpumpe Gr. ×2")

        # The Journal reads it as a line, exactly like a sentence (thread + Verlauf).
        entry = (
            (await db_session.execute(select(AuditLog).where(AuditLog.action_type == "field_message"))).scalars().one()
        )
        assert entry.changes_json is not None
        assert entry.changes_json["message"] == "Material: Tauchpumpe Gr. ×2"
        assert entry.changes_json["request_id"] == str(row.id)

    @pytest.mark.parametrize(
        "body",
        [
            {"kind": "material"},
            {"kind": "personnel"},
            {"kind": "personnel", "quantity": 0},
            {"kind": "message", "message": "  "},
            {"kind": "pickup", "message": "x"},
        ],
    )
    async def test_an_empty_request_is_refused(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User, body: dict
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        response = await client.post(f"/api/feld/incidents/{incident.id}/message", params=params, json=body)
        assert response.status_code == 422
        assert await _requests(db_session, incident) == []

    async def test_board_twin_records_a_radio_request(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, _params = await _setup(db_session, test_event, test_user)
        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-requests",
            json={"kind": "personnel", "quantity": 4, "item": "Atemschutz"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["label"] == "Verstärkung: 4 Personen Atemschutz"
        assert body["from_field"] is False
        assert body["status"] == "open"

    async def test_viewer_cannot_record_or_work(
        self, viewer_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await viewer_client.post(
            f"/api/feld/incidents/{incident.id}/message", params=params, json={"message": "Pumpe läuft"}
        )
        [row] = await _requests(db_session, incident)
        assert (
            await viewer_client.post(f"/api/incidents/{incident.id}/field-requests", json={"message": "x"})
        ).status_code == 403
        assert (
            await viewer_client.patch(f"/api/incidents/{incident.id}/field-requests/{row.id}", json={"status": "done"})
        ).status_code == 403


class TestWorkflow:
    async def test_dismissing_the_bell_is_seen_not_handled(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, person, params = await _setup(db_session, test_event, test_user)
        await editor_client.post(
            f"/api/feld/incidents/{incident.id}/message", params=params, json={"message": "Pumpe läuft"}
        )
        [row] = await _requests(db_session, incident)

        assert (await editor_client.post(f"/api/notifications/{row.notification_id}/dismiss")).status_code == 204

        [row] = await _requests(db_session, incident)
        assert row.seen_at is not None
        assert row.status == "open"
        # Still owed on the card…
        assert len((await _board_card(editor_client, incident))["field_requests"]) == 1
        # …and the crew reads «gesehen».
        feld = await editor_client.get(f"/api/feld/assignments/{person.id}", params={"token": params["token"]})
        [mine] = feld.json()["assignments"][0]["field_requests"]
        assert mine["seen_at"] is not None and mine["status"] == "open"

    async def test_in_progress_then_done_then_reopen(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        editor_name = test_editor.display_name or test_editor.username
        incident, person, params = await _setup(db_session, test_event, test_user)
        await editor_client.post(
            f"/api/feld/incidents/{incident.id}/message",
            params=params,
            json={"kind": "material", "item": "Wassersauger", "quantity": 1},
        )
        [row] = await _requests(db_session, incident)
        url = f"/api/incidents/{incident.id}/field-requests/{row.id}"

        working = await editor_client.patch(url, json={"status": "in_progress"})
        assert working.status_code == 200
        assert working.json()["status"] == "in_progress"
        assert working.json()["seen_at"] is not None

        done = await editor_client.patch(url, json={"status": "done"})
        assert done.status_code == 200
        body = done.json()
        assert body["status"] == "done"
        assert body["done_at"] is not None
        assert body["done_by_name"] == editor_name

        # Handling it took the bell entry with it, and the card owes nothing.
        notification = await db_session.get(Notification, row.notification_id, populate_existing=True)
        assert notification is not None and notification.dismissed is True
        assert (await _board_card(editor_client, incident))["field_requests"] == []
        # The detail still lists it, handled.
        listed = (await editor_client.get(f"/api/incidents/{incident.id}/field-requests")).json()
        assert [r["status"] for r in listed] == ["done"]
        # The crew reads «erledigt».
        feld = await editor_client.get(f"/api/feld/assignments/{person.id}", params={"token": params["token"]})
        assert feld.json()["assignments"][0]["field_requests"][0]["status"] == "done"

        reopened = await editor_client.patch(url, json={"status": "open"})
        assert reopened.json()["status"] == "open"
        assert reopened.json()["done_at"] is None

        audit = (
            (await db_session.execute(select(AuditLog).where(AuditLog.action_type == "field_request_status")))
            .scalars()
            .all()
        )
        assert [(a.changes_json or {}).get("to") for a in sorted(audit, key=lambda a: a.timestamp)] == [
            "in_progress",
            "done",
            "open",
        ]

    async def test_a_request_of_another_incident_is_404(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await editor_client.post(
            f"/api/feld/incidents/{incident.id}/message", params=params, json={"message": "Pumpe läuft"}
        )
        [row] = await _requests(db_session, incident)
        other = await editor_client.patch(f"/api/incidents/{uuid4()}/field-requests/{row.id}", json={"status": "done"})
        assert other.status_code == 404


class TestPickup:
    async def test_pickup_is_a_work_item_and_erledigt_clears_the_flag(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await editor_client.post(
            f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True, "note": "3 Personen"}
        )
        [row] = await _requests(db_session, incident)
        assert (row.kind, row.status, row.text) == ("pickup", "open", "3 Personen")
        assert row.notification_id is not None

        done = await editor_client.patch(
            f"/api/incidents/{incident.id}/field-requests/{row.id}", json={"status": "done"}
        )
        assert done.status_code == 200
        assert done.json()["status"] == "done"
        card = await _board_card(editor_client, incident)
        assert card["pickup_needed"] is False
        assert card["field_requests"] == []

        # A handled Abholung is not re-opened; a new one is a new request.
        again = await editor_client.patch(
            f"/api/incidents/{incident.id}/field-requests/{row.id}", json={"status": "open"}
        )
        assert again.status_code == 409

    async def test_clearing_on_the_chip_closes_the_work_item(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await editor_client.post(f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True})
        cleared = await editor_client.post(f"/api/incidents/{incident.id}/field-report", json={"pickup_needed": False})
        assert cleared.status_code == 200
        [row] = await _requests(db_session, incident)
        assert row.status == "done"
        assert row.done_by_user_id is not None

    async def test_wir_fahren_selbst_closes_it_with_the_crews_name(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await editor_client.post(f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True})
        await editor_client.post(f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": False})
        [row] = await _requests(db_session, incident)
        assert (row.status, row.done_by_name, row.done_by_user_id) == ("done", "Muster Hans", None)

    async def test_note_edit_keeps_one_work_item(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        url = f"/api/feld/incidents/{incident.id}/pickup"
        await editor_client.post(url, params=params, json={"needed": True})
        await editor_client.post(url, params=params, json={"needed": True, "note": "beim Brunnen"})
        [row] = await _requests(db_session, incident)
        assert row.text == "beim Brunnen"

    async def test_pickup_is_not_repeated_in_the_phones_request_list(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, person, params = await _setup(db_session, test_event, test_user)
        await editor_client.post(f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True})
        feld = await editor_client.get(f"/api/feld/assignments/{person.id}", params={"token": params["token"]})
        assert feld.json()["assignments"][0]["field_requests"] == []


class TestPhonePayload:
    async def test_structured_chips_are_dropped_and_materials_served(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        _incident, person, params = await _setup(db_session, test_event, test_user)
        # A station that kept the old chips in its own list.
        db_session.add(Setting(key="feld.message_chips", value="Verstärkung nötig\nmaterial  nötig\nPumpe läuft"))
        db_session.add_all(
            [
                Material(id=uuid4(), name="Tauchpumpe Gr.", type="Tauchpumpen", location="TLF"),
                Material(id=uuid4(), name="Tauchpumpe Gr.", type="Tauchpumpen", location="Pio"),
                Material(id=uuid4(), name="Ausgemustert", type="Sonstiges", location="", archived_at=datetime.now(UTC)),
                Material(id=uuid4(), name="Absperrband", type="Sonstiges", location="TLF"),
            ]
        )
        await db_session.commit()

        response = await client.get(f"/api/feld/assignments/{person.id}", params={"token": params["token"]})
        assert response.status_code == 200
        body = response.json()
        assert body["message_chips"] == ["Pumpe läuft"]
        assert body["request_materials"] == ["Absperrband", "Tauchpumpe Gr."]


class TestReviewHardening:
    """The review of #172: transitions, races, leftover bells, repeats, completion."""

    async def _message(self, client: AsyncClient, incident: Ref, params: dict[str, str], body: dict) -> None:
        response = await client.post(f"/api/feld/incidents/{incident.id}/message", params=params, json=body)
        assert response.status_code == 204, response.text

    async def test_done_goes_back_only_through_reopen(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await self._message(editor_client, incident, params, {"message": "Pumpe läuft"})
        [row] = await _requests(db_session, incident)
        url = f"/api/incidents/{incident.id}/field-requests/{row.id}"
        assert (await editor_client.patch(url, json={"status": "done"})).status_code == 200
        assert (await editor_client.patch(url, json={"status": "in_progress"})).status_code == 409
        assert (await editor_client.patch(url, json={"status": "open"})).json()["status"] == "open"

    async def test_a_stale_screen_is_refused(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await self._message(editor_client, incident, params, {"message": "Pumpe läuft"})
        [row] = await _requests(db_session, incident)
        url = f"/api/incidents/{incident.id}/field-requests/{row.id}"
        assert (
            await editor_client.patch(url, json={"status": "in_progress", "expected_status": "open"})
        ).status_code == 200
        # A second operator still looking at «offen»:
        stale = await editor_client.patch(url, json={"status": "done", "expected_status": "open"})
        assert stale.status_code == 409
        [row] = await _requests(db_session, incident)
        assert row.status == "in_progress"

    async def test_erledigt_on_an_old_pickup_never_closes_the_current_one(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        url = f"/api/feld/incidents/{incident.id}/pickup"
        await editor_client.post(url, params=params, json={"needed": True})
        await editor_client.post(url, params=params, json={"needed": False})
        await editor_client.post(url, params=params, json={"needed": True, "note": "zweites Mal"})
        old, current = await _requests(db_session, incident)
        assert (old.status, current.status) == ("done", "open")

        response = await editor_client.patch(
            f"/api/incidents/{incident.id}/field-requests/{old.id}", json={"status": "done"}
        )
        assert response.status_code == 200
        card = await _board_card(editor_client, incident)
        assert card["pickup_needed"] is True
        assert [r["id"] for r in card["field_requests"]] == [str(current.id)]

    async def test_only_one_open_pickup_row_can_exist(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        from sqlalchemy.exc import IntegrityError

        incident, _person, _params = await _setup(db_session, test_event, test_user)
        db_session.add_all(
            [
                FieldRequest(incident_id=incident.id, kind="pickup", status="open"),
                FieldRequest(incident_id=incident.id, kind="pickup", status="in_progress"),
            ]
        )
        with pytest.raises(IntegrityError):
            await db_session.commit()
        await db_session.rollback()

    async def test_closing_an_abholung_clears_every_bell_its_note_edits_added(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        url = f"/api/feld/incidents/{incident.id}/pickup"
        await editor_client.post(url, params=params, json={"needed": True})
        await editor_client.post(url, params=params, json={"needed": True, "note": "beim Brunnen"})
        await editor_client.post(url, params=params, json={"needed": True, "note": "beim Brunnen, 3 Personen"})
        [row] = await _requests(db_session, incident)
        await editor_client.patch(f"/api/incidents/{incident.id}/field-requests/{row.id}", json={"status": "done"})

        bells = (
            (
                await db_session.execute(
                    select(Notification)
                    .where(Notification.incident_id == incident.id, Notification.type == "field_pickup")
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        needed = [b for b in bells if b.message.startswith("Abholung nötig")]
        assert len(needed) == 3
        assert all(b.dismissed for b in needed)

    async def test_a_repeated_send_is_one_request(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        body = {"kind": "material", "item": "Tauchpumpe Gr.", "quantity": 2, "client_request_id": str(uuid4())}
        await self._message(editor_client, incident, params, body)
        await self._message(editor_client, incident, params, body)  # «Nochmals senden»
        assert len(await _requests(db_session, incident)) == 1
        bells = (
            (await db_session.execute(select(Notification).where(Notification.incident_id == incident.id)))
            .scalars()
            .all()
        )
        assert len(bells) == 1
        entries = (
            (await db_session.execute(select(AuditLog).where(AuditLog.action_type == "field_message"))).scalars().all()
        )
        assert len(entries) == 1

    async def test_completing_the_place_closes_its_sentences_not_its_asks(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        incident, _person, params = await _setup(db_session, test_event, test_user)
        await self._message(editor_client, incident, params, {"message": "Pumpe läuft"})
        await self._message(editor_client, incident, params, {"kind": "material", "item": "Wassersauger"})
        response = await editor_client.post(
            f"/api/incidents/{incident.id}/status", json={"from_status": "active", "to_status": "complete"}
        )
        assert response.status_code == 200, response.text

        rows = {r.kind: r for r in await _requests(db_session, incident)}
        assert rows["message"].status == "done"
        assert rows["message"].done_by_name is not None
        assert rows["material"].status == "open"
        audit = (
            (await db_session.execute(select(AuditLog).where(AuditLog.action_type == "field_request_status")))
            .scalars()
            .all()
        )
        assert [(a.changes_json or {}).get("reason") for a in audit] == ["incident_completed"]
