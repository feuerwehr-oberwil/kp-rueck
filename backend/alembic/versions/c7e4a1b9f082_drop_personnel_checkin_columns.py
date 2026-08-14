"""drop personnel.checked_in / checked_in_at / checked_out_at

Revision ID: c7e4a1b9f082
Revises: b8e1c5f9d203
Create Date: 2026-08-11 07:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7e4a1b9f082"
down_revision: str | Sequence[str] | None = "b8e1c5f9d203"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Attendance is per Ereignis; the columns that said otherwise go.

    `personnel.checked_in` was added on 2025-10-25 (06b032721f70) and superseded the
    same evening by `event_attendance` (cbd35b46565b). From then on nothing in the
    application wrote it — but `schemas.Personnel` still read it through
    `from_attributes`, so `GET /api/personnel/?checked_in_only=true&event_id=…`
    returned exactly the people who were present and stamped every one of them
    `checked_in: false`. The check-in endpoint said `true` about the same person
    seconds later. Downstream, the board's Personal sidebar showed "Keine Personen
    verfügbar" for a walk-in who had just been checked in.

    Making the response field come from `event_attendance` fixes the report. Dropping
    the columns is what stops it happening again: a column that answers, always
    falsely, is worse than a column that is not there, because the next person to join
    `personnel` for a roster view gets a plausible empty result instead of an error.

    Nothing is lost. The columns were never written after that first day, so they hold
    `false`/NULL for every row; there is no per-event fact in them to migrate, and
    event-scoped attendance has lived in `event_attendance` throughout.

    The CHECK constraint goes with them — it only ever guarded `checked_in = true`,
    a state no row could reach — as do both indexes on the column (the table carried
    two, `idx_personnel_checked_in` from 06b032721f70 and `ix_personnel_checked_in`
    from cbd35b46565b).
    """
    op.drop_constraint("valid_checkin_status", "personnel", type_="check")
    op.drop_index("ix_personnel_checked_in", table_name="personnel")
    op.drop_index("idx_personnel_checked_in", table_name="personnel")
    op.drop_column("personnel", "checked_out_at")
    op.drop_column("personnel", "checked_in_at")
    op.drop_column("personnel", "checked_in")


def downgrade() -> None:
    """Put the columns back, empty — which is the state they were in.

    A rolled-back deployment gets the old shape and the old (wrong) behaviour: code
    from before this revision reads these columns and reports nobody as checked in,
    exactly as it did on the day this bug was filed. `event_attendance` is untouched,
    so the check-in list, the roll-call and the stats keep working, and rolling
    forward again restores the correct roster without any data step.
    """
    op.add_column(
        "personnel",
        sa.Column("checked_in", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("personnel", sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("personnel", sa.Column("checked_out_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_personnel_checked_in", "personnel", ["checked_in"], unique=False)
    op.create_index("ix_personnel_checked_in", "personnel", ["checked_in"], unique=False)
    op.create_check_constraint(
        "valid_checkin_status",
        "personnel",
        "(checked_in = false) OR (checked_in = true AND status != 'unavailable')",
    )
