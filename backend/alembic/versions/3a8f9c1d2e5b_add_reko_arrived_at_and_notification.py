"""add_reko_arrived_at_and_notification_type

Revision ID: 3a8f9c1d2e5b
Revises: 1fab06fcd242
Create Date: 2026-01-31 14:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3a8f9c1d2e5b"
down_revision: str | Sequence[str] | None = "1fab06fcd242"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add arrived_at column to reko_reports and reko_arrived notification type."""
    # Add arrived_at column to reko_reports table
    op.add_column(
        "reko_reports",
        sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Drop existing notification type constraint
    op.drop_constraint("valid_notification_type", "notifications", type_="check")

    # Recreate with reko_arrived type added
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ("
        "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
        "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', 'training_emergency'"
        ")",
    )


def downgrade() -> None:
    """Remove arrived_at column and reko_arrived notification type."""
    # Drop column
    op.drop_column("reko_reports", "arrived_at")

    # Drop constraint with reko_arrived
    op.drop_constraint("valid_notification_type", "notifications", type_="check")

    # Recreate without reko_arrived
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ("
        "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
        "'missing_location', 'event_size_limit', 'reko_submitted', 'training_emergency'"
        ")",
    )
