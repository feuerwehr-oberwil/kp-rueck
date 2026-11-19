"""personnel.guest_event_id: a walk-in belongs to one Ereignis, not the roster

Revision ID: f2be867876f4
Revises: c4e8a2f6d9b1
Create Date: 2026-11-19 00:00:00.000000

«Person hinzufügen» in the Appell, on the check-in link and in the Fahrer picker used to
create a permanent roster row: a helper who turned up once stood in Settings ≫ Personal
and in every later Ereignis for ever (feedback 19.11.2026, #5). Such a person is now a
GUEST of the Ereignis it was added in: listed there with the roster, nowhere else. The row
is kept (rapport, history and audit still resolve the name) and goes with its Ereignis
when that is deleted. Existing rows stay roster – nothing tells a past walk-in apart.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f2be867876f4"
down_revision: str | Sequence[str] | None = "c4e8a2f6d9b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "personnel",
        sa.Column(
            "guest_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE", name="fk_personnel_guest_event_id_events"),
            nullable=True,
        ),
    )
    op.create_index("idx_personnel_guest_event_id", "personnel", ["guest_event_id"])


def downgrade() -> None:
    op.drop_index("idx_personnel_guest_event_id", table_name="personnel")
    op.drop_column("personnel", "guest_event_id")
