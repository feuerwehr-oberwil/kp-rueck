"""Every knob `.env.example` documents must actually reach something – this fails when one doesn't.

A station reads `.env.example`, sets a variable, restarts, and reasonably assumes the setting
took effect. For twelve variables that was false: `docker-compose.yml` listed the backend's
environment by hand and they had fallen off the list. Nothing errored. `SSO_EDITOR_ALLOWLIST`
was the worst of them – SETUP.md tells you to set it "or nobody who signs in with Microsoft can
change anything", and setting it produced exactly that symptom anyway.

`docker-compose.yml` now passes the whole `.env` into the backend, so the pass-through cannot
drift again. What CAN still drift is the file itself: a variable documented here that no code
anywhere reads is a promise to an operator that nothing keeps. That is what these tests guard.

Skipped when the repo root isn't present (running inside the backend image, where only
backend/ is copied).
"""

import pathlib
import re

import pytest

from app.auth.config import AuthSettings
from app.config import Settings

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV_EXAMPLE = ROOT / ".env.example"
COMPOSE = ROOT / "docker-compose.yml"

pytestmark = pytest.mark.skipif(not ENV_EXAMPLE.exists(), reason="repo root not available (running from the image)")

# Read by Docker Compose itself, or by a sidecar that is not the backend, so they will never
# appear as a backend setting. Each one is listed with what consumes it.
NOT_BACKEND_SETTINGS = {
    "COMPOSE_PROFILES": "docker compose, to decide which profiles are active",
    "KP_RUECK_TAG": "docker-compose.yml, image tags",
    "POSTGRES_PASSWORD": "the db service and the DATABASE_URL built for the backend",
    "POSTGRES_USER": "the db service",
    "POSTGRES_DB": "the db service",
    "BACKUP_HOST_DIR": "the backup sidecar",
    "BACKUP_AT": "the backup sidecar",
    "BACKUP_KEEP_DAILY": "the backup sidecar",
    "BACKUP_KEEP_WEEKLY": "the backup sidecar",
    "BACKUP_PG_IMAGE": "the backup sidecar's image",
    # DOMAIN is deliberately NOT here: Caddy is its main consumer, but the backend reads it
    # too (Settings.domain) as the TLS signal the secure-cookie policy trusts over
    # CORS_ORIGINS, so it must show up as a real backend setting.
    "HTTP_PORT": "Caddy's published port",
    "HTTPS_PORT": "Caddy's published port",
    "PRINT_AGENT_BACKEND_URL": "the print agent (BACKEND_URL)",
    "PRINT_POLL_INTERVAL_IDLE": "the print agent",
    "PRINT_POLL_INTERVAL_ACTIVE": "the print agent",
    "PRINT_LONG_POLL_SEC": "the print agent",
    "DRY_RUN": "the print agent",
}


def _documented_variables() -> dict[str, str | None]:
    """Every variable `.env.example` presents as settable, including the commented-out ones.

    Commented lines matter: they are how the file documents a default, and a wrong one there
    is the same lie as a missing pass-through. Maps NAME -> documented value (None if the
    line sets nothing, e.g. `SSO_EDITOR_ALLOWLIST=`).
    """
    found: dict[str, str | None] = {}
    for line in ENV_EXAMPLE.read_text().splitlines():
        m = re.fullmatch(r"#?\s*([A-Z][A-Z0-9_]*)=(.*)", line.strip())
        if not m:
            continue
        name, value = m.group(1), m.group(2).strip()
        found[name] = value or None
    return found


def _backend_setting_names() -> set[str]:
    """Env var names the backend actually reads, aliases included."""
    names: set[str] = set()
    for field_name, field in Settings.model_fields.items():
        names.add(field_name.upper())
        alias = field.validation_alias
        if alias is None:
            continue
        # AliasChoices carries the alternatives; a plain string alias is itself.
        names.update(str(choice).upper() for choice in getattr(alias, "choices", [alias]))
    # AuthSettings is a separate BaseSettings with env_prefix = "AUTH_".
    names.update(f"AUTH_{field_name.upper()}" for field_name in AuthSettings.model_fields)
    return names


def test_every_documented_variable_is_read_by_something():
    """A documented variable must reach the backend, or be consumed by compose/a sidecar."""
    compose_text = COMPOSE.read_text()
    backend_settings = _backend_setting_names()

    orphans = []
    for name in _documented_variables():
        if name in backend_settings or name in NOT_BACKEND_SETTINGS:
            continue
        # Anything else has to be visibly used by the compose file to count as wired.
        if re.search(rf"\$\{{{re.escape(name)}[:}}]", compose_text):
            continue
        orphans.append(name)

    assert not orphans, (
        f".env.example documents {orphans} but nothing reads them: they are not backend settings, "
        f"not interpolated in docker-compose.yml, and not listed in NOT_BACKEND_SETTINGS. "
        f"Either wire the variable up or delete it from the template – a documented knob that "
        f"does nothing is worse than an undocumented one."
    )


def test_compose_passes_the_whole_env_file_to_the_backend():
    """The mechanism the other tests rely on: no hand-maintained list to fall off.

    Reverting to an explicit `environment:` list is what caused the original drift, and it
    breaks silently – the stack still boots, the setting is just ignored. Guard the mechanism,
    not the twelve names that happened to be missing that time.
    """
    compose_text = COMPOSE.read_text()
    backend_block = compose_text.split("\n  backend:\n", 1)
    assert len(backend_block) == 2, "no `backend:` service in docker-compose.yml"
    # Up to the next top-level service definition.
    backend_service = re.split(r"\n  [a-z-]+:\n", backend_block[1])[0]

    assert "env_file:" in backend_service and "path: .env" in backend_service, (
        "docker-compose.yml no longer passes .env into the backend. Every variable in "
        ".env.example then has to be listed under `environment:` by hand, which is exactly "
        "the drift this file exists to prevent – twelve documented settings were silently "
        "ignored the last time it was a hand-maintained list."
    )


def test_commented_out_defaults_match_the_code():
    """`# LOGIN_FAILED_WINDOW_SECONDS=300` next to a code default of 900 is a documented lie."""
    defaults = {name.upper(): field.default for name, field in Settings.model_fields.items()}
    mismatches = []

    for name, documented in _documented_variables().items():
        if documented is None or name not in defaults:
            continue
        actual = defaults[name]
        if actual is None or isinstance(actual, list | dict):
            continue  # not a scalar we can compare against a template string
        if isinstance(actual, bool):
            expected = str(actual).lower()
            if documented.lower() != expected:
                mismatches.append(f"{name}: template says {documented!r}, code default is {expected!r}")
            continue
        if str(actual) != documented:
            mismatches.append(f"{name}: template says {documented!r}, code default is {str(actual)!r}")

    assert not mismatches, "`.env.example` states defaults the code does not use:\n  " + "\n  ".join(mismatches)
