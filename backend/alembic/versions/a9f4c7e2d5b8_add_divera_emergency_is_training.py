"""add is_training to divera_emergencies

Simulated Divera alarms injected by the Übungssteuerung land in the same pool
as real webhook/poll alarms so trainees practice the real intake workflow. The
flag keeps them apart: badge in the pool UI, excluded from auto-attach, and
only attachable to training events.

Revision ID: a9f4c7e2d5b8
Revises: b3d7f2a9c1e8
Create Date: 2026-07-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9f4c7e2d5b8"
down_revision: str | Sequence[str] | None = "b3d7f2a9c1e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "divera_emergencies",
        sa.Column("is_training", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "idx_divera_emergencies_is_training", "divera_emergencies", ["is_training"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_divera_emergencies_is_training", table_name="divera_emergencies")
    op.drop_column("divera_emergencies", "is_training")
