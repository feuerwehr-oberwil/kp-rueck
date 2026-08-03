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
    RekoReport,
    StatusTransition,
)
from app.seed_demo import seed_demo_database, seed_demo_shared_resources

# The storm scenario: 1 featured fire + 16 loose storm/water incidents +
# 4 Auftrag stops ("Sturmholz Oberwil").
EXPECTED_INCIDENT_COUNT = 21

ALL_BOARD_COLUMNS = {
    "incoming",
    "reko",
    "reko_done",
    "enroute",
    "active",
    "returning",
    "complete",
}


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
        assert len(incidents) == EXPECTED_INCIDENT_COUNT

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
    """Regression: the shared content function fills an event with the storm scenario."""

    @pytest_asyncio.fixture
    async def seeded_event(self, db_session: AsyncSession, shared_resources) -> Event:
        from app.seed_demo import seed_demo_event_content

        event = Event(id=uuid4(), name=f"{DEMO_SANDBOX_PREFIX}test", training_flag=False)
        db_session.add(event)
        await db_session.commit()

        await seed_demo_event_content(db_session, event)
        await db_session.commit()
        return event

    @pytest.mark.asyncio
    async def test_full_storm_board_with_fire_and_auftrag(self, db_session: AsyncSession, seeded_event: Event):
        from app.models import EventAttendance

        incidents = (
            (await db_session.execute(select(Incident).where(Incident.event_id == seeded_event.id))).scalars().all()
        )
        assert len(incidents) == EXPECTED_INCIDENT_COUNT
        # Map view: every incident has coordinates
        assert all(i.location_lat and i.location_lng for i in incidents)
        # The board looks alive: every one of the seven columns has cards
        assert {i.status for i in incidents} == ALL_BOARD_COLUMNS

        # Exactly ONE fire Einsatz — active, staffed, not part of the Auftrag;
        # everything else is the storm story (elementarereignis-heavy).
        fires = [i for i in incidents if i.type == "brandbekaempfung"]
        assert len(fires) == 1
        assert fires[0].status == "active"
        assert fires[0].group_id is None
        assert sum(1 for i in incidents if i.type == "elementarereignis") >= 12

        # ONE Auftrag with four ordered tree-clearing stops
        groups = (
            (await db_session.execute(select(IncidentGroup).where(IncidentGroup.event_id == seeded_event.id)))
            .scalars()
            .all()
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

        # A large part of the roster is checked in, and every personnel that is
        # actively assigned (incident or Auftrag) must be among the checked-in.
        checked_in_ids = set(
            (
                await db_session.execute(
                    select(EventAttendance.personnel_id).where(
                        EventAttendance.event_id == seeded_event.id, EventAttendance.checked_in
                    )
                )
            ).scalars()
        )
        assert len(checked_in_ids) >= 12

        incident_ids = [i.id for i in incidents]
        active_assigned_ids = set(
            (
                await db_session.execute(
                    select(IncidentAssignment.resource_id).where(
                        IncidentAssignment.incident_id.in_(incident_ids),
                        IncidentAssignment.resource_type == "personnel",
                        IncidentAssignment.unassigned_at.is_(None),
                    )
                )
            ).scalars()
        )
        active_assigned_ids |= {a.resource_id for a in group_assignments if a.resource_type == "personnel"}
        assert active_assigned_ids <= checked_in_ids

    @pytest.mark.asyncio
    async def test_reko_slice(self, db_session: AsyncSession, seeded_event: Event):
        incidents = (
            (await db_session.execute(select(Incident).where(Incident.event_id == seeded_event.id))).scalars().all()
        )
        incident_by_id = {i.id: i for i in incidents}
        incident_ids = list(incident_by_id)

        reports = (
            (await db_session.execute(select(RekoReport).where(RekoReport.incident_id.in_(incident_ids))))
            .scalars()
            .all()
        )
        assignments = (
            (
                await db_session.execute(
                    select(IncidentAssignment).where(IncidentAssignment.incident_id.in_(incident_ids))
                )
            )
            .scalars()
            .all()
        )
        reported_incident_ids = {r.incident_id for r in reports}

        # In-progress Rekos: reko-column incidents with a reko person actively
        # on site and NO submitted report yet (they show as "open" on the dashboard).
        reko_in_progress = [i for i in incidents if i.status == "reko"]
        assert len(reko_in_progress) >= 2
        for incident in reko_in_progress:
            assert incident.id not in reported_incident_ids
            active_crew = [
                a
                for a in assignments
                if a.incident_id == incident.id and a.resource_type == "personnel" and a.unassigned_at is None
            ]
            assert active_crew, f"reko incident {incident.title} has no reko person assigned"

        # Completed reports: submitted (non-draft) reports on later-stage
        # incidents, each with a matching assignment row for its author so the
        # dashboard's open/done/total counts add up.
        completed = [r for r in reports if not r.is_draft and r.submitted_at is not None]
        assert len(completed) >= 3
        for report in completed:
            incident = incident_by_id[report.incident_id]
            assert incident.status not in ("incoming", "reko")
            assert report.submitted_by_personnel_id is not None
            assert report.summary_text
            assert report.dangers_json is not None
            assert report.effort_json is not None
            author_rows = [
                a
                for a in assignments
                if a.incident_id == report.incident_id
                and a.resource_type == "personnel"
                and a.resource_id == report.submitted_by_personnel_id
            ]
            assert author_rows, f"report on {incident.title} has no assignment row for its author"
            # Authors stay actively assigned only on reko_done incidents; on
            # later stages the row is historical so nobody is double-booked.
            if incident.status != "reko_done":
                assert all(a.unassigned_at is not None for a in author_rows)


@pytest.mark.asyncio
async def test_demo_seed_ensures_training_data_for_existing_database(monkeypatch):
    """Existing demo deployments must receive templates on the next seed run."""
    seed_training = AsyncMock()
    existing_users = MagicMock()
    # A MagicMock rather than a bare object(): this same session mock also serves
    # _ensure_disposable_marker(), which reads `.value` off the row it finds.
    existing_users.scalars.return_value.first.return_value = MagicMock()
    db = AsyncMock()
    db.execute.return_value = existing_users
    db_context = AsyncMock()
    db_context.__aenter__.return_value = db

    monkeypatch.setattr("app.seed_demo.seed_training_data", seed_training)
    monkeypatch.setattr("app.seed_demo.async_session_maker", MagicMock(return_value=db_context))

    await seed_demo_database()

    seed_training.assert_awaited_once_with(skip_geocoding=True)
