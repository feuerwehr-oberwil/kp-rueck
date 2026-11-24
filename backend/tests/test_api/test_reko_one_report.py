"""One live Reko report per incident, with its changes in the Chronik (owner pick 23.11.2026, #6).

* every form link of the incident opens and edits THE report – no draft per token;
* the first filing rings the bell once; later edits (field or KP) ring nothing;
* the filing is ONE Chronik fact; each change saved AFTER it is a Chronik row (time, who,
  field, old → new), one row per author and field per autosave burst
  (`reko_history.COALESCE_WINDOW`). A draft's edits and the filing write record no rows.
"""

from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Notification, Personnel, RekoReport, RekoReportChange, User
from app.services.tokens import generate_form_token

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


@pytest.fixture
async def incident_id(db_session: AsyncSession, test_event: Event, test_editor: User) -> UUID:
    incident = Incident(
        id=uuid4(),
        title="Keller Wasser",
        type="elementarereignis",
        priority="low",
        location_address="Hauptstrasse 5, Oberwil",
        status="reko",
        event_id=test_event.id,
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.commit()
    return incident.id


async def _reports(db: AsyncSession, incident_id: UUID) -> list[RekoReport]:
    db.expire_all()
    return list((await db.execute(select(RekoReport).where(RekoReport.incident_id == incident_id))).scalars())


async def _changes(db: AsyncSession, report_id: UUID) -> list[RekoReportChange]:
    db.expire_all()
    result = await db.execute(
        select(RekoReportChange)
        .where(RekoReportChange.report_id == report_id)
        .order_by(RekoReportChange.changed_at, RekoReportChange.field)
    )
    return list(result.scalars())


async def _file(client: AsyncClient, incident_id: UUID) -> UUID:
    """The crew files the report («Einsatz relevant?» Ja) – the change rows start after it."""
    token = generate_form_token(str(incident_id), "reko")
    filed = await client.post(
        "/api/reko/",
        params={"submit": True},
        json={"incident_id": str(incident_id), "token": token, "is_relevant": True},
    )
    assert filed.status_code == 200, filed.text
    return UUID(filed.json()["id"])


async def _reko_bells(db: AsyncSession, incident_id: UUID) -> int:
    result = await db.execute(
        select(Notification).where(Notification.incident_id == incident_id, Notification.type == "reko_submitted")
    )
    return len(result.scalars().all())


async def test_every_link_opens_the_same_report(client: AsyncClient, db_session: AsyncSession, incident_id: UUID):
    first, second = (generate_form_token(str(incident_id), "reko") for _ in range(2))
    opened = await client.get("/api/reko/form", params={"incident_id": str(incident_id), "token": first})
    report_id = opened.json()["id"]
    filed = await client.post(
        "/api/reko/",
        params={"submit": True},
        json={"incident_id": str(incident_id), "token": first, "is_relevant": True},
    )
    assert filed.json()["id"] == report_id

    again = await client.get("/api/reko/form", params={"incident_id": str(incident_id), "token": second})
    assert again.json()["id"] == report_id
    assert again.json()["is_relevant"] is True
    edited = await client.patch(
        f"/api/reko/{report_id}", headers={"X-Reko-Token": second}, json={"summary_text": "Keller 20 cm"}
    )
    assert edited.status_code == 200, edited.text
    assert [r.summary_text for r in await _reports(db_session, incident_id)] == ["Keller 20 cm"]


async def test_the_bell_rings_once_for_the_first_filing(
    client: AsyncClient, editor_client: AsyncClient, db_session: AsyncSession, incident_id: UUID
):
    token = generate_form_token(str(incident_id), "reko")
    body = {"incident_id": str(incident_id), "token": token, "is_relevant": True}
    assert (await client.post("/api/reko/", params={"submit": True}, json=body)).status_code == 200
    assert await _reko_bells(db_session, incident_id) == 1

    # The crew presses «Absenden» again, and the KP edits: no second «Reko-Meldung».
    body["summary_text"] = "Nachtrag"
    assert (await client.post("/api/reko/", params={"submit": True}, json=body)).status_code == 200
    [report] = await _reports(db_session, incident_id)
    kp = await editor_client.patch(f"/api/reko/{report.id}", json={"additional_notes": "Zufahrt Hof"})
    assert kp.status_code == 200, kp.text
    assert await _reko_bells(db_session, incident_id) == 1
    assert len(await _reports(db_session, incident_id)) == 1


async def test_an_autosave_burst_is_one_chronik_row_per_author_and_field(
    client: AsyncClient,
    editor_client: AsyncClient,
    db_session: AsyncSession,
    incident_id: UUID,
    test_editor: User,
):
    editor_id = test_editor.id
    report_id = await _file(client, incident_id)
    for text in ("K", "Kel", "Keller 20 cm"):
        saved = await editor_client.post(
            "/api/reko/", params={"submit": False}, json={"incident_id": str(incident_id), "summary_text": text}
        )
        assert saved.status_code == 200, saved.text
    [row] = await _changes(db_session, report_id)
    assert (row.field, row.old_value, row.new_value) == ("summary_text", None, "Keller 20 cm")
    assert (row.source, row.user_id, row.personnel_id) == ("kp", editor_id, None)

    # Another author on the same field is a row of its own.
    token = generate_form_token(str(incident_id), "reko")
    field = await client.patch(
        f"/api/reko/{report_id}", headers={"X-Reko-Token": token}, json={"summary_text": "Keller 30 cm"}
    )
    assert field.status_code == 200, field.text
    rows = await _changes(db_session, report_id)
    assert [(r.source, r.old_value, r.new_value) for r in rows] == [
        ("kp", None, "Keller 20 cm"),
        ("feld", "Keller 20 cm", "Keller 30 cm"),
    ]

    # Past the window, the same author starts a new row.
    await db_session.execute(
        update(RekoReportChange)
        .where(RekoReportChange.report_id == report_id)
        .values(changed_at=RekoReportChange.changed_at - timedelta(minutes=5))
    )
    await db_session.commit()
    await client.patch(f"/api/reko/{report_id}", headers={"X-Reko-Token": token}, json={"summary_text": "Keller leer"})
    assert len(await _changes(db_session, report_id)) == 3


async def test_links_that_name_nobody_never_share_a_row(
    client: AsyncClient, db_session: AsyncSession, incident_id: UUID
):
    # Sol review G, S6: two crews on two unbound links look the same – each save keeps its row.
    first, second = (generate_form_token(str(incident_id), "reko") for _ in range(2))
    report_id = await _file(client, incident_id)
    for token, text in ((first, "Keller 20 cm"), (second, "Keller 30 cm")):
        saved = await client.patch(
            f"/api/reko/{report_id}", headers={"X-Reko-Token": token}, json={"summary_text": text}
        )
        assert saved.status_code == 200, saved.text
    rows = await _changes(db_session, report_id)
    assert [(r.old_value, r.new_value) for r in rows] == [(None, "Keller 20 cm"), ("Keller 20 cm", "Keller 30 cm")]


async def test_a_change_taken_back_inside_the_window_leaves_no_row(
    client: AsyncClient, editor_client: AsyncClient, db_session: AsyncSession, incident_id: UUID
):
    report_id = await _file(client, incident_id)
    await editor_client.patch(f"/api/reko/{report_id}", json={"power_supply": "unavailable"})
    await editor_client.patch(f"/api/reko/{report_id}", json={"power_supply": "unknown"})
    assert await _changes(db_session, report_id) == []


async def test_dangers_and_photos_are_recorded_as_lists(
    client: AsyncClient, editor_client: AsyncClient, db_session: AsyncSession, incident_id: UUID, tmp_path, monkeypatch
):
    from app.services.photo_storage import photo_storage

    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    report_id = await _file(client, incident_id)
    await editor_client.post(
        "/api/reko/",
        params={"submit": False},
        json={"incident_id": str(incident_id), "dangers_json": {"collapse": True, "electrical": True}},
    )
    await editor_client.patch(f"/api/reko/{report_id}", json={"dangers_json": {"electrical": False}})

    import io

    from PIL import Image

    image = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(image, format="JPEG")
    uploaded = await editor_client.post(
        f"/api/reko/{incident_id}/photos", files={"file": ("a.jpg", image.getvalue(), "image/jpeg")}
    )
    assert uploaded.status_code == 200, uploaded.text

    rows = {row.field: row for row in await _changes(db_session, report_id)}
    assert (rows["dangers"].old_value, rows["dangers"].new_value) == ([], ["collapse"])
    assert (rows["photos"].old_value, rows["photos"].new_value) == ([], [uploaded.json()["filename"]])


async def test_the_chronik_shows_the_change_with_its_author(
    client: AsyncClient, editor_client: AsyncClient, db_session: AsyncSession, incident_id: UUID, test_editor: User
):
    report_id = await _file(client, incident_id)
    await editor_client.patch(f"/api/reko/{report_id}", json={"is_relevant": False})
    timeline = await editor_client.get(f"/api/incidents/{incident_id}/timeline")
    assert timeline.status_code == 200, timeline.text
    [event] = [e for e in timeline.json()["events"] if e["event_type"] == "reko_change"]
    assert event["reko_field"] == "is_relevant"
    assert (event["old_value"], event["new_value"]) == (True, False)
    assert event["source"] == "kp"
    assert event["actor_name"] == (test_editor.display_name or test_editor.username)


async def test_a_draft_and_its_filing_are_one_fact_not_change_rows(
    client: AsyncClient, editor_client: AsyncClient, db_session: AsyncSession, incident_id: UUID
):
    # Sign-off 24.11.2026: «Reko-Bericht eingegangen» AND «leer → …» rows showed the filing twice.
    token = generate_form_token(str(incident_id), "reko")
    body = {"incident_id": str(incident_id), "token": token, "summary_text": "Dachstock ausgebrannt"}
    assert (await client.post("/api/reko/", params={"submit": False}, json=body)).status_code == 200
    body |= {"is_relevant": True, "power_supply": "available"}
    filed = await client.post("/api/reko/", params={"submit": True}, json=body)
    assert filed.status_code == 200, filed.text
    report_id = UUID(filed.json()["id"])
    assert await _changes(db_session, report_id) == []

    # The first edit after the filing is a row, against the filed value.
    await editor_client.patch(f"/api/reko/{report_id}", json={"additional_notes": "Zufahrt Hof"})
    rows = await _changes(db_session, report_id)
    assert [(r.field, r.old_value, r.new_value) for r in rows] == [("additional_notes", None, "Zufahrt Hof")]


async def test_the_filing_line_names_who_filed_not_who_opened(
    db_session: AsyncSession, test_event: Event, incident_id: UUID, test_editor: User, test_admin: User
):
    # Sol review G round 2, S4: operator A opens the draft, operator B's save files it.
    from app import schemas
    from app.crud import reko as crud
    from app.services.audit_export_service import collect_event_report_data
    from app.services.rapport_rows import reko_filing_lines
    from app.services.reko_history import RekoAuthor

    opened = await crud.get_or_create_kp_reko_report(db_session, incident_id, test_editor)
    await crud.update_reko_report(
        db_session, opened.id, schemas.RekoReportUpdate(summary_text="Keller"), author=RekoAuthor.kp(test_editor)
    )
    report, filed_now = await crud.update_reko_report(
        db_session, opened.id, schemas.RekoReportUpdate(is_relevant=True), author=RekoAuthor.kp(test_admin), submit=True
    )
    await db_session.commit()
    assert filed_now and report.submitted_by_user_id == test_admin.id

    data = await collect_event_report_data(db_session, test_event.id)
    [line] = reko_filing_lines(data, next(r for r in data.reko_reports if r.id == report.id))
    assert line.startswith(f"Erfasst im KP durch {test_admin.username} (Funkmeldung)")


async def test_a_crew_filing_names_the_person_who_filed(
    db_session: AsyncSession, incident_id: UUID, test_personnel: Personnel
):
    # S4, field side: the draft was stamped with whoever opened it; the filer's link names another.
    from app import schemas
    from app.crud import reko as crud
    from app.services.reko_history import RekoAuthor

    filer = Personnel(id=uuid4(), name="Anna Beispiel", role="Gruppenführer", status="available")
    db_session.add(filer)
    await db_session.commit()
    token = generate_form_token(str(incident_id), "reko")
    opened = await crud.get_or_create_reko_report(db_session, incident_id, token, test_personnel.id)
    report, _ = await crud.update_reko_report(
        db_session, opened.id, schemas.RekoReportUpdate(is_relevant=True), author=RekoAuthor.feld(filer.id), submit=True
    )
    assert (report.submitted_by_personnel_id, report.submitted_by_user_id) == (filer.id, None)


async def test_a_kp_filing_of_a_crew_draft_names_the_kp_everywhere(
    db_session: AsyncSession, test_event: Event, incident_id: UUID, test_personnel: Personnel, test_admin: User
):
    # Sol review G round 3, S2: the crew opens the draft, the KP files it – exactly one filer.
    from app import schemas
    from app.crud import reko as crud
    from app.crud.feld.briefings import _reko_briefings
    from app.models import JournalEntry
    from app.services.audit_export_service import collect_event_report_data
    from app.services.rapport_rows import reko_filing_lines
    from app.services.reko_history import RekoAuthor

    opened = await crud.get_or_create_reko_report(
        db_session, incident_id, generate_form_token(str(incident_id), "reko"), test_personnel.id
    )
    report, filed_now = await crud.update_reko_report(
        db_session, opened.id, schemas.RekoReportUpdate(is_relevant=True), author=RekoAuthor.kp(test_admin), submit=True
    )
    assert filed_now
    assert (report.submitted_by_user_id, report.submitted_by_personnel_id) == (test_admin.id, None)
    incident = await db_session.get(Incident, incident_id)
    assert incident is not None
    await crud.process_reko_submission(db_session, incident, report)
    await db_session.commit()

    kp_name = test_admin.display_name or test_admin.username
    [bell] = (
        await db_session.execute(
            select(Notification).where(Notification.incident_id == incident_id, Notification.type == "reko_submitted")
        )
    ).scalars()
    assert f"von {kp_name}" in bell.message and test_personnel.name not in bell.message
    assert (await _reko_briefings(db_session, [incident_id]))[incident_id]["submitted_by_name"] is None
    [journal] = (
        await db_session.execute(
            select(JournalEntry).where(JournalEntry.incident_id == incident_id, JournalEntry.kind == "reko")
        )
    ).scalars()
    assert journal.author_name == kp_name
    data = await collect_event_report_data(db_session, test_event.id)
    [line] = reko_filing_lines(data, next(r for r in data.reko_reports if r.id == report.id))
    assert line.startswith(f"Erfasst im KP durch {kp_name}")


async def test_the_journal_names_the_kp_user_who_filed_not_who_opened(
    db_session: AsyncSession, incident_id: UUID, test_editor: User, test_admin: User
):
    # S2: operator A opens the draft, operator B files – the Einsatzjournal names B.
    from app import schemas
    from app.crud import reko as crud
    from app.models import JournalEntry
    from app.services.reko_history import RekoAuthor

    opened = await crud.get_or_create_kp_reko_report(db_session, incident_id, test_editor)
    await crud.update_reko_report(
        db_session, opened.id, schemas.RekoReportUpdate(is_relevant=True), author=RekoAuthor.kp(test_admin), submit=True
    )
    await db_session.commit()
    [journal] = (
        await db_session.execute(
            select(JournalEntry).where(JournalEntry.incident_id == incident_id, JournalEntry.kind == "reko")
        )
    ).scalars()
    assert journal.author_name == (test_admin.display_name or test_admin.username)
