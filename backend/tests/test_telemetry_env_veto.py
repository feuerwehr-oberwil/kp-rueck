"""The deployer's telemetry veto must actually bind to the documented variable names.

PRIVACY.md tells an operator to put ``KP_TELEMETRY_ENABLED=0`` in their compose file and
promises it "outranks the settings page, so no later click can turn it on". That promise is
only worth anything if the name in the docs is a name pydantic actually reads.

It very nearly wasn't. ``Settings`` has no ``env_prefix``, so every field binds to its bare
upper-cased name — ``TELEMETRY_ENABLED``, not ``KP_TELEMETRY_ENABLED``. The KP_ spelling was
in the docs, in both .env.example files and in the comment above the field, and bound to
nothing at all. Consent defaults to off in the database so nothing was being transmitted,
but a station that had *enforced* the ban per the documentation had not enforced anything.

This test pins both spellings so the veto can never quietly come unstuck again. If it fails
because someone removed the ``AliasChoices``, the fix is to put them back, not to relax the
test — the KP_ name is the published one.

``_env_file=None`` on every construction below keeps a developer's own backend/.env out of
the assertions; this is about name binding, not about what any one machine happens to have.
"""

import pytest

from app.config import Settings
from app.telemetry.dsn import UPSTREAM_DSN

TELEMETRY_ENV_VARS = (
    "KP_TELEMETRY_ENABLED",
    "TELEMETRY_ENABLED",
    "KP_TELEMETRY_DSN",
    "TELEMETRY_DSN",
    "KP_TELEMETRY_FLUSH_MINUTES",
    "TELEMETRY_FLUSH_MINUTES",
)


@pytest.fixture(autouse=True)
def _clear_telemetry_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Start every case from "nothing set", whatever the developer's shell holds."""
    for name in TELEMETRY_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize("var", ["KP_TELEMETRY_ENABLED", "TELEMETRY_ENABLED"])
@pytest.mark.parametrize("falsy", ["0", "false", "False", "no", ""])
def test_either_spelling_disables_telemetry(monkeypatch: pytest.MonkeyPatch, var: str, falsy: str) -> None:
    """The documented KP_ name and the bare name must both switch the transport off.

    The empty string is in the list on purpose: compose passes an unset variable through as
    "", and _empty_telemetry_flag_is_false reads that as "don't send" rather than crashing
    the boot on a pydantic bool parse.
    """
    monkeypatch.setenv(var, falsy)
    assert Settings(_env_file=None).telemetry_enabled is False


@pytest.mark.parametrize("var", ["KP_TELEMETRY_DSN", "TELEMETRY_DSN"])
def test_either_spelling_redirects_the_dsn(monkeypatch: pytest.MonkeyPatch, var: str) -> None:
    """A station aiming the machinery at its own GlitchTip must not still reach ours."""
    own_ingest = "https://deadbeef@glitchtip.example.ch/7"
    monkeypatch.setenv(var, own_ingest)
    settings = Settings(_env_file=None)
    assert settings.telemetry_dsn == own_ingest
    assert settings.telemetry_dsn != UPSTREAM_DSN


@pytest.mark.parametrize("var", ["KP_TELEMETRY_FLUSH_MINUTES", "TELEMETRY_FLUSH_MINUTES"])
def test_either_spelling_sets_the_flush_interval(monkeypatch: pytest.MonkeyPatch, var: str) -> None:
    """Both spellings are accepted here too, so the trio has no odd one out."""
    monkeypatch.setenv(var, "42")
    assert Settings(_env_file=None).telemetry_flush_minutes == 42


def test_kp_prefix_wins_when_both_are_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """KP_ is the documented name, so it outranks the bare one rather than racing it."""
    monkeypatch.setenv("KP_TELEMETRY_ENABLED", "0")
    monkeypatch.setenv("TELEMETRY_ENABLED", "1")
    assert Settings(_env_file=None).telemetry_enabled is False


def test_defaults_are_unchanged_when_nothing_is_set() -> None:
    """The aliases must not have quietly altered what an untouched install does."""
    settings = Settings(_env_file=None)
    assert settings.telemetry_enabled is True
    assert settings.telemetry_dsn == UPSTREAM_DSN
    assert settings.telemetry_flush_minutes == 5
