"""field_requests: every Meldung from /feld becomes a workable item (R13)

Revision ID: d9a4e7c21f05
Revises: c4e8a2f61d97
Create Date: 2026-10-08 00:00:00.000000

A crew's Meldung used to be a bell entry plus an audit row; dismissing the bell
was the only "handling" there was. One row per request now carries a state
(open → in_progress → done, with who/when) that the card, the detail and the
notification sidebar all read, and that `/feld` reads back to the crew.

Additive only. An open Abholung on an existing incident gets its work item
backfilled, so the sidebar does not start out missing the one field request
that is time-critical; historical Meldungen stay what they were (audit rows) —
inventing "open" items for every sentence ever sent would bury the board.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision: str = "d9a4e7c21f05"
down_revision: str | Sequence[str] | None = "c4e8a2f61d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "field_requests",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column("incident_id", PG_UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="open", nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("item", sa.String(length=120), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("created_by_personnel_id", PG_UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_user_id", PG_UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_name", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("notification_id", PG_UUID(as_uuid=True), nullable=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("in_progress_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("in_progress_by_name", sa.String(length=100), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_by_user_id", PG_UUID(as_uuid=True), nullable=True),
        sa.Column("done_by_name", sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_personnel_id"], ["personnel.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["notification_id"], ["notifications.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["done_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("kind IN ('message', 'material', 'personnel', 'pickup')", name="valid_field_request_kind"),
        sa.CheckConstraint("status IN ('open', 'in_progress', 'done')", name="valid_field_request_status"),
    )
    op.create_index("idx_field_requests_incident", "field_requests", ["incident_id"])
    op.create_index("idx_field_requests_status", "field_requests", ["status"])

    # The open Abholungen that exist right now get their work item.
    op.execute(
        """
        INSERT INTO field_requests (id, incident_id, kind, status, text, created_by_personnel_id,
                                    created_by_name, created_at)
        SELECT gen_random_uuid(), i.id, 'pickup', 'open', i.pickup_note, i.pickup_requested_by,
               p.name, COALESCE(i.pickup_requested_at, now())
        FROM incidents i
        LEFT JOIN personnel p ON p.id = i.pickup_requested_by
        WHERE i.pickup_needed IS TRUE
        """
    )


def downgrade() -> None:
    op.drop_index("idx_field_requests_status", table_name="field_requests")
    op.drop_index("idx_field_requests_incident", table_name="field_requests")
    op.drop_table("field_requests")
