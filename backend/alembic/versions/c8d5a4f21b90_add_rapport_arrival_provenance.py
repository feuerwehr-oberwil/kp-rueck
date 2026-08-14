"""add schadenplatz_reports.arrived_by_personnel_id / arrived_by_user_id

Revision ID: c8d5a4f21b90
Revises: b6f4d0c21e73
Create Date: 2026-08-09 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c8d5a4f21b90"
down_revision: str | Sequence[str] | None = "b6f4d0c21e73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Give the arrival its own author instead of borrowing the row's.

    Phase 1 read the arrival's provenance off ``created_by_personnel_id`` /
    ``created_by_user_id``, which was exact only for as long as an arrival was
    the ONLY thing that could create the row. Phase 2 lets the KP create a
    Schadenplatz-Rapport first (decision 28 — an editor files for an incident
    that never had any field contact), and a crew tapping "Angekommen" on that
    existing row would then have its arrival rendered as "im KP erfasst".

    So the arrival carries its own pair, with the same rule as every other
    ``*_by`` pair in this table: exactly one side is populated per write, a
    ``User`` is never guessed to be a ``Personnel``, and both are cleared when
    the arrival itself is cleared.

    BACKFILL: for the rows that exist today the old rule WAS correct — the
    arrival is what created them — so the created_by pair is copied across for
    every row that actually has an arrival. Rows without one stay NULL.
    """
    op.add_column(
        "schadenplatz_reports",
        sa.Column("arrived_by_personnel_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "schadenplatz_reports",
        sa.Column("arrived_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_schadenplatz_reports_arrived_by_personnel_id",
        "schadenplatz_reports",
        "personnel",
        ["arrived_by_personnel_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_schadenplatz_reports_arrived_by_user_id",
        "schadenplatz_reports",
        "users",
        ["arrived_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE schadenplatz_reports
           SET arrived_by_personnel_id = created_by_personnel_id,
               arrived_by_user_id = created_by_user_id
         WHERE arrived_at IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop both columns; the readers fall back to the created_by pair."""
    op.drop_constraint("fk_schadenplatz_reports_arrived_by_user_id", "schadenplatz_reports", type_="foreignkey")
    op.drop_constraint("fk_schadenplatz_reports_arrived_by_personnel_id", "schadenplatz_reports", type_="foreignkey")
    op.drop_column("schadenplatz_reports", "arrived_by_user_id")
    op.drop_column("schadenplatz_reports", "arrived_by_personnel_id")
