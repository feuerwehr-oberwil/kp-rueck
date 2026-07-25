"""Production detection — the switch every hardening check hangs off.

Getting this wrong is not a cosmetic bug: a self-hosted stack that reads as "development"
would generate a fresh SECRET_KEY on every restart, seed a random admin password, and put
sample incidents on a real board.
"""

import pytest

from app.environment import is_production_environment


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Start from a machine that looks like neither Railway nor a declared deployment."""
    for name in (
        "ENVIRONMENT",
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_PROJECT_ID",
        "RAILWAY_SERVICE_ID",
        "RAILWAY_STATIC_URL",
        "RAILWAY_PUBLIC_DOMAIN",
    ):
        monkeypatch.delenv(name, raising=False)


def test_plain_dev_machine_is_not_production():
    assert is_production_environment() is False


def test_explicit_environment_variable(monkeypatch):
    """What docker-compose sets — the self-host path that had no signal before."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert is_production_environment() is True


def test_explicit_environment_variable_is_case_and_space_tolerant(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "  Production ")
    assert is_production_environment() is True


@pytest.mark.parametrize(
    "indicator",
    ["RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"],
)
def test_railway_indicators_still_work(monkeypatch, indicator):
    """Existing Railway deployments must keep hardening without a variable change."""
    monkeypatch.setenv(indicator, "whatever")
    assert is_production_environment() is True


def test_other_environments_are_not_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "staging")
    assert is_production_environment() is False
