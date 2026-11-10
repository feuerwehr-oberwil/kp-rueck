"""standby two-way: who leads an Ereignis, and what both systems changed at once

Revision ID: 568e14cea8c5
Revises: c3d9a1e7f2b5
Create Date: 2026-11-09 00:00:00.000000

A standby box no longer cuts an Ereignis off for good when it takes it over: its work goes to
the hosted board as soon as that answers, and the hosted board can take it back
(app/standby_sync.py, docs/STANDBY.md). `event_leads` says which system leads; `event_conflicts`
keeps the version that lost when both changed the same thing. Both tables start empty and stay
empty on a board without a standby box.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "568e14cea8c5"
down_revision: str | Sequence[str] | None = "c3d9a1e7f2b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event_leads",
        sa.Column("event_id", UUID(as_uuid=True), sa.ForeignKey("events.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("holder", sa.String(16), nullable=False),
        sa.Column("since", sa.DateTime(timezone=True), nullable=False),
        sa.Column("taken_by", sa.String(255), nullable=True),
        sa.CheckConstraint("holder IN ('hosted', 'standby')", name="valid_event_lead_holder"),
    )
    op.create_table(
        "event_conflicts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", UUID(as_uuid=True), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("table_name", sa.String(64), nullable=False),
        sa.Column("row_id", UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("kept_on", sa.String(16), nullable=False),
        sa.Column("deleted_on", sa.String(16), nullable=True),
        sa.Column("columns", JSONB(), nullable=True),
        sa.Column("row", JSONB(), nullable=True),
        sa.Column("subject", JSONB(), nullable=True),
        sa.Column("lost_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.String(255), nullable=True),
        sa.Column("resolution", sa.String(16), nullable=True),
        sa.CheckConstraint("kind IN ('field', 'deleted', 'duplicate')", name="valid_event_conflict_kind"),
        sa.CheckConstraint(
            "resolution IS NULL OR resolution IN ('kept', 'other', 'both')", name="valid_conflict_resolution"
        ),
    )
    op.create_index("ix_event_conflicts_event_id", "event_conflicts", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_event_conflicts_event_id", table_name="event_conflicts")
    op.drop_table("event_conflicts")
    op.drop_table("event_leads")
