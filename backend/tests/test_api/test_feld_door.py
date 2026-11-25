"""The `/feld` door: Feld-Code → unlocked → bound to one person.

Plan 26, decisions 13, 18, 22, 28 and 30. The point of every test here is that
**holding the link is not enough**. Before this, whoever had the URL could read
the picker and write as any crew in the Ereignis — fine for a poster inside a
locked vehicle hall, indefensible for an Einsatzzettel that leaves in a vehicle
and stays valid for thirty days.
"""

import asyncio
import runpy
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models import (
    Event,
    EventSpecialFunction,
    FeldCodeAttempt,
    FeldDeviceClaim,
    FeldUnlockClaim,
    Incident,
    IncidentAssignment,
    Personnel,
    User,
)
from app.services.tokens import generate_feld_token, validate_feld_token, validate_form_token
from tests.conftest import feld_device_token, feld_unlock_token


async def _person_on_an_incident(db: AsyncSession, event: Event, user: User) -> Personnel:
    incident = Incident(
        id=uuid.uuid4(),
        title="Baum",
        type="elementarereignis",
        priority="medium",
        location_address="Hauptstrasse 12",
        status="active",
        event_id=event.id,
        created_by=user.id,
    )
    person = Personnel(id=uuid.uuid4(), name="Brunner Marco", role="Feuerwehrmann", status="available")
    db.add_all([incident, person])
    await db.commit()
    db.add(IncidentAssignment(incident_id=incident.id, resource_type="personnel", resource_id=person.id))
    await db.commit()
    return person


@pytest.mark.asyncio
async def test_security_upgrade_revokes_devices_and_pickers_but_keeps_poster(client, db_session, test_event, test_user):
    person = await _person_on_an_incident(db_session, test_event, test_user)
    poster = generate_feld_token(test_event.id)
    old_picker = await feld_unlock_token(client, test_event)
    bound = await client.post(
        f"/api/feld/claim?token={await feld_unlock_token(client, test_event)}",
        json={"personnel_id": str(person.id)},
    )
    assert bound.status_code == 200
    old_device = bound.json()["token"]
    old_claim = validate_feld_token(old_device).claim_id
    pending_claim = validate_feld_token(old_picker).unlock_id
    already_revoked = FeldDeviceClaim(
        event_id=test_event.id, personnel_id=person.id, revoked_at=datetime.now(UTC) - timedelta(days=1)
    )
    db_session.add(already_revoked)
    await db_session.commit()
    prior_timestamp = already_revoked.revoked_at

    migration = runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "alembic/versions/e5b8a90c31d2_reset_legacy_field_credentials.py")
    )

    def upgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration["upgrade"]()

    await (await db_session.connection()).run_sync(upgrade)
    await db_session.commit()
    await db_session.refresh(already_revoked)
    assert already_revoked.revoked_at == prior_timestamp
    assert (await db_session.get(FeldDeviceClaim, old_claim)).revoked_at is not None
    assert (await db_session.get(FeldUnlockClaim, pending_claim)).revoked_at is not None
    assert (await client.get(f"/api/feld/assignments/{person.id}?token={old_device}")).status_code == 401
    assert (
        await client.post(f"/api/feld/claim?token={old_picker}", json={"personnel_id": str(person.id)})
    ).status_code == 401
    unlock = await client.post(f"/api/feld/unlock?token={poster}", json={"code": test_event.feld_code})
    assert unlock.status_code == 200
    new_claim = await client.post(
        f"/api/feld/claim?token={unlock.json()['token']}", json={"personnel_id": str(person.id)}
    )
    assert new_claim.status_code == 200
    new_device = new_claim.json()["token"]
    assert (await client.get(f"/api/feld/assignments/{person.id}?token={new_device}")).status_code == 200


