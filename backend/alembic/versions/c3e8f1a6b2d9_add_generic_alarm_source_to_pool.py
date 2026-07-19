"""add generic alarm source to divera_emergencies

The alarm pool becomes provider-neutral: any dispatch system can deliver
alarms via the generic webhook (POST /api/alarms), not just Divera. Each pool
row now carries a `source` slug ("divera", "webhook", or a custom slug per
sender) and an opaque `source_id` for idempotent deduplication. `divera_id`
becomes nullable — generic alarms have none — and existing rows are
backfilled with source="divera" / source_id=divera_id so dedupe keeps working
across both identifier schemes.

Revision ID: c3e8f1a6b2d9
Revises: a9f4c7e2d5b8
Create Date: 2026-07-19 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e8f1a6b2d9"
down_revision: str | Sequence[str] | None = "a9f4c7e2d5b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column("divera_emergencies", "divera_id", existing_type=sa.Integer(), nullable=True)
    op.add_column(
        "divera_emergencies",
        sa.Column("source", sa.String(length=20), nullable=False, server_default="divera"),
    )
    op.add_column("divera_emergencies", sa.Column("source_id", sa.Text(), nullable=True))
    # All pre-existing rows came in via Divera (incl. simulated training alarms,
    # which use synthetic negative divera_ids); mirror the id for generic dedupe.
    op.execute("UPDATE divera_emergencies SET source_id = divera_id::text WHERE divera_id IS NOT NULL")
    op.create_index(
        "uq_divera_emergencies_source_source_id",
        "divera_emergencies",
        ["source", "source_id"],
        unique=True,
        postgresql_where=sa.text("source_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "uq_divera_emergencies_source_source_id",
        table_name="divera_emergencies",
        postgresql_where=sa.text("source_id IS NOT NULL"),
    )
    # Rows without a divera_id (generic alarms) cannot survive the NOT NULL restore.
    op.execute("DELETE FROM divera_emergencies WHERE divera_id IS NULL")
    op.drop_column("divera_emergencies", "source_id")
    op.drop_column("divera_emergencies", "source")
    op.alter_column("divera_emergencies", "divera_id", existing_type=sa.Integer(), nullable=False)
