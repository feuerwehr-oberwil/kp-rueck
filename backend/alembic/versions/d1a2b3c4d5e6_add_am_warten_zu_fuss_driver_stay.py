"""add am_warten, zu_fuss, driver_stay fields

Revision ID: d1a2b3c4d5e6
Revises: c4d5e6f7g8h9
Create Date: 2026-03-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1a2b3c4d5e6"
down_revision: str | None = "c4d5e6f7g8h9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Am Warten flag on incidents (delayed emergency)
    op.add_column("incidents", sa.Column("am_warten", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("incidents", sa.Column("am_warten_note", sa.Text(), nullable=True))

    # Zu Fuss flag on incidents (personnel go by foot, not by vehicle)
    op.add_column("incidents", sa.Column("zu_fuss", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Driver stay flag on incident_assignments (should driver+car stay on scene)
    # Default false = driver returns (Rückkehr)
    op.add_column(
        "incident_assignments",
        sa.Column("driver_stay", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("incident_assignments", "driver_stay")
    op.drop_column("incidents", "zu_fuss")
    op.drop_column("incidents", "am_warten_note")
    op.drop_column("incidents", "am_warten")
