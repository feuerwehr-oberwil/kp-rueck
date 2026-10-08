"""journal_entries: the per-Ereignis Einsatztagebuch as an append-only log (idea R8)

Revision ID: d5f1a7c3e9b2
Revises: c4e8a2f61d97
Create Date: 2026-10-08 00:00:00.000000

Until now the Einsatztagebuch existed only as a PDF chapter, assembled at print time from
status transitions, assignments, Reko reports and three audit actions. Two problems: the
audit rows are swept after AUDIT_RETENTION_DAYS (so a Divera alarm and every Meldung vom
Feld fell out of an old Ereignis' record), and there was nowhere to write the lines that
belong to no card («Gemeindepräsident informiert»).

From here on `services/journal.py` writes the rows as the facts happen. This migration
BACKFILLS the same rows from what the database holds today, so the PDF of an existing
Ereignis — which now reads only this table — keeps every line it printed before, plus the
Meldungen and field notifications it never showed. Field Meldungen whose audit rows were
already swept are gone; nothing can bring them back.

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


_USER_NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)"

_RESOURCE_NAME = """
    CASE a.resource_type
        WHEN 'personnel' THEN COALESCE(p.name, a.resource_id::text)
        WHEN 'vehicle' THEN COALESCE(
            CASE WHEN COALESCE(v.radio_call_sign, '') <> '' THEN v.name || ' (' || v.radio_call_sign || ')'
                 ELSE v.name END,
            a.resource_id::text)
        WHEN 'material' THEN COALESCE(m.name, a.resource_id::text)
        ELSE a.resource_id::text
    END
"""

_ASSIGNMENT_JOINS = """
    FROM incident_assignments a
    JOIN incidents i ON i.id = a.incident_id
    LEFT JOIN personnel p ON a.resource_type = 'personnel' AND p.id = a.resource_id
    LEFT JOIN vehicles v ON a.resource_type = 'vehicle' AND v.id = a.resource_id
    LEFT JOIN materials m ON a.resource_type = 'material' AND m.id = a.resource_id
    LEFT JOIN users u ON u.id = a.assigned_by
