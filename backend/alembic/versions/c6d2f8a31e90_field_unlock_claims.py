"""Store short-lived single-use field unlock grants.

Revision ID: c6d2f8a31e90
Revises: b9e6d3c20a71
"""

import sqlalchemy as sa
from alembic import op

revision = "c6d2f8a31e90"
down_revision = "b9e6d3c20a71"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feld_unlock_claims",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feld_unlock_claims_event_id", "feld_unlock_claims", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_feld_unlock_claims_event_id", table_name="feld_unlock_claims")
    op.drop_table("feld_unlock_claims")
