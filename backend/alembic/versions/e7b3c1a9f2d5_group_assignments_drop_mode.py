"""add incident_group_assignments and drop incident_groups.mode

Revision ID: e7b3c1a9f2d5
Revises: d7c9e1f3a2b4
Create Date: 2026-07-21 23:30:00.000000

Resources now belong to the Auftrag (incident_group) itself and are shared across
all of its stops — even when it has zero stops. This adds the route-level
assignment junction table (mirroring incident_assignments) and drops the now-unused
squad/vehicle_only ``mode`` column (the shuttle "mode" concept is gone; the
copy-squad mechanism it drove is replaced by direct group assignment).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7b3c1a9f2d5"
down_revision: str | Sequence[str] | None = "d7c9e1f3a2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add route-level assignments; drop the Auftrag ``mode`` column."""
    op.create_table(
        "incident_group_assignments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("incident_group_id", sa.UUID(), nullable=False),
        sa.Column("resource_type", sa.String(length=20), nullable=False),
        sa.Column("resource_id", sa.UUID(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("assigned_by", sa.UUID(), nullable=True),
        sa.Column("unassigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("driver_stay", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.CheckConstraint("resource_type IN ('personnel', 'vehicle', 'material')", name="valid_resource_type"),
        sa.ForeignKeyConstraint(["incident_group_id"], ["incident_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "incident_group_id",
            "resource_type",
            "resource_id",
            "unassigned_at",
            name="unique_group_assignment",
        ),
    )
    op.create_index("idx_group_assignments_group", "incident_group_assignments", ["incident_group_id"])
    op.create_index("idx_group_assignments_resource", "incident_group_assignments", ["resource_type", "resource_id"])
    op.create_index("idx_group_assignments_resource_id", "incident_group_assignments", ["resource_id"])
    op.create_index("idx_group_assignments_unassigned", "incident_group_assignments", ["unassigned_at"])
    op.create_index(
        "idx_group_assignments_group_active",
        "incident_group_assignments",
        ["incident_group_id", "resource_type", "unassigned_at"],
    )

    # Drop the squad/vehicle_only mode (and its check) — the concept is removed.
    op.drop_constraint("valid_group_mode", "incident_groups", type_="check")
    op.drop_column("incident_groups", "mode")


def downgrade() -> None:
    """Re-add the Auftrag ``mode`` column; drop route-level assignments."""
    op.add_column(
        "incident_groups",
        sa.Column("mode", sa.String(length=20), server_default="squad", nullable=False),
    )
    op.create_check_constraint(
        "valid_group_mode",
        "incident_groups",
        "mode IN ('squad', 'vehicle_only')",
    )

    op.drop_index("idx_group_assignments_group_active", table_name="incident_group_assignments")
    op.drop_index("idx_group_assignments_unassigned", table_name="incident_group_assignments")
    op.drop_index("idx_group_assignments_resource_id", table_name="incident_group_assignments")
    op.drop_index("idx_group_assignments_resource", table_name="incident_group_assignments")
    op.drop_index("idx_group_assignments_group", table_name="incident_group_assignments")
    op.drop_table("incident_group_assignments")
