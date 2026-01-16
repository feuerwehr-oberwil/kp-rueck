"""add tags field to personnel

Revision ID: 3b2810233f06
Revises: 371d5ab93e7b
Create Date: 2025-11-14 12:48:58.896910

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3b2810233f06"
down_revision: str | Sequence[str] | None = "371d5ab93e7b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add tags JSONB column to personnel table."""
    op.add_column("personnel", sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    """Remove tags column from personnel table."""
    op.drop_column("personnel", "tags")
