"""journal_entries: the per-Ereignis Einsatztagebuch as an append-only log (idea R8)

Revision ID: d5f1a7c3e9b2
Revises: c4e8a2f61d97
Create Date: 2026-10-08 00:00:00.000000

Until now the Einsatztagebuch existed only as a PDF chapter, assembled at print time from
status transitions, assignments, Reko reports and three audit actions. Two problems: the
audit rows are swept after AUDIT_RETENTION_DAYS (so a Divera alarm and every Meldung vom
Feld fell out of an old Ereignis' record), and there was nowhere to write the lines that
belong to no card («Gemeindepräsident informiert»).

From here on `services/journal.py` writes the rows as the facts happen. The boot after this
migration BACKFILLS the same rows from what the database holds today
(`services/journal_backfill.py`, idempotent, rerun on every boot), so the PDF of an existing
Ereignis — which now reads only this table — keeps every line it printed before, plus the
Meldungen and field facts it never showed. Field Meldungen whose audit rows were already
swept are gone; nothing can bring them back.

Downgrade drops the table — manual lines written since are lost with it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d5f1a7c3e9b2"
down_revision: str | Sequence[str] | None = "c4e8a2f61d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "journal_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "incident_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("incidents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("data", postgresql.JSONB(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("author_name", sa.String(100), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "corrects_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("journal_entries.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("client_id", sa.String(64), nullable=True),
        sa.Column("source_key", sa.String(120), nullable=True),
        sa.CheckConstraint(
            "kind IN ('manual', 'status', 'incident', 'assignment', 'message', 'field', 'reko', 'alarm')",
            name="valid_journal_kind",
        ),
        sa.CheckConstraint("kind = 'manual' OR corrects_id IS NULL", name="journal_only_manual_corrects"),
        sa.UniqueConstraint("seq", name="journal_entries_seq_key"),
        sa.UniqueConstraint("event_id", "client_id", name="uq_journal_event_client_id"),
    )
    op.create_index("idx_journal_event_occurred", "journal_entries", ["event_id", "occurred_at"])
    op.create_index("idx_journal_incident", "journal_entries", ["incident_id"])

    op.create_index("idx_journal_source_key", "journal_entries", ["source_key"])
    # No data here: `services/journal_backfill.py` fills the table on boot (and on every
    # later boot fills only what is missing) — one copy of the SQL, idempotent, and it also
    # catches what an old instance wrote during a rolling cutover.


def downgrade() -> None:
    op.drop_index("idx_journal_source_key", table_name="journal_entries")
    op.drop_index("idx_journal_incident", table_name="journal_entries")
    op.drop_index("idx_journal_event_occurred", table_name="journal_entries")
    op.drop_table("journal_entries")
