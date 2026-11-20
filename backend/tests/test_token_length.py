"""Short machine credentials stop a production boot (`Settings.check_token_length`)."""

import pytest
from pydantic import ValidationError

from app.config import REFUSED_WHEN_SHORT, Settings


@pytest.fixture
def production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SECRET_KEY", "k" * 64)


@pytest.mark.parametrize("name", sorted(REFUSED_WHEN_SHORT))
def test_production_refuses_a_short_token(production: None, monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "x" * 31)
    with pytest.raises(ValidationError, match=f"{name} must be at least 32 characters"):
        Settings(_env_file=None)


@pytest.mark.parametrize("name", sorted(REFUSED_WHEN_SHORT))
@pytest.mark.parametrize("value", ["", "x" * 32], ids=["unset", "32 characters"])
def test_production_accepts_an_unset_or_long_token(
    production: None, monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    assert getattr(Settings(_env_file=None), name.lower()) == value


@pytest.mark.parametrize("name", sorted(REFUSED_WHEN_SHORT))
def test_development_only_warns(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, name: str) -> None:
    for variable in ("ENVIRONMENT", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"):
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.delenv("RAILWAY_STATIC_URL", raising=False)
    monkeypatch.delenv("RAILWAY_PUBLIC_DOMAIN", raising=False)
    monkeypatch.setenv(name, "short")
    with caplog.at_level("WARNING", logger="app.config"):
        Settings(_env_file=None)
    assert f"{name} is only 5 characters long" in caplog.text
