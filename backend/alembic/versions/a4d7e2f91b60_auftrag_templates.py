"""Standard-Aufträge (Auftrag templates)

Two new tables, nothing touched. A station that never opens the new settings
section upgrades into "no templates", which behaves exactly like today: creating
an event still produces a board with zero Aufträge.

Revision ID: a4d7e2f91b60
Revises: d3b8f1a70c25
Create Date: 2026-08-16 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision: str = "a4d7e2f91b60"
down_revision: str | None = "d3b8f1a70c25"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auftrag_templates",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("auto_create", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_auftrag_templates_position", "auftrag_templates", ["position"])

    op.create_table(
        "auftrag_template_resources",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "template_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("auftrag_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("resource_type", sa.String(length=20), nullable=False),
        sa.Column("resource_id", PG_UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint("resource_type IN ('vehicle', 'material')", name="valid_template_resource_type"),
    )
    op.create_index("ix_auftrag_template_resources_template_id", "auftrag_template_resources", ["template_id"])
    op.create_index(
        "uq_template_resource",
        "auftrag_template_resources",
        ["template_id", "resource_type", "resource_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_template_resource", table_name="auftrag_template_resources")
    op.drop_index("ix_auftrag_template_resources_template_id", table_name="auftrag_template_resources")
    op.drop_table("auftrag_template_resources")
    op.drop_index("idx_auftrag_templates_position", table_name="auftrag_templates")
    op.drop_table("auftrag_templates")
