"""Tests for the public share-link payload (/api/viewer/data).

The endpoint has no session behind it — the token in the URL is the only gate —
so every row it carries is a deliberate subset, and these tests pin those
subsets rather than the endpoint as a whole. The first block is the incident
itself (the Melder must not ride along on a link that gets forwarded), then the
Reko report, then the resource lists.

The last part of the file covers the one thing the payload does NOT carry:
the Reko photos themselves, served by /api/photos, which takes the same token.
"""

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.materials import apply_out_of_service
from app.models import (
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    RekoReport,
    User,
    Vehicle,
)
from app.services.photo_storage import photo_storage
from app.services.tokens import generate_alarm_token, generate_form_token, generate_viewer_token


@pytest_asyncio.fixture
async def submitted_reko(db_session: AsyncSession, test_incident: Incident) -> RekoReport:
    """A filed Reko report with dangers, effort, free text and photos."""
    report = RekoReport(
        id=uuid4(),
        incident_id=test_incident.id,
        token=generate_form_token(str(test_incident.id), "reko"),
        is_draft=False,
        is_relevant=True,
        dangers_json={"electrical": True, "other_notes": "Bewohner im 2. OG bettlägerig"},
        effort_json={"personnel_count": 4, "estimated_duration_hours": 2.0},
        summary_text="Zufahrt über Rampe Süd frei",
        photos_json=["photo-1.jpg", "photo-2.jpg"],
    )
    db_session.add(report)
    await db_session.commit()
    await db_session.refresh(report)
    return report


