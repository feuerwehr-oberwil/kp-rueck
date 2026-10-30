"""The standby copy: what it carries over, what it keeps, and when it refuses.

Runs against two scratch databases migrated to head – a "hosted" source and a "box" – because
what matters here is Postgres behaviour (TRUNCATE … CASCADE, COPY, foreign keys between the
copied tables), which a mock would only restate.
"""

import asyncio
import re
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from alembic import command
from app import standby_sync
from app.config import settings
from app.models import Base, Event, Material, MaterialGroup, Personnel, Setting, User
from app.standby_sync import CONFIG_TABLES, StandbySyncError, schema_covers, sync_once
from tests.conftest import create_scratch_database, drop_scratch_database, worker_database_url

BACKEND = Path(__file__).resolve().parents[1]
SOURCE_URL = worker_database_url(suffix="_standby_source")
BOX_URL = worker_database_url(suffix="_standby_box")


@pytest.fixture(scope="module")
def databases():
    """Both databases built by Alembic once, so they carry a real alembic_version."""
    cfg = Config(str(BACKEND / "alembic.ini"))
    for url in (SOURCE_URL, BOX_URL):
        asyncio.run(create_scratch_database(url))
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(settings, "database_url", url)
            command.upgrade(cfg, "head")
    yield
    for url in (SOURCE_URL, BOX_URL):
        asyncio.run(drop_scratch_database(url))


async def _reset(url: str) -> None:
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE users, settings, events, personnel, material_groups, materials CASCADE"))
    await engine.dispose()


async def _add(url: str, *rows: object) -> None:
    engine = create_async_engine(url)
    async with async_sessionmaker(engine)() as db:
        db.add_all(rows)
        await db.commit()
    await engine.dispose()


async def _settings(url: str) -> dict[str, str]:
    engine = create_async_engine(url)
    async with async_sessionmaker(engine)() as db:
        rows = (await db.execute(select(Setting.key, Setting.value))).all()
    await engine.dispose()
    return dict(rows)


async def _names(url: str, model: type) -> set[str]:
    engine = create_async_engine(url)
    async with async_sessionmaker(engine)() as db:
        column = model.username if model is User else model.name
        names = set((await db.execute(select(column))).scalars())
    await engine.dispose()
    return names


@pytest.fixture
def station(databases):
    """A hosted station with its roster, and a freshly claimed box with its own admin."""

    async def build():
        await _reset(SOURCE_URL)
        await _reset(BOX_URL)
        group = MaterialGroup(id=uuid4(), name="Atemschutz")
        await _add(
            SOURCE_URL,
            User(username="kommandant", role="admin", password_hash="x"),
            Personnel(name="Muster Hans", role="Feuerwehrmann", status="available"),
            group,
            Material(name="Pressluftatmer", group_id=group.id),
            Setting(key="firestation_name", value="Feuerwehr Beispielhausen"),
            Setting(key="map_mode", value="online"),
            Setting(key="alarm_webhook_secret", value="hosted-secret"),
            Setting(key="telemetry.install_id", value="hosted-install"),
        )
        await _add(
            BOX_URL,
            User(username="box-admin", role="admin", password_hash="x"),
            Setting(key="firestation_name", value="Feuerwehr Musterstadt"),
            Setting(key="map_mode", value="auto"),
            Setting(key="alarm_webhook_secret", value="box-secret"),
            Setting(key="telemetry.install_id", value="box-install"),
        )

    asyncio.run(build())


def test_copies_the_configuration_and_keeps_the_box_settings(station):
    report = asyncio.run(sync_once(SOURCE_URL, BOX_URL))

    assert report.rows["personnel"] == 1
    assert asyncio.run(_names(BOX_URL, User)) == {"kommandant"}
    assert asyncio.run(_names(BOX_URL, Personnel)) == {"Muster Hans"}
    assert asyncio.run(_names(BOX_URL, Material)) == {"Pressluftatmer"}
    assert asyncio.run(_settings(BOX_URL)) == {
        "firestation_name": "Feuerwehr Beispielhausen",
        "map_mode": "auto",
        "alarm_webhook_secret": "box-secret",
        "telemetry.install_id": "box-install",
    }


def test_refuses_a_box_that_holds_an_ereignis(station):
    asyncio.run(_add(BOX_URL, Event(name="Unwetter", training_flag=False, feld_code="1234")))

    with pytest.raises(StandbySyncError) as refused:
        asyncio.run(sync_once(SOURCE_URL, BOX_URL))

    assert refused.value.stage == "in_use"
    assert asyncio.run(_names(BOX_URL, User)) == {"box-admin"}


def test_refuses_a_source_newer_than_the_box(station):
    async def stamp_unknown_revision():
        engine = create_async_engine(SOURCE_URL)
        async with engine.begin() as conn:
            revision = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
            await conn.execute(text("UPDATE alembic_version SET version_num = 'f00000000000'"))
        await engine.dispose()
        return revision

    async def restore(revision: str):
        engine = create_async_engine(SOURCE_URL)
        async with engine.begin() as conn:
            await conn.execute(text("UPDATE alembic_version SET version_num = :r"), {"r": revision})
        await engine.dispose()

    revision = asyncio.run(stamp_unknown_revision())
    try:
        with pytest.raises(StandbySyncError) as refused:
            asyncio.run(sync_once(SOURCE_URL, BOX_URL))
    finally:
        asyncio.run(restore(revision))

    assert refused.value.stage == "version"
    assert asyncio.run(_names(BOX_URL, User)) == {"box-admin"}


def test_schema_covers_only_ancestors():
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    head = script.get_current_head()
    parent = script.get_revision(head).down_revision

    assert schema_covers(script, head, head)
    assert schema_covers(script, head, parent)
    assert not schema_covers(script, parent, head)
    assert not schema_covers(script, head, "f00000000000")


def test_tables_are_parents_first():
    order = {name: i for i, name in enumerate(CONFIG_TABLES)}
    for name in CONFIG_TABLES:
        for fk in Base.metadata.tables[name].foreign_keys:
            parent = fk.column.table.name
            if parent in order and parent != name:
                assert order[parent] < order[name], f"{parent} must come before {name}"


def test_dev_sync_copies_the_same_tables():
    dev_sync = BACKEND.parent / "scripts" / "dev-sync.sh"
    if not dev_sync.exists():
        pytest.skip("repo root not available (running from the image)")
    block = re.search(r"CONFIG_TABLES=\((.*?)\n\)", dev_sync.read_text(), re.S)
    assert block, "CONFIG_TABLES not found in scripts/dev-sync.sh"
    names = [line.strip() for line in block.group(1).splitlines() if line.strip() and not line.strip().startswith("#")]
    assert names == ["alembic_version", *standby_sync.CONFIG_TABLES]
