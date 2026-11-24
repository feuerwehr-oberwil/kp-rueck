"""planned_assignments: the «Danach» of a resource (Jetzt / Danach, 24.11.2026)

Revision ID: d4a7c1e9b2f6
Revises: b8e4f2a6c1d7
Create Date: 2026-11-24 00:00:00.000000

Owner pick 1B: an assignment is Jetzt (incident_assignments / incident_group_assignments) or
Danach (this table) – a resource planned for an Einsatz or an Auftrag after its current work.
A queue per resource, ordered by planned_at. Nothing existing changes: rows already double-booked
stay as they are, the «Jetzt on one only» rule applies to new assignments (crud/assignments.py).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d4a7c1e9b2f6"
down_revision: str | Sequence[str] | None = "b8e4f2a6c1d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "planned_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "incident_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("incidents.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "incident_group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("incident_groups.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("resource_type", sa.String(20), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("planned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("planned_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("resource_type IN ('personnel', 'vehicle', 'material')", name="valid_resource_type"),
        sa.CheckConstraint("(incident_id IS NULL) <> (incident_group_id IS NULL)", name="planned_one_holder"),
        sa.UniqueConstraint("incident_id", "resource_type", "resource_id", name="uq_planned_incident_resource"),
        sa.UniqueConstraint("incident_group_id", "resource_type", "resource_id", name="uq_planned_group_resource"),
    )
    op.create_index("idx_planned_resource_queue", "planned_assignments", ["resource_type", "resource_id", "planned_at"])
    op.create_index("idx_planned_event", "planned_assignments", ["event_id"])


def downgrade() -> None:
    op.drop_index("idx_planned_event", table_name="planned_assignments")
    op.drop_index("idx_planned_resource_queue", table_name="planned_assignments")
    op.drop_table("planned_assignments")
