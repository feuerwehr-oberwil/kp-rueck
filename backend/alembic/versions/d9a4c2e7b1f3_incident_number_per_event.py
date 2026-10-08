"""incidents: a number per Ereignis («14»), assigned by the database

Revision ID: d9a4c2e7b1f3
Revises: c4e8a2f61d97
Create Date: 2026-10-08 00:00:00.000000

An incident had no handle shorter than its address. ⌘K now takes «14 tlf meier»
(assign TLF and Meier to Einsatz 14), so every incident gets a small number,
counted per Ereignis and shown on its card.

Existing rows are numbered in creation order per Ereignis, soft-deleted ones
included, so a number is never handed out twice within an Ereignis. New rows
are numbered by a BEFORE INSERT trigger – one place for every creation path
(the same SQL as ``app.models.INCIDENT_NUMBER_TRIGGER_SQL``, which installs it on
``create_all``).

Safe on existing data: the column is nullable and filled in the same
transaction; the trigger only fills a NULL number.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9a4c2e7b1f3"
down_revision: str | Sequence[str] | None = "c4e8a2f61d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy of `app.models.INCIDENT_NUMBER_TRIGGER_SQL` as of this revision – a
# migration must not change when the model module does. A later change to the
# trigger is a new migration.
INCIDENT_NUMBER_TRIGGER_SQL = (
    """
CREATE OR REPLACE FUNCTION incidents_assign_number() RETURNS trigger AS $$
BEGIN
    IF NEW.number IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('incident_number:' || NEW.event_id::text));
        SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number
          FROM incidents WHERE event_id = NEW.event_id;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql
""",
    """
CREATE TRIGGER incidents_assign_number
    BEFORE INSERT ON incidents
    FOR EACH ROW EXECUTE FUNCTION incidents_assign_number()
""",
)


def upgrade() -> None:
    op.add_column("incidents", sa.Column("number", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE incidents AS i SET number = numbered.n
          FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY created_at, id) AS n
              FROM incidents
          ) AS numbered
         WHERE numbered.id = i.id
        """
    )
    op.create_index("idx_incidents_event_number", "incidents", ["event_id", "number"])
    for statement in INCIDENT_NUMBER_TRIGGER_SQL:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS incidents_assign_number ON incidents")
    op.execute("DROP FUNCTION IF EXISTS incidents_assign_number()")
    op.drop_index("idx_incidents_event_number", table_name="incidents")
    op.drop_column("incidents", "number")
