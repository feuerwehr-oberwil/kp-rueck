"""add_reko_submitted_notification_type

Revision ID: 2565181f99b1
Revises: 94803763b5de
Create Date: 2026-01-16 15:29:44.190297

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2565181f99b1"
down_revision: str | Sequence[str] | None = "94803763b5de"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add reko_submitted to valid notification types."""
    # Drop existing constraint
    op.drop_constraint("valid_notification_type", "notifications", type_="check")

    # Recreate with reko_submitted type added (include ALL existing types)
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ("
        "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
        "'missing_location', 'missing_personnel', 'missing_vehicle', "
        "'event_size_limit', 'training_emergency', 'reko_submitted'"
        ")",
    )


def downgrade() -> None:
    """Remove reko_submitted from valid notification types."""
    # Drop constraint with reko_submitted
    op.drop_constraint("valid_notification_type", "notifications", type_="check")

    # Recreate without reko_submitted (keep all other existing types)
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ("
        "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
        "'missing_location', 'missing_personnel', 'missing_vehicle', "
        "'event_size_limit', 'training_emergency'"
        ")",
    )
