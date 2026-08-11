"""rapport: "Eingesetztes Personal" becomes a name checklist

Revision ID: d3b8f1a70c25
Revises: a1c4d8e93f27
Create Date: 2026-08-11 15:20:00.000000

The crew confirmed a *number*. A number answers neither of the two questions the
KP actually has the morning after — was somebody there that nobody aufgeboten,
and did somebody go home that nobody tracked — and every output that printed it
wanted the names anyway. So the head count follows the vehicles (§18.33): a row
per person checked in at the Ereignis, the ones the board has on this incident
arriving ticked, and the crew corrects it in either direction.

``extra_personnel_json`` is the free-text half: a neighbouring brigade's crew or
somebody from the Werkhof is on no roster of this station, and **names are never
ids** here — the same rule the extra material follows. `/feld` writes no
attendance row and no personnel row; it records who was standing there. The note
is free text rather than an "Einheit" column so it can also carry "kam um 21:00"
or "nur Verkehrsdienst".

``personnel_count`` stays and becomes derived (ticked rows + extra entries), so
the five outputs and the billing workflow that read it keep working and can never
disagree with the list underneath. **Existing rows are left exactly as they are**:
their count is what a crew actually answered, and back-filling names from today's
assignments would invent a roll-call for a Schadenplatz that is long closed.

The downgrade drops the two columns; the counts survive, which is all the old
shape could ever hold.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d3b8f1a70c25"
down_revision: str | Sequence[str] | None = "a1c4d8e93f27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "schadenplatz_reports",
        sa.Column("personnel_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "schadenplatz_reports",
        sa.Column("extra_personnel_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("schadenplatz_reports", "extra_personnel_json")
    op.drop_column("schadenplatz_reports", "personnel_json")
