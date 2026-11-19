"""incident_assignments.reko_position: a Reko person's Rekos have an order

Revision ID: a7d3c9e1f5b2
Revises: f2be867876f4
Create Date: 2026-11-19 12:00:00.000000

The Reko-Modus on the map lets the KP put a Reko person's open Rekos in order, like the
stops of an Auftrag (feedback 19.11.2026, #19): the pins carry the number, a dotted line
joins them, and /feld lists them in that order. The order lives on the assignment row.
Active Reko rows are numbered per person and Ereignis in the order they were assigned,
so nothing jumps on the first look after the update.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7d3c9e1f5b2"
down_revision: str | Sequence[str] | None = "f2be867876f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("incident_assignments", sa.Column("reko_position", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE incident_assignments AS ia
        SET reko_position = ranked.rn - 1
        FROM (
            SELECT a.id,
                   row_number() OVER (
                       PARTITION BY a.resource_id, i.event_id ORDER BY a.assigned_at, a.id
                   ) AS rn
            FROM incident_assignments AS a
            JOIN incidents AS i ON i.id = a.incident_id
            WHERE a.purpose = 'reko'
              AND a.resource_type = 'personnel'
              AND a.unassigned_at IS NULL
        ) AS ranked
        WHERE ia.id = ranked.id
        """
    )


def downgrade() -> None:
    op.drop_column("incident_assignments", "reko_position")
