"""Incident field messages — KP → Trupp (sweep 27 §P3.2)

The mirror of the crew's «Meldung vom Feld»: a short, timestamped sentence the KP
sends to the squad at one Schadenplatz. Additive only.

Revision ID: 7b579524a5fd
Revises: a7f2c9e14b83
Create Date: 2026-08-19 18:21:43.300798
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision: str = "7b579524a5fd"
down_revision: str | None = "a7f2c9e14b83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "incident_field_messages",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column("incident_id", PG_UUID(as_uuid=True), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("author_name", sa.String(length=100), nullable=False),
        sa.Column("created_by", PG_UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_incident_field_messages_incident", "incident_field_messages", ["incident_id"])


def downgrade() -> None:
    op.drop_index("idx_incident_field_messages_incident", table_name="incident_field_messages")
    op.drop_table("incident_field_messages")
