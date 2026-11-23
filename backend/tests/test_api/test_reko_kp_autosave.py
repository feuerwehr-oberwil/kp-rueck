"""The board's Reko report saves as a draft and is filed by the answer to «Einsatz relevant?».

Owner pick 19.11.2026 (#30, simplified: «One rule: relevance answer files»): the KP Reko
form has no save button. Every field goes out at once as a KP draft (`POST /api/reko/?submit=false`,
then `PATCH …?submit=false`). The moment «Einsatz relevant?» is answered (Ja or Nein) the
report is filed exactly like the crew's submit – the card from «Reko» to «Reko abgeschlossen»,
priority bump, the bell (`api.reko._kp_draft_files_now`, `crud.reko.process_reko_submission`),
wherever the card is. A status move files nothing.
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
async def test_the_answer_files_the_draft_like_the_crew_submit_and_only_once(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    incident_id = await _incident(db_session, test_event, test_user)

    # Findings first: a draft, no bell, the card stays at Reko.
    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "dangers_json": {"collapse": True}}
    )
    assert created.json()["is_draft"] is True
    report_id = created.json()["id"]
    assert await _reko_bells(db_session, incident_id) == 0

    # «Ja» files it: the card moves on, the danger bumps the priority, the bell rings once.
    answered = await editor_client.patch(f"/api/reko/{report_id}?submit=false", json={"is_relevant": True})
    assert answered.json()["is_draft"] is False
    db_session.expire_all()
    incident = await db_session.get(Incident, incident_id)
    assert incident is not None and (incident.status, incident.priority) == ("reko_done", "medium")
    assert await _reko_bells(db_session, incident_id) == 1

    # A later edit amends the filed report; no second bell.
    later = await editor_client.patch(f"/api/reko/{report_id}?submit=false", json={"additional_notes": "Nachtrag"})
    assert (later.json()["is_draft"], later.json()["additional_notes"]) == (False, "Nachtrag")
    assert await _reko_bells(db_session, incident_id) == 1


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("status", ["incoming", "reko", "enroute"])
async def test_a_first_save_with_the_answer_files_at_once_wherever_the_card_is(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User, status: str
):
    incident_id = await _incident(db_session, test_event, test_user, status=status)

    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "is_relevant": False}
    )

    assert created.json()["is_draft"] is False
    assert await _reko_bells(db_session, incident_id) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_without_the_answer_a_draft_stays_a_draft_whatever_the_status(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    incident_id = await _incident(db_session, test_event, test_user)
    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "summary_text": "Keller 20 cm"}
    )
    report_id = created.json()["id"]

    # A status move files nothing any more – into «Reko abgeschlossen» or past it.
    await _move(editor_client, incident_id, "reko", "reko_done")
    await _move(editor_client, incident_id, "reko_done", "enroute")
    later = await editor_client.patch(f"/api/reko/{report_id}?submit=false", json={"additional_notes": "Zufahrt Hof"})

    assert later.json()["is_draft"] is True
    [report] = await _reports(db_session, incident_id)
    assert report.is_draft is True
    assert await _reko_bells(db_session, incident_id) == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_kp_answer_files_a_crew_draft_and_keeps_the_crews_byline(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_editor: User
):
    """One live report (23.11.2026): the KP's «Einsatz relevant?» files the crew's open draft too.

    The crew opened the link and is still typing; the KP hears «relevant» over the radio.
    The board's answer files THE report – once, stamped now – and the crew stays its author.
    """
    from datetime import UTC, datetime, timedelta

    incident_id = await _incident(db_session, test_event, test_editor)
    person = Personnel(id=uuid4(), name="Muster Hans", role="Feuerwehrmann", status="available")
    db_session.add(person)
    await db_session.flush()
    crew_draft = RekoReport(
        id=uuid4(),
        incident_id=incident_id,
        token=generate_form_token(str(incident_id), "reko"),
        is_draft=True,
        submitted_by_personnel_id=person.id,
        summary_text="Trupp: Keller 20 cm",
        submitted_at=datetime.now(UTC) - timedelta(minutes=10),
    )
    db_session.add(crew_draft)
    await db_session.commit()

    filed = await editor_client.patch(f"/api/reko/{crew_draft.id}?submit=false", json={"is_relevant": True})
    assert filed.status_code == 200, filed.text
    assert filed.json()["is_draft"] is False
    assert filed.json()["submitted_by_personnel_id"] == str(person.id)
    assert datetime.fromisoformat(filed.json()["submitted_at"]) > datetime.now(UTC) - timedelta(minutes=1)
    assert await _reko_bells(db_session, incident_id) == 1

    amended = await editor_client.patch(f"/api/reko/{crew_draft.id}?submit=false", json={"additional_notes": "Nachtrag"})
    # An amendment keeps the submission time and rings nothing.
    assert amended.json()["submitted_at"] == filed.json()["submitted_at"]
    assert await _reko_bells(db_session, incident_id) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_danger_added_after_filing_escalates_without_a_second_bell(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_user: User
):
    """Pass 5 S4: «Ja» synced first (filed, priority stays low), a danger ticked afterwards."""
    incident_id = await _incident(db_session, test_event, test_user)
    created = await editor_client.post(
        "/api/reko/?submit=false", json={"incident_id": str(incident_id), "is_relevant": True}
    )
    report_id = created.json()["id"]
    db_session.expire_all()
    assert (await db_session.get(Incident, incident_id)).priority == "low"

    await editor_client.patch(f"/api/reko/{report_id}?submit=false", json={"dangers_json": {"electrical": True}})

    db_session.expire_all()
    incident = await db_session.get(Incident, incident_id)
    assert incident is not None and incident.priority == "medium"
    assert await _reko_bells(db_session, incident_id) == 1
