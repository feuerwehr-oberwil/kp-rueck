"""Tests for the event figures and time-on-duty endpoints (`app/api/stats.py`)."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.models import Event, EventAttendance, Incident, IncidentAssignment, Personnel, User

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        id=uuid4(),
        username="stats_user",
        password_hash=hash_password("userpass123abc"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Stats Test Event",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def authenticated_client(client: AsyncClient, test_user: User) -> AsyncClient:
    """Create an authenticated client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "stats_user", "password": "userpass123abc"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Time on duty (personnel_activity)
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_personnel_activity_time_on_duty_and_einsaetze(
    db_session: AsyncSession, authenticated_client: AsyncClient, test_event: Event, test_user: User
):
    """Who is here, since when, how long, how many Einsätze, and where now.

    The clock runs from check-in, not from the current assignment; an Einsatz is a
    distinct incident (or Auftrag) worked, finished or current; a mis-drag released
    within a minute is not one.
    """
    from app.models import IncidentGroup, IncidentGroupAssignment

    now = datetime.now(UTC)
    veteran = Personnel(id=uuid4(), name="Müller Hans", role="Wm", status="available")
    fresh = Personnel(id=uuid4(), name="Frisch Eva", role="Sdt", status="available")
    gone = Personnel(id=uuid4(), name="Weg Paul", role="Sdt", status="available")
    db_session.add_all([veteran, fresh, gone])
    await db_session.flush()
    db_session.add_all(
        [
            EventAttendance(
                event_id=test_event.id, personnel_id=veteran.id, checked_in=True, checked_in_at=now - timedelta(hours=5)
            ),
            EventAttendance(
                event_id=test_event.id,
                personnel_id=fresh.id,
                checked_in=True,
                checked_in_at=now - timedelta(minutes=20),
            ),
            # Came back after going home: the old check-out stamp stays, and they are here.
            EventAttendance(
                event_id=test_event.id,
                personnel_id=gone.id,
                checked_in=True,
                checked_in_at=now - timedelta(hours=1),
                checked_out_at=now - timedelta(hours=2),
            ),
        ]
    )

    def incident(title: str, address: str | None) -> Incident:
        return Incident(
            id=uuid4(),
            event_id=test_event.id,
            title=title,
            type="brandbekaempfung",
            status="active",
            priority="medium",
            location_address=address,
        )

    done_a, done_b, misdrag, current = (
        incident("Keller A", "Bahnhofstrasse 1"),
        incident("Keller B", "Hauptstrasse 2"),
        incident("Keller C", "Hauptstrasse 3"),
        incident("Baum", "Mühlemattstrasse 18"),
    )
    db_session.add_all([done_a, done_b, misdrag, current])
    route = IncidentGroup(id=uuid4(), event_id=test_event.id, name="Sturmrunde Nord")
    db_session.add(route)
    await db_session.flush()

    def worked(inc: Incident, start_h: float, end_h: float | None) -> IncidentAssignment:
        return IncidentAssignment(
            incident_id=inc.id,
            resource_type="personnel",
            resource_id=veteran.id,
            assigned_at=now - timedelta(hours=start_h),
            unassigned_at=None if end_h is None else now - timedelta(hours=end_h),
        )

    db_session.add_all(
        [
            worked(done_a, 4.5, 3.5),
            # Same incident twice (moved off and back): still ONE Einsatz.
            worked(done_a, 3.4, 3.0),
            worked(done_b, 2.9, 2.0),
            IncidentAssignment(
                incident_id=misdrag.id,
                resource_type="personnel",
                resource_id=veteran.id,
                assigned_at=now - timedelta(minutes=90),
                unassigned_at=now - timedelta(minutes=90) + timedelta(seconds=40),
            ),
            # The current assignment is only minutes old — time on duty is still 5 h.
            worked(current, 0.05, None),
            IncidentGroupAssignment(
                incident_group_id=route.id,
                resource_type="personnel",
                resource_id=veteran.id,
                assigned_at=now - timedelta(hours=1.9),
                unassigned_at=now - timedelta(hours=1),
            ),
        ]
    )
    await db_session.commit()

    response = await authenticated_client.get(f"/api/events/{test_event.id}/personnel-activity")
    assert response.status_code == 200
    rows = response.json()

    assert [r["name"] for r in rows] == ["Müller Hans", "Weg Paul", "Frisch Eva"]

    hans = rows[0]
    assert 299 <= hans["active_duration_minutes"] <= 301
    assert hans["assignment_count"] == 4  # Keller A, Keller B, Baum, Sturmrunde Nord
    assert hans["status"] == "assigned"
    assert hans["current_incident_title"] == "Mühlemattstrasse 18"
    assert hans["checked_in_at"] is not None
    # 60 + 24 + 54 (incidents) + 54 (Auftrag) + 3 (current) min, the mis-drag's 40 s;
    # the rest of the 5 h is Pause.
    assert 194 <= hans["assigned_minutes"] <= 196

    eva = rows[2]
    assert eva["assignment_count"] == 0
    assert eva["assigned_minutes"] == 0
    assert eva["current_incident_title"] is None
    assert eva["status"] == "available"
    assert 19 <= eva["active_duration_minutes"] <= 21


