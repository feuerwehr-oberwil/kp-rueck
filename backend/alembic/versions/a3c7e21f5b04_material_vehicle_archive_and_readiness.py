"""Archive + readiness columns for materials and vehicles

Splits the single `status` column into the three things it was doing at once:

* `out_of_service_since` – «Nicht einsatzbereit», with the date the board shows
* `archived_at`          – retired from the inventory, excluded from every list
* deployment stays where it belongs, in `incident_assignments`

Backfill: rows currently sitting on status='unavailable' become out-of-service as of
their `updated_at`. That is deliberately conservative — the old "delete" wrote exactly
the same value as a genuine defect, so the two are indistinguishable in the data. An
operator sees them blocked rather than silently gone and can archive them properly.

Revision ID: a3c7e21f5b04
Revises: 7b579524a5fd
Create Date: 2026-08-22 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3c7e21f5b04"
down_revision: str | Sequence[str] | None = "7b579524a5fd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("materials", "vehicles"):
        op.add_column(table, sa.Column("out_of_service_since", sa.DateTime(timezone=True), nullable=True))
        op.add_column(table, sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index(f"idx_{table}_archived_at", table, ["archived_at"])
        op.execute(sa.text(f"UPDATE {table} SET out_of_service_since = updated_at WHERE status = 'unavailable'"))


def downgrade() -> None:
    for table in ("materials", "vehicles"):
        op.drop_index(f"idx_{table}_archived_at", table_name=table)
        op.drop_column(table, "archived_at")
        op.drop_column(table, "out_of_service_since")
