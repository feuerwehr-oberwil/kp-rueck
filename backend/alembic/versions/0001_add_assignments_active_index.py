"""add compound index for active assignments

Revision ID: 0001_active_idx
Revises: fccf2c43febf
Create Date: 2026-01-22

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_active_idx"
down_revision: str | None = "1fab06fcd242"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add compound index for finding active assignments by incident."""
    op.create_index(
        "idx_assignments_incident_active",
        "incident_assignments",
        ["incident_id", "resource_type", "unassigned_at"],
        unique=False,
    )


def downgrade() -> None:
    """Remove the compound index."""
    op.drop_index("idx_assignments_incident_active", table_name="incident_assignments")
