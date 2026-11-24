"""notifications: gps_arrival / gps_release – GPS questions as bell to-dos (24.11.2026)

Owner rule 24.11.2026: a popup only answers the operator's own action; what the system starts
is a «Zu erledigen» row in the bell. The GPS arrival and return questions were WebSocket-only
popups; they become notification rows with buttons. Widening the CHECK accepts every old row.

Revision ID: e5c2a8f1d3b7
Revises: d4a7c1e9b2f6
Create Date: 2026-11-24 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5c2a8f1d3b7"
down_revision: str | Sequence[str] | None = "d4a7c1e9b2f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_NOTIFICATION_TYPES = (
    "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
    "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
    "'training_emergency', 'vehicle_arrived', "
    "'rapport_submitted', 'field_arrived', 'field_complete', 'field_message', "
    "'field_pickup', 'field_report', 'feld_code_rotated', 'personnel_leaving'"
)
NEW_NOTIFICATION_TYPES = OLD_NOTIFICATION_TYPES + ", 'gps_arrival', 'gps_release'"


def upgrade() -> None:
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({NEW_NOTIFICATION_TYPES})")


def downgrade() -> None:
    # Rows carrying the new types have to go first, or the narrower constraint cannot be applied.
    op.execute("DELETE FROM notifications WHERE type IN ('gps_arrival', 'gps_release')")
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({OLD_NOTIFICATION_TYPES})")
