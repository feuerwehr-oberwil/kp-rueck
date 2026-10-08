"""incidents: possible duplicate flag and merged-into link

Revision ID: d2a9e6f41c83
Revises: c4e8a2f61d97
Create Date: 2026-10-08 00:00:00.000000

A second call about the same Schadenplatz used to be a second card: the board
had no way to say "this is the tree from ten minutes ago", so two Trupps got
sent to one address or an operator deleted a card and lost its Melder.

Two nullable self-references, no backfill:

- ``possible_duplicate_of_id`` – an automatic door (webhook, poller, /alarm,
  bulk attach) created this card next to an open one of the same Ereignis. The
  card says so and offers the merge; nothing is merged without a human.
- ``merged_into_id`` – this report was folded into that card. The row is kept
  (soft-deleted) so the merge can be undone and the report's provenance
  (source, source_ref, Melder) stays answerable.

SET NULL both ways: deleting either card never deletes the other.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2a9e6f41c83"
down_revision: str | Sequence[str] | None = "c4e8a2f61d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("incidents", sa.Column("possible_duplicate_of_id", sa.UUID(), nullable=True))
    op.add_column("incidents", sa.Column("merged_into_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_incidents_possible_duplicate_of",
        "incidents",
        "incidents",
        ["possible_duplicate_of_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_incidents_merged_into",
        "incidents",
        "incidents",
        ["merged_into_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_incidents_merged_into_id", "incidents", ["merged_into_id"])


def downgrade() -> None:
    op.drop_index("ix_incidents_merged_into_id", table_name="incidents")
    op.drop_constraint("fk_incidents_merged_into", "incidents", type_="foreignkey")
    op.drop_constraint("fk_incidents_possible_duplicate_of", "incidents", type_="foreignkey")
    op.drop_column("incidents", "merged_into_id")
    op.drop_column("incidents", "possible_duplicate_of_id")
