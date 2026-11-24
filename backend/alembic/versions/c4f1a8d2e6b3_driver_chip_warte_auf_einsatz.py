"""The shipped driver chip «Warte auf Auftrag» reads «Warte auf Einsatz».

«Auftrag» names the multi-stop object only (23.11.2026). The default of
`feld.driver_message_chips` moved in code, but a station's stored list keeps the old line.
This renames exactly that one line in the stored list – the exact text, so « Warte auf
Auftrag » or «Warte auf Auftrag bei TLF» stay; a CRLF line keeps its \r. Every other line,
and a list that does not contain it, stays as the station wrote it.

Revision ID: c4f1a8d2e6b3
Revises: b8e4f2a6c1d7
"""

import sqlalchemy as sa
from alembic import op

revision = "c4f1a8d2e6b3"
down_revision = "b8e4f2a6c1d7"
branch_labels = None
depends_on = None

KEY = "feld.driver_message_chips"
OLD = "Warte auf Auftrag"
NEW = "Warte auf Einsatz"


def _rename(old: str, new: str) -> None:
    conn = op.get_bind()
    value = conn.execute(sa.text("SELECT value FROM settings WHERE key = :key"), {"key": KEY}).scalar()
    if value is None:
        return
    lines = value.split("\n")
    renamed = [new if line == old else new + "\r" if line == old + "\r" else line for line in lines]
    if renamed != lines:
        conn.execute(
            sa.text("UPDATE settings SET value = :value WHERE key = :key"),
            {"value": "\n".join(renamed), "key": KEY},
        )


def upgrade() -> None:
    _rename(OLD, NEW)


def downgrade() -> None:
    _rename(NEW, OLD)
