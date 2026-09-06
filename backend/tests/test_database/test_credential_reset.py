"""A completed credential-reset migration must never run again on routine startup."""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from alembic.config import Config
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from alembic import command
from app.config import settings
from app.models import Event, FeldDeviceClaim, FeldUnlockClaim, Personnel
from tests.conftest import create_scratch_database, drop_scratch_database, worker_database_url


def test_credential_reset_runs_once(monkeypatch):
    url = worker_database_url(suffix="_credential_reset")
    asyncio.run(create_scratch_database(url))
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    event_id, person_id, old_id, picker_id, new_id = [uuid4() for _ in range(5)]

    async def seed():
        engine = create_async_engine(url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                db.add_all(
                    [
                        Event(id=event_id, name="Disposable reset test"),
                        Personnel(id=person_id, name="Test Person", role="Feuerwehrmann", status="available"),
                    ]
                )
                await db.flush()
                db.add_all(
                    [
                        FeldDeviceClaim(id=old_id, event_id=event_id, personnel_id=person_id),
                        FeldUnlockClaim(
                            id=picker_id, event_id=event_id, expires_at=datetime.now(UTC) + timedelta(minutes=5)
                        ),
                    ]
                )
                await db.commit()
        finally:
            await engine.dispose()

    async def verify_and_reenter():
        engine = create_async_engine(url)
        try:
            async with async_sessionmaker(engine)() as db:
                assert (await db.get(FeldDeviceClaim, old_id)).revoked_at is not None
                assert (await db.get(FeldUnlockClaim, picker_id)).revoked_at is not None
                db.add(FeldDeviceClaim(id=new_id, event_id=event_id, personnel_id=person_id))
                await db.commit()
        finally:
            await engine.dispose()

    async def verify_new_device_stays_live():
        engine = create_async_engine(url)
        try:
            async with async_sessionmaker(engine)() as db:
                assert (await db.get(FeldDeviceClaim, new_id)).revoked_at is None
                assert (await db.get(FeldDeviceClaim, old_id)).revoked_at is not None
        finally:
            await engine.dispose()

    try:
        command.upgrade(cfg, "d2a7f91c60e4")
        asyncio.run(seed())
        command.upgrade(cfg, "e5b8a90c31d2")
        asyncio.run(verify_and_reenter())
        command.upgrade(cfg, "e5b8a90c31d2")
        asyncio.run(verify_new_device_stays_live())
    finally:
        asyncio.run(drop_scratch_database(url))
