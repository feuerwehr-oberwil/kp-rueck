"""add vehicle_arrived notification type

Revision ID: b3d7f2a9c1e8
Revises: f1e2d3c4b5a6
Create Date: 2026-07-02 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3d7f2a9c1e8"
down_revision: str | Sequence[str] | None = "f1e2d3c4b5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Allow 'vehicle_arrived' as a notification type (geofence arrival alerts).

    The geofence check inserted this type already; without the constraint it
    raised an IntegrityError that rolled back ALL pending notifications the
    moment a tracked vehicle arrived on scene.
    """
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ("
        "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
        "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
        "'training_emergency', 'vehicle_arrived'"
        ")",
    )


def downgrade() -> None:
    """Restore the previous constraint (without vehicle_arrived)."""
    # Remove any vehicle_arrived rows first so the stricter constraint applies.
    op.execute("DELETE FROM notifications WHERE type = 'vehicle_arrived'")
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint(
        "valid_notification_type",
        "notifications",
        "type IN ("
        "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
        "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
        "'training_emergency'"
        ")",
    )
