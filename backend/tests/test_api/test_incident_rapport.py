"""KP parity for the Schadenplatz-Rapport surface (plan 25, decision 28).

The regression net for the failure this plan exists to prevent: **a field
surface the KP cannot substitute for**. The normal case is a radio message — the
crew has no signal, no phone or no hands and dictates — so everything a crew can
tap on `/feld` an editor must be able to enter from the board, landing in the
*same columns*, through the *same CRUD module*.

Structure, so later phases extend rather than rewrite:

* ``TestFieldReportParity``   — phase 1: arrived / complete / pickup (this file's core)
* ``TestProvenance``          — the "never faked" rule, both directions
* ``TestPickupSurvivesComplete`` — the one interaction with the board's own cascade

Phase 2 adds ``TestRapportParity`` (the form itself) next to these; the §6.1
table in the plan is the checklist it has to satisfy.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    Event,
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    SchadenplatzReport,
    User,
)
from app.services.photo_storage import photo_storage
from app.services.tokens import generate_feld_token


@pytest.fixture(autouse=True)
def _isolate_photo_storage(tmp_path, monkeypatch):
    """Keep uploaded test photos out of the repo's `data/photos`."""
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path / "photos")


def _one_pixel_jpeg() -> bytes:
    """A real JPEG — photo_storage validates magic bytes and decodes with PIL."""
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buffer, format="JPEG")
    return buffer.getvalue()


