"""add source column to incidents

Tracks where an alarm originated: "operator" (created in the dashboard by a
logged-in user) or "intake" (created via the public token-gated alarm form).

Revision ID: a1c4f7d2e9b3
Revises: c8a2f5e1d7b9
Create Date: 2026-06-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c4f7d2e9b3"
down_revision: str | Sequence[str] | None = "c8a2f5e1d7b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add with a server default so existing rows backfill to "operator".
    op.add_column(
        "incidents",
        sa.Column("source", sa.String(length=20), nullable=False, server_default="operator"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("incidents", "source")
