"""replace the NULL-blind unique_assignment with a partial index over active rows

Revision ID: a1c4d8e93f27
Revises: b4f1c07a92de
Create Date: 2026-08-11 11:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c4d8e93f27"
down_revision: str | Sequence[str] | None = "b4f1c07a92de"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """One ACTIVE assignment per resource per incident, enforced by the database.

    `unique_assignment` covered (incident_id, resource_type, resource_id, unassigned_at).
    Active rows carry unassigned_at = NULL and NULL != NULL in SQL, so it permitted any
    number of active duplicates — a double click put the same person on the incident twice.

    Order matters and is not cosmetic: the old constraint has to go BEFORE the dedupe,
    because closing duplicates writes the same unassigned_at into several rows and would
    trip it. The dedupe then has to run BEFORE the new index, because CREATE UNIQUE INDEX
    fails on data that already violates it — and `start.sh` runs `alembic upgrade head` on
    boot, so a migration that fails here is a backend that does not start.
    """
    op.drop_constraint("unique_assignment", "incident_assignments", type_="unique")

    # Close the duplicates this bug already created. Keep exactly one active row per
    # (incident, resource): the Einsatzleiter if one of them carries the flag, otherwise
    # the earliest assignment — that is the one whose assigned_at the board has been
    # showing and the one the audit log describes. The rest are released "now" rather
    # than deleted: they are real history, someone did click twice, and a soft release
    # is what every other path in this codebase does.
    op.execute(
        sa.text("""
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY incident_id, resource_type, resource_id
                       ORDER BY is_leader DESC, assigned_at ASC, id ASC
                   ) AS rn
            FROM incident_assignments
            WHERE unassigned_at IS NULL
        )
        UPDATE incident_assignments
        SET unassigned_at = NOW()
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        """)
    )

    op.create_index(
        "uq_assignments_active_resource",
        "incident_assignments",
        ["incident_id", "resource_type", "resource_id"],
        unique=True,
        postgresql_where=sa.text("unassigned_at IS NULL"),
    )


def downgrade() -> None:
    """Reversible, with one honest caveat.

    The index goes and the old constraint comes back, so the schema matches what it was.
    The rows this migration released cannot be un-released: after the dedupe there is no
    record of which closed rows were duplicates and which were ordinary releases. That is
    acceptable in this direction — the duplicates were wrong to be active in the first
    place — but it means a downgrade restores the weaker constraint, not the bad data.
    """
    op.drop_index("uq_assignments_active_resource", table_name="incident_assignments")
    op.create_unique_constraint(
        "unique_assignment",
        "incident_assignments",
        ["incident_id", "resource_type", "resource_id", "unassigned_at"],
    )