async def _make_person(db: AsyncSession, name: str) -> Personnel:
    person = Personnel(id=uuid4(), name=name, role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _make_incident(db: AsyncSession, event: Event, user: User, title: str = "Keller Wasser") -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title} 1, Oberwil",
        status="active",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _assign(db: AsyncSession, incident: Incident, person: Personnel) -> IncidentAssignment:
    assignment = IncidentAssignment(
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=person.id,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


async def _report(db: AsyncSession, incident: Incident) -> SchadenplatzReport | None:
    result = await db.execute(select(SchadenplatzReport).where(SchadenplatzReport.incident_id == incident.id))
    return result.scalar_one_or_none()


class TestFieldReportParity:
    """Every phase-1 field action, done from the board by an editor."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_editor(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        response = await client.post(f"/api/incidents/{incident.id}/field-report", json={"pickup_needed": True})
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_incident_is_404(self, editor_client: AsyncClient):
        response = await editor_client.post(f"/api/incidents/{uuid4()}/field-report", json={"pickup_needed": True})
        assert response.status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_arrival_lands_in_the_same_column_as_the_field_path(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # "Angekommen" over the radio. It has to reach schadenplatz_reports —
        # the same row /feld upserts — not a second place.
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 14, tzinfo=UTC)

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": at.isoformat()},
        )
        assert response.status_code == 200
        assert response.json()["arrived_at"] is not None

        report = await _report(db_session, incident)
        assert report is not None
        assert report.arrived_at == at
        assert report.is_draft is True

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_field_complete_is_writable_from_the_board(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The writer that did not exist: until this endpoint, an operator taking
        # "Einsatz beendet" over the radio had nowhere to put it — the only code
        # that could set the column was the training simulator.
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 40, tzinfo=UTC)

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"field_complete_reported_at": at.isoformat()},
        )
        assert response.status_code == 200

        await db_session.refresh(incident)
        assert incident.field_complete_reported_at == at
        # Reporting is not closing (§3).
        assert incident.status == "active"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pickup_set_and_cleared(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)

        set_response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "3 Personen zu Fuss"},
        )
        assert set_response.status_code == 200
        body = set_response.json()
        assert body["pickup_needed"] is True
        assert body["pickup_note"] == "3 Personen zu Fuss"
        assert body["pickup_requested_at"] is not None

        cleared = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": False},
        )
        assert cleared.status_code == 200
        assert cleared.json()["pickup_needed"] is False
        assert cleared.json()["pickup_note"] is None

        await db_session.refresh(incident)
        assert incident.pickup_needed is False
        assert incident.pickup_requested_at is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_absent_field_is_left_alone(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Absent means "leave it", null means "clear it". Without that
        # distinction an operator amending the pickup note would silently wipe
        # the arrival time.
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 14, tzinfo=UTC)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": at.isoformat(), "field_complete_reported_at": at.isoformat()},
        )

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True},
        )
        assert response.status_code == 200
        assert response.json()["arrived_at"] is not None
        assert response.json()["field_complete_reported_at"] is not None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_null_clears(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 14, tzinfo=UTC)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": at.isoformat(), "field_complete_reported_at": at.isoformat()},
        )

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": None, "field_complete_reported_at": None},
        )
        assert response.status_code == 200
        assert response.json()["arrived_at"] is None
        assert response.json()["field_complete_reported_at"] is None

        await db_session.refresh(incident)
        assert incident.field_complete_reported_at is None
        assert incident.field_complete_reported_by is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_get_returns_the_same_state(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "Ecke Hauptstrasse"},
        )

        response = await editor_client.get(f"/api/incidents/{incident.id}/field-report")
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is True
        assert response.json()["pickup_note"] == "Ecke Hauptstrasse"


class TestProvenance:
    """ "Never faked" (decision 28), asserted in both directions.

    A KP-entered report must not look like a crew-filed one, and a crew-filed
    one must not look like the operator's. The personnel FKs are the field
    side's; the audit log is the KP's.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_kp_write_leaves_the_personnel_columns_null_and_names_the_user(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        at = datetime(2026, 8, 8, 23, 40, tzinfo=UTC)

        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={
                "arrived_at": at.isoformat(),
                "field_complete_reported_at": at.isoformat(),
                "pickup_needed": True,
                "pickup_note": "abholen",
            },
        )

        await db_session.refresh(incident)
        # No operator is ever guessed to be a firefighter — a wrong attribution
        # on a billing document is worse than no attribution.
        assert incident.field_complete_reported_by is None
        assert incident.pickup_requested_by is None
        report = await _report(db_session, incident)
        assert report is not None
        assert report.created_by_personnel_id is None
        assert report.created_by_user_id == test_editor.id
        assert report.updated_by_personnel_id is None
        assert report.updated_by_user_id == test_editor.id

        # The user reaches the record through the audit log instead.
        entries = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.action_type.in_(["field_arrived", "field_complete"]))
                )
            )
            .scalars()
            .all()
        )
        assert entries
        assert all(entry.user_id == test_editor.id for entry in entries)
        assert all(entry.changes_json is not None and entry.changes_json["source"] == "kp" for entry in entries)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_field_write_is_the_mirror_image(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        params = {"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)}

        await client.post(f"/api/feld/incidents/{incident.id}/arrived", params=params)
        await client.post(f"/api/feld/incidents/{incident.id}/complete", params=params)
        await client.post(
            f"/api/feld/incidents/{incident.id}/pickup", params=params, json={"needed": True, "note": "zu Fuss"}
        )

        await db_session.refresh(incident)
        assert incident.field_complete_reported_by == person.id
        assert incident.pickup_requested_by == person.id
        report = await _report(db_session, incident)
        assert report is not None
        assert report.created_by_personnel_id == person.id
        assert report.created_by_user_id is None

        entries = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.action_type.in_(["field_arrived", "field_complete"]))
                )
            )
            .scalars()
            .all()
        )
        assert entries
        assert all(entry.user_id is None for entry in entries)
        assert all(entry.changes_json is not None and entry.changes_json["source"] == "feld" for entry in entries)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_kp_amendment_takes_over_the_updated_by_pair(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        # A mixed report (crew filed, KP amended) must show the KP as the last
        # writer without erasing that the crew created it.
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        await client.post(
            f"/api/feld/incidents/{incident.id}/arrived",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
        )

        corrected = datetime(2026, 8, 8, 22, 5, tzinfo=UTC)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": corrected.isoformat()},
        )

        report = await _report(db_session, incident)
        assert report is not None
        await db_session.refresh(report)
        assert report.created_by_personnel_id == person.id  # the crew created it
        assert report.updated_by_user_id == test_editor.id  # the KP corrected it
        assert report.updated_by_personnel_id is None
        assert report.arrived_at == corrected


