"""rapport: "Weiteres Material" becomes a list with a per-entry on-site flag

Revision ID: b4f1c07a92de
Revises: c7e4a1b9f082
Create Date: 2026-08-11 09:00:00.000000

Plan 25 §18.35. "Weiteres gebrauchtes Material" was one comma-separated string
(``extra_material_note``) and therefore could only ever answer one question per
rapport, not one per item. The question the crew actually needs to answer per
item is *vor Ort verblieben*: an improvised pump that stayed in a cellar is a
device lying at an address that somebody has to fetch, and until now nothing in
the system knew about it — it appeared in no Restliste and on no Abholliste.

So the string becomes ``extra_materials_json``: one entry per item,
``{"name": ..., "left_on_site": ...}``. Deliberately **no `used` flag** — naming
something on this list already means it was used, which is why the entries carry
exactly one tick instead of the two the material checklist has.

Decision 18 is untouched and is the reason this is a list of names and not of
ids: nothing here resolves to a unit, nothing here creates an assignment. The
free-text escape stays for the pump borrowed from the neighbouring brigade,
which is in no catalogue.

**Existing notes are carried over, every entry `left_on_site=false`** — the state
they implicitly have today, because no crew was ever asked the question. Reading
them as *true* would invent an answer and send somebody driving.

The downgrade joins the names back into a comma-separated note and loses the
flags, which is unavoidable: the old column has nowhere to put them.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b4f1c07a92de"
down_revision: str | Sequence[str] | None = "c7e4a1b9f082"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "schadenplatz_reports",
        sa.Column("extra_materials_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    # Split on the comma the two old controls joined on, trim, drop the empties,
    # and keep the crew's order. `WITH ORDINALITY` is what makes the order
    # survive the aggregate — a list that comes back shuffled reads like somebody
    # else's rapport.
    op.execute(
        sa.text(
            """
            UPDATE schadenplatz_reports AS r
            SET extra_materials_json = built.value
            FROM (
                SELECT
                    s.id,
                    jsonb_agg(
                        jsonb_build_object('name', TRIM(t.part), 'left_on_site', false)
                        ORDER BY t.ordinality
                    ) AS value
                FROM schadenplatz_reports AS s,
                     LATERAL unnest(string_to_array(s.extra_material_note, ',')) WITH ORDINALITY AS t(part, ordinality)
                WHERE s.extra_material_note IS NOT NULL
                  AND TRIM(t.part) <> ''
                GROUP BY s.id
            ) AS built
            WHERE r.id = built.id
            """
        )
    )

    op.drop_column("schadenplatz_reports", "extra_material_note")


def downgrade() -> None:
    op.add_column("schadenplatz_reports", sa.Column("extra_material_note", sa.Text(), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE schadenplatz_reports AS r
            SET extra_material_note = built.value
            FROM (
                SELECT
                    s.id,
                    NULLIF(string_agg(TRIM(t.entry ->> 'name'), ', ' ORDER BY t.ordinality), '') AS value
                FROM schadenplatz_reports AS s,
                     LATERAL jsonb_array_elements(s.extra_materials_json) WITH ORDINALITY AS t(entry, ordinality)
                WHERE s.extra_materials_json IS NOT NULL
                  AND jsonb_typeof(s.extra_materials_json) = 'array'
                  AND NULLIF(TRIM(COALESCE(t.entry ->> 'name', '')), '') IS NOT NULL
                GROUP BY s.id
            ) AS built
            WHERE r.id = built.id
            """
        )
    )
    op.drop_column("schadenplatz_reports", "extra_materials_json")
