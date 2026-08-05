"""add Einsatzleiter flag to incident and route assignments

Revision ID: c3f8a1d29b47
Revises: b4d7e1f9a2c8
Create Date: 2026-08-05 16:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f8a1d29b47"
down_revision: str | Sequence[str] | None = "b4d7e1f9a2c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Mark one assignment per incident (or per Auftrag) as the Einsatzleiter.

    The role lives on the assignment rather than on the incident so it can never
    name someone who is not actually assigned, and so releasing that person
    clears the role without a second write. An Auftrag's stops own no resources
    of their own, so a stop takes its leader from the route's assignments.

    The partial unique indexes are what make "one leader" a fact rather than a
    convention: two editors promoting different people at the same moment would
    otherwise both succeed and leave the board showing two leaders.
    """
    for table in ("incident_assignments", "incident_group_assignments"):
        op.add_column(
            table,
            sa.Column("is_leader", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    op.create_index(
        "uq_assignments_single_leader",
        "incident_assignments",
        ["incident_id"],
        unique=True,
        postgresql_where=sa.text("is_leader AND unassigned_at IS NULL"),
    )
    op.create_index(
        "uq_group_assignments_single_leader",
        "incident_group_assignments",
        ["incident_group_id"],
        unique=True,
        postgresql_where=sa.text("is_leader AND unassigned_at IS NULL"),
    )


def downgrade() -> None:
    """Drop the flag. Which assignment was the leader is not recoverable."""
    op.drop_index("uq_group_assignments_single_leader", table_name="incident_group_assignments")
    op.drop_index("uq_assignments_single_leader", table_name="incident_assignments")
    for table in ("incident_group_assignments", "incident_assignments"):
        op.drop_column(table, "is_leader")
