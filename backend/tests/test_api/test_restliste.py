"""The Restliste, the Abholliste and the Einsatzzettel QR (plan 25, phase 3).

Three things that only make sense together: nobody clicks twenty-three cards
individually, so the gaps have to be countable in one place (§6, V-8); the
material half of those gaps is next morning's driving list, so it has to come out
on paper (decision 25); and the crew that is standing at one of those addresses
gets there from a QR on the slip it was handed (decision 19).

The fixture below is a deliberate mix — submitted / draft / none, a unit left on
site, a unit that came back, a consumable, a released assignment and an open
pickup — because every one of those is a row somebody could plausibly have
counted wrongly.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.crud import print_jobs as print_job_crud
from app.models import Event, Incident, IncidentAssignment, Material, PrintJob, Setting, User
from app.services.tokens import validate_feld_token


@pytest_asyncio.fixture
async def printer_enabled(db_session: AsyncSession):
    """Enable the thermal printer so the queue guard passes."""
    db_session.add(Setting(key="printer.enabled", value="true"))
    await db_session.commit()


async def _incident(db: AsyncSession, event: Event, user: User, title: str) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title}strasse 1, Oberwil",
        status="active",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _material(db: AsyncSession, name: str, *, consumable: bool = False) -> Material:
    material = Material(
        id=uuid4(),
        name=name,
        type="Sonstiges",
        location="Magazin A",
        status="available",
        consumable=consumable,
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return material


async def _assign_material(
    db: AsyncSession,
    incident: Incident,
    material: Material,
    *,
    released: bool = False,
) -> IncidentAssignment:
    assignment = IncidentAssignment(
        incident_id=incident.id,
        resource_type="material",
        resource_id=material.id,
        assigned_at=datetime(2026, 8, 8, 23, 14, tzinfo=UTC),
        unassigned_at=datetime.now(UTC) if released else None,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


async def _mixed_event(
    editor_client: AsyncClient,
    db: AsyncSession,
    event: Event,
    user: User,
) -> dict[str, Incident]:
    """Four Schadenplätze covering every state the Restliste has to tell apart.

    Filed through the KP twin rather than by writing rows: the counts must be
    right for the data the real handlers produce, not for a hand-built fixture
    that happens to agree with them.
    """
    submitted = await _incident(db, event, user, "Abgeschlossen")
    draft = await _incident(db, event, user, "Angefangen")
    untouched = await _incident(db, event, user, "Nichts")
    pickup = await _incident(db, event, user, "Wartet")

    pump = await _material(db, "Tauchpumpe TP-4")
    saw = await _material(db, "Motorsäge")
    returned_pump = await _material(db, "Tauchpumpe TP-9")
    absorbent = await _material(db, "Ölbindemittel", consumable=True)

    stays = await _assign_material(db, submitted, pump)
    goes_home = await _assign_material(db, submitted, saw)
    # Left on site by the crew, but the board has already released it — the board
    # is the authority on where a unit is, so it must not appear.
    already_released = await _assign_material(db, submitted, returned_pump, released=True)
    consumable = await _assign_material(db, submitted, absorbent)

    response = await editor_client.put(
        f"/api/incidents/{submitted.id}/rapport",
        json={
            "is_draft": False,
            "damage_type": "wasserschaden",
            "materials": [
                {"assignment_id": str(stays.id), "used": True, "left_on_site": True},
                {"assignment_id": str(goes_home.id), "used": True, "left_on_site": False},
                {"assignment_id": str(already_released.id), "used": True, "left_on_site": True},
                {"assignment_id": str(consumable.id), "used": True, "left_on_site": True},
            ],
        },
    )
    assert response.status_code == 200

    draft_response = await editor_client.put(
        f"/api/incidents/{draft.id}/rapport",
        json={"is_draft": True, "kurzbericht": "Angefangen zu tippen"},
    )
    assert draft_response.status_code == 200

    pickup_response = await editor_client.post(
        f"/api/incidents/{pickup.id}/field-report",
        json={"pickup_needed": True, "pickup_note": "3 Personen zu Fuss"},
    )
    assert pickup_response.status_code == 200

    return {"submitted": submitted, "draft": draft, "untouched": untouched, "pickup": pickup}


class TestRestliste:
    """The three counts on the events page."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_auth(self, client: AsyncClient, test_event: Event):
        assert (await client.get(f"/api/events/{test_event.id}/restliste")).status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_event_is_404(self, editor_client: AsyncClient):
        assert (await editor_client.get(f"/api/events/{uuid4()}/restliste")).status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_three_counts_against_a_deliberate_mix(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incidents = await _mixed_event(editor_client, db_session, test_event, test_user)

        response = await editor_client.get(f"/api/events/{test_event.id}/restliste")
        assert response.status_code == 200
        body = response.json()

        # "x von 4 Schadenplätzen ohne Rapport" — a draft counts as missing: a
        # rapport somebody started and walked away from is exactly the gap the
        # list exists to surface.
        assert body["incident_total"] == 4
        missing = {row["incident_id"]: row for row in body["missing_rapport"]}
        assert set(missing) == {
            str(incidents["draft"].id),
            str(incidents["untouched"].id),
            str(incidents["pickup"].id),
        }
        assert missing[str(incidents["draft"].id)]["rapport_state"] == "draft"
        assert missing[str(incidents["untouched"].id)]["rapport_state"] == "none"

        # One unit, not four: the saw came back, the second pump was released by
        # the board, and a used consumable is gone (decision 26).
        assert [unit["name"] for unit in body["material_on_site"]] == ["Tauchpumpe TP-4"]
        unit = body["material_on_site"][0]
        assert unit["incident_id"] == str(incidents["submitted"].id)
        assert unit["location_address"] == "Abgeschlossenstrasse 1, Oberwil"
        assert unit["location"] == "Magazin A"
        assert unit["since"].startswith("2026-08-08T23:14")

        # The pickup is about the Trupp and stays its own list.
        assert [row["incident_id"] for row in body["open_pickups"]] == [str(incidents["pickup"].id)]
        assert body["open_pickups"][0]["pickup_note"] == "3 Personen zu Fuss"
        assert body["open_pickups"][0]["since"] is not None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_pickup_survives_the_card_being_completed(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Completing an incident releases the personnel while they are still
        # standing at the address — which is precisely when the Restliste has to
        # keep showing them (decision 24).
        incident = await _incident(db_session, test_event, test_user, "Wartet")
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True},
        )
        await editor_client.post(f"/api/incidents/{incident.id}/status", json={"to_status": "complete"})

        body = (await editor_client.get(f"/api/events/{test_event.id}/restliste")).json()
        assert [row["incident_id"] for row in body["open_pickups"]] == [str(incident.id)]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_empty_event_has_nothing_open(
        self,
        editor_client: AsyncClient,
        test_event: Event,
    ):
        body = (await editor_client.get(f"/api/events/{test_event.id}/restliste")).json()
        assert body["incident_total"] == 0
        assert body["missing_rapport"] == []
        assert body["material_on_site"] == []
        assert body["open_pickups"] == []


