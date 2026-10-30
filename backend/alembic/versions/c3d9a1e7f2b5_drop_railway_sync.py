"""drop the Railway ↔ local sync: its log table and its four settings

Revision ID: c3d9a1e7f2b5
Revises: bff3241e12af
Create Date: 2026-10-30 00:00:00.000000

The two-way sync (services/sync_service.py) is gone: it needed a write credential to the hosted
database on the local box, skipped every settings row, and dropped Einsätze whose creator or
Auftrag did not exist locally without a word. Its run history and its settings go with it.
A standby box now follows the hosted board one way (docs/STANDBY.md).

Downgrade recreates the empty table and the default settings; the old history and a configured
`railway_database_url` are not restored.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "c3d9a1e7f2b5"
down_revision: str | Sequence[str] | None = "bff3241e12af"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SYNC_SETTINGS = {
    "sync_interval_minutes": "2",
    "auto_sync_on_create": "true",
    "railway_database_url": "",
    "sync_conflict_buffer_seconds": "5",
}


def upgrade() -> None:
    op.drop_index("idx_sync_log_status", table_name="sync_log")
    op.drop_index("idx_sync_log_started_at", table_name="sync_log")
    op.drop_table("sync_log")
    op.get_bind().execute(
        sa.text("DELETE FROM settings WHERE key IN :keys").bindparams(sa.bindparam("keys", expanding=True)),
        {"keys": list(SYNC_SETTINGS)},
    )


def downgrade() -> None:
    op.create_table(
        "sync_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("sync_direction", sa.String(20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("records_synced", JSONB, nullable=True),
        sa.Column("errors", JSONB, nullable=True),
        sa.CheckConstraint("sync_direction IN ('from_railway', 'to_railway')", name="valid_sync_direction"),
        sa.CheckConstraint("status IN ('success', 'failed', 'partial', 'in_progress')", name="valid_sync_status"),
    )
    op.create_index("idx_sync_log_started_at", "sync_log", ["started_at"])
    op.create_index("idx_sync_log_status", "sync_log", ["status"])
    bind = op.get_bind()
    for key, value in SYNC_SETTINGS.items():
        bind.execute(
            sa.text("INSERT INTO settings (key, value) VALUES (:k, :v) ON CONFLICT (key) DO NOTHING"),
            {"k": key, "v": value},
        )
