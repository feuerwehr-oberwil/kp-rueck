"""The `/feld` door: Feld-Code → unlocked → bound to one person.

Plan 26, decisions 13, 18, 22, 28 and 30. The point of every test here is that
**holding the link is not enough**. Before this, whoever had the URL could read
the picker and write as any crew in the Ereignis — fine for a poster inside a
locked vehicle hall, indefensible for an Einsatzzettel that leaves in a vehicle
and stays valid for thirty days.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    EventSpecialFunction,
    FeldDeviceClaim,
    Incident,
    IncidentAssignment,
    Personnel,
    User,
)
from app.services.tokens import generate_feld_token, validate_feld_token, validate_form_token
from tests.conftest import feld_device_token


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
            f"/api/feld/claim?token={generate_feld_token(test_event.id, unlocked=True)}",
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
    async def test_claiming_a_stranger_is_refused(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        await _person_on_an_incident(db_session, test_event, test_user)
        stranger = Personnel(id=uuid.uuid4(), name="Nie Dabei", role="Feuerwehrmann", status="available")
        db_session.add(stranger)
        await db_session.commit()

        response = await client.post(
            f"/api/feld/claim?token={generate_feld_token(test_event.id, unlocked=True)}",
            json={"personnel_id": str(stranger.id)},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_unknown_uuid_gets_the_same_answer_as_a_stranger(
        self, client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Otherwise the endpoint is an oracle for which personnel ids exist.
        await _person_on_an_incident(db_session, test_event, test_user)

        response = await client.post(
            f"/api/feld/claim?token={generate_feld_token(test_event.id, unlocked=True)}",
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
            f"/api/feld/claim?token={generate_feld_token(test_event.id, unlocked=True)}",
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
            f"/api/feld/claim?token={generate_feld_token(test_event.id, unlocked=True)}",
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
            f"/api/feld/claim?token={generate_feld_token(test_event.id, unlocked=True)}",
            json={"personnel_id": str(person.id)},
        )

        response = await editor_client.get(f"/api/feld/access?event_id={test_event.id}")

        assert response.status_code == 200
        assert response.json() == {"code": test_event.feld_code, "device_count": 1}

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_anonymous_caller_cannot_read_the_code(self, client: AsyncClient, test_event: Event):
        response = await client.get(f"/api/feld/access?event_id={test_event.id}")
        assert response.status_code in (401, 403)


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
            f"/api/reko-dashboard/incidents/{incident_id}/assign-reko",
            json={"personnel_id": str(person.id)},
        )
        assert response.status_code in (200, 201), response.text

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