class TestBothDirections:
    """What one door sets, the other reads and can clear."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_kp_clears_what_the_field_reported(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        await client.post(
            f"/api/feld/incidents/{incident.id}/pickup",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"needed": True, "note": "zu Fuss"},
        )

        response = await editor_client.post(f"/api/incidents/{incident.id}/field-report", json={"pickup_needed": False})
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_field_clears_what_the_kp_entered(
        self,
        editor_client: AsyncClient,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The crew tapping "abgeholt" on a pickup the operator entered from a
        # radio call.
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)
        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "abholen"},
        )

        response = await client.post(
            f"/api/feld/incidents/{incident.id}/pickup",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"needed": False},
        )
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_kp_can_report_arrival_for_an_incident_with_no_field_contact(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Nobody has ever opened /feld for this Schadenplatz. The operator still
        # has to be able to record what came over the radio.
        incident = await _make_incident(db_session, test_event, test_user, "Nie im Feld")
        assert await _report(db_session, incident) is None

        response = await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"arrived_at": datetime(2026, 8, 8, 21, 0, tzinfo=UTC).isoformat()},
        )
        assert response.status_code == 200
        assert await _report(db_session, incident) is not None


class TestPickupSurvivesComplete:
    """Decision 24's load-bearing half.

    Completing an incident auto-releases the personnel while the crew is
    physically still at the address. The open pickup flag is exactly the thing
    that has to outlive that release — otherwise the board forgets three people
    standing in the rain at the moment they most need collecting.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pickup_survives_the_transition_to_complete(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        await editor_client.post(
            f"/api/incidents/{incident.id}/field-report",
            json={"pickup_needed": True, "pickup_note": "3 Personen"},
        )

        transition = await editor_client.post(
            f"/api/incidents/{incident.id}/status",
            json={"from_status": "active", "to_status": "complete"},
        )
        assert transition.status_code == 200
        # The card is closed AND the flag is still there.
        assert transition.json()["status"] == "complete"
        assert transition.json()["pickup_needed"] is True
        assert transition.json()["pickup_note"] == "3 Personen"

        await db_session.refresh(incident)
        assert incident.pickup_needed is True
        assert incident.pickup_requested_at is not None
        # The personnel really were released — this is the state the flag has to
        # survive, not a case where nothing happened.
        assignments = (
            (await db_session.execute(select(IncidentAssignment).where(IncidentAssignment.incident_id == incident.id)))
            .scalars()
            .all()
        )
        assert all(a.unassigned_at is not None for a in assignments)

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pickup_can_still_be_cleared_after_completion(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident.status = "complete"
        incident.pickup_needed = True
        incident.pickup_note = "warten noch"
        incident.pickup_requested_at = datetime.now(UTC) - timedelta(minutes=40)
        await db_session.commit()

        response = await editor_client.post(f"/api/incidents/{incident.id}/field-report", json={"pickup_needed": False})
        assert response.status_code == 200
        assert response.json()["pickup_needed"] is False


class TestRapportParity:
    """The form itself, from the board (decision 28, §6.1).

    The §6.1 table is the acceptance criterion for the whole phase, so it is
    walked field by field rather than described: an editor writes each one
    through the incidents router and it has to land in the **same column** the
    `/feld` path writes. One CRUD module, two thin routers — a second
    implementation is how the KP path silently loses a field six months later.
    """

    # (json field, value sent, column read back). Every row of the §6.1 table
    # that is a plain report field; the checklist, the counts and the submit get
    # their own tests below because they have behaviour, not just storage.
    FIELDS: list[tuple[str, object, str]] = [
        ("kurzbericht", "Baum auf Fahrbahn, zersägt und geräumt.", "kurzbericht"),
        ("handed_over_to", "Werkhof Oberwil", "handed_over_to"),
        ("owner_name", "A. Bürgin", "owner_name"),
        ("owner_phone", "079 111 22 33", "owner_phone"),
    ]

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize(("field", "value", "column"), FIELDS, ids=[row[0] for row in FIELDS])
    async def test_every_field_lands_in_the_same_column(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        field: str,
        value: object,
        column: str,
    ):
        incident = await _make_incident(db_session, test_event, test_user)

        response = await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={"is_draft": True, field: value},
        )
        assert response.status_code == 200, response.text
        assert response.json()[column] == value

        report = await _report(db_session, incident)
        assert report is not None
        assert getattr(report, column) == value

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_extra_material_is_a_list_of_names_with_one_tick_each(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """ "Weiteres gebrauchtes Material" through the KP door (§18.35).

        It is the one report field that is no longer a string: *vor Ort
        verblieben* is a question per item, and the KP twin has to write the same
        column the phone does — including the flag, which is what a Restliste
        row and an Abholliste line are made of.
        """
        incident = await _make_incident(db_session, test_event, test_user)

        response = await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={
                "is_draft": True,
                "extra_materials": [
                    {"name": "Seil vom TLF geborgt", "left_on_site": False},
                    {"name": "Pumpe vom Nachbarn", "left_on_site": True},
                ],
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["extra_materials"] == [
            {"name": "Seil vom TLF geborgt", "left_on_site": False},
            {"name": "Pumpe vom Nachbarn", "left_on_site": True},
        ]
        # No `used` here and there must not be one: naming a thing on this list
        # already says it was used.
        assert all(set(row) == {"name", "left_on_site"} for row in response.json()["extra_materials"])

        report = await _report(db_session, incident)
        assert report is not None
        assert report.extra_materials_json == [
            {"name": "Seil vom TLF geborgt", "left_on_site": False},
            {"name": "Pumpe vom Nachbarn", "left_on_site": True},
        ]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_form_no_longer_carries_the_two_times(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """Beginn/Ende Tätigkeit is derived at output time, never asked for."""
        incident = await _make_incident(db_session, test_event, test_user)

        response = await editor_client.get(f"/api/incidents/{incident.id}/rapport")
        assert response.status_code == 200
        body = response.json()
        assert "work_started_at" not in body
        assert "work_ended_at" not in body
        assert "default_work_started_at" not in body["prefill"]
        assert "default_work_ended_at" not in body["prefill"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_rapport_submitted_is_logged_once_not_on_every_autosave(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """The KP mount autosaves with ``is_draft: false``.

        Keying the journal entry on "submitting" alone would write a "Rapport
        erfasst" row every few seconds while an operator types, so only the
        draft→filed transition counts.
        """
        incident = await _make_incident(db_session, test_event, test_user)

        for text in ("Keller", "Keller ausgepumpt", "Keller ausgepumpt, Hauswart informiert"):
            response = await editor_client.put(
                f"/api/incidents/{incident.id}/rapport",
                json={"is_draft": False, "kurzbericht": text},
            )
            assert response.status_code == 200, response.text

        rows = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.resource_id == incident.id,
                        AuditLog.action_type.in_(["rapport_submitted", "rapport_saved"]),
                    )
                )
            )
            .scalars()
            .all()
        )
        actions = [row.action_type for row in rows]
        assert actions.count("rapport_submitted") == 1
        assert actions.count("rapport_saved") == 2

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_editor(
        self,
        viewer_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The response carries the owner block — the first citizen PII in
        # kp-rueck (§9) — so even the GET is editor-gated, not CurrentUser: a
        # viewer sees the board, not the Eigentümer of a damaged cellar.
        incident = await _make_incident(db_session, test_event, test_user)
        assert (await viewer_client.get(f"/api/incidents/{incident.id}/rapport")).status_code == 403
        assert (
            await viewer_client.put(f"/api/incidents/{incident.id}/rapport", json={"is_draft": True})
        ).status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_editor_creates_a_rapport_for_an_incident_with_no_field_contact(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The radio case, and the whole point of decision 28: nobody ever tapped
        # anything on /feld for this Schadenplatz — no arrival, no crew, no
        # assignment — and the KP still has to be able to file the rapport.
        incident = await _make_incident(db_session, test_event, test_user, "Sturmschaden Hauptstrasse")

        prefilled = await editor_client.get(f"/api/incidents/{incident.id}/rapport")
        assert prefilled.status_code == 200
        assert prefilled.json()["exists"] is False
        assert prefilled.json()["prefill"]["location_address"] == incident.location_address

        filed = await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={
                "is_draft": False,
                "kurzbericht": "Über Funk: Baum entfernt.",
            },
        )
        assert filed.status_code == 200
        assert filed.json()["is_draft"] is False
        assert filed.json()["submitted_at"] is not None

        report = await _report(db_session, incident)
        assert report is not None
        assert report.arrived_at is None  # no field contact, and none invented

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_material_checklist_is_the_same_checklist(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # Same rows, same two ticks, same consumable rule (decision 26).
        incident = await _make_incident(db_session, test_event, test_user)
        pump = Material(id=uuid4(), name="Tauchpumpe TP-4", type="Sonstiges", location="Depot", status="available")
        foam = Material(
            id=uuid4(), name="Ölbindemittel", type="Sonstiges", location="Depot", status="available", consumable=True
        )
        db_session.add_all([pump, foam])
        await db_session.commit()
        pump_assignment = IncidentAssignment(incident_id=incident.id, resource_type="material", resource_id=pump.id)
        foam_assignment = IncidentAssignment(incident_id=incident.id, resource_type="material", resource_id=foam.id)
        db_session.add_all([pump_assignment, foam_assignment])
        await db_session.commit()
        await db_session.refresh(pump_assignment)
        await db_session.refresh(foam_assignment)

        listed = await editor_client.get(f"/api/incidents/{incident.id}/rapport")
        assert {row["name"] for row in listed.json()["materials"]} == {"Tauchpumpe TP-4", "Ölbindemittel"}

        response = await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={
                "is_draft": True,
                "materials": [
                    {"assignment_id": str(pump_assignment.id), "used": True, "left_on_site": True},
                    {"assignment_id": str(foam_assignment.id), "used": True, "left_on_site": True},
                ],
            },
        )
        rows = {row["name"]: row for row in response.json()["materials"]}
        assert rows["Tauchpumpe TP-4"]["left_on_site"] is True
        assert rows["Ölbindemittel"]["left_on_site"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_counts_are_corrected_the_same_way(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        response = await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={"is_draft": True, "personnel_count": 4},
        )
        assert response.json()["personnel_count_corrected"] is True
        assert response.json()["prefill"]["board_personnel_count"] == 1

        agreeing = await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={"is_draft": True, "personnel_count": 1},
        )
        assert agreeing.json()["personnel_count_corrected"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_submitting_freezes_the_snapshot_identically(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        filed = await editor_client.put(f"/api/incidents/{incident.id}/rapport", json={"is_draft": False})
        snapshot = filed.json()["cost_snapshot_json"]
        assert [entry["name"] for entry in snapshot] == ["Muster Hans"]

        extra = await _make_person(db_session, "Frey Marc")
        await _assign(db_session, incident, extra)

        after = await editor_client.get(f"/api/incidents/{incident.id}/rapport")
        assert after.json()["cost_snapshot_json"] == snapshot

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_kp_write_stamps_the_user_and_leaves_the_personnel_columns_null(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        await editor_client.put(f"/api/incidents/{incident.id}/rapport", json={"is_draft": True, "kurzbericht": "Funk"})

        report = await _report(db_session, incident)
        assert report is not None
        assert report.created_by_user_id == test_editor.id
        assert report.updated_by_user_id == test_editor.id
        assert report.created_by_personnel_id is None
        assert report.updated_by_personnel_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_field_write_stamps_the_personnel_and_leaves_the_user_columns_null(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        response = await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"is_draft": True, "kurzbericht": "Keller ausgepumpt"},
        )
        assert response.status_code == 200

        report = await _report(db_session, incident)
        assert report is not None
        assert report.created_by_personnel_id == person.id
        assert report.updated_by_personnel_id == person.id
        assert report.created_by_user_id is None
        assert report.updated_by_user_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_mixed_report_shows_both_lines(
        self,
        client: AsyncClient,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        # Crew filed, KP amended. Both authors survive — that is why the two
        # pairs exist instead of one resolved "erfasst von".
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        await client.put(
            f"/api/feld/incidents/{incident.id}/rapport",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            json={"is_draft": True, "kurzbericht": "Keller ausgepumpt"},
        )
        amended = await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={"is_draft": True, "handed_over_to": "Hauswart"},
        )
        assert amended.status_code == 200
        body = amended.json()
        assert body["created_by_name"] == "Muster Hans"
        assert body["created_in_kp"] is False
        assert body["updated_by_name"] == test_editor.username
        assert body["updated_in_kp"] is True

        report = await _report(db_session, incident)
        assert report is not None
        assert report.created_by_personnel_id == person.id
        assert report.updated_by_personnel_id is None
        assert report.updated_by_user_id == test_editor.id

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_rapport_endpoints_never_write_an_assignment(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        # The same boundary the /feld suite asserts, on the KP side. Ticking
        # "vor Ort verblieben" records a fact; releasing what came back is a
        # separate board action the operator clicks (decisions 15 and 17).
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        assignment = await _assign(db_session, incident, person)
        material = Material(id=uuid4(), name="Tauchpumpe", type="Sonstiges", location="Depot", status="available")
        db_session.add(material)
        await db_session.commit()
        material_assignment = IncidentAssignment(
            incident_id=incident.id, resource_type="material", resource_id=material.id
        )
        db_session.add(material_assignment)
        await db_session.commit()
        await db_session.refresh(material_assignment)
        before = {
            (row.id, row.assigned_at, row.unassigned_at, row.is_leader)
            for row in (await db_session.execute(select(IncidentAssignment))).scalars().all()
        }

        await editor_client.get(f"/api/incidents/{incident.id}/rapport")
        await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={
                "is_draft": False,
                "materials": [{"assignment_id": str(material_assignment.id), "used": True, "left_on_site": True}],
            },
        )
        await editor_client.get(f"/api/incidents/{incident.id}/rapport/material-return")

        db_session.expire_all()
        after = {
            (row.id, row.assigned_at, row.unassigned_at, row.is_leader)
            for row in (await db_session.execute(select(IncidentAssignment))).scalars().all()
        }
        assert after == before
        assert assignment.id in {row[0] for row in after}

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_material_return_offers_only_what_came_back(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        pump = Material(id=uuid4(), name="Tauchpumpe", type="Sonstiges", location="Depot", status="available")
        saw = Material(id=uuid4(), name="Motorsäge", type="Sonstiges", location="Depot", status="available")
        db_session.add_all([pump, saw])
        await db_session.commit()
        pump_a = IncidentAssignment(incident_id=incident.id, resource_type="material", resource_id=pump.id)
        saw_a = IncidentAssignment(incident_id=incident.id, resource_type="material", resource_id=saw.id)
        db_session.add_all([pump_a, saw_a])
        await db_session.commit()
        await db_session.refresh(pump_a)
        await db_session.refresh(saw_a)

        # A draft offers nothing: a half-answered checklist is not a release list.
        await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={
                "is_draft": True,
                "materials": [
                    {"assignment_id": str(pump_a.id), "used": True, "left_on_site": True},
                    {"assignment_id": str(saw_a.id), "used": True, "left_on_site": False},
                ],
            },
        )
        draft = await editor_client.get(f"/api/incidents/{incident.id}/rapport/material-return")
        assert draft.json()["returned"] == []

        # …but the completion gate reads it (§18.23): it only PREFILLS a dialog
        # the operator confirms, and a crew that filled the checklist without
        # pressing "Rapport abschliessen" on a phone has answered anyway.
        gate = await editor_client.get(f"/api/incidents/{incident.id}/rapport/material-return?include_draft=true")
        assert [unit["name"] for unit in gate.json()["returned"]] == ["Motorsäge"]
        assert [unit["name"] for unit in gate.json()["left_on_site"]] == ["Tauchpumpe"]
        assert gate.json()["rapport_is_draft"] is True

        await editor_client.put(f"/api/incidents/{incident.id}/rapport", json={"is_draft": False})
        submitted = await editor_client.get(f"/api/incidents/{incident.id}/rapport/material-return")
        assert [unit["name"] for unit in submitted.json()["returned"]] == ["Motorsäge"]
        assert [unit["name"] for unit in submitted.json()["left_on_site"]] == ["Tauchpumpe"]
        assert submitted.json()["rapport_is_draft"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_named_leftovers_are_shown_but_not_releasable(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """The asymmetry of §18.35, spelled out on the wire.

        A "Weiteres Material" entry the crew left behind is a device at an
        address, so the Abholliste fetches it — but the release list has nothing
        to free, because there is no assignment under a name. It travels in its
        own field so the UI can *say* that, instead of leaving an operator to
        wonder why the Restliste knows about a pump the dialog does not.
        """
        incident = await _make_incident(db_session, test_event, test_user)
        await editor_client.put(
            f"/api/incidents/{incident.id}/rapport",
            json={
                "is_draft": False,
                "extra_materials": [
                    {"name": "Pumpe vom Nachbarn", "left_on_site": True},
                    {"name": "2 Schaufeln vom Werkhof", "left_on_site": False},
                ],
            },
        )

        body = (await editor_client.get(f"/api/incidents/{incident.id}/rapport/material-return")).json()
        assert body["returned"] == []
        assert body["left_on_site"] == []
        assert body["left_on_site_named"] == ["Pumpe vom Nachbarn"]


class TestPhotoParity:
    """Fotos, both mounts (§6.1) — the WhatsApp-photo case.

    A crew with no signal gets the picture out over whatever channel works and
    the operator attaches it from the board. Same storage and the same files as
    the field upload; only the door and the provenance differ.
    """

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_editor_uploads_and_deletes(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)

        upload = await editor_client.post(
            f"/api/incidents/{incident.id}/rapport/photos",
            files={"file": ("whatsapp.jpg", _one_pixel_jpeg(), "image/jpeg")},
        )
        assert upload.status_code == 200
        filename = upload.json()["filename"]
        assert upload.json()["photos"] == [filename]

        # The same list the field mount renders, from the board's own GET.
        rapport = await editor_client.get(f"/api/incidents/{incident.id}/rapport")
        assert rapport.json()["photos"] == [filename]

        # Provenance is never faked: a KP write stamps the user and leaves the
        # personnel column NULL.
        report = await _report(db_session, incident)
        assert report is not None
        await db_session.refresh(report)
        assert report.updated_by_user_id == test_editor.id
        assert report.updated_by_personnel_id is None

        removed = await editor_client.delete(f"/api/incidents/{incident.id}/rapport/photos/{filename}")
        assert removed.status_code == 200
        assert removed.json()["photos"] == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_photo_from_the_field_is_visible_from_the_board(
        self,
        client: AsyncClient,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        person = await _make_person(db_session, "Muster Hans")
        await _assign(db_session, incident, person)

        upload = await client.post(
            f"/api/feld/incidents/{incident.id}/photos",
            params={"token": generate_feld_token(test_event.id), "personnel_id": str(person.id)},
            files={"file": ("keller.jpg", _one_pixel_jpeg(), "image/jpeg")},
        )
        assert upload.status_code == 200

        rapport = await editor_client.get(f"/api/incidents/{incident.id}/rapport")
        assert rapport.json()["photos"] == [upload.json()["filename"]]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_viewer_cannot_upload(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        response = await client.post(
            f"/api/incidents/{incident.id}/rapport/photos",
            files={"file": ("keller.jpg", _one_pixel_jpeg(), "image/jpeg")},
        )
        assert response.status_code == 401
