"""One live Reko report per incident, with a change history (owner pick 23.11.2026, #6).

Until now every form link filed its own report, and a new link opened a new draft
prefilled from the newest filed one. From here on an incident has ONE report that the
field and the KP edit together; each saved change is a row in `reko_report_changes`.

The fold, per incident that has more than one report:

* **kept**: the newest FILED report (by `submitted_at`, then `updated_at`); without a
  filed one, the newest draft. Its answers and its provenance stay as they are – a newer
  report was prefilled from the older one, so it already carries what the older said.
* **photos**: every photo of the other rows that the kept one does not list is appended,
  so no picture drops out of the report – except a draft's photos onto a filed kept
  report: a filed report's photos are what a /display share link may open, and a draft's
  were never shared. Those stay in `reko_reports_folded` only (the downgrade restores them).
* **arrival**: the earliest `arrived_at` of all rows (and its author), which is what the
  board showed before.
* the other rows are deleted. Every row of a folded incident, the kept one as it was
  before the fold included, is parked in `reko_reports_folded` (`to_jsonb` of the row):
  the downgrade puts them back from there, so up/down loses nothing. The downgrade
  restores the rows as they were before the upgrade: a change made after it is not carried
  back.

`updated_by_user_at` is new: «Ergänzt im KP durch … um …» needs the KP's own time now
that the field's edits also move `updated_at`. Backfilled from `updated_at` where a KP
user amended.

`submitted_by_user_id` is new: the operator whose save filed the report – with one report
per incident, whoever opened the draft is not who filed it. Backfilled from
`created_by_user_id` on filed reports no crew filed (until now one person did both).

Revision ID: c4f1a7e2d9b3
Revises: c4f7a2e9d1b3
"""

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c4f1a7e2d9b3"
down_revision = "c4f7a2e9d1b3"
branch_labels = None
depends_on = None


def _fold_reports(bind: sa.Connection) -> None:
    """Keep one report per incident (module docstring); park every row of a folded incident."""
    bind.execute(
        sa.text(
            """
            INSERT INTO reko_reports_folded (id, incident_id, kept, row_json, folded_at)
            SELECT r.id, r.incident_id, ranked.rn = 1, to_jsonb(r), now()
            FROM reko_reports r
            JOIN (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY incident_id
                           ORDER BY is_draft ASC, submitted_at DESC, updated_at DESC, id
                       ) AS rn,
                       count(*) OVER (PARTITION BY incident_id) AS n
                FROM reko_reports
            ) ranked ON ranked.id = r.id
            WHERE ranked.n > 1
            """
        )
    )
    rows = bind.execute(
        sa.text(
            """
            SELECT r.id, r.incident_id, f.kept, r.is_draft, r.photos_json, r.arrived_at,
                   r.arrived_reported_by_user_id, r.submitted_at
            FROM reko_reports r JOIN reko_reports_folded f ON f.id = r.id
            ORDER BY r.incident_id, r.submitted_at
            """
        )
    ).all()
    by_incident: dict[object, list[sa.Row]] = {}
    for row in rows:
        by_incident.setdefault(row.incident_id, []).append(row)

    for group in by_incident.values():
        kept = next(row for row in group if row.kept)
        others = [row for row in group if not row.kept]
        photos = list(kept.photos_json or [])
        # A filed report's photos are share-visible; a draft's never were (docstring).
        sources = others if kept.is_draft else [row for row in others if not row.is_draft]
        for row in sources:  # oldest first: a later photo stays later
            photos.extend(name for name in (row.photos_json or []) if name not in photos)
        arrivals = [row for row in group if row.arrived_at is not None]
        first_arrival = min(arrivals, key=lambda row: row.arrived_at) if arrivals else None
        bind.execute(
            sa.text(
                """
                UPDATE reko_reports
                SET photos_json = CAST(:photos AS jsonb),
                    arrived_at = :arrived_at,
                    arrived_reported_by_user_id = :arrived_by
                WHERE id = :id
                """
            ),
            {
                "id": kept.id,
                "photos": json.dumps(photos),
                "arrived_at": first_arrival.arrived_at if first_arrival else None,
                "arrived_by": first_arrival.arrived_reported_by_user_id if first_arrival else None,
            },
        )
        bind.execute(
            sa.text("DELETE FROM reko_reports WHERE id = ANY(:ids)"),
            {"ids": [row.id for row in others]},
        )


def upgrade() -> None:
    op.create_table(
        "reko_reports_folded",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kept", sa.Boolean(), nullable=False),
        sa.Column("row_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("folded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_reko_reports_folded_incident_id"), "reko_reports_folded", ["incident_id"], unique=False)

    _fold_reports(op.get_bind())

    op.drop_index("idx_reko_incident", table_name="reko_reports")
    op.create_index("uq_reko_reports_incident", "reko_reports", ["incident_id"], unique=True)

    op.add_column("reko_reports", sa.Column("updated_by_user_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE reko_reports SET updated_by_user_at = updated_at WHERE updated_by_user_id IS NOT NULL")
    op.add_column("reko_reports", sa.Column("submitted_by_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_reko_reports_submitted_by_user_id",
        "reko_reports",
        "users",
        ["submitted_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        "UPDATE reko_reports SET submitted_by_user_id = created_by_user_id"
        " WHERE NOT is_draft AND submitted_by_personnel_id IS NULL"
    )

    op.create_table(
        "reko_report_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field", sa.String(length=40), nullable=False),
        sa.Column("old_value", postgresql.JSONB(none_as_null=True, astext_type=sa.Text()), nullable=True),
        sa.Column("new_value", postgresql.JSONB(none_as_null=True, astext_type=sa.Text()), nullable=True),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("personnel_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["personnel_id"], ["personnel.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["report_id"], ["reko_reports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_reko_changes_report_field", "reko_report_changes", ["report_id", "field", "changed_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("idx_reko_changes_report_field", table_name="reko_report_changes")
    op.drop_table("reko_report_changes")

    op.drop_index("uq_reko_reports_incident", table_name="reko_reports")
    op.create_index("idx_reko_incident", "reko_reports", ["incident_id"], unique=False)

    # The kept rows get their own photos and arrival back, the folded ones return as they were.
    op.execute(
        """
        UPDATE reko_reports r
        SET photos_json = f.row_json -> 'photos_json',
            arrived_at = (f.row_json ->> 'arrived_at')::timestamptz,
            arrived_reported_by_user_id = (f.row_json ->> 'arrived_reported_by_user_id')::uuid
        FROM reko_reports_folded f
        WHERE f.id = r.id AND f.kept
        """
    )
    op.drop_constraint("fk_reko_reports_submitted_by_user_id", "reko_reports", type_="foreignkey")
    op.drop_column("reko_reports", "submitted_by_user_id")
    op.drop_column("reko_reports", "updated_by_user_at")
    op.execute(
        """
        INSERT INTO reko_reports
        SELECT (jsonb_populate_record(NULL::reko_reports, f.row_json)).*
        FROM reko_reports_folded f
        WHERE NOT f.kept AND NOT EXISTS (SELECT 1 FROM reko_reports r WHERE r.id = f.id)
        """
    )

    op.drop_index(op.f("ix_reko_reports_folded_incident_id"), table_name="reko_reports_folded")
    op.drop_table("reko_reports_folded")
