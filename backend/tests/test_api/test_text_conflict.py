"""A text save over somebody else's newer text is refused, not silently applied (review F05).

The board sends ``text_base`` – per free-text field, the text it last saw the server hold.
The server compares it with the stored text under the incident row lock; a mismatch is a
409 ``text_conflict`` that carries the stored text and who wrote it, and nothing changes.
"""

import asyncio
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.crud import incidents as incidents_crud
from app.models import AuditLog, Event, Incident, User
from app.schemas import IncidentUpdate


async def _patch(client: AsyncClient, incident_id: UUID, body: dict[str, object]):
    return await client.patch(f"/api/incidents/{incident_id}", json=body)


async def test_a_save_over_newer_text_is_refused_with_the_stored_text_and_its_writer(
    editor_client: AsyncClient, test_incident: Incident, test_editor: User
):
    seen = test_incident.description
    first = await _patch(
        editor_client,
        test_incident.id,
        {"description": "Löschangriff über die Fassade", "text_base": {"description": seen}},
    )
    assert first.status_code == 200

    stale = await _patch(
        editor_client, test_incident.id, {"description": "Bewohner evakuiert", "text_base": {"description": seen}}
    )

    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "text_conflict"
    assert body["params"]["field"] == "description"
    assert body["params"]["current"] == "Löschangriff über die Fassade"
    assert body["params"]["changed_by"] == (test_editor.display_name or test_editor.username)
    assert "changed_at" in body["params"]
    stored = await editor_client.get(f"/api/incidents/{test_incident.id}")
    assert stored.json()["description"] == "Löschangriff über die Fassade"


async def test_keeping_my_text_sends_theirs_as_the_base(editor_client: AsyncClient, test_incident: Incident):
    await _patch(editor_client, test_incident.id, {"internal_notes": "Theirs", "text_base": {"internal_notes": ""}})

    mine = await _patch(
        editor_client, test_incident.id, {"internal_notes": "Mine", "text_base": {"internal_notes": "Theirs"}}
    )

    assert mine.status_code == 200
    assert mine.json()["internal_notes"] == "Mine"


async def test_edits_to_different_fields_never_clash(editor_client: AsyncClient, test_incident: Incident):
    seen = test_incident.description
    await _patch(editor_client, test_incident.id, {"contact": "Bühler Werner", "text_base": {"contact": ""}})

    other = await _patch(editor_client, test_incident.id, {"description": "Neu", "text_base": {"description": seen}})

    assert other.status_code == 200


async def test_a_replayed_save_is_not_a_conflict(editor_client: AsyncClient, test_incident: Incident):
    body = {"description": "Gleich", "text_base": {"description": test_incident.description}}
    assert (await _patch(editor_client, test_incident.id, body)).status_code == 200
    assert (await _patch(editor_client, test_incident.id, body)).status_code == 200


@pytest_asyncio.fixture
async def committed_incident(
    test_engine: AsyncEngine,
) -> AsyncGenerator[tuple[async_sessionmaker[AsyncSession], UUID, UUID]]:
    """An incident and an editor committed for real, so two sessions can race on them."""
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id, event_id, incident_id = uuid4(), uuid4(), uuid4()
    async with sessions() as db:
        prior_audit_ids = set(await db.scalars(select(AuditLog.id)))
        db.add_all(
            [
                User(id=user_id, username=f"text-race-{user_id}", password_hash=None, role="editor"),
                Event(id=event_id, name="Text race", training_flag=False, created_at=datetime.now(UTC)),
            ]
        )
        await db.flush()
        db.add(
            Incident(
                id=incident_id,
                title="Race",
                type="elementarereignis",
                priority="medium",
                status="active",
                event_id=event_id,
                created_by=user_id,
                description="Before",
            )
        )
        await db.commit()
    try:
        yield sessions, incident_id, user_id
    finally:
        async with sessions() as db:
            await db.execute(delete(Incident).where(Incident.event_id == event_id))
            await db.execute(delete(AuditLog).where(AuditLog.id.not_in(prior_audit_ids)))
            await db.execute(delete(Event).where(Event.id == event_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()


async def test_two_simultaneous_saves_from_the_same_base_cannot_both_commit(committed_incident):
    sessions, incident_id, user_id = committed_incident
    request = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)

    def save(text_: str) -> IncidentUpdate:
        return IncidentUpdate(description=text_, text_base={"description": "Before"})

    async with sessions() as first, sessions() as second:
        user_a = await first.get(User, user_id)
        user_b = await second.get(User, user_id)
        # The first save holds the row lock until it commits …
        await incidents_crud.update_incident(first, incident_id, save("A"), user_a, request)
        racing = asyncio.create_task(incidents_crud.update_incident(second, incident_id, save("B"), user_b, request))
        async with sessions() as probe:
            for _ in range(100):
                if await probe.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()"
                    )
                ):
                    break
                await asyncio.sleep(0.05)
            else:
                raise AssertionError("the second save never waited for the lock")
        await first.commit()

        # … so the second compares against «A», not the «Before» it read nothing of.
        with pytest.raises(incidents_crud.TextConflictError) as conflict:
            await asyncio.wait_for(racing, timeout=10)
        await second.rollback()

    assert conflict.value.current == "A"