class TestUnlock:
    """Step 2: the four digits."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_right_code_returns_a_token_and_the_picker(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Picker in the same response: the only thing you can do next is find
        # your own name, and a second round trip on a wet phone buys nothing.
        person = await _person_on_an_incident(db_session, test_event, test_user)

        response = await client.post(
            f"/api/feld/unlock?token={generate_feld_token(test_event.id)}",
            json={"code": test_event.feld_code},
        )

        assert response.status_code == 200
        body = response.json()
        assert [p["personnel_id"] for p in body["personnel"]] == [str(person.id)]
        claims = validate_feld_token(body["token"])
        assert claims is not None
        assert claims.unlocked is True
        # Unlocked is NOT bound — naming yourself is still to come.
        assert claims.personnel_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_wrong_code_is_refused(self, client: AsyncClient, test_event: Event):
        wrong = "0000" if test_event.feld_code != "0000" else "1111"
        response = await client.post(
            f"/api/feld/unlock?token={generate_feld_token(test_event.id)}",
            json={"code": wrong},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_code_from_another_ereignis_does_not_open_this_one(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        # Codes are per Ereignis, so last week's poster is worthless this week —
        # which is most of the reason the code exists at all.
        other = Event(id=uuid.uuid4(), name="Anderes Ereignis")
        db_session.add(other)
        await db_session.commit()
        assert other.feld_code != test_event.feld_code

        response = await client.post(
            f"/api/feld/unlock?token={generate_feld_token(test_event.id)}",
            json={"code": other.feld_code},
        )
        assert response.status_code == 403


class TestClaim:
    """Step 3: naming yourself, which is where the binding happens."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_claiming_binds_the_token_to_that_person(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)

        response = await client.post(
            f"/api/feld/claim?token={await feld_unlock_token(client, test_event)}",
            json={"personnel_id": str(person.id)},
        )

        assert response.status_code == 200
        claims = validate_feld_token(response.json()["token"])
        assert claims is not None
        assert claims.personnel_id == person.id
        assert claims.claim_id is not None
        # The claim row is what makes "alle Geräte abmelden" possible at all.
        rows = (await db_session.execute(select(FeldDeviceClaim))).scalars().all()
        assert [r.id for r in rows] == [claims.claim_id]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_you_cannot_claim_without_the_code(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)

        response = await client.post(
            f"/api/feld/claim?token={generate_feld_token(test_event.id)}",
            json={"personnel_id": str(person.id)},
        )

        assert response.status_code == 403
        assert (await db_session.execute(select(FeldDeviceClaim))).first() is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_anybody_on_the_roster_may_name_themselves(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        """This used to require having work in the Ereignis already, and that
        was backwards: the picker is the roster now, so the people it refused
        were exactly the ones the page grew for — somebody who has just walked
        in and wants to check in, and a Telefondienst who is assigned to nothing
        by definition. Worse, it refused them with "Zugriff erforderlich", which
        reads as a fault rather than as "nothing here yet".
        """
        await _person_on_an_incident(db_session, test_event, test_user)
        newcomer = Personnel(id=uuid.uuid4(), name="Neu Hier", role="Feuerwehrmann", status="available")
        db_session.add(newcomer)
        await db_session.commit()

        response = await client.post(
            f"/api/feld/claim?token={await feld_unlock_token(client, test_event)}",
            json={"personnel_id": str(newcomer.id)},
        )
        assert response.status_code == 200
        # ...and their list is simply empty, which the page words as
        # "noch kein Auftrag" rather than an error.
        token = response.json()["token"]
        feed = await client.get(f"/api/feld/assignments/{newcomer.id}?token={token}")
        assert feed.status_code == 200
        assert feed.json()["assignments"] == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_unknown_uuid_gets_the_same_answer_as_a_stranger(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Otherwise the endpoint is an oracle for which personnel ids exist.
        await _person_on_an_incident(db_session, test_event, test_user)

        response = await client.post(
            f"/api/feld/claim?token={await feld_unlock_token(client, test_event)}",
            json={"personnel_id": str(uuid.uuid4())},
        )
        assert response.status_code == 403


class TestRevocation:
    """Decision 30 — and the distinction that keeps the brake from being pulled by accident."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_revoking_devices_kills_a_bound_token(
        self,
        client: AsyncClient,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)
        claimed = await client.post(
            f"/api/feld/claim?token={await feld_unlock_token(client, test_event)}",
            json={"personnel_id": str(person.id)},
        )
        token = claimed.json()["token"]
        assert (await client.get(f"/api/feld/assignments/{person.id}?token={token}")).status_code == 200

        revoked = await editor_client.post(f"/api/feld/access/revoke-devices?event_id={test_event.id}")
        assert revoked.status_code == 200
        assert revoked.json()["device_count"] == 0

        # 401, not 403: the device is not forbidden, it has been logged out and
        # the page has to send it back through the door rather than tell the
        # crew they are not assigned.
        after = await client.get(f"/api/feld/assignments/{person.id}?token={token}")
        assert after.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_regenerating_the_code_logs_nobody_out(
        self,
        client: AsyncClient,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """The whole reason the two actions are separate (decision 30).

        A new code has to be a cheap thing to do — otherwise nobody does it when
        a code leaks. If it also threw every crew off the page mid-storm, it
        would be the dangerous button people avoid.
        """
        person = await _person_on_an_incident(db_session, test_event, test_user)
        claimed = await client.post(
            f"/api/feld/claim?token={await feld_unlock_token(client, test_event)}",
            json={"personnel_id": str(person.id)},
        )
        token = claimed.json()["token"]
        # Read before, not after: the ORM object refreshes to the new code.
        old_code = test_event.feld_code

        regenerated = await editor_client.post(f"/api/feld/access/regenerate?event_id={test_event.id}")
        assert regenerated.status_code == 200
        assert regenerated.json()["code"] != old_code
        # Still one device, still working.
        assert regenerated.json()["device_count"] == 1
        assert (await client.get(f"/api/feld/assignments/{person.id}?token={token}")).status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_old_code_stops_unlocking_new_devices(
        self, client: AsyncClient, editor_client: AsyncClient, test_event: Event
    ):
        old_code = test_event.feld_code
        await editor_client.post(f"/api/feld/access/regenerate?event_id={test_event.id}")

        response = await client.post(
            f"/api/feld/unlock?token={generate_feld_token(test_event.id)}",
            json={"code": old_code},
        )
        assert response.status_code == 403


class TestAccessStateIsEditorOnly:
    """The code is a credential, however short."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_board_sees_the_code_and_the_device_count(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)
        await client.post(
            f"/api/feld/claim?token={await feld_unlock_token(client, test_event)}",
            json={"personnel_id": str(person.id)},
        )

        response = await editor_client.get(f"/api/feld/access?event_id={test_event.id}")

        assert response.status_code == 200
        assert response.json() == {"code": test_event.feld_code, "device_count": 1}

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_anonymous_caller_cannot_read_the_code(self, client: AsyncClient, test_event: Event):
        response = await client.get(f"/api/feld/access?event_id={test_event.id}")
        assert response.status_code == 401


class TestRekoLink:
    """Absorbing the Reko form without widening a token type."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_reko_auftrag_gets_a_form_token(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)
        assignment = (await db_session.execute(select(IncidentAssignment))).scalar_one()
        assignment.purpose = "reko"
        await db_session.commit()
        token = await feld_device_token(db_session, test_event.id, person.id)

        response = await client.post(
            f"/api/feld/incidents/{assignment.incident_id}/reko-link?token={token}&personnel_id={person.id}"
        )

        assert response.status_code == 200
        # The SAME per-incident form token /reko-dashboard used to hand out —
        # `/feld` mints it rather than teaching either token type about the other.
        assert validate_form_token(response.json()["token"], str(assignment.incident_id))

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_working_crew_cannot_file_a_reko(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # They read the Reko as briefing and file a Schadenplatz-Rapport instead;
        # filing the Reko is the job of the trupp the KP sent to look.
        person = await _person_on_an_incident(db_session, test_event, test_user)
        assignment = (await db_session.execute(select(IncidentAssignment))).scalar_one()
        token = await feld_device_token(db_session, test_event.id, person.id)

        response = await client.post(
            f"/api/feld/incidents/{assignment.incident_id}/reko-link?token={token}&personnel_id={person.id}"
        )

        assert response.status_code == 403


class TestBoardAssignedRekoReachesTheField:
    """The write path, not just the migration.

    `purpose` was added with a backfill for history, and the board's own
    assign-reko path then had to learn to set it. It did not, at first: every
    Reko the KP assigned came out as a crew row, so `/feld` asked the trupp for
    a Schadenplatz-Rapport on a place it had only looked at — the exact bug the
    column exists to kill, alive again for every NEW assignment.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_assigning_a_reko_from_the_board_lands_as_a_reko_row(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # A crew is already on the Schadenplatz; the Reko is somebody ELSE, which
        # is the normal case and the only one the board accepts — assigning the
        # person already on it is a no-op it answers 400 to.
        await _person_on_an_incident(db_session, test_event, test_user)
        incident_id = (await db_session.execute(select(IncidentAssignment))).scalar_one().incident_id
        person = Personnel(id=uuid.uuid4(), name="Fischer Thomas", role="Offizier", status="available")
        db_session.add(person)
        await db_session.commit()
        # The board only offers people who hold the reko function for the event.
        db_session.add(EventSpecialFunction(event_id=test_event.id, personnel_id=person.id, function_type="reko"))
        await db_session.commit()

        response = await editor_client.post(
            f"/api/reko/incidents/{incident_id}/assign-reko",
            json={"personnel_id": str(person.id)},
        )
        assert response.status_code == 201, response.text

        rows = (
            (
                await db_session.execute(
                    select(IncidentAssignment).where(
                        IncidentAssignment.incident_id == incident_id,
                        IncidentAssignment.resource_id == person.id,
                        IncidentAssignment.unassigned_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [r.purpose for r in rows] == ["reko"]

        # And the field surface reads it as a Reko auftrag: no Rapport asked for.
        token = await feld_device_token(db_session, test_event.id, person.id)
        feed = await client.get(f"/api/feld/assignments/{person.id}?token={token}")
        row = next(r for r in feed.json()["assignments"] if r["incident_id"] == str(incident_id))
        assert row["source"] == "reko"


class TestOwnAttendance:
    """The individual half of the roll call (plan 26, decision 10).

    `/check-in` stays a page for the shared tablet at the door — one device for
    many people is a different product from a page built around a per-device
    "this phone is Marco" cookie. This is the other half: somebody saying "ich
    bin da" from the vehicle, and — the part that had no home at all — "ich
    rücke ab".
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_checking_yourself_in_and_out_again(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)
        token = await feld_device_token(db_session, test_event.id, person.id)

        assert (await client.post(f"/api/feld/attendance/{person.id}?token={token}&present=true")).status_code == 200
        feed = await client.get(f"/api/feld/assignments/{person.id}?token={token}")
        assert feed.json()["checked_in"] is True

        # A crew still standing on a Schadenplatz can say it has gone home; the
        # board clears the assignment, not the person.
        assert (await client.post(f"/api/feld/attendance/{person.id}?token={token}&present=false")).status_code == 200
        feed = await client.get(f"/api/feld/assignments/{person.id}?token={token}")
        assert feed.json()["checked_in"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_somebody_with_no_assignment_can_still_check_in(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        # The whole point: checking in is what you do BEFORE the KP has given
        # you anything, so requiring an assignment first would refuse exactly
        # the people this exists for.
        newcomer = Personnel(id=uuid.uuid4(), name="Neu Hier", role="Feuerwehrmann", status="available")
        db_session.add(newcomer)
        await db_session.commit()
        token = await feld_device_token(db_session, test_event.id, newcomer.id)

        response = await client.post(f"/api/feld/attendance/{newcomer.id}?token={token}&present=true")

        assert response.status_code == 200
        feed = await client.get(f"/api/feld/assignments/{newcomer.id}?token={token}")
        # Present, and honest about having nothing — which is what the page then
        # says instead of an unexplained empty screen.
        assert feed.json()["checked_in"] is True
        assert feed.json()["assignments"] == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_device_cannot_check_somebody_else_in(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)
        colleague = Personnel(id=uuid.uuid4(), name="Frey Marc", role="Feuerwehrmann", status="available")
        db_session.add(colleague)
        await db_session.commit()
        token = await feld_device_token(db_session, test_event.id, person.id)

        response = await client.post(f"/api/feld/attendance/{colleague.id}?token={token}&present=true")

        assert response.status_code == 403


class TestWrongCodes:
    """Wrong Feld-Codes count per phone AND per address: five tries, then a growing wait.

    Per phone, so a fumbling crew member does not cost the depot's shared Wi-Fi its budget
    alone; per address, so a guesser cannot buy fresh tries by inventing phones. The wait grows
    1 → 5 → 15 minutes and stays there. Wrong tries never move the code – a guesser must not be
    able to throw every crew out of the door; rotating stays the KP's «Neu generieren».
    Counted in the database (``feld_code_attempts``), so a restart gives nobody a fresh budget.
    """

    @staticmethod
    def _wrong(event: Event) -> str:
        return "0000" if event.feld_code != "0000" else "1111"

    @staticmethod
    async def _try(client: AsyncClient, event: Event, code: str, *, ip: str, device: uuid.UUID | None):
        # trusted_proxy_count=1: the right-most X-Forwarded-For hop is the caller's address.
        body: dict[str, str] = {"code": code}
        if device:
            body["device"] = str(device)
        return await client.post(
            f"/api/feld/unlock?token={generate_feld_token(event.id)}", json=body, headers={"X-Forwarded-For": ip}
        )

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("same", ["phone", "address"])
    async def test_five_wrong_tries_from_one_phone_or_one_address_mean_a_minute_of_waiting(
        self, client: AsyncClient, test_event: Event, same: str
    ):
        phone = uuid.uuid4()
        for i in range(5):
            answer = await self._try(
                client,
                test_event,
                self._wrong(test_event),
                ip="203.0.113.1" if same == "address" else f"198.51.100.{i}",
                device=phone if same == "phone" else uuid.uuid4(),
            )
        assert answer.status_code == 429
        assert answer.json()["detail"]["retry_after"] == 60
        assert answer.json()["detail"]["message"] == "Zu viele Fehlversuche. Bitte 1 Minute warten."

        # The right code waits too, from that phone or address – and works from anywhere else.
        blocked = await self._try(
            client, test_event, test_event.feld_code, ip="203.0.113.1", device=phone if same == "phone" else None
        )
        assert blocked.status_code == 429
        assert (
            await self._try(client, test_event, test_event.feld_code, ip="192.0.2.9", device=None)
        ).status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_wait_grows_to_five_then_fifteen_minutes_and_stays_there(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        phone = uuid.uuid4()
        waits = []
        for _ in range(8):
            answer = await self._try(client, test_event, self._wrong(test_event), ip="203.0.113.1", device=phone)
            if answer.status_code == 429:
                waits.append(answer.json()["detail"]["retry_after"])
                # The wait is over – the next wrong try is the next lockout.
                await db_session.execute(
                    update(FeldCodeAttempt)
                    .where(FeldCodeAttempt.event_id == test_event.id)
                    .values(locked_until=datetime.now(UTC) - timedelta(seconds=1))
                )
                await db_session.commit()
            else:
                assert answer.json()["detail"]["error"] == "wrong_code"
        assert waits == [60, 300, 900, 900]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_wrong_tries_never_rotate_the_code(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        code = test_event.feld_code
        for i in range(40):
            await self._try(client, test_event, self._wrong(test_event), ip=f"203.0.113.{i}", device=uuid.uuid4())
        await db_session.refresh(test_event)
        assert test_event.feld_code == code

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_right_code_clears_that_phones_and_that_addresss_count(
        self, client: AsyncClient, test_event: Event
    ):
        phone = uuid.uuid4()
        for _ in range(4):
            await self._try(client, test_event, self._wrong(test_event), ip="203.0.113.1", device=phone)
        assert (
            await self._try(client, test_event, test_event.feld_code, ip="203.0.113.1", device=phone)
        ).status_code == 200

        answer = await self._try(client, test_event, self._wrong(test_event), ip="203.0.113.1", device=phone)
        assert answer.json()["detail"]["attempts_left"] == 4


@pytest.mark.asyncio
@pytest.mark.api
async def test_bound_and_spent_tokens_cannot_reenter_the_picker_or_claim_another_person(
    client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    person = await _person_on_an_incident(db_session, test_event, test_user)
    other = Personnel(id=uuid.uuid4(), name="Andere Person", role="Feuerwehrmann", status="available")
    db_session.add(other)
    await db_session.commit()
    picker = await feld_unlock_token(client, test_event)
    response = await client.post(f"/api/feld/claim?token={picker}", json={"personnel_id": str(person.id)})
    assert response.status_code == 200
    bound = response.json()["token"]
    for token, refused in ((picker, 401), (bound, 403)):
        assert (await client.get(f"/api/feld/personnel?token={token}")).status_code == refused
        assert (
            await client.post(f"/api/feld/claim?token={token}", json={"personnel_id": str(other.id)})
        ).status_code == refused
        assert (
            await client.post(f"/api/feld/unlock?token={token}", json={"code": test_event.feld_code})
        ).status_code == refused
    assert (await client.get(f"/api/feld/assignments/{person.id}?token={bound}")).status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("action", ["regenerate", "revoke-devices"])
async def test_code_rotation_and_logout_all_invalidate_outstanding_picker_grants(
    client: AsyncClient,
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_user: User,
    action: str,
):
    person = await _person_on_an_incident(db_session, test_event, test_user)
    picker = await feld_unlock_token(client, test_event)
    assert (await editor_client.post(f"/api/feld/access/{action}?event_id={test_event.id}")).status_code == 200
    assert (await client.get(f"/api/feld/personnel?token={picker}")).status_code == 401
    assert (
        await client.post(f"/api/feld/claim?token={picker}", json={"personnel_id": str(person.id)})
    ).status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_logout_revokes_one_device_and_cannot_be_bypassed_by_reclaiming(
    client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    person = await _person_on_an_incident(db_session, test_event, test_user)
    tokens = []
    for _ in range(2):
        picker = await feld_unlock_token(client, test_event)
        response = await client.post(f"/api/feld/claim?token={picker}", json={"personnel_id": str(person.id)})
        tokens.append(response.json()["token"])
    assert (await client.post(f"/api/feld/logout?token={tokens[0]}")).status_code == 204
    for path in ("context", "personnel", f"assignments/{person.id}"):
        assert (await client.get(f"/api/feld/{path}?token={tokens[0]}")).status_code == 401
    assert (
        await client.post(f"/api/feld/claim?token={tokens[0]}", json={"personnel_id": str(person.id)})
    ).status_code == 401
    assert (await client.get(f"/api/feld/assignments/{person.id}?token={tokens[1]}")).status_code == 200


@pytest.mark.asyncio
async def test_late_logout_preserves_original_revocation_time(client, db_session, test_event, test_user):
    from app.crud.feld import revoke_claim

    person = await _person_on_an_incident(db_session, test_event, test_user)
    token = await feld_device_token(db_session, test_event.id, person.id)
    claims = validate_feld_token(token)
    row = await db_session.get(FeldDeviceClaim, claims.claim_id)
    assert (await client.post(f"/api/feld/logout?token={token}")).status_code == 204
    await db_session.refresh(row)
    original = row.revoked_at
    assert original is not None
    assert (await client.post(f"/api/feld/logout?token={token}")).status_code == 401
    # A second request may already have passed admission before the first logout
    # committed. Its delayed write must still retain the first timestamp.
    await revoke_claim(db_session, claims.claim_id, test_event.id, person.id)
    await db_session.refresh(row)
    assert row.revoked_at == original


@pytest.mark.asyncio
@pytest.mark.api
async def test_expired_and_legacy_picker_credentials_cannot_claim(
    client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    person = await _person_on_an_incident(db_session, test_event, test_user)
    picker = await feld_unlock_token(client, test_event)
    claims = validate_feld_token(picker)
    assert claims is not None
    grant = await db_session.get(FeldUnlockClaim, claims.unlock_id)
    assert grant is not None
    grant.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    for token in (picker, generate_feld_token(test_event.id, unlocked=True)):
        assert (await client.get(f"/api/feld/personnel?token={token}")).status_code == 401
        assert (
            await client.post(f"/api/feld/claim?token={token}", json={"personnel_id": str(person.id)})
        ).status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_claim_row_must_match_the_person_named_in_the_signed_token(
    client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    person = await _person_on_an_incident(db_session, test_event, test_user)
    original = await feld_device_token(db_session, test_event.id, person.id)
    claims = validate_feld_token(original)
    assert claims is not None
    token = generate_feld_token(test_event.id, personnel_id=uuid.uuid4(), unlocked=True, claim_id=claims.claim_id)
    assert (await client.get(f"/api/feld/context?token={token}")).status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_concurrent_claim_requests_can_consume_a_picker_grant_only_once(test_engine: AsyncEngine, monkeypatch):
    """Use separate database transactions, as two real HTTP requests do."""
    from app.database import get_db
    from app.main import app
    from app.middleware.audit import _inflight_audit_tasks

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    event = Event(id=uuid.uuid4(), name="Concurrent field exchange")
    person = Personnel(id=uuid.uuid4(), name="Concurrent Person", role="Feuerwehrmann", status="available")
    async with sessions() as db:
        db.add_all([event, person])
        await db.commit()

    async def request_session():
        async with sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, request_session)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            picker = await feld_unlock_token(client, event)
            responses = await asyncio.gather(
                *[
                    client.post(f"/api/feld/claim?token={picker}", json={"personnel_id": str(person.id)})
                    for _ in range(2)
                ]
            )
            assert sorted(response.status_code for response in responses) == [200, 401]
        async with sessions() as db:
            claims = (
                (await db.execute(select(FeldDeviceClaim).where(FeldDeviceClaim.event_id == event.id))).scalars().all()
            )
            assert len(claims) == 1
    finally:
        if _inflight_audit_tasks:
            await asyncio.gather(*list(_inflight_audit_tasks))
        async with sessions() as db:
            await db.execute(delete(Event).where(Event.id == event.id))
            await db.execute(delete(Personnel).where(Personnel.id == person.id))
            await db.commit()


class TestSessionInsteadOfCode:
    """An editor's Rück login opens the Feld door without the four digits (owner, 03.10.2026).

    The session counts INSTEAD of the code: the same picker grant, for the link's Ereignis, through
    the same claim step. Anything that is not a valid editor/admin session (viewer included) falls
    back to the code – without the attempt counting as a failure.
    """

    @staticmethod
    async def _login(client: AsyncClient, db: AsyncSession, role: str) -> None:
        from app.auth.security import hash_password
        from tests.conftest import TEST_PASSWORD

        db.add(User(id=uuid.uuid4(), username=f"door_{role}", password_hash=hash_password(TEST_PASSWORD), role=role))
        await db.commit()
        response = await client.post("/api/auth/login", data={"username": f"door_{role}", "password": TEST_PASSWORD})
        assert response.status_code == 200, response.text

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize("role", ["editor", "admin"])
    async def test_a_logged_in_phone_gets_the_picker_without_a_code(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User, role: str
    ):
        person = await _person_on_an_incident(db_session, test_event, test_user)
        await self._login(client, db_session, role)

        response = await client.post(f"/api/feld/unlock?token={generate_feld_token(test_event.id)}", json={})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["event_id"] == str(test_event.id)
        assert [p["personnel_id"] for p in body["personnel"]] == [str(person.id)]
        claims = validate_feld_token(body["token"])
        assert claims is not None and claims.unlocked is True and claims.personnel_id is None
        assert claims.event_id == test_event.id
        # ... and it is the ordinary picker grant: the claim step takes it as from a code
        claim = await client.post(f"/api/feld/claim?token={body['token']}", json={"personnel_id": str(person.id)})
        assert claim.status_code == 200, claim.text

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_viewer_session_still_needs_the_code(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        # The picker grant writes Meldungen; a viewer may not, so their session is no session here.
        await self._login(client, db_session, "viewer")
        token = generate_feld_token(test_event.id)

        response = await client.post(f"/api/feld/unlock?token={token}", json={})
        assert response.status_code == 403
        assert response.json()["detail"]["error"] == "code_required"

        response = await client.post(f"/api/feld/unlock?token={token}", json={"code": test_event.feld_code})
        assert response.status_code == 200, response.text

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_anonymous_phone_is_asked_for_the_code_and_it_costs_no_attempt(
        self, client: AsyncClient, test_event: Event
    ):
        token = generate_feld_token(test_event.id)
        for _ in range(8):  # more than the per-phone budget of failures
            response = await client.post(f"/api/feld/unlock?token={token}", json={})
            assert response.status_code == 403
            assert response.json()["detail"]["error"] == "code_required"
        # still a full budget: the right code opens at once
        response = await client.post(f"/api/feld/unlock?token={token}", json={"code": test_event.feld_code})
        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_expired_or_logged_out_session_falls_back_to_the_code(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        await self._login(client, db_session, "editor")
        assert (await client.post("/api/auth/logout")).status_code == 200
        response = await client.post(f"/api/feld/unlock?token={generate_feld_token(test_event.id)}", json={})
        assert response.status_code == 403
        assert response.json()["detail"]["error"] == "code_required"

        # a stale cookie that no longer decodes is no session either
        client.cookies.set("access_token", "not-a-jwt")
        response = await client.post(f"/api/feld/unlock?token={generate_feld_token(test_event.id)}", json={})
        assert response.json()["detail"]["error"] == "code_required"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_code_sent_by_a_logged_in_phone_is_still_checked(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        # The session replaces a MISSING code; it never turns a wrong one into a right one.
        await self._login(client, db_session, "editor")
        wrong = "0000" if test_event.feld_code != "0000" else "1111"
        response = await client.post(
            f"/api/feld/unlock?token={generate_feld_token(test_event.id)}", json={"code": wrong}
        )
        assert response.status_code == 403
        assert response.json()["detail"]["error"] == "wrong_code"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_session_does_not_reach_past_the_link(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event
    ):
        # Without a link token there is no Ereignis to open — a login alone is not a Feld link.
        await self._login(client, db_session, "editor")
        assert (await client.post("/api/feld/unlock", json={})).status_code == 422
        # ... and an expired link stays expired, session or not
        expired = generate_feld_token(test_event.id, expires_hours=-1)
        assert (await client.post(f"/api/feld/unlock?token={expired}", json={})).status_code == 401
