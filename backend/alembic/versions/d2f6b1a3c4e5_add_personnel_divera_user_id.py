"""add divera_user_id to personnel

Stores the Divera 24/7 user_cluster_relation id for each person so outbound
alarms can target individuals. Nullable: only populated when a person is synced
from / matched to Divera. Harmless for installations that don't use Divera.

Revision ID: d2f6b1a3c4e5
Revises: b4d1e0a7c9f2
Create Date: 2026-06-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2f6b1a3c4e5"
down_revision: str | Sequence[str] | None = "b4d1e0a7c9f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "personnel",
        sa.Column("divera_user_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_personnel_divera_user_id", "personnel", ["divera_user_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_personnel_divera_user_id", table_name="personnel")
    op.drop_column("personnel", "divera_user_id")
