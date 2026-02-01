"""Add print_jobs table for thermal printer integration.

Revision ID: a1b2c3d4e5f6
Revises: 9452137d14fc
Create Date: 2025-02-01 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "9452137d14fc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "print_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("job_type IN ('assignment', 'board')", name="valid_print_job_type"),
        sa.CheckConstraint("status IN ('pending', 'printing', 'completed', 'failed')", name="valid_print_job_status"),
    )

    op.create_index("idx_print_jobs_status", "print_jobs", ["status"])
    op.create_index("idx_print_jobs_created_at", "print_jobs", ["created_at"])
    op.create_index("idx_print_jobs_incident_id", "print_jobs", ["incident_id"])
    op.create_index("idx_print_jobs_event_id", "print_jobs", ["event_id"])


def downgrade() -> None:
    op.drop_index("idx_print_jobs_event_id", table_name="print_jobs")
    op.drop_index("idx_print_jobs_incident_id", table_name="print_jobs")
    op.drop_index("idx_print_jobs_created_at", table_name="print_jobs")
    op.drop_index("idx_print_jobs_status", table_name="print_jobs")
    op.drop_table("print_jobs")
