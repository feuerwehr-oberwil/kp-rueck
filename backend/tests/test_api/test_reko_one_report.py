"""One live Reko report per incident, with its changes in the Chronik (owner pick 23.11.2026, #6).

* every form link of the incident opens and edits THE report – no draft per token;
* the first filing rings the bell once; later edits (field or KP) ring nothing;
* each saved change is a Chronik row (time, who, field, old → new), one row per author and
  field per autosave burst (`reko_history.COALESCE_WINDOW`).
"""

from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Notification, RekoReport, RekoReportChange, User
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
        "/api/reko/", params={"submit": True}, json={"incident_id": str(incident_id), "token": first, "is_relevant": True}
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
    for text in ("K", "Kel", "Keller 20 cm"):
        saved = await editor_client.post(
            "/api/reko/", params={"submit": False}, json={"incident_id": str(incident_id), "summary_text": text}
        )
        assert saved.status_code == 200, saved.text
    report_id = UUID(saved.json()["id"])
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


async def test_a_change_taken_back_inside_the_window_leaves_no_row(
    editor_client: AsyncClient, db_session: AsyncSession, incident_id: UUID
):
    saved = await editor_client.post(
        "/api/reko/", params={"submit": False}, json={"incident_id": str(incident_id), "power_supply": "unavailable"}
    )
    report_id = saved.json()["id"]
    await editor_client.patch(f"/api/reko/{report_id}", json={"power_supply": "unknown"})
    assert await _changes(db_session, UUID(report_id)) == []


async def test_dangers_and_photos_are_recorded_as_lists(
    editor_client: AsyncClient, db_session: AsyncSession, incident_id: UUID, tmp_path, monkeypatch
):
    from app.services.photo_storage import photo_storage

    monkeypatch.setattr(photo_storage, "photos_dir", tmp_path)
    saved = await editor_client.post(
        "/api/reko/",
        params={"submit": False},
        json={"incident_id": str(incident_id), "dangers_json": {"collapse": True, "electrical": True}},
    )
    report_id = UUID(saved.json()["id"])
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
    await editor_client.post(
        "/api/reko/", params={"submit": False}, json={"incident_id": str(incident_id), "is_relevant": True}
    )
    timeline = await editor_client.get(f"/api/incidents/{incident_id}/timeline")
    assert timeline.status_code == 200, timeline.text
    [event] = [e for e in timeline.json()["events"] if e["event_type"] == "reko_change"]
    assert event["reko_field"] == "is_relevant"
    assert (event["old_value"], event["new_value"]) == (None, True)
    assert event["source"] == "kp"
    assert event["actor_name"] == (test_editor.display_name or test_editor.username)
