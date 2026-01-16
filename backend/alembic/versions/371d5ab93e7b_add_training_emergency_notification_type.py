"""add training_emergency notification type

Revision ID: 371d5ab93e7b
Revises: e99d83752bc8
Create Date: 2025-11-14 11:22:40.959200

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "371d5ab93e7b"
down_revision: str | Sequence[str] | None = "e99d83752bc8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add training_emergency to valid notification types."""
    # Drop existing constraint
    op.drop_constraint("valid_notification_type", "notifications", type_="check")

    # Recreate with new type
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ('time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', 'missing_location', 'missing_personnel', 'missing_vehicle', 'event_size_limit', 'training_emergency')",
    )


def downgrade() -> None:
    """Remove training_emergency from valid notification types."""
    # Drop constraint with training_emergency
    op.drop_constraint("valid_notification_type", "notifications", type_="check")

    # Recreate without training_emergency
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ('time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', 'missing_location', 'missing_personnel', 'missing_vehicle', 'event_size_limit')",
    )
