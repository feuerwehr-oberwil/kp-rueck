"""incident_assignments: why a person is on this Schadenplatz

Revision ID: b3e8f1c07a92
Revises: a4d7e2f91b60
Create Date: 2026-08-16 21:10:00.000000

Plan 26 §27. A Reko trupp is assigned exactly like a work crew — one
``incident_assignments`` row, ``resource_type='personnel'`` — and the only thing
that ever said "Reko" was ``event_special_functions``, which marks a person for
the whole *Ereignis*, not for one Schadenplatz. So nothing could tell the two
apart per incident, and ``rapport_applies`` consequently demanded a
Schadenplatz-Rapport from a trupp that had only driven past and looked.

``purpose`` puts the distinction where it belongs: on the row that says this
person is on this Schadenplatz. It drives which detail view `/feld` opens, and —
the load-bearing part — which rows can owe a Rapport at all.

**The backfill is deliberately narrow.** A row becomes ``'reko'`` only when both
things are true: the person holds the ``reko`` special function for that
incident's event, *and* a Reko report on that same incident names them as its
author. That second condition is what keeps it honest. Holding the reko function
does not mean every assignment was a Reko assignment — a Reko person who spent
the second half of the night clearing trees would otherwise have their work
rows relabelled, and those rows owe a Rapport that would then silently vanish.

The cost of being narrow is the opposite error: a Reko assignment whose report
was never filed (or was left a draft) stays ``'crew'`` and keeps asking for a
Rapport, exactly as it does today. That is the pre-existing behaviour, not a new
defect, and it is visible and fixable in the UI — whereas a work assignment
wrongly marked ``'reko'`` silently drops a Rapport nobody notices is missing.
Guessing wrong in the direction of *more* paperwork is the safe direction.

Downgrade drops the column. Nothing is lost that was not derived.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3e8f1c07a92"
down_revision: str | Sequence[str] | None = "a4d7e2f91b60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "incident_assignments",
        sa.Column("purpose", sa.String(length=20), nullable=False, server_default="crew"),
    )

    # Both conditions, joined through the incident's event. `submitted_by_personnel_id`
    # is the author of the Reko, so it is the only field that ties a *report* back to
    # a *person* — the special function alone would relabel work rows (see docstring).
    op.execute(
        sa.text(
            """
            UPDATE incident_assignments AS ia
            SET purpose = 'reko'
            FROM incidents AS i
            WHERE ia.incident_id = i.id
              AND ia.resource_type = 'personnel'
              AND EXISTS (
                    SELECT 1 FROM event_special_functions AS esf
                    WHERE esf.event_id = i.event_id
                      AND esf.personnel_id = ia.resource_id
                      AND esf.function_type = 'reko'
              )
              AND EXISTS (
                    SELECT 1 FROM reko_reports AS rr
                    WHERE rr.incident_id = ia.incident_id
                      AND rr.submitted_by_personnel_id = ia.resource_id
              )
            """
        )
    )

    op.create_check_constraint(
        "valid_assignment_purpose",
        "incident_assignments",
        "purpose IN ('crew', 'reko')",
    )
    # Every `/feld` visibility query filters personnel rows by purpose, so the
    # index carries it alongside the columns those queries already use.
    op.create_index(
        "idx_assignments_personnel_purpose",
        "incident_assignments",
        ["resource_id", "resource_type", "purpose"],
    )


def downgrade() -> None:
    op.drop_index("idx_assignments_personnel_purpose", table_name="incident_assignments")
    op.drop_constraint("valid_assignment_purpose", "incident_assignments", type_="check")
    op.drop_column("incident_assignments", "purpose")
