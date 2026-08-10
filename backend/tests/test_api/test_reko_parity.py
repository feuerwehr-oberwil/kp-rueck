"""KP parity for the Reko surface (plan 26 §5, §8.2).

`/reko` failed the rule twice: the board could neither create a report nor mark
"vor Ort". `POST /api/reko/` validated a per-incident form token and had no user
path at all, so an editor could not file a recon report ever — and "Reko meldet:
vor Ort" over the radio had nowhere to go. Both are the same failure: a surface
whose data can only arrive through that surface makes the KP a spectator to its
own board on the one night the phones are what broke.

**The field door is asserted first, in every class.** The auth change is one
route growing a second door (decision 11) rather than a `…-by-editor` twin, and
the regression it could plausibly cause is on the phone, not on the board — so
the phone's calls run before the board's, and an auth change that breaks a crew
fails this suite before it reaches a tablet.

One fixture caveat that shapes the file: `client`, `editor_client` and
`viewer_client` are the **same** `AsyncClient`, logged in differently. A test
that asked for two of them would be asserting the anonymous case against an
authenticated session, so each test takes exactly one. Where a case genuinely
needs both channels, the field call goes through its token on whatever client is
at hand — the token path is session-independent by construction, which is itself
worth pinning down.

Structure:

* ``TestRekoReportParity``  — the report itself, both doors on `POST /api/reko/`
* ``TestRekoArrivedParity`` — "vor Ort", the editor writer and the field twin
* ``TestRekoProvenance``    — the "never faked" rule, both directions and mixed
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Personnel, RekoReport, User
from app.services.tokens import generate_form_token

# Every field of `RekoReportUpdate`, with a value the board sets and the column
# the token path writes it into. Parametrized so a field added to the form
# without a KP writer fails here instead of six months later (§8.2).
REPORT_FIELDS = [
    ("is_relevant", True),
    ("power_supply", "emergency_needed"),
    ("summary_text", "Keller 30 cm unter Wasser, Pumpe läuft"),
    ("additional_notes", "Zufahrt über Hinterhof"),
    (
        "dangers_json",
        {
            "fire": False,
            "fire_danger": False,
            "explosion": False,
            "collapse": True,
            "chemical": False,
            "electrical": True,
            "other_notes": "Ölfilm im Wasser",
        },
    ),
    (
        "effort_json",
        {
            "personnel_count": 4,
            "vehicles_needed": ["TLF 1"],
            "equipment_needed": ["Tauchpumpe"],
            "estimated_duration_hours": 2.5,
        },
    ),
]


async def _make_incident(db: AsyncSession, event: Event, user: User, title: str = "Keller Wasser") -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title} 1, Oberwil",
        status="reko",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _make_person(db: AsyncSession, name: str = "Muster Hans") -> Personnel:
    person = Personnel(id=uuid4(), name=name, role="Feuerwehrmann", status="available")
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


async def _reports(db: AsyncSession, incident_id: UUID) -> list[RekoReport]:
    """The rows straight from the table.

    Takes the *id*, never the ORM object: `expire_all` is what makes the API's
    writes visible through this shared session, and an expired `Incident` would
    then try to lazy-load its own primary key from a sync context.
    """
    db.expire_all()
    result = await db.execute(
        select(RekoReport).where(RekoReport.incident_id == incident_id).order_by(RekoReport.submitted_at)
    )
    return list(result.scalars().all())


def _body(**overrides) -> dict:
    """A full report body, the shape the field form sends."""
    body = dict(REPORT_FIELDS)
    body.update(overrides)
    return body


class TestRekoReportParity:
    """`POST /api/reko/` — one route, two doors."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_field_door_still_works(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """The regression the auth change could plausibly cause. First on purpose."""
        incident = await _make_incident(db_session, test_event, test_user)
        token = generate_form_token(str(incident.id))

        response = await client.post(
            "/api/reko/",
            json=_body(incident_id=str(incident.id), token=token),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["is_relevant"] is True
        assert body["summary_text"] == "Keller 30 cm unter Wasser, Pumpe läuft"
        assert body["is_draft"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_neither_token_nor_session_is_401(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id

        response = await client.post("/api/reko/", json=_body(incident_id=str(incident_id)))

        assert response.status_code == 401
        assert await _reports(db_session, incident_id) == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_token_for_a_different_incident_never_writes(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """The token-scoping guarantee has to survive the auth change.

        A leaked form link must not become a way to write into another incident
        — never 200, and nothing in the table afterwards.
        """
        target = await _make_incident(db_session, test_event, test_user, "Ziel")
        target_id = target.id
        other = await _make_incident(db_session, test_event, test_user, "Anderer")
        wrong_token = generate_form_token(str(other.id))

        response = await client.post(
            "/api/reko/",
            json=_body(incident_id=str(target_id), token=wrong_token),
        )

        assert response.status_code in (400, 401)
        assert await _reports(db_session, target_id) == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_wrong_token_stays_refused_even_with_a_session(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """A logged-in operator must not be able to launder a foreign token either.

        The board's door is "send no token at all"; a token that is present and
        wrong is a mistake worth refusing rather than quietly ignoring.
        """
        target = await _make_incident(db_session, test_event, test_user, "Ziel")
        target_id = target.id
        other = await _make_incident(db_session, test_event, test_user, "Anderer")

        response = await editor_client.post(
            "/api/reko/",
            json=_body(incident_id=str(target_id), token=generate_form_token(str(other.id))),
        )

        assert response.status_code in (400, 401)
        assert await _reports(db_session, target_id) == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_editor_creates_a_report_on_an_incident_with_no_field_contact(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """The acceptance criterion of this phase: create from nothing.

        Nobody ever opened a Reko link for this incident. The report an operator
        dictates has to appear in the board's list exactly as a field-filed one
        does — same endpoint, same shape, same place.
        """
        incident = await _make_incident(db_session, test_event, test_user, "Nie im Feld")
        incident_id = incident.id
        assert await _reports(db_session, incident_id) == []

        response = await editor_client.post("/api/reko/", json=_body(incident_id=str(incident_id)))
        assert response.status_code == 200
        assert response.json()["is_draft"] is False

        listed = await editor_client.get(f"/api/reko/incident/{incident_id}/reports")
        assert listed.status_code == 200
        rows = listed.json()
        assert len(rows) == 1
        assert rows[0]["summary_text"] == "Keller 30 cm unter Wasser, Pumpe läuft"
        assert rows[0]["is_draft"] is False

    @pytest.mark.asyncio
    @pytest.mark.api
    @pytest.mark.parametrize(("field", "value"), REPORT_FIELDS)
    async def test_every_field_lands_in_the_same_column(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        field: str,
        value,
    ):
        """Set from the board, read back from the column the token path writes."""
        incident = await _make_incident(db_session, test_event, test_user, f"Feld {field}")
        incident_id = incident.id

        response = await editor_client.post(
            "/api/reko/",
            json={"incident_id": str(incident_id), field: value},
        )
        assert response.status_code == 200

        report = (await _reports(db_session, incident_id))[0]
        assert getattr(report, field) == value

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_draft_save_is_reused_rather_than_stacked(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """An operator typing is one report, not one per keystroke burst."""
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id

        first = await editor_client.post(
            "/api/reko/?submit=false",
            json={"incident_id": str(incident_id), "summary_text": "erste Zeile"},
        )
        second = await editor_client.post(
            "/api/reko/?submit=false",
            json={"incident_id": str(incident_id), "summary_text": "zweite Zeile"},
        )
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["id"] == second.json()["id"]

        rows = await _reports(db_session, incident_id)
        assert len(rows) == 1
        assert rows[0].summary_text == "zweite Zeile"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_unknown_incident_is_refused(self, editor_client: AsyncClient):
        response = await editor_client.post("/api/reko/", json={"incident_id": str(uuid4())})
        assert response.status_code == 400


class TestRekoArrivedParity:
    """ "Reko meldet: vor Ort" — the message that had nowhere to go."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_field_door_still_works(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id
        token = generate_form_token(str(incident_id))

        response = await client.post(f"/api/reko/{incident_id}/arrived?token={token}")

        assert response.status_code == 200
        assert response.json()["arrived_at"] is not None
        report = (await _reports(db_session, incident_id))[0]
        assert report.arrived_at is not None
        assert report.arrived_reported_by_user_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_authentication(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id

        response = await client.post(f"/api/incidents/{incident_id}/reko-arrived", json={})

        assert response.status_code == 401
        assert await _reports(db_session, incident_id) == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_viewer_is_refused(
        self,
        viewer_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id

        response = await viewer_client.post(f"/api/incidents/{incident_id}/reko-arrived", json={})

        assert response.status_code == 403
        assert await _reports(db_session, incident_id) == []

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unknown_incident_is_404(self, editor_client: AsyncClient):
        response = await editor_client.post(f"/api/incidents/{uuid4()}/reko-arrived", json={})
        assert response.status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_editor_reports_the_arrival_for_an_incident_with_no_field_contact(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user, "Funkmeldung")
        incident_id = incident.id

        response = await editor_client.post(f"/api/incidents/{incident_id}/reko-arrived", json={})
        assert response.status_code == 200
        assert response.json()["arrived_at"] is not None

        # And the board sees it on the incident — the same field the field path
        # feeds, plus the one flag that says which channel it came through.
        listed = await editor_client.get(f"/api/incidents/{incident_id}")
        assert listed.status_code == 200
        assert listed.json()["reko_arrived_at"] is not None
        assert listed.json()["reko_arrived_by_kp"] is True

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_explicit_timestamp_lands_where_it_was_given(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """A radio message logged five minutes late belongs five minutes ago."""
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id
        at = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=5)

        response = await editor_client.post(
            f"/api/incidents/{incident_id}/reko-arrived",
            json={"arrived_at": at.isoformat()},
        )
        assert response.status_code == 200

        report = (await _reports(db_session, incident_id))[0]
        assert report.arrived_at == at

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_it_is_idempotent_and_clearable(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id

        first = await editor_client.post(f"/api/incidents/{incident_id}/reko-arrived", json={})
        second = await editor_client.post(f"/api/incidents/{incident_id}/reko-arrived", json={})
        assert first.json()["arrived_at"] == second.json()["arrived_at"]
        assert len(await _reports(db_session, incident_id)) == 1

        cleared = await editor_client.post(
            f"/api/incidents/{incident_id}/reko-arrived",
            json={"arrived_at": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["arrived_at"] is None

        report = (await _reports(db_session, incident_id))[0]
        assert report.arrived_at is None
        # A mis-heard call is corrected, not amended: the provenance goes with it.
        assert report.arrived_reported_by_user_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_the_kp_corrects_an_arrival_the_crew_reported(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        """The field writes first — the correction edits that row, not a second one.

        The field call rides the same client on purpose: the token path is
        session-independent, and that is exactly what this route promises.
        """
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id
        token = generate_form_token(str(incident_id))
        assert (await editor_client.post(f"/api/reko/{incident_id}/arrived?token={token}")).status_code == 200

        at = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=12)
        response = await editor_client.post(
            f"/api/incidents/{incident_id}/reko-arrived",
            json={"arrived_at": at.isoformat()},
        )
        assert response.status_code == 200

        rows = await _reports(db_session, incident_id)
        assert len(rows) == 1
        assert rows[0].arrived_at == at
        assert rows[0].arrived_reported_by_user_id is not None


class TestRekoProvenance:
    """Never faked, in either direction, and both sides at once when mixed."""

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
        incident_id = incident.id
        person = await _make_person(db_session)
        person_id = person.id
        token = generate_form_token(str(incident_id))

        # The link resolves the reporting person, exactly as the crew opens it.
        loaded = await client.get(
            "/api/reko/form",
            params={"incident_id": str(incident_id), "token": token, "personnel_id": str(person_id)},
        )
        assert loaded.status_code == 200

        response = await client.post("/api/reko/", json=_body(incident_id=str(incident_id), token=token))
        assert response.status_code == 200

        report = (await _reports(db_session, incident_id))[0]
        assert report.submitted_by_personnel_id == person_id
        assert report.created_by_user_id is None
        assert report.updated_by_user_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_kp_write_stamps_the_user_and_leaves_the_personnel_column_null(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        """Never guess a Personnel row from a User (decision 6)."""
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id
        editor_id = test_editor.id

        response = await editor_client.post("/api/reko/", json=_body(incident_id=str(incident_id)))
        assert response.status_code == 200

        report = (await _reports(db_session, incident_id))[0]
        assert report.submitted_by_personnel_id is None
        assert report.created_by_user_id == editor_id
        assert report.updated_by_user_id == editor_id

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_kp_arrival_and_a_field_arrival_are_mirror_images(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        editor_id = test_editor.id

        field_incident = await _make_incident(db_session, test_event, test_user, "Feld")
        field_id = field_incident.id
        person = await _make_person(db_session, "Feld Frau")
        person_id = person.id
        token = generate_form_token(str(field_id))
        await editor_client.get(
            "/api/reko/form",
            params={"incident_id": str(field_id), "token": token, "personnel_id": str(person_id)},
        )
        assert (await editor_client.post(f"/api/reko/{field_id}/arrived?token={token}")).status_code == 200

        kp_incident = await _make_incident(db_session, test_event, test_user, "KP")
        kp_id = kp_incident.id
        assert (await editor_client.post(f"/api/incidents/{kp_id}/reko-arrived", json={})).status_code == 200

        field_report = (await _reports(db_session, field_id))[0]
        assert field_report.submitted_by_personnel_id == person_id
        assert field_report.arrived_reported_by_user_id is None

        kp_report = (await _reports(db_session, kp_id))[0]
        assert kp_report.arrived_reported_by_user_id == editor_id
        assert kp_report.submitted_by_personnel_id is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_an_editor_amendment_keeps_the_crews_authorship(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
        test_editor: User,
    ):
        """The mixed case: crew filed, KP added what came in afterwards.

        One row, both lines — which is the whole reason the personnel FK and the
        user FK are separate columns rather than one resolved author.
        """
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id
        person = await _make_person(db_session)
        person_id = person.id
        editor_id = test_editor.id
        token = generate_form_token(str(incident_id))

        await editor_client.get(
            "/api/reko/form",
            params={"incident_id": str(incident_id), "token": token, "personnel_id": str(person_id)},
        )
        filed = await editor_client.post("/api/reko/", json=_body(incident_id=str(incident_id), token=token))
        assert filed.status_code == 200
        report_id = filed.json()["id"]

        amended = await editor_client.patch(
            f"/api/reko/{report_id}",
            json={"additional_notes": "Nachtrag per Funk: Zufahrt gesperrt"},
        )
        assert amended.status_code == 200

        rows = await _reports(db_session, incident_id)
        assert len(rows) == 1, "an amendment is not a second report"
        assert rows[0].submitted_by_personnel_id == person_id
        assert rows[0].created_by_user_id is None
        assert rows[0].updated_by_user_id == editor_id
        assert rows[0].additional_notes == "Nachtrag per Funk: Zufahrt gesperrt"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_a_field_amendment_still_leaves_no_user_behind(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_user: User,
    ):
        incident = await _make_incident(db_session, test_event, test_user)
        incident_id = incident.id
        token = generate_form_token(str(incident_id))
        filed = await client.post("/api/reko/", json=_body(incident_id=str(incident_id), token=token))
        report_id = filed.json()["id"]

        amended = await client.patch(
            f"/api/reko/{report_id}",
            json={"additional_notes": "Nachtrag vom Trupp"},
            headers={"X-Reko-Token": token},
        )
        assert amended.status_code == 200

        report = (await _reports(db_session, incident_id))[0]
        assert report.updated_by_user_id is None
