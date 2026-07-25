"""Telemetry outbox (opt-in error reports)

Additive only, and the additive-ness is the point: consent lives in the existing key/value
``settings`` table and no row is written here, so every existing deployment upgrades into "off".
The station has to click something first.

Revision ID: f8c2d4a6b1e3
Revises: e7b3c1a9f2d5
Create Date: 2026-07-25 19:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision: str = "f8c2d4a6b1e3"
down_revision: str | None = "e7b3c1a9f2d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "telemetry_outbox",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("payload_json", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error", sa.String(length=200), nullable=True),
    )
    op.create_index("ix_telemetry_outbox_pending", "telemetry_outbox", ["sent_at", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_telemetry_outbox_pending", table_name="telemetry_outbox")
    op.drop_table("telemetry_outbox")
