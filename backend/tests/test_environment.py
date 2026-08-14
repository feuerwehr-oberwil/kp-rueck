"""Production detection — the switch every hardening check hangs off.

Getting this wrong is not a cosmetic bug: a self-hosted stack that reads as "development"
would generate a fresh SECRET_KEY on every restart, seed a random admin password, and put
sample incidents on a real board.
"""

import pytest

from app.environment import (
    KNOWN_DEPLOYMENT_ROLES,
    DeploymentRoleError,
    blocked_domains,
    blocked_reason,
    deployment_role,
    deployment_role_label,
    is_domain_blocked,
    is_production_environment,
)


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
        "DEPLOYMENT_ROLE",
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


# ==========================================================================================
# DEPLOYMENT_ROLE — what this instance may do to the outside world.
#
# The reason it is an environment variable and not a setting: staging is a 1:1 copy of the
# production DATABASE, so any switch stored in a table arrives carrying production's value.
# These tests exist to keep somebody from "simplifying" it back into the settings store, and
# to pin the direction of the lock: it only ever adds refusals.
# ==========================================================================================


def test_default_role_is_production_and_blocks_nothing():
    assert deployment_role() == "production"
    assert blocked_domains() == ()
    assert deployment_role_label() is None


def test_staging_blocks_outbound_alerting_and_sync(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_ROLE", "staging")
    assert deployment_role() == "staging"
    assert is_domain_blocked("alerting") is True
    assert is_domain_blocked("sync") is True


@pytest.mark.parametrize("domain", ["printing", "traccar", "alarms", "intake"])
def test_staging_does_not_block_the_wanted_domains(monkeypatch, domain):
    """Printing, GPS reads and inbound alarms are the point of a staging box."""
    monkeypatch.setenv("DEPLOYMENT_ROLE", "staging")
    assert is_domain_blocked(domain) is False


@pytest.mark.parametrize("value", ["staging", "STAGING", "  Staging  ", "Staging"])
def test_staging_spelling_is_case_and_space_tolerant(monkeypatch, value):
    """A shouted or padded value must still lock — near-misses must not quietly unlock."""
    monkeypatch.setenv("DEPLOYMENT_ROLE", value)
    assert deployment_role() == "staging"
    assert is_domain_blocked("alerting") is True


def test_unset_reads_as_production():
    """Nobody made a claim, so the safe default applies — and it stays silent about it.

    This is the case every existing deployment is in. It must keep behaving exactly as it did
    before the variable existed.
    """
    assert deployment_role() == "production"
    assert blocked_domains() == ()


@pytest.mark.parametrize("value", ["", "   ", "\t", "\n"])
def test_empty_reads_as_production(monkeypatch, value):
    monkeypatch.setenv("DEPLOYMENT_ROLE", value)
    assert deployment_role() == "production"
    assert blocked_domains() == ()


@pytest.mark.parametrize("value", ["stagging", "prod", "STAGE", "true", "1", "🙂", "staging,production"])
def test_a_value_we_cannot_read_refuses_to_start(monkeypatch, value):
    """The case this exists for.

    A SET value means somebody intended something specific. If we cannot tell what, the one
    reading we must not silently pick is 'production' — the reading that lifts every lock.
    `DEPLOYMENT_ROLE=stagging` on a test box would otherwise be a test system that can alarm
    the station.
    """
    monkeypatch.setenv("DEPLOYMENT_ROLE", value)
    with pytest.raises(DeploymentRoleError):
        deployment_role()


def test_the_refusal_reads_well_in_a_deploy_log(monkeypatch):
    """This message is met in a Railway deploy log, by somebody who did not write this code."""
    monkeypatch.setenv("DEPLOYMENT_ROLE", "stagging")
    with pytest.raises(DeploymentRoleError) as excinfo:
        deployment_role()

    message = str(excinfo.value)
    assert "stagging" in message  # what it got
    assert "production" in message and "staging" in message  # what it accepts
    assert "unset" in message  # what to do for an ordinary deployment
    assert "Refusing to start" in message  # what just happened


@pytest.mark.parametrize("domain_fn", [blocked_domains, deployment_role_label])
def test_every_answer_refuses_on_an_unreadable_role(monkeypatch, domain_fn):
    """Nothing downstream may quietly paper over it by defaulting on its own."""
    monkeypatch.setenv("DEPLOYMENT_ROLE", "stagging")
    with pytest.raises(DeploymentRoleError):
        domain_fn()


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "production",
        "PRODUCTION",
        "staging",
        "  STAGING  ",
        "stagging",
        "dev",
        "development",
        "local",
        "test",
        "demo",
        "off",
        "false",
        "0",
        "none",
        "null",
        "-",
        "🙂",
    ],
)
def test_no_value_can_ever_unlock_anything(monkeypatch, value):
    """The fail-safe direction cannot be flipped by a typo, because there is nothing to flip.

    Whatever you put in this variable, exactly one of three things happens: you get ordinary
    production behaviour, you get MORE refusals, or the process refuses to start. There is no
    fourth outcome and deliberately no role that relaxes a check — so no value, valid or not,
    can weaken a deployment. In particular none of them can touch production hardening.
    """
    monkeypatch.setenv("DEPLOYMENT_ROLE", value)
    monkeypatch.setenv("ENVIRONMENT", "production")

    try:
        blocked = set(blocked_domains())
    except DeploymentRoleError:
        blocked = None  # refused to start: nothing is unlocked because nothing runs

    # Never negative: empty, a known non-empty set, or no process at all.
    assert blocked in (None, set(), {"alerting", "sync"})
    # And the hardening switch is a separate axis this variable cannot reach.
    assert is_production_environment() is True


@pytest.mark.parametrize("role", KNOWN_DEPLOYMENT_ROLES)
def test_every_known_role_answers_consistently(monkeypatch, role):
    """Whatever a role blocks, it must give a reason for — and only for — exactly that."""
    monkeypatch.setenv("DEPLOYMENT_ROLE", role)
    blocked = blocked_domains()
    for domain in ("alerting", "sync", "printing"):
        if domain in blocked:
            reason = blocked_reason(domain)
            assert reason and reason.endswith(".")
            assert "gesperrt" in reason
        else:
            assert blocked_reason(domain) is None


def test_the_app_refuses_to_boot_on_a_role_it_cannot_read():
    """End to end, in a real process: importing the app aborts and says why.

    The unit tests above pin the function; this pins the consequence — that the failure lands
    at startup, where somebody meets it in a deploy log, and not on the first request.
    """
    import os
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        env={**os.environ, "DEPLOYMENT_ROLE": "stagging"},
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode != 0, "the process started with a deployment role it cannot read"
    assert "DeploymentRoleError" in result.stderr
    assert "stagging" in result.stderr
    assert "Refusing to start" in result.stderr


def test_the_app_boots_with_no_role_set():
    """The case every existing deployment is in: unset, silent, unchanged."""
    import os
    import subprocess
    import sys

    env = {k: v for k, v in os.environ.items() if k != "DEPLOYMENT_ROLE"}
    result = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr


def test_staging_reason_names_the_role(monkeypatch):
    """A refusal has to say WHY, or the operator debugs the alerting service instead."""
    monkeypatch.setenv("DEPLOYMENT_ROLE", "staging")
    reason = blocked_reason("alerting")
    assert reason is not None
    assert "Ausalarmierung" in reason
    assert "Staging" in reason