class TestAbholliste:
    """The material half on paper: address · unit · since when (decision 25)."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_printing_requires_the_printer_to_be_enabled(
        self,
        editor_client: AsyncClient,
        test_event: Event,
    ):
        assert (await editor_client.post(f"/api/print/abholliste/{test_event.id}/")).status_code == 400

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_payload_carries_one_line_per_unit(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        printer_enabled,
    ):
        incidents = await _mixed_event(editor_client, db_session, test_event, test_user)

        response = await editor_client.post(f"/api/print/abholliste/{test_event.id}/")
        assert response.status_code == 201
        job_id = response.json()["id"]

        job = (await db_session.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one()
        assert job.job_type == "abholliste"
        assert job.event_id == test_event.id
        assert job.payload["event_name"] == test_event.name
        # Exactly the units the Restliste counts — the sheet and the screen must
        # never disagree, or somebody drives out for a pump that came back.
        assert job.payload["units"] == [
            {
                "name": "Tauchpumpe TP-4",
                "location": "Magazin A",
                "address": "Abgeschlossenstrasse 1, Oberwil",
                "since": "2026-08-08T23:14:00+00:00",
            }
        ]
        assert incidents["submitted"].location_address == job.payload["units"][0]["address"]


class TestEinsatzzettelFeldQR:
    """The second QR on the slip (decision 19): same token, plus the incident."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_payload_carries_the_event_token_and_the_incident(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _incident(db_session, test_event, test_user, "Keller")
        loaded = (
            await db_session.execute(
                select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident.id)
            )
        ).scalar_one()

        payload = await print_job_crud.build_assignment_payload(db_session, loaded)
        link = payload["feld_qr"]
        assert link

        assert "/feld?token=" in link
        assert link.endswith(f"&incident_id={incident.id}")
        # Not a new token type: the same event token the poster carries. That is
        # what makes the slip a shortcut rather than a second door — and it is
        # also why a slip left in a vehicle is a credential until it expires.
        token = link.split("token=", 1)[1].split("&", 1)[0]
        assert validate_feld_token(token) == test_event.id

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_no_qr_when_the_installation_has_no_public_origin(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        monkeypatch,
    ):
        # There is no address to send a phone to, so the slip prints exactly as
        # it always did rather than carrying a QR that resolves nowhere.
        monkeypatch.setattr(print_job_crud.settings, "cors_origins", [])
        incident = await _incident(db_session, test_event, test_user, "Keller")
        loaded = (
            await db_session.execute(
                select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == incident.id)
            )
        ).scalar_one()

        payload = await print_job_crud.build_assignment_payload(db_session, loaded)
        assert payload["feld_qr"] is None
