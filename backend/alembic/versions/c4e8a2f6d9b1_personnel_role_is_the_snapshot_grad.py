"""personnel.role: the Grad a roster snapshot names, not a four-word tier

Revision ID: c4e8a2f6d9b1
Revises: a7d3f1c9e2b4
Create Date: 2026-11-17 00:00:00.000000

The roster-snapshot sync used to fold the snapshot's rank key into one of four tier words
(`fw` → «Wachtmeister», `hptm` → «Offizier», `gfr` → «Mannschaft»), so a Feldweibel read «Wm»
in KP Rück and «Fw» in KP Front. It now stores the Grad itself (services/ranks.py). The sync
only rewrites `role` when the FILE changes a person's rank, so people it already created would
keep the old word until then – this moves them over once.

Only rows the sync wrote are touched: the person's snapshot identity carries the rank key it
last applied (`metadata_json->>'rank'`), and `role` must still be the word that key used to
map to. An operator's own edit of `role` is left alone. Downgrade maps back the same way.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e8a2f6d9b1"
down_revision: str | Sequence[str] | None = "a7d3f1c9e2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# rank key, the old tier word, the Grad. Written out rather than imported: a migration must
# keep meaning what it meant when it ran. `wm` and `kpl` mapped to their own Grad already.
_MAP = (
    ("kdt", "Offizier", "Kommandant"),
    ("maj", "Offizier", "Major"),
    ("hptm", "Offizier", "Hauptmann"),
    ("oblt", "Offizier", "Oberleutnant"),
    ("lt", "Offizier", "Leutnant"),
    ("fw", "Wachtmeister", "Feldweibel"),
    ("gfr", "Mannschaft", "Gefreiter"),
    ("fwm", "Mannschaft", "Feuerwehrmann"),
    ("sdt", "Mannschaft", "Soldat"),
)


def _move(from_column: str, to_column: str) -> None:
    values = ", ".join(f"('{key}', '{old}', '{grad}')" for key, old, grad in _MAP)
    op.execute(
        f"""
        UPDATE personnel AS p
        SET role = m.{to_column}
        FROM personnel_external_identities AS i, (VALUES {values}) AS m(key, old, grad)
        WHERE i.personnel_id = p.id
          AND i.metadata_json ->> 'rank' = m.key
          AND p.role = m.{from_column}
        """
    )


def upgrade() -> None:
    _move("old", "grad")


def downgrade() -> None:
    _move("grad", "old")
