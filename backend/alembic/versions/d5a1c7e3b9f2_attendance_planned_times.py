"""event_attendance: planned «kommt um» / «geht um», and the bell 15' before

Revision ID: d5a1c7e3b9f2
Revises: f2be867876f4
Create Date: 2026-11-19 00:00:00.000000

In a long Ereignis people come later and leave earlier (feedback 19.11.2026, #3). The
Appell and the person themselves (check-in link, /feld) can now say «kommt um 20:00» /
«geht um 22:00»: two nullable stamps beside the record, KP Front's Schicht in one block.
A ``personnel_leaving`` notification rings 15' before somebody's «geht um».

Safe on existing data: both columns are nullable, and the widened CHECK constraint
accepts every row the old one did.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5a1c7e3b9f2"
down_revision: str | Sequence[str] | None = "f2be867876f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_NOTIFICATION_TYPES = (
    "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
    "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
    "'training_emergency', 'vehicle_arrived', "
    "'rapport_submitted', 'field_arrived', 'field_complete', 'field_message', "
    "'field_pickup', 'field_report', 'feld_code_rotated'"
)
NEW_NOTIFICATION_TYPES = OLD_NOTIFICATION_TYPES + ", 'personnel_leaving'"


def upgrade() -> None:
    op.add_column("event_attendance", sa.Column("planned_from", sa.DateTime(timezone=True), nullable=True))
    op.add_column("event_attendance", sa.Column("planned_until", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({NEW_NOTIFICATION_TYPES})")


def downgrade() -> None:
    # Rows carrying the new type go first, or the narrower constraint cannot be applied.
    op.execute("DELETE FROM notifications WHERE type = 'personnel_leaving'")
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({OLD_NOTIFICATION_TYPES})")
    # A plan-only row (never checked in, never out) is the absence of a record without its plan.
    op.execute("DELETE FROM event_attendance WHERE NOT checked_in AND checked_in_at IS NULL AND checked_out_at IS NULL")
    op.drop_column("event_attendance", "planned_until")
    op.drop_column("event_attendance", "planned_from")
