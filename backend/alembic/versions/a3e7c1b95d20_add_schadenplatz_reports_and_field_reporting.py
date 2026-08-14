"""add schadenplatz_reports and field reporting

Revision ID: a3e7c1b95d20
Revises: d4a91c7e05b8
Create Date: 2026-08-08 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a3e7c1b95d20"
down_revision: str | Sequence[str] | None = "d4a91c7e05b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The notification-type vocabulary before and after this revision. Kept as literals
# so the migration stays readable after the model moves on again.
OLD_NOTIFICATION_TYPES = (
    "'time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
    "'missing_location', 'event_size_limit', 'reko_submitted', 'reko_arrived', "
    "'training_emergency', 'vehicle_arrived'"
)
NEW_NOTIFICATION_TYPES = (
    OLD_NOTIFICATION_TYPES + ", 'rapport_submitted', 'field_arrived', 'field_complete', 'field_message', 'field_pickup'"
)
ADDED_NOTIFICATION_TYPES = "'rapport_submitted', 'field_arrived', 'field_complete', 'field_message', 'field_pickup'"


def upgrade() -> None:
    """Give the field a place to report from, and the board a place to read it.

    Three things, one revision: the Schadenplatz-Rapport table (one row per
    incident, the digital fahrzeugrapport.pdf), the five incident columns the
    field actions write (who reported "Einsatz beendet", and the Abholung flag
    with its note and provenance), and five new notification types.
    """
    op.create_table(
        "schadenplatz_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Einsatzdaten
        sa.Column("damage_type", sa.String(length=20), nullable=True),
        sa.Column("damage_type_other", sa.Text(), nullable=True),
        sa.Column("work_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("work_ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("materials_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("extra_material_note", sa.Text(), nullable=True),
        # Kurzbericht
        sa.Column("kurzbericht", sa.Text(), nullable=True),
        sa.Column("handed_over_to", sa.Text(), nullable=True),
        # Eigentümer-/Halterdaten (citizen PII — deleted with the incident)
        sa.Column("owner_name", sa.String(length=200), nullable=True),
        sa.Column("owner_street", sa.String(length=200), nullable=True),
        sa.Column("owner_city", sa.String(length=200), nullable=True),
        sa.Column("vehicle_plate", sa.String(length=50), nullable=True),
        sa.Column("vehicle_model", sa.String(length=100), nullable=True),
        # Kostenpflicht
        sa.Column("personnel_count", sa.Integer(), nullable=True),
        sa.Column("personnel_count_corrected", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("vehicle_count", sa.Integer(), nullable=True),
        sa.Column("vehicle_count_corrected", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cost_snapshot_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        # Field actions that predate the form
        sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("photos_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        # Provenance: exactly one side of each pair is populated per write —
        # personnel for a /feld write, user for a KP write ("Funkmeldung").
        sa.Column("created_by_personnel_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_personnel_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        # True by default: the row is created by "Angekommen", before a form exists.
        sa.Column("is_draft", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_personnel_id"], ["personnel.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_personnel_id"], ["personnel.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("incident_id", name="uq_schadenplatz_report_incident"),
        sa.CheckConstraint(
            "damage_type IS NULL OR damage_type IN ('wasserschaden', 'sturmschaden', 'schneebruch', 'anderes')",
            name="valid_damage_type",
        ),
    )

    # Five incident columns. field_complete_reported_at already existed and had no
    # writer outside the training simulator; these give the field action a reporter
    # and add the Abholung flag, which deliberately survives `complete`.
    op.add_column(
        "incidents",
        sa.Column("field_complete_reported_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_incidents_field_complete_reported_by_personnel",
        "incidents",
        "personnel",
        ["field_complete_reported_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "incidents",
        sa.Column("pickup_needed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("incidents", sa.Column("pickup_note", sa.Text(), nullable=True))
    op.add_column("incidents", sa.Column("pickup_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "incidents",
        sa.Column("pickup_requested_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_incidents_pickup_requested_by_personnel",
        "incidents",
        "personnel",
        ["pickup_requested_by"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({NEW_NOTIFICATION_TYPES})")


def downgrade() -> None:
    """Drop the table, the five columns and the widened notification vocabulary."""
    # Rows carrying a new type have to go first, or the narrower constraint cannot
    # be applied and the downgrade fails halfway.
    op.execute(f"DELETE FROM notifications WHERE type IN ({ADDED_NOTIFICATION_TYPES})")
    op.drop_constraint("valid_notification_type", "notifications", type_="check")
    op.create_check_constraint("valid_notification_type", "notifications", f"type IN ({OLD_NOTIFICATION_TYPES})")

    op.drop_constraint("fk_incidents_pickup_requested_by_personnel", "incidents", type_="foreignkey")
    op.drop_column("incidents", "pickup_requested_by")
    op.drop_column("incidents", "pickup_requested_at")
    op.drop_column("incidents", "pickup_note")
    op.drop_column("incidents", "pickup_needed")
    op.drop_constraint("fk_incidents_field_complete_reported_by_personnel", "incidents", type_="foreignkey")
    op.drop_column("incidents", "field_complete_reported_by")

    op.drop_table("schadenplatz_reports")
