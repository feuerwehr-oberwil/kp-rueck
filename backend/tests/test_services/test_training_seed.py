"""Training fixtures must not bypass the configured online-address policy."""

from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select

from app.config import settings
from app.models import EmergencyTemplate, TrainingLocation
from app.seed_training import FALLBACK_TRAINING_LOCATIONS, seed_training_data


@pytest.fixture
def isolated_seed(db_session, monkeypatch):
    @asynccontextmanager
    async def session():
        yield db_session

    monkeypatch.setattr("app.seed_training.async_session_maker", session)
    outbound = MagicMock(side_effect=AssertionError("Training seeding must stay offline"))
    monkeypatch.setattr("httpx.AsyncClient", outbound)
    return outbound


@pytest.mark.parametrize("provider", ["disabled", "swisstopo"])
async def test_optional_seed_geocoding_flag_never_opens_network(db_session, monkeypatch, isolated_seed, provider):
    monkeypatch.setattr(settings, "geocoding_provider", provider)
    # Older API clients may explicitly request this formerly networked path.
    await seed_training_data(skip_geocoding=False)
    locations = (await db_session.execute(select(TrainingLocation))).scalars().all()
    assert len(locations) == len(FALLBACK_TRAINING_LOCATIONS)
    locations[0].street = "Custom station location"
    await db_session.commit()
    await seed_training_data(skip_geocoding=False)
    await db_session.refresh(locations[0])
    assert locations[0].street == "Custom station location"
    assert await db_session.scalar(select(func.count()).select_from(TrainingLocation)) == len(locations)
    isolated_seed.assert_not_called()


async def test_production_template_seed_keeps_locations_empty(db_session, isolated_seed):
    await seed_training_data(skip_geocoding=True, seed_locations=False)
    assert await db_session.scalar(select(func.count()).select_from(EmergencyTemplate)) > 0
    assert await db_session.scalar(select(func.count()).select_from(TrainingLocation)) == 0
    isolated_seed.assert_not_called()
