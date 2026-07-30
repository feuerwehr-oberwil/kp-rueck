"""rename incident status identifiers to english

The board, the API and the database now share one status vocabulary, so the
translation table between them (``frontend/lib/incident-status.ts``) is gone.
``reko`` and ``reko_done`` keep their names — a Reko is domain vocabulary, not a
state of readiness.

Three things move together, and all three must, or a card lands in no column:
the CHECK constraint on ``incidents.status``, the existing rows in
``incidents.status``, and the existing rows in ``status_transitions`` — which
carry the old values in their own ``from_status`` / ``to_status`` columns and
feed the PDF report and the Lageblatt.

Deliberately NOT translated: ``audit_log.changes_json``. It records what the
system said at the time, nothing keys behaviour on it, and it renders as raw
JSON. Rewriting history there would buy nothing and risk mangling the other
shapes stored in that column.

Revision ID: 23a79cae1e20
Revises: a7d3f1c9b2e4
Create Date: 2026-07-30 12:42:37.199540

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "23a79cae1e20"
down_revision: str | Sequence[str] | None = "a7d3f1c9b2e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# old (German) -> new (English). `reko` / `reko_done` are unchanged and absent.
RENAMES: dict[str, str] = {
    "eingegangen": "incoming",
    "disponiert": "enroute",
    "einsatz": "active",
    "einsatz_beendet": "returning",
    "abschluss": "complete",
}

OLD_STATUSES = ("eingegangen", "reko", "reko_done", "disponiert", "einsatz", "einsatz_beendet", "abschluss")
NEW_STATUSES = ("incoming", "reko", "reko_done", "enroute", "active", "returning", "complete")

CONSTRAINT_NAME = "valid_status"


def _in_list(values: Sequence[str]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def _translate(mapping: dict[str, str]) -> None:
    """Rewrite every column that carries the status vocabulary."""
    for column, table in (
        ("status", "incidents"),
        ("from_status", "status_transitions"),
        ("to_status", "status_transitions"),
    ):
        for old, new in mapping.items():
            op.execute(
                sa.text(f"UPDATE {table} SET {column} = :new WHERE {column} = :old").bindparams(old=old, new=new)
            )


def upgrade() -> None:
    # Drop first: the constraint forbids the new values while it still names the old ones.
    op.drop_constraint(CONSTRAINT_NAME, "incidents", type_="check")
    _translate(RENAMES)
    # No server default is touched: `incidents.status` has none — the "incoming"
    # default lives in the SQLAlchemy model and applies on insert.
    op.create_check_constraint(CONSTRAINT_NAME, "incidents", f"status IN ({_in_list(NEW_STATUSES)})")


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "incidents", type_="check")
    _translate({new: old for old, new in RENAMES.items()})
    op.create_check_constraint(CONSTRAINT_NAME, "incidents", f"status IN ({_in_list(OLD_STATUSES)})")
