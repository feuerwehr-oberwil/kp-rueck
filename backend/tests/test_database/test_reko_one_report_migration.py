"""`c4f1a7e2d9b3` folds several Reko reports into one per incident, and its downgrade undoes it."""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import command
from app.config import settings
from tests.conftest import create_scratch_database, drop_scratch_database, worker_database_url

BEFORE, FOLD = "b8e4f2a6c1d7", "c4f1a7e2d9b3"


def test_the_fold_keeps_the_newest_filed_report_and_comes_back_on_downgrade(monkeypatch):
    url = worker_database_url(suffix="_reko_fold")
    asyncio.run(create_scratch_database(url))
    monkeypatch.setattr(settings, "database_url", url)
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    event, incident, old, newest, draft = (uuid4() for _ in range(5))
    now = datetime.now(UTC)

    async def run(statements: list[tuple[str, dict]]) -> None:
        engine = create_async_engine(url)
        try:
            async with engine.begin() as conn:
                for sql, params in statements:
                    await conn.execute(text(sql), params)
        finally:
            await engine.dispose()

    async def rows() -> dict:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as conn:
                result = await conn.execute(
                    text("SELECT id, incident_id, summary_text, photos_json, arrived_at FROM reko_reports")
                )
                return {row.id: row for row in result}
        finally:
            await engine.dispose()

    report_sql = (
        "INSERT INTO reko_reports (id, incident_id, token, is_draft, submitted_at, updated_at, summary_text, "
        "photos_json, arrived_at) VALUES (:id, :incident, 't', :draft, :at, :at, :text, CAST(:photos AS jsonb), :arr)"
    )
    try:
        command.upgrade(cfg, BEFORE)
        # Raw SQL: the schema as of BEFORE, which the ORM models no longer describe.
        asyncio.run(
            run(
                [
                    (
                        "INSERT INTO events (id, name, training_flag, auto_attach_divera, feld_code) "
                        "VALUES (:id, 'Disposable fold test', false, false, '1234')",
                        {"id": event},
                    ),
                    (
                        "INSERT INTO incidents (id, event_id, title, type, priority, status) "
                        "VALUES (:id, :event, 'Keller', 'elementarereignis', 'low', 'reko')",
                        {"id": incident, "event": event},
                    ),
                    (
                        report_sql,
                        {
                            "id": old,
                            "incident": incident,
                            "draft": False,
                            "at": now - timedelta(minutes=30),
                            "text": "Erste Meldung",
                            "photos": '["a.jpg"]',
                            "arr": now - timedelta(minutes=40),
                        },
                    ),
                    (
                        report_sql,
                        {
                            "id": newest,
                            "incident": incident,
                            "draft": False,
                            "at": now - timedelta(minutes=10),
                            "text": "Ergänzung",
                            "photos": '["b.jpg"]',
                            "arr": None,
                        },
                    ),
                    (
                        report_sql,
                        {
                            "id": draft,
                            "incident": incident,
                            "draft": True,
                            "at": now,
                            "text": "Entwurf",
                            "photos": "[]",
                            "arr": None,
                        },
                    ),
                ]
            )
        )

        command.upgrade(cfg, FOLD)
        folded = asyncio.run(rows())
        assert set(folded) == {newest}
        kept = folded[newest]
        assert kept.summary_text == "Ergänzung"
        assert kept.photos_json == ["b.jpg", "a.jpg"]  # no picture drops out
        assert kept.arrived_at == now - timedelta(minutes=40)  # the earliest arrival

        command.downgrade(cfg, BEFORE)
        restored = asyncio.run(rows())
        assert set(restored) == {old, newest, draft}
        assert restored[newest].photos_json == ["b.jpg"]
        assert restored[newest].arrived_at is None
        assert restored[old].summary_text == "Erste Meldung"
        assert restored[draft].summary_text == "Entwurf"
    finally:
        asyncio.run(drop_scratch_database(url))
