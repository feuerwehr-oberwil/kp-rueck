"""rapport: owner becomes name + phone, `used` stops being three-state

Revision ID: f2a7c4d1e903
Revises: f5b13c9a4e27
Create Date: 2026-08-10 10:00:00.000000

Plan 25 §18.31 and §18.32 — two reversals from the fifth field test, in one
revision because they touch one table and ship together.

**Eigentümer/Halter: one free-text box becomes Name + Telefon.** §18.10 collapsed
five paper columns into one Textarea and it was right about four of them — the
street, the city, the plate and the car model really are prose. It was wrong
about the fifth: a phone number buried inside a paragraph cannot be dialled, and
the whole point of writing down who owns the flooded cellar is that somebody
rings them. The incident already carries exactly this pair for the Melder
(``contact`` / ``contact_phone``), so the rapport now carries the same two
shapes.

The existing note is **carried into the name**, not dropped: whatever a crew
wrote about the owner is more valuable than the tidiness of the new column, and
nobody can split free text back into a name and a number without guessing. That
is the same reasoning §18.10's own merge used, in the other direction.

**``used`` stops being three-state.** ``null`` used to mean "die Crew hat nicht
geantwortet"; the tri-state control it needed was too fiddly on a phone, and the
default answer for a unit that was dispatched to this Schadenplatz is *ja*. Every
stored ``null`` becomes ``true`` — reading it as ``false`` would invent a denial
nobody made, and leaving it as ``null`` would keep a state the readers no longer
render.

The downgrade puts the name and the phone back into one note (two lines, empty
parts omitted) and leaves the material ticks alone: ``true`` is a valid
three-state value, so there is nothing to undo and re-inventing "keine Angabe"
out of a "ja" would be pure guesswork.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a7c4d1e903"
down_revision: str | Sequence[str] | None = "f5b13c9a4e27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("schadenplatz_reports", sa.Column("owner_name", sa.Text(), nullable=True))
    op.add_column("schadenplatz_reports", sa.Column("owner_phone", sa.String(length=50), nullable=True))

    # The whole note becomes the name. No attempt is made to pull a number out of
    # it: a regex that is right nine times out of ten is wrong once on a billing
    # document, and the operator who reads "Fam. Meier, unten links, Tel 079 …"
    # in the Name field can move the number across in two seconds.
    op.execute(
        sa.text(
            """
            UPDATE schadenplatz_reports
            SET owner_name = NULLIF(TRIM(owner_note), '')
            WHERE owner_note IS NOT NULL
            """
        )
    )
    op.drop_column("schadenplatz_reports", "owner_note")

    # `used: null` → `used: true`, one row of the checklist at a time. jsonb_agg
    # over the expanded array rebuilds the list in its original order; rapports
    # with no checklist at all are left untouched rather than rewritten to `[]`.
    op.execute(
        sa.text(
            """
            UPDATE schadenplatz_reports AS r
            SET materials_json = rebuilt.value
            FROM (
                SELECT
                    s.id,
                    jsonb_agg(
                        CASE
                            WHEN jsonb_typeof(unit -> 'used') = 'null' OR unit -> 'used' IS NULL
                            THEN jsonb_set(unit, '{used}', 'true'::jsonb)
                            ELSE unit
                        END
                        ORDER BY ordinality
                    ) AS value
                FROM schadenplatz_reports AS s,
                     LATERAL jsonb_array_elements(s.materials_json) WITH ORDINALITY AS t(unit, ordinality)
                WHERE s.materials_json IS NOT NULL
                  AND jsonb_typeof(s.materials_json) = 'array'
                GROUP BY s.id
            ) AS rebuilt
            WHERE r.id = rebuilt.id
            """
        )
    )


def downgrade() -> None:
    op.add_column("schadenplatz_reports", sa.Column("owner_note", sa.Text(), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE schadenplatz_reports
            SET owner_note = NULLIF(
                concat_ws(
                    E'\n',
                    NULLIF(TRIM(COALESCE(owner_name, '')), ''),
                    NULLIF(TRIM(COALESCE(owner_phone, '')), '')
                ),
                ''
            )
            """
        )
    )
    op.drop_column("schadenplatz_reports", "owner_phone")
    op.drop_column("schadenplatz_reports", "owner_name")