@pytest_asyncio.fixture
async def melder_incident(db_session: AsyncSession, test_incident: Incident) -> Incident:
    """The test incident with a Melder, their phone number and internal notes."""
    test_incident.contact = "Meier Ruth (Bewohnerin)"
    test_incident.contact_phone = "061 222 22 22"
    test_incident.internal_notes = "Schlüsseldepot Code 4711, Nachbarin hat Zweitschlüssel"
    await db_session.commit()
    await db_session.refresh(test_incident)
    return test_incident


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_omits_the_melder_and_the_internal_notes(
    client: AsyncClient,
    test_event: Event,
    melder_incident: Incident,
):
    """THE finding: a forwarded link must not carry a resident's name or number.

    Checked on the raw response as well as the parsed row — the values must not
    reappear anywhere else in the payload either.
    """
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")
    assert response.status_code == 200

    incident = next(i for i in response.json()["incidents"] if i["id"] == str(melder_incident.id))
    for field in ("contact", "contact_phone", "internal_notes"):
        assert field not in incident

    assert "Meier Ruth" not in response.text
    assert "061 222 22 22" not in response.text
    assert "Schlüsseldepot" not in response.text


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_keeps_the_situation(
    client: AsyncClient,
    test_event: Event,
    melder_incident: Incident,
):
    """Address, Meldung, type, priority, status — the reason the link exists."""
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    incident = next(i for i in response.json()["incidents"] if i["id"] == str(melder_incident.id))
    assert incident["location_address"] == "Hauptstrasse 123, Basel"
    assert incident["description"] == "Brand in Mehrfamilienhaus"
    assert incident["title"] == "Wohnungsbrand"
    assert incident["type"] == "brandbekaempfung"
    assert incident["priority"] == "high"
    assert incident["status"] == "incoming"
    assert incident["location_lat"] is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_omits_the_operator_and_the_workflow_bookkeeping(
    client: AsyncClient,
    test_event: Event,
    test_incident: Incident,
):
    """What nobody chose to share: user/personnel ids and the rapport internals.

    The incident row is an allowlist (`schemas/viewer.py`), so this is a
    regression guard for the whole class rather than for three field names — a
    column added to `Incident` must not reach a shared link by itself.
    """
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    incident = next(i for i in response.json()["incidents"] if i["id"] == str(test_incident.id))
    for field in (
        "created_by",
        "source_ref",
        "field_arrived_by",
        "field_complete_reported_by",
        "pickup_requested_by",
        "pickup_note",
        "has_schadenplatz_rapport",
        "has_schadenplatz_rapport_draft",
        "has_been_dispatched",
        "reko_arrived_by_kp",
        "contact",
        "contact_phone",
        "internal_notes",
    ):
        assert field not in incident, field


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_carries_the_pickup_flag_but_not_its_note(
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
):
    """ "Abholung nötig" is the situation; the operator's note about it is not.

    The flag and its timestamp draw the PickupBadge on a wall display — a crew
    standing at the kerb is the last thing a shared board may keep to itself,
    and neither value names anybody. `pickup_note` is unbounded operator free
    text that only ever surfaces in a tooltip, so it stays behind — as does the
    person who asked for the pickup.
    """
    requester = Personnel(id=uuid4(), name="Bucher Tim", role="Feuerwehrmann", status="available")
    db_session.add(requester)
    await db_session.flush()
    test_incident.pickup_needed = True
    test_incident.pickup_note = "Meier Ruth fährt sie sonst, Handy 061 222 22 22"
    test_incident.pickup_requested_at = datetime(2026, 8, 13, 21, 30, tzinfo=UTC)
    test_incident.pickup_requested_by = requester.id
    await db_session.commit()

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    incident = next(i for i in response.json()["incidents"] if i["id"] == str(test_incident.id))
    assert incident["pickup_needed"] is True
    assert incident["pickup_requested_at"] is not None
    assert "pickup_note" not in incident
    assert "pickup_requested_by" not in incident
    assert "Meier Ruth" not in response.text
    assert str(requester.id) not in response.text


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_roster_is_names_and_roles_only(
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
):
    """A checked-in person, without their account identity in another system."""
    from app.models import PersonnelExternalIdentity

    person = Personnel(id=uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
    db_session.add(person)
    await db_session.flush()
    db_session.add(PersonnelExternalIdentity(personnel_id=person.id, provider="divera", external_id="4711"))
    db_session.add(EventAttendance(event_id=test_event.id, personnel_id=person.id, checked_in=True))
    await db_session.commit()

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    row = next(p for p in response.json()["personnel"] if p["id"] == str(person.id))
    assert row["name"] == "Muster Hans"
    assert row["role"] == "Feuerwehrmann"
    # Neither the provider-side id nor the link flag belongs on a shared wall.
    assert "divera_linked" not in row
    assert "4711" not in response.text


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_material_carries_readiness_but_not_the_legacy_status(
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
):
    """«Nicht einsatzbereit» rides along; the raw `status` mirror does not.

    The display derives «im Einsatz» from this event's assignments, which is why
    `status` stays behind — but readiness is a station-wide fact it cannot
    reconstruct from anything in the payload. Without it a defective pump drew
    green on the wall, which is the one thing that panel must never say.
    """
    broken = Material(id=uuid4(), name="Tauchpumpe 2", type="Tauchpumpen", location="Pio", status="available")
    fine = Material(id=uuid4(), name="Tauchpumpe 1", type="Tauchpumpen", location="Pio", status="available")
    apply_out_of_service(broken, True)
    db_session.add_all([broken, fine])
    await db_session.commit()

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    rows = {row["name"]: row for row in response.json()["materials"]}
    assert rows["Tauchpumpe 2"]["out_of_service"] is True
    assert rows["Tauchpumpe 1"]["out_of_service"] is False
    assert "status" not in rows["Tauchpumpe 2"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_omits_archived_material_and_vehicles(
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_vehicle: Vehicle,
):
    """Retired inventory is off the shared panels, like it is off the board."""
    retired = Material(id=uuid4(), name="Alte Motorspritze", type="Pumpen", location="Depot", status="available")
    retired.archived_at = datetime.now(UTC)
    sold = Vehicle(id=uuid4(), name="Alter MTW", type="MTW", status="available", display_order=9)
    sold.archived_at = datetime.now(UTC)
    db_session.add_all([retired, sold])
    await db_session.commit()

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")
    body = response.json()

    assert [row["name"] for row in body["materials"]] == []
    assert [row["name"] for row in body["vehicles"]] == [test_vehicle.name]


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_assignments_do_not_name_the_operator(
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
    test_user: User,
):
    """Which resource is on which incident — never who put it there, or when."""
    person = Personnel(id=uuid4(), name="Frey Marc", role="Gruppenführer", status="available")
    db_session.add(person)
    await db_session.flush()
    db_session.add(
        IncidentAssignment(
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=person.id,
            assigned_by=test_user.id,
        )
    )
    await db_session.commit()

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    row = response.json()["assignments"][str(test_incident.id)][0]
    assert row["resource_id"] == str(person.id)
    assert row["resource_type"] == "personnel"
    assert "assigned_by" not in row
    assert "assigned_at" not in row
    assert "unassigned_at" not in row
    assert str(test_user.id) not in response.text


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_marks_which_crew_member_leads(
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
):
    """`is_leader` names nobody new — it marks one of the names already shared.

    Without it the displays' `sortCrewByLeader(crew, leaderName)` is a no-op on
    a shared board and no crew member is drawn as Gruppenführer.
    """
    leader = Personnel(id=uuid4(), name="Frey Marc", role="Gruppenführer", status="available")
    member = Personnel(id=uuid4(), name="Suter Nina", role="Feuerwehrfrau", status="available")
    db_session.add_all([leader, member])
    await db_session.flush()
    db_session.add_all(
        [
            IncidentAssignment(
                incident_id=test_incident.id,
                resource_type="personnel",
                resource_id=leader.id,
                is_leader=True,
            ),
            IncidentAssignment(
                incident_id=test_incident.id,
                resource_type="personnel",
                resource_id=member.id,
            ),
        ]
    )
    await db_session.commit()

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    rows = {row["resource_id"]: row for row in response.json()["assignments"][str(test_incident.id)]}
    assert rows[str(leader.id)]["is_leader"] is True
    assert rows[str(member.id)]["is_leader"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_carries_reko_summary(
    client: AsyncClient,
    test_event: Event,
    test_incident: Incident,
    submitted_reko: RekoReport,
):
    """The share link shows what the Reko reported: verdict, text, dangers, effort."""
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")
    assert response.status_code == 200

    summary = response.json()["reko_summaries"][str(test_incident.id)]
    assert summary["is_relevant"] is True
    assert summary["summary_text"] == "Zufahrt über Rampe Süd frei"
    assert summary["dangers_json"]["electrical"] is True
    assert summary["dangers_json"]["fire"] is False
    assert summary["personnel_count"] == 4
    assert summary["estimated_duration_hours"] == 2.0


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_omits_free_text_note_and_submitter(
    client: AsyncClient,
    test_event: Event,
    test_incident: Incident,
    submitted_reko: RekoReport,
):
    """The danger note names people on site, and who reported it is not the situation."""
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    summary = response.json()["reko_summaries"][str(test_incident.id)]
    assert "submitted_by_personnel_name" not in summary
    assert "other_notes" not in summary["dangers_json"]
    assert "bettlägerig" not in response.text


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_carries_reko_photo_filenames(
    client: AsyncClient,
    test_event: Event,
    test_incident: Incident,
    submitted_reko: RekoReport,
):
    """The detail dialog needs to know which pictures exist before it can draw them."""
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    summary = response.json()["reko_summaries"][str(test_incident.id)]
    assert summary["photos_json"] == ["photo-1.jpg", "photo-2.jpg"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_data_skips_incidents_without_a_submitted_reko(
    client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_user: User,
    test_incident: Incident,
):
    """A draft is not a report: only submitted ones reach the share link."""
    draft_incident = Incident(
        id=uuid4(),
        title="Keller unter Wasser",
        type="brandbekaempfung",
        priority="low",
        status="incoming",
        event_id=test_event.id,
        created_by=test_user.id,
    )
    db_session.add(draft_incident)
    await db_session.flush()
    db_session.add(
        RekoReport(
            id=uuid4(),
            incident_id=draft_incident.id,
            token=generate_form_token(str(draft_incident.id), "reko"),
            is_draft=True,
            summary_text="Noch nicht abgeschickt",
        )
    )
    await db_session.commit()

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/viewer/data?token={token}")

    summaries = response.json()["reko_summaries"]
    assert str(draft_incident.id) not in summaries
    # the incident with no report at all is absent too
    assert str(test_incident.id) not in summaries


# ============================================================
# GET /api/photos/{incident}/{file} — the share link's second door
#
# The photos are the one part of the Reko result that is NOT in the payload
# above: it carries filenames, and the picture itself comes from the photo
# route. Opening that route to a share token widens a real boundary, so the
# tests below pin exactly how far: this event, submitted Reko reports, nothing
# else, and a 404 (never a 403) for everything outside — a share link must not
# be usable to confirm that another event's photo exists.
# ============================================================

#: Must be UUID.jpg — `photo_storage.get_photo_path` rejects any other shape.
PHOTO_FILENAME = "11111111-2222-3333-4444-555555555555.jpg"
OTHER_PHOTO_FILENAME = "99999999-8888-7777-6666-555555555555.jpg"
PHOTO_BYTES = b"\xff\xd8\xff\xe0 pretend jpeg"


@pytest.fixture
def photos_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the storage service at a scratch directory, guard included.

    Deliberately NOT a mock of `photo_storage`: the traversal guard lives inside
    `get_photo_path`, and a test that mocks it away tests nothing.
    """
    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    return tmp_path


def _write_photo(photos_dir: Path, incident_id: UUID, filename: str = PHOTO_FILENAME) -> None:
    incident_dir = photos_dir / str(incident_id)
    incident_dir.mkdir(parents=True, exist_ok=True)
    (incident_dir / filename).write_bytes(PHOTO_BYTES)


async def _file_report(
    db_session: AsyncSession, incident: Incident, filenames: list[str], *, is_draft: bool = False
) -> RekoReport:
    report = RekoReport(
        id=uuid4(),
        incident_id=incident.id,
        token=generate_form_token(str(incident.id), "reko"),
        is_draft=is_draft,
        summary_text="Dach abgedeckt",
        photos_json=filenames,
    )
    db_session.add(report)
    await db_session.commit()
    return report


@pytest_asyncio.fixture
async def stored_photo(photos_dir: Path, db_session: AsyncSession, test_incident: Incident) -> str:
    """One photo on disk, listed by one submitted Reko report."""
    _write_photo(photos_dir, test_incident.id)
    await _file_report(db_session, test_incident, [PHOTO_FILENAME])
    return PHOTO_FILENAME


@pytest_asyncio.fixture
async def other_event_incident(db_session: AsyncSession, test_user: User, photos_dir: Path) -> Incident:
    """A second event with its own incident, Reko report and photo on disk."""
    other_event = Event(id=uuid4(), name="Grossbrand Nebenan", training_flag=False)
    db_session.add(other_event)
    await db_session.flush()
    incident = Incident(
        id=uuid4(),
        title="Industriehalle",
        type="brandbekaempfung",
        priority="high",
        status="incoming",
        event_id=other_event.id,
        created_by=test_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    _write_photo(photos_dir, incident.id, OTHER_PHOTO_FILENAME)
    await _file_report(db_session, incident, [OTHER_PHOTO_FILENAME])
    return incident


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_served_with_valid_viewer_token(
    client: AsyncClient, test_event: Event, test_incident: Incident, stored_photo: str
):
    """The picture of the damage is what the share board came for."""
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/photos/{test_incident.id}/{stored_photo}?token={token}")

    assert response.status_code == 200
    assert response.content == PHOTO_BYTES
    assert response.headers["content-type"] == "image/jpeg"
    # A shared cache must never hold a photo a later tokenless request could be served.
    assert "private" in response.headers.get("cache-control", "")


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_without_token_or_session_is_unauthorized(
    client: AsyncClient, test_incident: Incident, stored_photo: str
):
    """No door, no photo — the route is not open just because it now has a token door."""
    response = await client.get(f"/api/photos/{test_incident.id}/{stored_photo}")
    assert response.status_code == 401
    assert PHOTO_BYTES not in response.content


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_rejects_expired_viewer_token(
    client: AsyncClient, test_event: Event, test_incident: Incident, stored_photo: str
):
    """A share link stops working when it expires, photos included."""
    expired = generate_viewer_token(test_event.id, expires_hours=-1)
    response = await client.get(f"/api/photos/{test_incident.id}/{stored_photo}?token={expired}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_rejects_a_token_of_another_type(
    client: AsyncClient, test_event: Event, test_incident: Incident, stored_photo: str
):
    """Only a viewer token opens this door — an alarm-intake link is not a share link."""
    response = await client.get(
        f"/api/photos/{test_incident.id}/{stored_photo}?token={generate_alarm_token(test_event.id)}"
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_token_cannot_reach_another_events_photo(
    client: AsyncClient, test_event: Event, other_event_incident: Incident
):
    """THE boundary: a token is scoped to one event, and 404 does not confirm the file."""
    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/photos/{other_event_incident.id}/{OTHER_PHOTO_FILENAME}?token={token}")

    assert response.status_code == 404
    assert PHOTO_BYTES not in response.content


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_token_reaches_only_files_a_submitted_report_lists(
    client: AsyncClient,
    photos_dir: Path,
    test_event: Event,
    test_incident: Incident,
    stored_photo: str,
):
    """The incident's directory also holds Schadenplatz-Rapport photos.

    Existing on disk under an incident of the token's event is not enough: the
    share link carries the Reko result, so it opens the Reko result's files.
    """
    _write_photo(photos_dir, test_incident.id, OTHER_PHOTO_FILENAME)

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/photos/{test_incident.id}/{OTHER_PHOTO_FILENAME}?token={token}")

    assert response.status_code == 404
    assert PHOTO_BYTES not in response.content


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_token_cannot_read_a_draft_report_photo(
    client: AsyncClient,
    photos_dir: Path,
    db_session: AsyncSession,
    test_event: Event,
    test_incident: Incident,
):
    """An unsent report is not part of the shared situation."""
    _write_photo(photos_dir, test_incident.id)
    await _file_report(db_session, test_incident, [PHOTO_FILENAME], is_draft=True)

    token = generate_viewer_token(test_event.id)
    response = await client.get(f"/api/photos/{test_incident.id}/{PHOTO_FILENAME}?token={token}")

    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_token_cannot_traverse_out_of_the_incident_directory(
    client: AsyncClient, photos_dir: Path, test_event: Event, test_incident: Incident, stored_photo: str
):
    """`..` in the filename reaches nothing — with the real `get_photo_path`, unmocked.

    Two layers answer here and both are refusals: an escaped slash never matches
    the `{filename}` path segment at all (router 404), and a name that is not
    UUID.jpg is rejected by the storage guard (400). Either is fine; serving the
    file is not.
    """
    (photos_dir / "secret.jpg").write_bytes(b"another incident's evidence")

    token = generate_viewer_token(test_event.id)
    for attempt in (
        "..%2Fsecret.jpg",
        "..%2F..%2Fetc%2Fpasswd",
        f"..%2F{test_incident.id}%2F{PHOTO_FILENAME}",
        "....jpg",
    ):
        response = await client.get(f"/api/photos/{test_incident.id}/{attempt}?token={token}")
        assert response.status_code in (400, 404), attempt
        assert b"evidence" not in response.content
        assert b"root:" not in response.content


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_session_traversal_guard_is_unchanged(
    editor_client: AsyncClient, photos_dir: Path, test_incident: Incident
):
    """The session door keeps the same guard: 400 for anything but a UUID.jpg name."""
    (photos_dir / "secret.jpg").write_bytes(b"another incident's evidence")

    # Escaped slash: refused by the router before the handler is entered.
    escaped = await editor_client.get(f"/api/photos/{test_incident.id}/..%2Fsecret.jpg")
    assert escaped.status_code == 404
    assert b"evidence" not in escaped.content

    # No slash, so the handler does run — and `get_photo_path` rejects the shape.
    malformed = await editor_client.get(f"/api/photos/{test_incident.id}/secret.jpg")
    assert malformed.status_code == 400
    assert b"evidence" not in malformed.content


@pytest.mark.asyncio
@pytest.mark.api
async def test_photo_session_door_is_not_narrowed_by_the_token_rules(
    editor_client: AsyncClient, photos_dir: Path, test_incident: Incident
):
    """An operator still reads every photo of the incident, Reko report or not.

    The "only what a submitted report lists" rule is the token's leash, not a
    new restriction on the board — the Schadenplatz-Rapport read path depends on
    this endpoint serving files no Reko report mentions.
    """
    _write_photo(photos_dir, test_incident.id, OTHER_PHOTO_FILENAME)

    response = await editor_client.get(f"/api/photos/{test_incident.id}/{OTHER_PHOTO_FILENAME}")
    assert response.status_code == 200
    assert response.content == PHOTO_BYTES


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_token_opens_no_other_endpoint(client: AsyncClient, test_event: Event, test_incident: Incident):
    """The photo route is the only door this token gained — the board stays shut."""
    token = generate_viewer_token(test_event.id)

    incidents = await client.get(f"/api/incidents/?event_id={test_event.id}&token={token}")
    assert incidents.status_code == 401

    reports = await client.get(f"/api/reko/incident/{test_incident.id}?token={token}")
    assert reports.status_code in (401, 404)
