"""add_performance_indexes

Revision ID: 92081e9489a9
Revises: b803ba1b851c
Create Date: 2025-10-29 19:48:15.856629

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "92081e9489a9"
down_revision: str | Sequence[str] | None = "b803ba1b851c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add performance indexes to optimize common queries."""

    # Composite index for common incident queries (event_id + status + deleted_at)
    # This optimizes the main get_incidents query pattern
    op.create_index(
        "idx_incidents_event_status_deleted", "incidents", ["event_id", "status", "deleted_at"], unique=False
    )

    # Composite index for status transitions lookup (incident_id + timestamp DESC)
    # This optimizes finding the latest status transition per incident
    op.create_index(
        "idx_status_transitions_incident_timestamp",
        "status_transitions",
        ["incident_id", sa.text("timestamp DESC")],
        unique=False,
    )

    # Composite index for assignment resource lookups
    # This optimizes finding assignments by resource
    op.create_index(
        "idx_assignments_resource_lookup",
        "incident_assignments",
        ["resource_type", "resource_id", "unassigned_at"],
        unique=False,
    )


def downgrade() -> None:
    """Remove performance indexes."""
    op.drop_index("idx_assignments_resource_lookup", table_name="incident_assignments")
    op.drop_index("idx_status_transitions_incident_timestamp", table_name="status_transitions")
    op.drop_index("idx_incidents_event_status_deleted", table_name="incidents")
