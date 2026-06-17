"""Tests for the per-session demo sandbox endpoint (POST /api/demo/sandbox)."""

from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.health import DEMO_SANDBOX_MAX, DEMO_SANDBOX_PREFIX
from app.config import settings as app_settings
from app.models import Event, Incident, IncidentAssignment, Personnel, StatusTransition
from app.seed_demo import seed_demo_shared_resources


@pytest.fixture
def demo_mode(monkeypatch):
    monkeypatch.setattr(app_settings, "demo_mode", True)


@pytest_asyncio.fixture
async def shared_resources(db_session: AsyncSession):
    """Create the shared demo resources the scenario content references."""
    await seed_demo_shared_resources(db_session)
    await db_session.commit()


async def _count(db_session: AsyncSession, model) -> int:
    result = await db_session.execute(select(func.count(model.id)))
    return result.scalar() or 0


class TestDemoSandbox:
    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_creates_populated_sandbox(
        self, editor_client: AsyncClient, db_session: AsyncSession, demo_mode, shared_resources
    ):
        personnel_before = await _count(db_session, Personnel)

        response = await editor_client.post("/api/demo/sandbox")

        assert response.status_code == 200
        body = response.json()
        assert body["reused"] is False
        assert body["name"].startswith(DEMO_SANDBOX_PREFIX)
        event_id = UUID(body["event_id"])

        event = (await db_session.execute(select(Event).where(Event.id == event_id))).scalar_one()
        assert event.archived_at is None

        incidents = (await db_session.execute(select(Incident).where(Incident.event_id == event_id))).scalars().all()
        assert len(incidents) >= 10

        incident_ids = [i.id for i in incidents]
        assignment_count = (
            await db_session.execute(
                select(func.count(IncidentAssignment.id)).where(IncidentAssignment.incident_id.in_(incident_ids))
            )
        ).scalar()
        assert assignment_count > 0

        transition_count = (
            await db_session.execute(
                select(func.count(StatusTransition.id)).where(StatusTransition.incident_id.in_(incident_ids))
            )
        ).scalar()
        assert transition_count > 0

        # Shared resources were not duplicated
        assert await _count(db_session, Personnel) == personnel_before

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_two_calls_create_distinct_events(self, editor_client: AsyncClient, demo_mode, shared_resources):
        first = (await editor_client.post("/api/demo/sandbox")).json()
        second = (await editor_client.post("/api/demo/sandbox")).json()

        assert first["event_id"] != second["event_id"]
        assert first["name"] != second["name"]

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_cap_returns_oldest_sandbox(
        self, editor_client: AsyncClient, db_session: AsyncSession, demo_mode, shared_resources
    ):
        from datetime import UTC, datetime, timedelta

        base = datetime.now(UTC) - timedelta(hours=1)
        oldest_id = None
        for i in range(DEMO_SANDBOX_MAX):
            event = Event(
                id=uuid4(),
                name=f"{DEMO_SANDBOX_PREFIX}{i:04x}",
                training_flag=False,
                created_at=base + timedelta(seconds=i),
            )
            if i == 0:
                oldest_id = event.id
            db_session.add(event)
        await db_session.commit()

        response = await editor_client.post("/api/demo/sandbox")

        assert response.status_code == 200
        body = response.json()
        assert body["reused"] is True
        assert body["event_id"] == str(oldest_id)

        sandbox_count = (
            await db_session.execute(select(func.count(Event.id)).where(Event.name.startswith(DEMO_SANDBOX_PREFIX)))
        ).scalar()
        assert sandbox_count == DEMO_SANDBOX_MAX

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_404_outside_demo_mode(self, editor_client: AsyncClient, monkeypatch):
        monkeypatch.setattr(app_settings, "demo_mode", False)
        response = await editor_client.post("/api/demo/sandbox")
        assert response.status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_unauthenticated(self, client: AsyncClient, demo_mode):
        response = await client.post("/api/demo/sandbox")
        assert response.status_code == 401


class TestSeedDemoEventContent:
    """Regression: the shared content function fills an event with the full scenario."""

    @pytest.mark.asyncio
    async def test_covers_all_statuses(self, db_session: AsyncSession, shared_resources):
        from app.seed_demo import seed_demo_event_content

        event = Event(id=uuid4(), name="Hochwasser Oberwil", training_flag=False)
        db_session.add(event)
        await db_session.commit()

        await seed_demo_event_content(db_session, event)
        await db_session.commit()

        incidents = (await db_session.execute(select(Incident).where(Incident.event_id == event.id))).scalars().all()
        statuses = {i.status for i in incidents}
        assert len(incidents) >= 12
        assert statuses == {
            "eingegangen",
            "reko",
            "reko_done",
            "disponiert",
            "einsatz",
            "einsatz_beendet",
            "abschluss",
        }
        # Map view: every incident has coordinates
        assert all(i.location_lat and i.location_lng for i in incidents)
