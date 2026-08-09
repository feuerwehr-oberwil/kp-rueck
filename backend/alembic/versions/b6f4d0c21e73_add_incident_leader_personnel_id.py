"""add incidents.leader_personnel_id (leader of record)

Revision ID: b6f4d0c21e73
Revises: a3e7c1b95d20
Create Date: 2026-08-09 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b6f4d0c21e73"
down_revision: str | Sequence[str] | None = "a3e7c1b95d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Remember who led a Schadenplatz after the crew has gone home.

    `incident_assignments.is_leader` is a property of one *active* row and is
    cleared on release — deliberately, because completing an incident releases
    the crew one at a time and each release promotes the next person, so a
    released row keeping the flag would end with everybody flagged as having
    led. The consequence is that a finished incident has no leader anywhere,
    which is precisely the state it is in when /feld shows it, when the event
    report PDF renders it and when the Lageblatt prints it.

    This column is the leader OF RECORD: stamped when a leader is genuinely
    chosen, frozen from the active leader immediately before the completion
    cascade releases anyone, never touched by that cascade's promotions.

    NO BACKFILL. Existing completed incidents have no recoverable leader:
    every assignment row was cleared on release and reconstructing a guess from
    the audit log would produce a record that looks authoritative and is not.
    They stay NULL, and the readers fall back to "kein EL erfasst" for them —
    the same sentence they already show for an incident nobody led.

    Third FK from `incidents` to `personnel` (after field_complete_reported_by
    and pickup_requested_by). ON DELETE SET NULL: retiring a person from the
    roster must never delete an incident.
    """
    op.add_column(
        "incidents",
        sa.Column("leader_personnel_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_incidents_leader_personnel_id",
        "incidents",
        "personnel",
        ["leader_personnel_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Drop the column. The record it held is not recoverable afterwards."""
    op.drop_constraint("fk_incidents_leader_personnel_id", "incidents", type_="foreignkey")
    op.drop_column("incidents", "leader_personnel_id")
