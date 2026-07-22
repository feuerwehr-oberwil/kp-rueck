"""add incident_groups (Aufträge) and incident.group_id/group_position

Revision ID: d7c9e1f3a2b4
Revises: f1a2b3c4d5e6
Create Date: 2026-07-21 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7c9e1f3a2b4"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add Aufträge (multi-stop routes) as a lightweight container over incidents.

    An Auftrag groups existing incidents into an ordered route for one squad.
    Each stop stays a first-class incident; the group carries only ordering +
    a squad/vehicle_only mode. `incidents.group_id` (SET NULL) + `group_position`
    make an incident a stop in at most one route.
    """
    op.create_table(
        "incident_groups",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=True),
        sa.Column("mode", sa.String(length=20), server_default="squad", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('squad', 'vehicle_only')", name="valid_group_mode"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_incident_groups_event_id", "incident_groups", ["event_id"])
    op.create_index("idx_incident_groups_event_position", "incident_groups", ["event_id", "position"])

    # Membership columns on incidents (a stop belongs to at most one route).
    op.add_column("incidents", sa.Column("group_id", sa.UUID(), nullable=True))
    op.add_column(
        "incidents",
        sa.Column("group_position", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_foreign_key(
        "incidents_group_id_fkey",
        "incidents",
        "incident_groups",
        ["group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_incidents_group_id", "incidents", ["group_id"])
    op.create_index("idx_incidents_group_position", "incidents", ["group_id", "group_position"])
    op.create_index(
        "uq_incidents_group_position_active",
        "incidents",
        ["group_id", "group_position"],
        unique=True,
        postgresql_where=sa.text("group_id IS NOT NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    """Drop the Aufträge feature schema."""
    op.drop_index("uq_incidents_group_position_active", table_name="incidents")
    op.drop_index("idx_incidents_group_position", table_name="incidents")
    op.drop_index("ix_incidents_group_id", table_name="incidents")
    op.drop_constraint("incidents_group_id_fkey", "incidents", type_="foreignkey")
    op.drop_column("incidents", "group_position")
    op.drop_column("incidents", "group_id")

    op.drop_index("idx_incident_groups_event_position", table_name="incident_groups")
    op.drop_index("ix_incident_groups_event_id", table_name="incident_groups")
    op.drop_table("incident_groups")
