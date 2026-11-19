"""The board's Reko report saves as a draft and is filed by «Reko abgeschlossen».

Owner pick 19.11.2026 (#30): the KP Reko form has no save button. Every field goes
out at once as a KP draft (`POST /api/reko/?submit=false`, then `PATCH …?submit=false`);
the report counts as filed – bell, priority bump, `has_completed_reko` – when the card
moves to «Reko abgeschlossen» or past it (`crud.reko.submit_kp_reko_drafts`). On a card
already there, the draft is filed the moment «Einsatz relevant?» is answered
(`api.reko._kp_draft_files_now`). Crew drafts are the crew's business.
"""

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Notification, Personnel, RekoReport, User
from app.services.tokens import generate_form_token


async def _incident(db: AsyncSession, event: Event, user: User, status: str = "reko") -> UUID:
    incident = Incident(
        id=uuid4(),
        title="Keller Wasser",
        type="elementarereignis",
        priority="low",
        location_address="Hauptstrasse 5, Oberwil",
        status=status,
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    return incident.id


async def _reports(db: AsyncSession, incident_id: UUID) -> list[RekoReport]:
    db.expire_all()
    result = await db.execute(select(RekoReport).where(RekoReport.incident_id == incident_id))
    return list(result.scalars().all())


async def _reko_bells(db: AsyncSession, incident_id: UUID) -> int:
    result = await db.execute(
        select(Notification).where(Notification.incident_id == incident_id, Notification.type.like("reko%"))
    )
    return len([row for row in result.scalars().all() if row.type != "reko_arrived"])


async def _move(client: AsyncClient, incident_id: UUID, from_status: str, to_status: str) -> None:
    response = await client.post(
        f"/api/incidents/{incident_id}/status", json={"from_status": from_status, "to_status": to_status}
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.api
async def test_kp_draft_is_filed_when_the_card_reaches_reko_done(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    incident_id = await _incident(db_session, test_event, test_user)

    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "dangers_json": {"collapse": True}}
    )
    assert created.status_code == 200
    report_id = created.json()["id"]
    assert created.json()["is_draft"] is True
    patched = await editor_client.patch(f"/api/reko/{report_id}?submit=false", json={"is_relevant": True})
    assert patched.json()["is_draft"] is True
    assert await _reko_bells(db_session, incident_id) == 0

    await _move(editor_client, incident_id, "reko", "reko_done")

    [report] = await _reports(db_session, incident_id)
    assert report.is_draft is False
    assert report.is_relevant is True
    assert await _reko_bells(db_session, incident_id) == 1
    incident = await db_session.get(Incident, incident_id)
    assert incident is not None and incident.priority == "medium"


@pytest.mark.asyncio
@pytest.mark.api
async def test_on_a_card_past_reko_the_answer_to_relevant_files_the_draft(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    """No move is coming any more; the one required answer is the moment (owner pick 19.11.2026)."""
    incident_id = await _incident(db_session, test_event, test_user, status="reko_done")

    # Another field first: still a draft, no bell.
    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "summary_text": "Keller trocken"}
    )
    assert created.json()["is_draft"] is True
    report_id = created.json()["id"]
    assert await _reko_bells(db_session, incident_id) == 0

    # «Nein» files it – bell once.
    answered = await editor_client.patch(f"/api/reko/{report_id}?submit=false", json={"is_relevant": False})
    assert answered.json()["is_draft"] is False
    assert await _reko_bells(db_session, incident_id) == 1

    # A later edit updates the filed report; no second bell.
    later = await editor_client.patch(f"/api/reko/{report_id}?submit=false", json={"additional_notes": "Nachtrag"})
    assert later.json()["is_draft"] is False
    assert later.json()["additional_notes"] == "Nachtrag"
    assert await _reko_bells(db_session, incident_id) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_first_save_with_the_answer_files_at_once_past_reko(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    incident_id = await _incident(db_session, test_event, test_user, status="enroute")

    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "is_relevant": True}
    )

    assert created.json()["is_draft"] is False
    assert await _reko_bells(db_session, incident_id) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_before_reko_done_the_answer_alone_files_nothing(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    """Cards before «Reko abgeschlossen» keep the move as the moment."""
    incident_id = await _incident(db_session, test_event, test_user, status="reko")

    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "is_relevant": True}
    )

    assert created.json()["is_draft"] is True
    assert await _reko_bells(db_session, incident_id) == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_move_leaves_arrival_rows_and_crew_drafts_alone(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    incident_id = await _incident(db_session, test_event, test_user)
    # «Reko vor Ort» over the radio: a KP row with no report in it.
    arrived = await editor_client.post(f"/api/incidents/{incident_id}/reko-arrived", json={})
    assert arrived.status_code == 200
    # The crew's own unfinished form.
    person = Personnel(id=uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
    db_session.add(person)
    db_session.add(
        RekoReport(
            incident_id=incident_id,
            token=generate_form_token(str(incident_id), "reko"),
            is_draft=True,
            submitted_by_personnel_id=person.id,
            summary_text="halb fertig",
        )
    )
    await db_session.commit()

    await _move(editor_client, incident_id, "reko", "reko_done")

    reports = await _reports(db_session, incident_id)
    assert len(reports) == 2
    assert all(report.is_draft for report in reports)
    assert await _reko_bells(db_session, incident_id) == 0
