"""Record what a completion released, so reopening can put it back

Completing an incident auto-releases the whole crew and every vehicle. Cancelling
the completion gate (or reopening the incident later) reverted the status and
nothing else, so the incident came back with an empty card. Restoring needs a
transition-scoped record of the rows that particular completion closed.

Revision ID: e2a6b40d7f19
Revises: b3d9f6072ac4
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e2a6b40d7f19"
down_revision: str | Sequence[str] | None = "b3d9f6072ac4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "status_transitions",
        sa.Column("released_assignments_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("status_transitions", "released_assignments_json")
