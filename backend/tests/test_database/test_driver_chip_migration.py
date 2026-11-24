"""Migration c4f1a8d2e6b3: the stored driver chip «Warte auf Auftrag» → «Warte auf Einsatz».

Only the exact line moves; a CRLF line keeps its \\r, and a station's own variants
(« Warte auf Auftrag », «Warte auf Auftrag bei TLF») stay as written. The downgrade leaves
the data alone – it cannot tell a renamed line from one the station typed.
"""

import runpy
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting

MIGRATION = runpy.run_path(
    str(Path(__file__).resolve().parents[2] / "alembic/versions/c4f1a8d2e6b3_driver_chip_warte_auf_einsatz.py")
)
STORED = "\n".join(["Warte auf Auftrag\r", "Warte auf Auftrag", " Warte auf Auftrag ", "Warte auf Auftrag bei TLF"])
RENAMED = "\n".join(["Warte auf Einsatz\r", "Warte auf Einsatz", " Warte auf Auftrag ", "Warte auf Auftrag bei TLF"])


async def _run(db_session: AsyncSession, step: str) -> str:
    def migrate(connection):
        with Operations.context(MigrationContext.configure(connection)):
            MIGRATION[step]()

    await (await db_session.connection()).run_sync(migrate)
    await db_session.commit()
    setting = await db_session.get(Setting, "feld.driver_message_chips")
    assert setting is not None
    await db_session.refresh(setting)
    return setting.value


@pytest.mark.asyncio
async def test_renames_the_exact_line_and_the_downgrade_keeps_the_data(db_session: AsyncSession):
    db_session.add(Setting(key="feld.driver_message_chips", value=STORED))
    await db_session.commit()

    assert await _run(db_session, "upgrade") == RENAMED
    assert await _run(db_session, "downgrade") == RENAMED