"""

_INSERT = (
    "INSERT INTO journal_entries "
    "(id, event_id, incident_id, kind, text, data, occurred_at, author_name, created_by, source_key) "
)

BACKFILL: tuple[str, ...] = (
    # Einsatz erstellt
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'incident', NULL,
           jsonb_build_object('action', 'created', 'title', i.title, 'source', i.source),
           i.created_at, LEFT({_USER_NAME}, 100), i.created_by, 'incident:' || i.id || ':created'
    FROM incidents i LEFT JOIN users u ON u.id = i.created_by
    WHERE i.created_at IS NOT NULL
    """,
    # Status
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'status', NULL,
           jsonb_build_object('from_status', t.from_status, 'to_status', t.to_status),
           t.timestamp, LEFT({_USER_NAME}, 100), t.user_id, 'status:' || t.id
    FROM status_transitions t
    JOIN incidents i ON i.id = t.incident_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.timestamp IS NOT NULL AND t.from_status <> t.to_status
    """,
    # zugeteilt
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'assignment', NULL,
           jsonb_build_object('action', 'assigned', 'resource_type', a.resource_type,
                              'resource_name', {_RESOURCE_NAME}),
           a.assigned_at, LEFT({_USER_NAME}, 100), a.assigned_by,
           'assign:' || a.id || ':' || floor(extract(epoch FROM a.assigned_at) * 1000)::bigint
    {_ASSIGNMENT_JOINS}
    WHERE a.assigned_at IS NOT NULL
    """,
    # vom Einsatz abgezogen
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'assignment', NULL,
           jsonb_build_object('action', 'unassigned', 'resource_type', a.resource_type,
                              'resource_name', {_RESOURCE_NAME}),
           a.unassigned_at, NULL, NULL,
           'unassign:' || a.id || ':' || floor(extract(epoch FROM a.unassigned_at) * 1000)::bigint
    {_ASSIGNMENT_JOINS}
    WHERE a.unassigned_at IS NOT NULL
    """,
    # Reko-Bericht eingegangen (filed only)
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'reko', NULLIF(btrim(r.summary_text), ''),
           jsonb_build_object('relevant', r.is_relevant),
           r.submitted_at, LEFT(COALESCE(p.name, {_USER_NAME}), 100), NULL,
           'reko:' || r.id || ':' || floor(extract(epoch FROM r.submitted_at) * 1000)::bigint
    FROM reko_reports r
    JOIN incidents i ON i.id = r.incident_id
    LEFT JOIN personnel p ON p.id = r.submitted_by_personnel_id
    LEFT JOIN users u ON u.id = r.created_by_user_id
    WHERE NOT COALESCE(r.is_draft, false) AND r.submitted_at IS NOT NULL
    """,
    # Meldung an den Trupp
    _INSERT
    + """
    SELECT gen_random_uuid(), i.event_id, i.id, 'message', f.message,
           jsonb_build_object('direction', 'to_field'),
           f.created_at, f.author_name, f.created_by, 'kpmsg:' || f.id
    FROM incident_field_messages f
    JOIN incidents i ON i.id = f.incident_id
    """,
    # Meldung vom Feld (whatever the audit sweep has left)
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'message', btrim(l.changes_json->>'message'),
           jsonb_build_object('direction', 'from_field', 'source', l.changes_json->>'source'),
           l.timestamp, LEFT(COALESCE(NULLIF(l.changes_json->>'personnel_name', ''), {_USER_NAME}), 100),
           l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.resource_type = 'incident' AND l.action_type = 'field_message'
      AND COALESCE(btrim(l.changes_json->>'message'), '') <> ''
    """,
    # Divera-Alarm
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'alarm', NULL,
           jsonb_build_object('recipients',
               CASE WHEN jsonb_typeof(l.changes_json->'recipients') = 'array'
                    THEN jsonb_array_length(l.changes_json->'recipients') END),
           l.timestamp, LEFT({_USER_NAME}, 100), l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.resource_type = 'incident' AND l.action_type = 'divera_alarm'
    """,
    # Einsatz gelöscht / wiederhergestellt
    _INSERT
    + f"""
    SELECT gen_random_uuid(), i.event_id, i.id, 'incident', NULL,
           jsonb_build_object('action', CASE l.action_type WHEN 'delete' THEN 'deleted' ELSE 'restored' END,
                              'title', i.title),
           l.timestamp, LEFT({_USER_NAME}, 100), l.user_id, 'audit:' || l.id
    FROM audit_log l
    JOIN incidents i ON i.id = l.resource_id
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.resource_type = 'incident' AND l.action_type IN ('delete', 'restore')
    """,
    # Field notifications that report an event on the ground
    _INSERT
    + """
    SELECT gen_random_uuid(), COALESCE(n.event_id, i.event_id), n.incident_id, 'field', n.message,
           jsonb_build_object('type', n.type),
           n.created_at, NULL, NULL, 'notification:' || n.id
    FROM notifications n
    LEFT JOIN incidents i ON i.id = n.incident_id
    WHERE n.type IN ('field_arrived', 'field_complete', 'field_pickup', 'reko_arrived',
                     'vehicle_arrived', 'rapport_submitted')
      AND COALESCE(n.event_id, i.event_id) IS NOT NULL
    """,
)


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

    # Raw driver SQL: the source keys contain ':' (`incident:<id>:created`), which a
    # SQLAlchemy text() would read as bind parameters.
    bind = op.get_bind()
    for statement in BACKFILL:
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    op.drop_index("idx_journal_incident", table_name="journal_entries")
    op.drop_index("idx_journal_event_occurred", table_name="journal_entries")
    op.drop_table("journal_entries")
