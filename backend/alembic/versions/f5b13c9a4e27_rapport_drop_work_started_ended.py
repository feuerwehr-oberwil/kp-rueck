"""drop schadenplatz_reports.work_started_at/work_ended_at

Revision ID: f5b13c9a4e27
Revises: e2a6b40d7f19
Create Date: 2026-08-09 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5b13c9a4e27"
down_revision: str | Sequence[str] | None = "e2a6b40d7f19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """The Einsatzdaten block goes: nobody should type a time the board has.

    "Beginn Tätigkeit" and "Ende Tätigkeit" were two inputs on the field slip
    that only ever repeated what the board already recorded three ways over —
    the column the card sits in, the "Angekommen"/"beendet" messages from the
    field, and the status transitions behind both. Asking a crew standing in a
    flooded cellar to retype that costs field time and buys no information.

    The two timestamps are **not** lost: every output derives them
    (``services.pdf_report_service.rapport_work_windows``) from exactly the chain
    that used to prefill these columns — Beginn = ``arrived_at``, else the first
    transition into ``active``, else the earliest assignment; Ende =
    ``incidents.field_complete_reported_at``, else the first transition into
    ``returning``/``complete``. The Einsätze-xlsx keeps its Beginn/Ende/Dauer,
    the Lageblatt keeps its "Tätigkeit" row and the Einsatzbericht its
    Tätigkeit line.

    Destructive on purpose, and the stored values are worth less than they look:
    a value that differed from the derivation only existed where a crew edited
    it by hand, and no output ever treated that edit as anything but the same
    two timestamps it now computes.
    """
    op.drop_column("schadenplatz_reports", "work_started_at")
    op.drop_column("schadenplatz_reports", "work_ended_at")


def downgrade() -> None:
    """Put the two nullable columns back, empty.

    The values cannot come back — they were dropped, not archived — so a
    downgraded database has the shape of the old one with nothing in it. That is
    survivable precisely because the derivation is the source of truth: the old
    code's ``get_rapport`` filled a NULL column from the same chain on first
    open, so a downgraded station sees prefilled times again rather than blanks.
    """
    op.add_column(
        "schadenplatz_reports",
        sa.Column("work_ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "schadenplatz_reports",
        sa.Column("work_started_at", sa.DateTime(timezone=True), nullable=True),
    )
