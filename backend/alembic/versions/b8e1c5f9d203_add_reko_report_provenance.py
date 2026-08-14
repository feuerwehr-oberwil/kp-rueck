"""reko_reports records which channel wrote the recon report

Revision ID: b8e1c5f9d203
Revises: a3d7f4b12c60
Create Date: 2026-08-10 15:30:00.000000

Plan 26 §5.3. Until now a Reko report could only ever be filed through the
per-incident form link, so ``submitted_by_personnel_id`` answered "who" on its
own. The board can now file the same report — and mark "Reko meldet: vor Ort" —
off a radio message, and the two are not the same fact.

Three nullable user FKs, and **NULL keeps meaning "through the link"**, which is
why no backfill runs here: every existing row came in that way, so the default
is already the truth for all of them.

``submitted_by_personnel_id`` is deliberately untouched. It stays the field-side
answer, and a mixed report — crew filed, KP amended — carries both sides at once
so both can print. Never guess a Personnel row from a User (decision 6): they
are different people often enough that a wrong attribution on a report an
operator acts on is worse than no attribution.

``arrived_reported_by_user_id`` is kept apart from the created/updated pair for
the same reason ``schadenplatz_reports.arrived_by_user_id`` is: the KP can now
create a report before anybody is on site, so reading the arrival's author off
the row's creator would render a crew's later "vor Ort" as a radio message.

``ondelete="SET NULL"`` because deleting a user account must not take an
incident's recon history with it; the row survives and simply falls back to
saying nothing about which operator typed it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b8e1c5f9d203"
down_revision: str | Sequence[str] | None = "a3d7f4b12c60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_COLUMNS = (
    "created_by_user_id",
    "updated_by_user_id",
    "arrived_reported_by_user_id",
)


def upgrade() -> None:
    for column in _COLUMNS:
        op.add_column(
            "reko_reports",
            sa.Column(column, postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_reko_reports_{column}",
            "reko_reports",
            "users",
            [column],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for column in reversed(_COLUMNS):
        op.drop_constraint(f"fk_reko_reports_{column}", "reko_reports", type_="foreignkey")
        op.drop_column("reko_reports", column)
