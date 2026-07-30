"""Personal heisst jetzt auch status

``Vehicle.status``, ``Material.status`` und ``Personnel.availability`` sind dasselbe
Konzept mit demselben Wertebereich — «im Dienst / nicht im Dienst». Die *Zuteilung*
läuft bei allen dreien über ``incident_assignments`` und fasst das Basisfeld nicht an.
Personal war grundlos das einzige mit einem anderen Namen.

Es ist eine reine Umbenennung: die Spalte wird umbenannt, nicht neu angelegt, damit
keine Zeile ihren Wert verliert. Postgres schreibt die beiden Check-Bedingungen beim
``RENAME COLUMN`` selbst auf den neuen Spaltennamen um; hier werden nur noch deren
Namen und der Indexname nachgezogen, damit nichts mehr «availability» heisst.

Revision ID: a7d3f1c9b2e4
Revises: c4a1e8b3d9f2
Create Date: 2026-07-30 10:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a7d3f1c9b2e4"
down_revision: str | None = "c4a1e8b3d9f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rename personnel.availability to personnel.status (values untouched)."""
    op.alter_column("personnel", "availability", new_column_name="status")
    op.execute("ALTER TABLE personnel RENAME CONSTRAINT valid_personnel_availability TO valid_personnel_status")
    op.execute("ALTER TABLE personnel RENAME CONSTRAINT valid_checkin_availability TO valid_checkin_status")
    op.execute("ALTER INDEX idx_personnel_availability RENAME TO idx_personnel_status")


def downgrade() -> None:
    """Rename personnel.status back to personnel.availability."""
    op.execute("ALTER INDEX idx_personnel_status RENAME TO idx_personnel_availability")
    op.execute("ALTER TABLE personnel RENAME CONSTRAINT valid_checkin_status TO valid_checkin_availability")
    op.execute("ALTER TABLE personnel RENAME CONSTRAINT valid_personnel_status TO valid_personnel_availability")
    op.alter_column("personnel", "status", new_column_name="availability")
