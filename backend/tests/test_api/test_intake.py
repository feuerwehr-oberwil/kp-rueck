"""Tests for the public token-gated alarm intake endpoints (/api/intake)."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.intake import INTAKE_NOTE_PREFIX, INTAKE_RECEIPT_FORM_TYPE, append_reporter_note
from app.models import Event, Incident, IncidentAssignment, StatusTransition, Vehicle
from app.services.tokens import (
    generate_alarm_token,
    generate_form_token,
    generate_viewer_token,
    validate_form_token,
)

VALID_ALARM = {
    "title": "Wohnungsbrand Hauptstrasse 45",
    "type": "brandbekaempfung",
    "priority": "high",
    "location_address": "Hauptstrasse 45, Basel",
    "location_lat": "47.5596",
    "location_lng": "7.5886",
    "description": "Rauch aus dem 2. OG",
    "contact": "Hans Muster, 079 123 45 67",
    "internal_notes": "Zufahrt über den Hinterhof gesperrt",
}

#: The one wording every refusal past the intake token wears, whatever went
#: wrong. Asserted literally so a future branch cannot say something more
#: helpful — "helpful" here means "tells a stranger which incidents exist".
DENIED = "Diese Meldung ist nicht deine."
CLOSED = "Der KP hat diese Meldung bereits übernommen. Änderungen bitte per Funk."


async def _phone_in(client: AsyncClient, event: Event, **overrides: object) -> tuple[str, str, str]:
    """Phone an alarm in and keep the receipt: `(intake token, incident id, receipt)`."""
    token = generate_alarm_token(event.id)
    response = await client.post(f"/api/intake/alarm?token={token}", json={**VALID_ALARM, **overrides})
    assert response.status_code == 201, response.text
    body = response.json()
    return token, body["id"], body["receipt_token"]


def _receipt_url(incident_id: str, token: str, receipt: str) -> str:
    return f"/api/intake/alarm/{incident_id}?token={token}&receipt={receipt}"


class TestGenerateLink:
    """POST /api/intake/generate-link is editor-only."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_auth(self, client: AsyncClient, test_event: Event):
        response = await client.post(f"/api/intake/generate-link?event_id={test_event.id}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_editor_gets_link(self, editor_client: AsyncClient, test_event: Event):
        response = await editor_client.post(f"/api/intake/generate-link?event_id={test_event.id}")
        assert response.status_code == 200
        body = response.json()
        assert body["token"]
        assert body["link"].startswith("/alarm?token=")
        assert body["full_url"].endswith(body["link"])


class TestContext:
    """GET /api/intake/context validates the token and returns event info."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_invalid_token(self, client: AsyncClient):
        response = await client.get("/api/intake/context?token=not-a-token")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_wrong_token_type_rejected(self, client: AsyncClient, test_event: Event):
        # A viewer token must not unlock the intake context.
        token = generate_viewer_token(test_event.id)
        response = await client.get(f"/api/intake/context?token={token}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_valid_token(self, client: AsyncClient, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.get(f"/api/intake/context?token={token}")
        assert response.status_code == 200
        event = response.json()["event"]
        assert event["name"] == test_event.name
        assert event["id"] == str(test_event.id)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_event(self, client: AsyncClient):
        token = generate_alarm_token(uuid4())
        response = await client.get(f"/api/intake/context?token={token}")
        assert response.status_code == 404


class TestCreateAlarm:
    """POST /api/intake/alarm creates an intake-flagged incident without a user."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_invalid_token(self, client: AsyncClient):
        response = await client.post("/api/intake/alarm?token=bad", json=VALID_ALARM)
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_creates_intake_incident(self, client: AsyncClient, db_session: AsyncSession, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.post(f"/api/intake/alarm?token={token}", json=VALID_ALARM)
        assert response.status_code == 201
        new_id = response.json()["id"]

        incident = (await db_session.execute(select(Incident).where(Incident.id == new_id))).scalar_one()
        assert incident.event_id == test_event.id
        assert incident.source == "intake"
        assert incident.created_by is None
        assert incident.status == "incoming"
        assert incident.title == VALID_ALARM["title"]
        assert incident.contact == VALID_ALARM["contact"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_two_texts_land_in_their_own_columns(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """«Meldung» → `description`, «Weitere Hinweise» → `internal_notes`.

        The board reads those two columns as «Meldung» and «Notizen». The form
        used to have nowhere to put the second one, so the first was pushed into
        `title` — which a card only shows when it has no address, i.e. never for
        an alarm the caller could name a street for.
        """
        token = generate_alarm_token(test_event.id)
        response = await client.post(f"/api/intake/alarm?token={token}", json=VALID_ALARM)
        assert response.status_code == 201

        incident = (await db_session.execute(select(Incident).where(Incident.id == response.json()["id"]))).scalar_one()
        assert incident.description == VALID_ALARM["description"]
        assert incident.internal_notes == VALID_ALARM["internal_notes"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_overlong_notes_rejected(self, client: AsyncClient, test_event: Event):
        """Free text through a login-less door is capped, like the Meldung."""
        token = generate_alarm_token(test_event.id)
        response = await client.post(
            f"/api/intake/alarm?token={token}",
            json={**VALID_ALARM, "internal_notes": "x" * 2001},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_minimal_payload(self, client: AsyncClient, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.post(
            f"/api/intake/alarm?token={token}",
            json={"title": "Kurz", "type": "diverse_einsaetze", "priority": "low"},
        )
        assert response.status_code == 201

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_empty_title_rejected(self, client: AsyncClient, test_event: Event):
        token = generate_alarm_token(test_event.id)
        response = await client.post(
            f"/api/intake/alarm?token={token}",
            json={"title": "   ", "type": "brandbekaempfung", "priority": "high"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_archived_event_rejected(self, client: AsyncClient, db_session: AsyncSession, test_event: Event):
        test_event.archived_at = datetime.now(UTC)
        await db_session.commit()
        token = generate_alarm_token(test_event.id)
        response = await client.post(f"/api/intake/alarm?token={token}", json=VALID_ALARM)
        assert response.status_code == 404


class TestReceipt:
    """The correction window: read your own Meldung back, and fix it.

    The create call is the only moment the server knows who reported an alarm —
    there is no login here to ask later — so that is where the receipt is minted.
    These tests are about what the receipt is worth: this one incident, for as
    long as the KP has not disponiert it, and nothing else.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_create_call_mints_a_receipt_for_that_one_alarm(self, client: AsyncClient, test_event: Event):
        _, incident_id, receipt = await _phone_in(client, test_event)

        assert validate_form_token(receipt, incident_id, INTAKE_RECEIPT_FORM_TYPE) is True
        # Its own flavour, so a receipt cannot be replayed against the Reko door.
        assert validate_form_token(receipt, incident_id, "reko") is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_reporter_can_read_back_and_correct_until_the_kp_takes_over(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """The happy path end to end: phone it in, see it is still open, fix the address."""
        token, incident_id, receipt = await _phone_in(client, test_event)

        state = await client.get(_receipt_url(incident_id, token, receipt))
        assert state.status_code == 200, state.text
        assert state.json() == {"id": incident_id, "status": "incoming", "editable": True, "vehicles": []}

        corrected = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={"location_address": "Hauptstrasse 54, Basel", "description": "Rauch aus dem 3. OG"},
        )
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["editable"] is True

        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        await db_session.refresh(incident)
        assert incident.location_address == "Hauptstrasse 54, Basel"
        assert incident.description == "Rauch aus dem 3. OG"
        # Untouched keys are unchanged, not cleared: the phone posts the whole
        # form back and a fixed street must not cost the alarm its caller.
        assert incident.contact == VALID_ALARM["contact"]
        assert incident.priority == VALID_ALARM["priority"]
        assert incident.internal_notes == VALID_ALARM["internal_notes"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_board_serves_the_corrected_alarm(self, editor_client: AsyncClient, test_event: Event):
        """A correction has to reach the card an operator is reading, not just the row.

        The intake door reads no session, so the logged-in client here changes
        nothing about the public half — it is only how the board is asked.
        """
        token, incident_id, receipt = await _phone_in(editor_client, test_event)

        await editor_client.put(
            _receipt_url(incident_id, token, receipt),
            json={"location_address": "Hauptstrasse 54, Basel"},
        )

        card = await editor_client.get(f"/api/incidents/{incident_id}")
        assert card.status_code == 200, card.text
        assert card.json()["location_address"] == "Hauptstrasse 54, Basel"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_corrected_street_is_not_left_stale_in_the_title(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """A card titled with its address must not keep the old one after a fix.

        The intake form titles an alarm with the street it is at, and the title
        is what a card shows biggest — a correction hidden behind the old
        «Hauptstrasse 12» is a correction nobody reads.
        """
        token, incident_id, receipt = await _phone_in(
            client, test_event, title="Hauptstrasse 45, Basel", location_address="Hauptstrasse 45, Basel"
        )

        response = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={"location_address": "Hauptstrasse 54, Basel"},
        )

        assert response.status_code == 200, response.text
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        await db_session.refresh(incident)
        assert incident.title == "Hauptstrasse 54, Basel"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_coordinate_sent_as_null_clears_the_pin_and_an_omitted_one_keeps_it(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """The coordinates' one exception to «None means unchanged».

        A Numeric column has no `""` to clear with, so presence decides: a
        coordinate key sent as null un-pins the wrong map pin, a key not sent
        leaves it exactly where it was.
        """
        token, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None

        # Keys omitted: the pin survives an unrelated correction.
        response = await client.put(
            _receipt_url(incident_id, token, receipt), json={"description": "Rauch aus dem 3. OG"}
        )
        assert response.status_code == 200, response.text
        await db_session.refresh(incident)
        assert incident.location_lat is not None
        assert incident.location_lng is not None

        # Keys present with null: the pin goes.
        response = await client.put(
            _receipt_url(incident_id, token, receipt), json={"location_lat": None, "location_lng": None}
        )
        assert response.status_code == 200, response.text
        await db_session.refresh(incident)
        assert incident.location_lat is None
        assert incident.location_lng is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_state_says_which_vehicles_are_on_it(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_vehicle: Vehicle
    ):
        """«Disponiert · TLF 1» without a phone call — the one board fact a reporter gets."""
        _, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        incident.status = "enroute"
        db_session.add(
            IncidentAssignment(
                incident_id=incident.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                purpose="crew",
            )
        )
        await db_session.commit()

        response = await client.get(_receipt_url(incident_id, generate_alarm_token(test_event.id), receipt))

        assert response.status_code == 200, response.text
        assert response.json()["vehicles"] == [test_vehicle.name]
        assert response.json()["status"] == "enroute"
        assert response.json()["editable"] is False


class TestReceiptIsTheSecondDoor:
    """The intake link creates; only the receipt reads or rewrites.

    A bookmarked `/alarm?token=…` is shared, long-lived and names no incident.
    If it were enough on its own, everyone at the phone desk could browse and
    rewrite everybody else's Meldungen — so both doors are checked, every time.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("method", ["get", "put"])
    async def test_the_intake_link_alone_opens_nothing(self, client: AsyncClient, test_event: Event, method: str):
        token, incident_id, _ = await _phone_in(client, test_event)

        response = await getattr(client, method)(
            f"/api/intake/alarm/{incident_id}?token={token}",
            **({"json": {"description": "egal"}} if method == "put" else {}),
        )

        # Required query parameter: the request never reaches the handler.
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("receipt", ["", "not-a-token"])
    @pytest.mark.parametrize("method", ["get", "put"])
    async def test_a_wrong_receipt_opens_nothing(
        self, client: AsyncClient, test_event: Event, method: str, receipt: str
    ):
        token, incident_id, _ = await _phone_in(client, test_event)

        response = await getattr(client, method)(
            _receipt_url(incident_id, token, receipt),
            **({"json": {"description": "egal"}} if method == "put" else {}),
        )

        assert response.status_code == 403
        assert response.json()["detail"] == DENIED

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("method", ["get", "put"])
    async def test_a_bad_intake_token_is_refused_before_the_receipt_counts(
        self, client: AsyncClient, test_event: Event, method: str
    ):
        """An expired or revoked link stops working here exactly as it does for creating."""
        _, incident_id, receipt = await _phone_in(client, test_event)

        response = await getattr(client, method)(
            _receipt_url(incident_id, "bad", receipt),
            **({"json": {"description": "egal"}} if method == "put" else {}),
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_receipt_for_one_alarm_cannot_read_or_write_another(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """Two calls taken on the same phone, from the same link, stay separate."""
        token, first_id, first_receipt = await _phone_in(client, test_event)
        _, second_id, _ = await _phone_in(client, test_event, title="Ölspur Bahnhofstrasse")

        read = await client.get(_receipt_url(second_id, token, first_receipt))
        assert read.status_code == 403
        assert read.json()["detail"] == DENIED

        write = await client.put(
            _receipt_url(second_id, token, first_receipt),
            json={"location_address": "Fremde Strasse 1"},
        )
        assert write.status_code == 403
        assert write.json()["detail"] == DENIED

        second = await db_session.get(Incident, UUID(second_id))
        assert second is not None
        await db_session.refresh(second)
        assert second.location_address == VALID_ALARM["location_address"]
        assert first_id != second_id

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_reko_token_is_not_a_receipt(self, client: AsyncClient, test_event: Event):
        """The Reko form's token names the same incident — and still opens nothing here."""
        token, incident_id, _ = await _phone_in(client, test_event)

        response = await client.get(_receipt_url(incident_id, token, generate_form_token(incident_id, "reko")))

        assert response.status_code == 403
        assert response.json()["detail"] == DENIED


class TestReceiptRefusalsDoNotProbeTheBoard:
    """Every refusal past the intake token is the same 403, whatever the reason.

    Otherwise the pair becomes an oracle: feed it incident IDs and read the
    status codes to learn which ones exist, which Ereignis they belong to and
    which were typed by an operator.
    """

    @staticmethod
    async def _refuse(client: AsyncClient, event: Event, incident_id: str) -> tuple[int, str]:
        """Ask both doors about an incident, holding a well-formed receipt for it."""
        url = _receipt_url(
            incident_id,
            generate_alarm_token(event.id),
            generate_form_token(incident_id, INTAKE_RECEIPT_FORM_TYPE),
        )
        read = await client.get(url)
        write = await client.put(url, json={"description": "egal"})
        assert read.status_code == write.status_code
        assert read.json()["detail"] == write.json()["detail"]
        return read.status_code, read.json()["detail"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_unknown_incident_is_refused(self, client: AsyncClient, test_event: Event):
        assert await self._refuse(client, test_event, str(uuid4())) == (403, DENIED)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_another_ereignis_is_refused(self, client: AsyncClient, db_session: AsyncSession, test_event: Event):
        """The receipt fits, the incident is real — and it is not in this link's Ereignis."""
        other_event = Event(id=uuid4(), name="Sturm Nachbargemeinde", training_flag=False)
        db_session.add(other_event)
        await db_session.commit()
        _, elsewhere, _ = await _phone_in(client, other_event)

        assert await self._refuse(client, test_event, elsewhere) == (403, DENIED)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_deleted_meldung_is_refused(self, client: AsyncClient, db_session: AsyncSession, test_event: Event):
        _, incident_id, _ = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        incident.deleted_at = datetime.now(UTC)
        await db_session.commit()

        assert await self._refuse(client, test_event, incident_id) == (403, DENIED)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_card_the_board_typed_is_refused(
        self, client: AsyncClient, test_event: Event, test_incident: Incident
    ):
        """`source='intake'` is part of the sentence: this door reaches its own alarms only."""
        assert test_incident.source == "operator"

        assert await self._refuse(client, test_event, str(test_incident.id)) == (403, DENIED)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_archived_ereignis_closes_the_receipt_too(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """Creating into an archived Lage 404s — correcting into one has to stop as well.

        The receipt names the incident and the incident still names the event, so
        the row-level checks all pass; only loading the Ereignis catches it. A
        closed Lage that still takes corrections is a card changing under an
        operator who has already filed the Lage away.

        Refused as the same 403 as every other denial here, not as the create
        path's 404: this pair must not answer *why* it said no.
        """
        token, incident_id, receipt = await _phone_in(client, test_event)
        test_event.archived_at = datetime.now(UTC)
        await db_session.commit()

        url = _receipt_url(incident_id, token, receipt)
        read = await client.get(url)
        write = await client.put(url, json={"location_address": "Zu spät 1"})

        assert (read.status_code, read.json()["detail"]) == (403, DENIED)
        assert (write.status_code, write.json()["detail"]) == (403, DENIED)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        await db_session.refresh(incident)
        assert incident.location_address == VALID_ALARM["location_address"]


class TestTheWindowClosesOnDispatch:
    """While the card sits in «Eingegangen» the address is still the reporter's.

    The moment it is disponiert a squad is driving to that address, so the
    window shuts and the correction goes over the radio. Same rule as `/feld`
    (`report_is_editable`), same status.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("status", ["reko", "reko_done"])
    async def test_reko_does_not_shut_the_window(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, status: str
    ):
        """A caller still typing while the Reko-Trupp is looking is *adding* information.

        Blocking that would only push it onto the radio for no gain, so the
        Reko phases stay inside the window.
        """
        token, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        incident.status = status
        await db_session.commit()

        response = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={"location_address": "Doch Nummer 7"},
        )

        assert response.status_code == 200
        await db_session.refresh(incident)
        assert incident.location_address == "Doch Nummer 7"

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("status", ["enroute", "active", "returning", "complete"])
    async def test_a_disponierte_meldung_can_no_longer_be_corrected(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, status: str
    ):
        token, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        incident.status = status
        await db_session.commit()

        response = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={"location_address": "Zu spät 1"},
        )

        assert response.status_code == 409
        assert response.json()["detail"] == CLOSED
        await db_session.refresh(incident)
        assert incident.location_address == VALID_ALARM["location_address"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_receipt_still_reads_after_the_window_shut(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """Reading is what the page polls for — the 409 belongs to the write half only."""
        token, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        incident.status = "enroute"
        await db_session.commit()

        response = await client.get(_receipt_url(incident_id, token, receipt))

        assert response.status_code == 200
        assert response.json()["editable"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_undispatch_does_not_reopen_the_window(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """Dragging a card back to «Eingegangen» must not hand the phone the pen again.

        `report_is_editable` is stateful, so on its own it would say yes here.
        By this point an operator may have refined the Meldung, and the phone
        sends its whole cached form back — «Meldung» is assign-semantics, so a
        stale receipt would silently overwrite that text.
        """
        token, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None

        # dispatched, then un-dispatched by the operator
        incident.status = "enroute"
        db_session.add(StatusTransition(incident_id=incident.id, from_status="incoming", to_status="enroute"))
        await db_session.commit()
        incident.status = "incoming"
        db_session.add(StatusTransition(incident_id=incident.id, from_status="enroute", to_status="incoming"))
        await db_session.commit()

        operator_text = "Baum auf Fahrbahn, Höhe Einfahrt Werkhof, halbseitig gesperrt"
        incident.description = operator_text
        await db_session.commit()

        read = await client.get(_receipt_url(incident_id, token, receipt))
        assert read.status_code == 200
        assert read.json()["editable"] is False

        response = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={"description": "Baum auf der Fahrbahn"},
        )

        assert response.status_code == 409
        assert response.json()["detail"] == CLOSED
        await db_session.refresh(incident)
        assert incident.description == operator_text


class TestTheReceiptCarriesNoContent:
    """What the reporter gets back is state, never text.

    The reporter's own words are already on the reporter's own screen. Echoing
    the columns would echo them *as they stand now* — and «Notizen» is where an
    operator types what the caller must not read.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_state_answers_four_keys_and_no_more(self, client: AsyncClient, test_event: Event):
        token, incident_id, receipt = await _phone_in(client, test_event)

        read = await client.get(_receipt_url(incident_id, token, receipt))
        write = await client.put(_receipt_url(incident_id, token, receipt), json={"description": "Rauch aus dem 3. OG"})

        assert set(read.json()) == {"id", "status", "editable", "vehicles"}
        # The write answers with the same shape — a correction is not a read-back.
        assert set(write.json()) == {"id", "status", "editable", "vehicles"}

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_state_never_echoes_what_an_operator_typed(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        token, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        incident.internal_notes = "Melder wirkte alkoholisiert, Angaben unsicher"
        await db_session.commit()

        read = await client.get(_receipt_url(incident_id, token, receipt))
        write = await client.put(_receipt_url(incident_id, token, receipt), json={"priority": "medium"})

        for body in (read.text, write.text):
            assert "alkoholisiert" not in body
            for value in VALID_ALARM.values():
                assert value not in body


class TestNotizenAreSharedWithTheOperator:
    """A public caller may add to «Notizen». It may never take anything out.

    The read half withholds `internal_notes` precisely because an operator may
    have typed into that column since the call — so a correction that *assigned*
    it would be a blind write over content the caller is not allowed to read,
    silently, with neither side told. The write half appends instead, which also
    keeps the one legitimate reason to touch the column: the reporter fixing
    their own Hinweis.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_correction_cannot_overwrite_what_an_operator_typed(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        token, incident_id, receipt = await _phone_in(client, test_event)
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        operator_note = "Melder wirkte alkoholisiert, Angaben unsicher"
        incident.internal_notes = f"{VALID_ALARM['internal_notes']}\n{operator_note}"
        await db_session.commit()

        response = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={"internal_notes": "Zufahrt doch frei, Hund im Haus"},
        )

        assert response.status_code == 200, response.text
        await db_session.refresh(incident)
        assert incident.internal_notes is not None
        # The operator keeps every word – including the original hint they read.
        assert operator_note in incident.internal_notes
        assert VALID_ALARM["internal_notes"] in incident.internal_notes
        # And the reporter's fix arrives, marked as the Nachtrag it is.
        assert incident.internal_notes.endswith(f"{INTAKE_NOTE_PREFIX}Zufahrt doch frei, Hund im Haus")

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_resending_the_unchanged_hint_adds_nothing(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """A double tap – or a page that posts its whole draft back – must not stutter."""
        token, incident_id, receipt = await _phone_in(client, test_event)

        for _ in range(2):
            response = await client.put(
                _receipt_url(incident_id, token, receipt),
                json={"internal_notes": VALID_ALARM["internal_notes"]},
            )
            assert response.status_code == 200, response.text

        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        await db_session.refresh(incident)
        assert incident.internal_notes == VALID_ALARM["internal_notes"]

    def test_a_short_nachtrag_inside_an_existing_line_still_appends(self):
        """Dedup is entry-exact, not substring.

        «12» occurring inside «Hausnummer 12 …» is not the same Nachtrag having
        been sent before — dropping it would swallow a genuine correction. Only
        the note standing as its own entry dedups.
        """
        existing = "Zufahrt über Hausnummer 12 gesperrt"
        appended = append_reporter_note(existing, "12")
        assert appended == f"{existing}\n{INTAKE_NOTE_PREFIX}12"
        # …and once it IS its own entry, the resend adds nothing.
        assert append_reporter_note(appended, "12") == appended

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_empty_hint_does_not_clear_the_column(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """`""` clears the reporter's own fields. It cannot clear this one."""
        token, incident_id, receipt = await _phone_in(client, test_event)

        response = await client.put(_receipt_url(incident_id, token, receipt), json={"internal_notes": ""})

        assert response.status_code == 200, response.text
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        await db_session.refresh(incident)
        assert incident.internal_notes == VALID_ALARM["internal_notes"]


class TestTheReceiptPollIsNotOnTheCreationBudget:
    """Reading the receipt is polled; creating an alarm is typed by a human.

    A station NATs every phone behind one address. On INTAKE's 10/minute, two
    open receipts polling every 20 s spend six of those ten on status reads and
    429 the alarm somebody is phoning in — on the surface whose whole point is
    that it works under pressure. `/feld` polls for the same reason and was
    given the same headroom.
    """

    @pytest.mark.unit
    def test_the_read_is_on_the_feld_budget_and_the_writes_are_not(self):
        from app.main import app  # noqa: F401 – importing registers the routes
        from app.middleware.rate_limit import RateLimits, limiter

        def amount(endpoint: str) -> int:
            entries = limiter._route_limits[f"app.api.{endpoint}"]
            assert len(entries) == 1, f"{endpoint} carries more than one limit"
            return int(entries[0].limit.amount)

        feld_budget = int(RateLimits.FELD.split("/")[0])
        intake_budget = int(RateLimits.INTAKE.split("/")[0])
        assert feld_budget > intake_budget, "the whole point is that FELD is the looser of the two"

        assert amount("intake.get_intake_alarm_state") == feld_budget
        # The two writes stay tight – nothing here loosens what an abuser would automate.
        assert amount("intake.create_intake_alarm") == intake_budget
        assert amount("intake.correct_intake_alarm") == intake_budget


class TestCorrectionValidation:
    """Free text coming back through a login-less door is capped like it was going in."""

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("field", ["description", "internal_notes", "title"])
    async def test_overlong_free_text_is_refused_on_the_way_back_in(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, field: str
    ):
        token, incident_id, receipt = await _phone_in(client, test_event)

        response = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={field: "x" * (201 if field == "title" else 2001)},
        )

        assert response.status_code == 422
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        await db_session.refresh(incident)
        assert getattr(incident, field) == VALID_ALARM[field]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_coordinate_off_the_planet_is_refused(self, client: AsyncClient, test_event: Event):
        token, incident_id, receipt = await _phone_in(client, test_event)

        response = await client.put(_receipt_url(incident_id, token, receipt), json={"location_lat": "99.9"})

        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_correction_is_not_a_second_way_onto_the_board(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        """No `status`, no operator flags — this is the reporter's own words, nothing else."""
        token, incident_id, receipt = await _phone_in(client, test_event)

        response = await client.put(
            _receipt_url(incident_id, token, receipt),
            json={"status": "complete", "nachbarhilfe": True, "description": "Rauch aus dem 3. OG"},
        )

        assert response.status_code == 200, response.text
        incident = await db_session.get(Incident, UUID(incident_id))
        assert incident is not None
        await db_session.refresh(incident)
        assert incident.status == "incoming"
        assert incident.nachbarhilfe is False
        assert incident.description == "Rauch aus dem 3. OG"
