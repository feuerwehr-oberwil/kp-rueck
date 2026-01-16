"""add_sync_log_table

Revision ID: 436a11d28487
Revises: 92081e9489a9
Create Date: 2025-10-29 22:55:25.985037

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "436a11d28487"
down_revision: str | Sequence[str] | None = "92081e9489a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "sync_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("sync_direction", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("records_synced", JSONB, nullable=True),
        sa.Column("errors", JSONB, nullable=True),
        sa.CheckConstraint("sync_direction IN ('from_railway', 'to_railway')", name="valid_sync_direction"),
        sa.CheckConstraint("status IN ('success', 'failed', 'partial', 'in_progress')", name="valid_sync_status"),
    )

    # Add indexes for performance
    op.create_index("idx_sync_log_started_at", "sync_log", ["started_at"])
    op.create_index("idx_sync_log_status", "sync_log", ["status"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_sync_log_status", table_name="sync_log")
    op.drop_index("idx_sync_log_started_at", table_name="sync_log")
    op.drop_table("sync_log")
