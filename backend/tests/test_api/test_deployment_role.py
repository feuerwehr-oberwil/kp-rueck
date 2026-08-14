"""DEPLOYMENT_ROLE seen from the outside: the public endpoint, and what does NOT change.

The governing constraint on the staging work is that as little code as possible may differ
between the two roles, so that staging rehearses the real thing. These tests are the guard on
that constraint: they pin the short list of differences (outbound alerting, sync) and assert
that representative flows come back byte-identical under both roles.

If a future change makes one of the "identical" assertions fail, that is the signal — either
the change belongs behind a different seam, or the difference has to be added to the list in
docs/RAILWAY.md deliberately.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Setting


@pytest.fixture
def production_role(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_ROLE", "production")


@pytest.fixture
def staging_role(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_ROLE", "staging")


@pytest_asyncio.fixture
async def board(db_session: AsyncSession) -> Event:
    """A small board plus the settings a copied production database would carry."""
    event = Event(id=uuid4(), name="Sturm", training_flag=False, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    incident = Incident(
        id=uuid4(),
        event_id=event.id,
        title="Baum auf Strasse",
        type="elementarereignis",
        priority="medium",
        location_address="Dorfstrasse 4",
        status="incoming",
    )
    db_session.add(incident)
    db_session.add(Setting(key="alerting.enabled", value="true"))
    db_session.add(Setting(key="railway_database_url", value="postgresql://u:p@prod.example.com/db"))
    await db_session.commit()
    await db_session.refresh(event)
    return event


# ==========================================================================================
# The public endpoint the UI band reads
# ==========================================================================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_deployment_endpoint_is_public_and_says_production(client: AsyncClient, production_role):
    """Unauthenticated: the tab you mistake at 02:00 is the one you have not logged into."""
    resp = await client.get("/api/deployment")
    assert resp.status_code == 200
    assert resp.json() == {"role": "production", "label": None, "blocked_domains": []}


@pytest.mark.asyncio
@pytest.mark.api
async def test_deployment_endpoint_names_the_staging_role(client: AsyncClient, staging_role):
    resp = await client.get("/api/deployment")
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "staging"
    assert body["label"] == "Staging – Übungssystem"
    assert sorted(body["blocked_domains"]) == ["alerting", "sync"]


# There is deliberately no test here for a misspelt DEPLOYMENT_ROLE reaching this endpoint: the
# process refuses to start on one, so no request can ever be served by such an instance. That
# refusal is pinned in tests/test_environment.py, including end to end in a real process.


# ==========================================================================================
# Nothing else differs
# ==========================================================================================


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize(
    "path",
    [
        "/api/incidents/?event_id={event_id}",
        "/api/events/",
        "/api/personnel/",
        "/api/vehicles/",
        "/api/materials/",
        "/api/settings/",
    ],
)
async def test_representative_flows_are_byte_identical_under_both_roles(
    editor_client: AsyncClient, board: Event, monkeypatch, path
):
    """The board, the roster and the settings store read exactly the same on staging.

    ``/api/settings`` is the load-bearing one: the role must not rewrite `alerting.enabled` or
    `railway_database_url`. It overrules them at the seam and leaves the data alone, so the
    same dump keeps behaving the same way when it is restored back into production.
    """
    url = path.format(event_id=board.id)

    monkeypatch.setenv("DEPLOYMENT_ROLE", "production")
    production = await editor_client.get(url)

    monkeypatch.setenv("DEPLOYMENT_ROLE", "staging")
    staging = await editor_client.get(url)

    assert production.status_code == staging.status_code == 200
    assert production.content == staging.content


@pytest.mark.asyncio
@pytest.mark.api
async def test_inbound_alarms_still_arrive_on_staging(client: AsyncClient, db_session, staging_role):
    """Explicitly NOT blocked — receiving is the whole reason to have the copy."""
    db_session.add(Setting(key="alarm_webhook_secret", value="test_secret"))
    await db_session.commit()

    resp = await client.post(
        "/api/alarms?secret=test_secret",
        json={
            "source": "leitstelle",
            "source_id": "STAGING-001",
            "title": "FEUER Testalarm",
            "address": "Hauptstrasse 12",
        },
    )
    assert resp.status_code in (200, 201)
