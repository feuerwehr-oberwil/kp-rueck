"""collapse the rapport's five owner columns into one free-text owner_note

Revision ID: b3d9f6072ac4
Revises: a7c4e2b81f36
Create Date: 2026-08-09 19:00:00.000000

Plan 25 §18.8. The Eigentümer-/Halterdaten block was five columns because the
paper slip has five ruled lines — Name, Strasse/Nr., Ort, KFZ-Kennzeichen,
KFZ-Typ. Paper has no choice; a phone in the rain does, and what came back from
the first real use was one filled name and four empty inputs. The block is now a
single multi-line box, which is also what every reader of it wants: the PDF
printed the five parts back as two joined strings, and the xlsx spread them over
four columns nobody could rely on.

**The existing data is merged, not dropped.** Whatever was in the five columns
becomes the first lines of the note, in the order a person would write them:

    Muster Hans
    Musterstrasse 12, 4104 Oberwil
    BL 12345 VW Golf

Rows where all five were NULL stay NULL — an empty three-newline string would
make every untouched rapport look like somebody typed whitespace into it.

The downgrade cannot un-merge (the note is free text by then and splitting it
would be guessing), so it restores the columns and puts the whole note into
``owner_name``, truncated to that column's 200 characters. That is lossy and
deliberately so: it is a rollback path, not a round trip.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3d9f6072ac4"
down_revision: str | Sequence[str] | None = "a7c4e2b81f36"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("schadenplatz_reports", sa.Column("owner_note", sa.Text(), nullable=True))

    # Line 1: the name. Line 2: "Strasse, Ort" — joined with a comma only when
    # both are present, which is what concat_ws does and what a plain || would
    # get wrong. Line 3: "Kennzeichen Typ". Empty lines are dropped rather than
    # written out, so a row that only ever had a name is a one-line note.
    op.execute(
        sa.text(
            """
            UPDATE schadenplatz_reports
            SET owner_note = NULLIF(
                array_to_string(
                    ARRAY(
                        SELECT line FROM unnest(ARRAY[
                            NULLIF(TRIM(COALESCE(owner_name, '')), ''),
                            NULLIF(concat_ws(', ',
                                NULLIF(TRIM(COALESCE(owner_street, '')), ''),
                                NULLIF(TRIM(COALESCE(owner_city, '')), '')
                            ), ''),
                            NULLIF(concat_ws(' ',
                                NULLIF(TRIM(COALESCE(vehicle_plate, '')), ''),
                                NULLIF(TRIM(COALESCE(vehicle_model, '')), '')
                            ), '')
                        ]) AS line
                        WHERE line IS NOT NULL
                    ),
                    E'\n'
                ),
                ''
            )
            """
        )
    )

    for column in ("owner_name", "owner_street", "owner_city", "vehicle_plate", "vehicle_model"):
        op.drop_column("schadenplatz_reports", column)


def downgrade() -> None:
    op.add_column("schadenplatz_reports", sa.Column("owner_name", sa.String(length=200), nullable=True))
    op.add_column("schadenplatz_reports", sa.Column("owner_street", sa.String(length=200), nullable=True))
    op.add_column("schadenplatz_reports", sa.Column("owner_city", sa.String(length=200), nullable=True))
    op.add_column("schadenplatz_reports", sa.Column("vehicle_plate", sa.String(length=50), nullable=True))
    op.add_column("schadenplatz_reports", sa.Column("vehicle_model", sa.String(length=100), nullable=True))

    # Lossy on purpose — see the module docstring.
    op.execute(
        sa.text(
            """
            UPDATE schadenplatz_reports
            SET owner_name = LEFT(owner_note, 200)
            WHERE owner_note IS NOT NULL
            """
        )
    )

    op.drop_column("schadenplatz_reports", "owner_note")
