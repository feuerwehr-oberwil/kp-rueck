"""Tests for the per-session demo sandbox endpoint (POST /api/demo/sandbox)."""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.health import DEMO_SANDBOX_MAX, DEMO_SANDBOX_PREFIX
from app.config import settings as app_settings
from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
    Personnel,
    StatusTransition,
)
from app.seed_demo import seed_demo_database, seed_demo_shared_resources


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
        # One fire Einsatz + four Auftrag stops
        assert len(incidents) == 5

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

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_viewer_can_create_sandbox(self, viewer_client: AsyncClient, demo_mode, shared_resources):
        # Viewers get their own Demo-Lage too (not a shared base event), so the
        # sandbox endpoint must accept read-only demo users.
        response = await viewer_client.post("/api/demo/sandbox")
        assert response.status_code == 200
        body = response.json()
        assert body["reused"] is False
        assert body["name"].startswith(DEMO_SANDBOX_PREFIX)


class TestSeedDemoEventContent:
    """Regression: the shared content function fills an event with the full scenario."""

    @pytest.mark.asyncio
    async def test_fire_plus_equipped_auftrag_with_checkins(self, db_session: AsyncSession, shared_resources):
        from app.models import EventAttendance
        from app.seed_demo import seed_demo_event_content

        event = Event(id=uuid4(), name=f"{DEMO_SANDBOX_PREFIX}test", training_flag=False)
        db_session.add(event)
        await db_session.commit()

        await seed_demo_event_content(db_session, event)
        await db_session.commit()

        incidents = (await db_session.execute(select(Incident).where(Incident.event_id == event.id))).scalars().all()
        assert len(incidents) == 5
        # Map view: every incident has coordinates
        assert all(i.location_lat and i.location_lng for i in incidents)

        # Exactly ONE fire Einsatz — active, staffed, not part of the Auftrag
        fires = [i for i in incidents if i.type == "brandbekaempfung"]
        assert len(fires) == 1
        assert fires[0].status == "einsatz"
        assert fires[0].group_id is None

        # ONE Auftrag with four ordered tree-clearing stops
        groups = (
            (await db_session.execute(select(IncidentGroup).where(IncidentGroup.event_id == event.id))).scalars().all()
        )
        assert len(groups) == 1
        auftrag = groups[0]
        stops = [i for i in incidents if i.group_id == auftrag.id]
        assert len(stops) == 4
        assert sorted(s.group_position for s in stops) == [0, 1, 2, 3]

        # The Auftrag is fully equipped at the route (group) level:
        # a vehicle, three crew, and a Motorsäge
        group_assignments = (
            (
                await db_session.execute(
                    select(IncidentGroupAssignment).where(
                        IncidentGroupAssignment.incident_group_id == auftrag.id,
                        IncidentGroupAssignment.unassigned_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        by_type = {}
        for a in group_assignments:
            by_type[a.resource_type] = by_type.get(a.resource_type, 0) + 1
        assert by_type == {"vehicle": 1, "personnel": 3, "material": 1}

        # A realistic subset of personnel is pre-checked-in for this event
        checked_in = (
            await db_session.execute(
                select(func.count(EventAttendance.id)).where(
                    EventAttendance.event_id == event.id, EventAttendance.checked_in
                )
            )
        ).scalar()
        assert checked_in == 10


@pytest.mark.asyncio
async def test_demo_seed_ensures_training_data_for_existing_database(monkeypatch):
    """Existing demo deployments must receive templates on the next seed run."""
    seed_training = AsyncMock()
    existing_users = MagicMock()
    existing_users.scalars.return_value.first.return_value = object()
    db = AsyncMock()
    db.execute.return_value = existing_users
    db_context = AsyncMock()
    db_context.__aenter__.return_value = db

    monkeypatch.setattr("app.seed_demo.seed_training_data", seed_training)
    monkeypatch.setattr("app.seed_demo.async_session_maker", MagicMock(return_value=db_context))

    await seed_demo_database()

    seed_training.assert_awaited_once_with(skip_geocoding=True)
