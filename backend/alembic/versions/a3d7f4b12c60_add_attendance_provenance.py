"""event_attendance records which channel wrote the roll-call

Revision ID: a3d7f4b12c60
Revises: f2a7c4d1e903
Create Date: 2026-08-10 12:00:00.000000

Plan 26 §4.4. Until now the only way a name got ticked was the login-less
check-in link, so there was nothing to distinguish. The board can now write the
same row over the radio, and the two are not the same fact: a self-report is
somebody standing at the door with their own phone, a board write is an operator
saying they heard it.

Two nullable user FKs, one per direction, and **NULL keeps meaning "through the
link"** — which is why no backfill runs here. Every existing row came in that
way, so the default is already the truth for all of them.

Deliberately not a source enum and not one shared "who" column: the personnel
side of the provenance (who reported it in the field) and the user side (which
operator typed it) must never be inferred from one another (decision 6).

``ondelete="SET NULL"`` because deleting a user account must not take the
attendance history of an Ereignis with it; the row survives and simply falls
back to saying nothing about who ticked it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a3d7f4b12c60"
down_revision: str | Sequence[str] | None = "f2a7c4d1e903"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "event_attendance",
        sa.Column("checked_in_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "event_attendance",
        sa.Column("checked_out_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_event_attendance_checked_in_by_user",
        "event_attendance",
        "users",
        ["checked_in_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_event_attendance_checked_out_by_user",
        "event_attendance",
        "users",
        ["checked_out_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_event_attendance_checked_out_by_user", "event_attendance", type_="foreignkey")
    op.drop_constraint("fk_event_attendance_checked_in_by_user", "event_attendance", type_="foreignkey")
    op.drop_column("event_attendance", "checked_out_by_user_id")
    op.drop_column("event_attendance", "checked_in_by_user_id")
