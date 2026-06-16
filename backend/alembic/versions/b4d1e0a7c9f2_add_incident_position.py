"""add incident position for manual board ordering

Revision ID: b4d1e0a7c9f2
Revises: a1c4f7d2e9b3
Create Date: 2026-06-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4d1e0a7c9f2"
down_revision: str | Sequence[str] | None = "a1c4f7d2e9b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add a persisted manual sort order to incidents.

    Operators reorder cards within a status column to prioritize alarms.
    Backfill seeds positions to preserve the current visual order (the board
    previously sorted by created_at DESC, so newest sits at the top → position 0).
    """
    op.add_column(
        "incidents",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "idx_incidents_event_status_position",
        "incidents",
        ["event_id", "status", "position"],
    )
    # Seed positions per (event, status) preserving the existing created_at DESC order.
    op.execute(
        """
        UPDATE incidents AS i
        SET position = sub.rn
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY event_id, status
                       ORDER BY created_at DESC
                   ) - 1 AS rn
            FROM incidents
            WHERE deleted_at IS NULL
        ) AS sub
        WHERE i.id = sub.id
        """
    )


def downgrade() -> None:
    """Drop the manual sort order column."""
    op.drop_index("idx_incidents_event_status_position", table_name="incidents")
    op.drop_column("incidents", "position")