@pytest.mark.asyncio
@pytest.mark.api
async def test_personnel_activity_empty_without_attendance(authenticated_client: AsyncClient, test_event: Event):
    response = await authenticated_client.get(f"/api/events/{test_event.id}/personnel-activity")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_personnel_activity_endpoint_unknown_event(authenticated_client: AsyncClient):
    response = await authenticated_client.get(f"/api/events/{uuid4()}/personnel-activity")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_personnel_activity_endpoint_requires_auth(client: AsyncClient, test_event: Event):
    response = await client.get(f"/api/events/{test_event.id}/personnel-activity")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_figures_reaction_times(
    authenticated_client: AsyncClient, db_session: AsyncSession, test_event: Event
):
    """GET /events/{id}/figures: counts per bucket and the Reaktionszeiten per
    priority, read off the status transitions."""
    from app.models import StatusTransition

    t0 = datetime.now(UTC) - timedelta(hours=2)
    dispatched = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Keller",
        type="elementarereignis",
        status="active",
        priority="high",
        created_at=t0,
    )
    waiting = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Baum",
        type="elementarereignis",
        status="incoming",
        priority="high",
        created_at=t0 + timedelta(minutes=30),
    )
    # Reopened: completed once, open again — no Abschluss.
    reopened = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Wasser",
        type="elementarereignis",
        status="active",
        priority="low",
        created_at=t0,
    )
    db_session.add_all([dispatched, waiting, reopened])
    await db_session.flush()
    db_session.add_all(
        [
            StatusTransition(
                incident_id=dispatched.id,
                from_status="incoming",
                to_status="enroute",
                timestamp=t0 + timedelta(minutes=4),
            ),
            StatusTransition(
                incident_id=dispatched.id,
                from_status="enroute",
                to_status="active",
                timestamp=t0 + timedelta(minutes=11),
            ),
            StatusTransition(
                incident_id=reopened.id, from_status="incoming", to_status="active", timestamp=t0 + timedelta(minutes=8)
            ),
            StatusTransition(
                incident_id=reopened.id,
                from_status="active",
                to_status="complete",
                timestamp=t0 + timedelta(minutes=50),
            ),
            StatusTransition(
                incident_id=reopened.id,
                from_status="complete",
                to_status="active",
                timestamp=t0 + timedelta(minutes=55),
            ),
        ]
    )
    await db_session.commit()

    response = await authenticated_client.get(f"/api/events/{test_event.id}/figures")
    assert response.status_code == 200
    figures = response.json()

    assert (figures["total"], figures["waiting"], figures["in_progress"], figures["done"]) == (3, 1, 2, 0)
    high = next(p for p in figures["by_priority"] if p["priority"] == "high")
    assert high["dispatched"] == {"count": 1, "median_seconds": 240.0, "p90_seconds": 240.0}
    assert high["on_scene"]["median_seconds"] == 660.0
    low = next(p for p in figures["by_priority"] if p["priority"] == "low")
    assert low["dispatched"]["median_seconds"] == 480.0
    assert low["closed"]["count"] == 0
    assert figures["oldest_waiting_high"]["incident_id"] == str(waiting.id)
    assert figures["oldest_waiting_high"]["title"] == "Baum"


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_figures_requires_auth_and_an_event(client: AsyncClient, authenticated_client: AsyncClient):
    assert (await authenticated_client.get(f"/api/events/{uuid4()}/figures")).status_code == 404
    client.cookies.clear()
    assert (await client.get(f"/api/events/{uuid4()}/figures")).status_code == 401


def test_assigned_minutes_merges_overlaps_and_clips_to_check_in():
    """An incident and its Auftrag at once is one stretch; time before check-in is not counted."""
    from app.api.stats import _assigned_minutes

    now = datetime.now(UTC)
    since = now - timedelta(hours=3)
    spans = [
        (now - timedelta(hours=4), now - timedelta(hours=2.5)),  # 30 min after check-in
        (now - timedelta(hours=2), now - timedelta(hours=1)),  # 60 min …
        (now - timedelta(hours=1.5), now - timedelta(hours=0.5)),  # … overlapping: +30 min
        (now - timedelta(minutes=10), now),  # running: 10 min
    ]
    assert _assigned_minutes(spans, since, now) == 130
    assert _assigned_minutes(spans, None, now) == 0
    assert _assigned_minutes([], since, now) == 0
