"""events: an Ereignis-wide ceiling on wrong Feld-Codes, and its bell entry

Revision ID: c4e8a2f61d97
Revises: b7c2e5a1d4f8
Create Date: 2026-09-23 00:00:00.000000

Wrong Feld-Codes were counted per (IP, Ereignis) only, in memory: five per
quarter-hour, then five minutes' wait. The link token is printed on posters, so
an attacker with many addresses gets five guesses at each of them, and four
digits are 10,000 codes. Two columns count the failures against one Ereignis
from every address together, and survive a restart; at the ceiling the code is
rotated and the KP gets a ``feld_code_rotated`` notification
(``crud/feld/access.py::record_code_failure``).

Safe on existing data: the counter starts at 0 through a server default, the
window start is nullable, and the widened CHECK constraint accepts every row
the old one did.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e8a2f61d97"
down_revision: str | Sequence[str] | None = "b7c2e5a1d4f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_NOTIFICATION_TYPES = (
    "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
    "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
    "'training_emergency', 'vehicle_arrived', "
    "'rapport_submitted', 'field_arrived', 'field_complete', 'field_message', "
    "'field_pickup', 'field_report'"
)
NEW_NOTIFICATION_TYPES = OLD_NOTIFICATION_TYPES + ", 'feld_code_rotated'"


def upgrade() -> None:
    op.add_column("events", sa.Column("feld_code_failures", sa.Integer(), server_default="0", nullable=False))
    op.add_column("events", sa.Column("feld_code_failures_since", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({NEW_NOTIFICATION_TYPES})")


def downgrade() -> None:
    # Rows carrying the new type have to go first, or the narrower constraint
    # cannot be applied and the downgrade fails halfway.
    op.execute("DELETE FROM notifications WHERE type = 'feld_code_rotated'")
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({OLD_NOTIFICATION_TYPES})")
    op.drop_column("events", "feld_code_failures_since")
    op.drop_column("events", "feld_code_failures")
