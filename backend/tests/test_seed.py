"""What a fresh production database is allowed to contain.

A station's fleet, roster and material catalogue are operational DATA, not
scaffolding. While these fixtures reached real deployments, the first act of
setting KP Rück up for your own station was deleting somebody else's five
vehicles and 57 firefighters off the board — and a restored backup put them
straight back. Production seeds accounts and settings; everything else the
station imports (docs/SETUP.md section 3).

No database here on purpose: the question is *which objects get added*, so a
recording session answers it directly and the test runs without Postgres.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app import models
from app.seed import SEED_MARKER_KEY, seed_database, seed_dev_logins


class RecordingSession:
    """Enough AsyncSession to run seed_database, remembering what it added."""

    def __init__(self):
        self.added: list[object] = []
        # Rows that "already exist". Keyed by the compared value when the query
        # carries a WHERE clause (a username, a settings key), and by the MODEL
        # CLASS for clause-less existence checks ("any user at all?") — so a
        # test can plant `existing[models.User]` to simulate a pre-marker
        # database. Unplanted lookups get None, i.e. "nothing here yet".
        self.existing: dict[object, object] = {}

    async def execute(self, statement):
        result = MagicMock()
        clause = getattr(statement, "whereclause", None)
        if clause is not None:
            key = getattr(getattr(clause, "right", None), "value", None)
        else:
            descriptions = getattr(statement, "column_descriptions", None) or [{}]
            key = descriptions[0].get("entity")
        found = self.existing.get(key) if key is not None else None
        result.scalars.return_value.first.return_value = found
        result.scalar_one_or_none.return_value = found
        return result

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def rollback(self):
        pass

    def count(self, model) -> int:
        return sum(1 for obj in self.added if isinstance(obj, model))


@pytest.fixture
def session(monkeypatch) -> RecordingSession:
    recording = RecordingSession()
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=recording)
    context.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr("app.seed.async_session_maker", MagicMock(return_value=context))
    return recording


@pytest.fixture(autouse=True)
def _seed_environment(monkeypatch):
    """Secrets production refuses to boot without, and no demo-mode detour."""
    monkeypatch.setenv("ADMIN_SEED_PASSWORD", "seed-admin-password")
    monkeypatch.setenv("VIEWER_PASSWORD", "seed-viewer-password")
    monkeypatch.setenv("EDITOR_PASSWORD", "seed-editor-password")
    monkeypatch.setattr("app.config.settings.demo_mode", False, raising=False)


@pytest.fixture(autouse=True)
def training(monkeypatch) -> AsyncMock:
    """Training data is seeded through its own session; stub it out."""
    stub = AsyncMock()
    monkeypatch.setattr("app.seed.seed_training_data", stub)
    return stub


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")


@pytest.fixture
def production_unclaimed(monkeypatch, _seed_environment):
    """Production with NONE of the seed secrets: the unclaimed first boot.

    Depends on `_seed_environment` explicitly so its setenvs are guaranteed to
    happen first and the delenvs here win.
    """
    monkeypatch.setenv("ENVIRONMENT", "production")
    for name in ("ADMIN_SEED_PASSWORD", "VIEWER_PASSWORD", "EDITOR_PASSWORD"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def development(monkeypatch):
    for name in (
        "ENVIRONMENT",
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_PROJECT_ID",
        "RAILWAY_SERVICE_ID",
        "RAILWAY_STATIC_URL",
        "RAILWAY_PUBLIC_DOMAIN",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize("model", [models.Vehicle, models.Personnel, models.Material])
async def test_production_board_starts_empty(session, production, model):
    """The whole point: no fleet, no roster, no material catalogue."""
    await seed_database()

    assert session.count(model) == 0


async def test_production_still_seeds_accounts_and_settings(session, production):
    """Empty must not mean unusable — an operator has to be able to log in."""
    await seed_database()

    usernames = {user.username for user in session.added if isinstance(user, models.User)}
    assert {"admin", "viewer"} <= usernames
    assert session.count(models.Setting) > 0


async def test_production_seeds_no_incidents(session, production):
    """A restored production DB must not show sample work as real operations."""
    await seed_database()

    assert session.count(models.Incident) == 0
    assert session.count(models.Event) == 0


async def test_production_skips_training_locations(session, production, training):
    """The bundled fallback list is real streets in one specific town."""
    await seed_database()

    training.assert_awaited_once()
    assert training.await_args.kwargs["seed_locations"] is False


@pytest.mark.parametrize("model", [models.Vehicle, models.Personnel, models.Material])
async def test_development_still_gets_its_fixtures(session, development, model):
    """Guards the other direction: `just dev` must still come up with a board."""
    await seed_database()

    assert session.count(model) > 0


async def test_development_seeds_training_locations(session, development, training):
    await seed_database()

    assert training.await_args.kwargs["seed_locations"] is True


async def test_unclaimed_production_seeds_settings_but_no_accounts(session, production_unclaimed):
    """No ADMIN_SEED_PASSWORD no longer aborts the boot: the board comes up
    unclaimed — settings and templates seeded, zero user accounts."""
    await seed_database()

    assert session.count(models.User) == 0
    assert session.count(models.Setting) > 0


@pytest.mark.parametrize("env", ["production", "production_unclaimed", "development"])
async def test_every_seed_path_writes_the_marker(session, env, request):
    """The marker row IS the "already seeded" guard now — a path that forgets
    it would re-seed on every boot (unclaimed) or crash on the username
    constraint (the others)."""
    request.getfixturevalue(env)

    await seed_database()

    keys = {s.key for s in session.added if isinstance(s, models.Setting)}
    assert SEED_MARKER_KEY in keys


async def test_marker_guards_the_reseed(session, production_unclaimed):
    """Second boot of an unclaimed board: still zero users, so only the marker
    can say "already seeded"."""
    session.existing[SEED_MARKER_KEY] = models.Setting(key=SEED_MARKER_KEY, value="2026-08-22")

    await seed_database()

    assert session.added == []


async def test_users_without_marker_also_guard(session, production):
    """A database seeded by an older version has users but no marker row. The
    seed must skip, not crash into the users.username unique constraint."""
    session.existing[models.User] = models.User(
        username="admin", password_hash="hash", role="admin", display_name="Administrator", is_active=True
    )

    await seed_database()

    assert session.added == []


async def test_dev_logins_refuse_in_production(session, production):
    """The upsert replaces password hashes – on a station that is sabotage, not setup."""
    with pytest.raises(RuntimeError):
        await seed_dev_logins()

    assert session.added == []


async def test_dev_logins_overwrite_a_synced_admin_and_add_the_rest(session, development):
    """After `just dev-sync`, the station's admin row is still there – but its hash
    must become the LOCAL dev password, and the missing dev accounts must appear."""
    synced_admin = models.User(
        username="admin", password_hash="station-hash", role="admin", display_name="Administrator", is_active=False
    )
    session.existing["admin"] = synced_admin

    await seed_dev_logins()

    assert synced_admin.password_hash != "station-hash"
    assert synced_admin.is_active is True
    added_users = {u.username for u in session.added if isinstance(u, models.User)}
    assert added_users == {"dev-user", "editor", "viewer"}
