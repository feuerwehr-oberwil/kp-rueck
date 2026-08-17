"""special functions: Kommandoposten

Revision ID: e2f7b91d4c56
Revises: d5a1c83e64b7
Create Date: 2026-08-17 10:40:00.000000

The people running the board are on the roster and were counted as free, so the
KP kept being offered its own operators as crew for a Schadenplatz. They are
working — on this app — and «verfügbar» has to mean available *to send out*.

This is exactly the case `special_function_types` was made for (plan 26,
decision 5): a station names a role, and the row is data rather than a
migration. Except this one ships with the app, because every station running a
command post has somebody sitting in it.

Like `magazin` and unlike `reko`: it occupies the person. A Reko trupp IS out on
a Schadenplatz and stays assignable to it; somebody at the board is not.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2f7b91d4c56"
down_revision: str | Sequence[str] | None = "d5a1c83e64b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEY = "kommandoposten"


def upgrade() -> None:
    op.bulk_insert(
        sa.table(
            "special_function_types",
            sa.column("key", sa.String),
            sa.column("label_de", sa.String),
            sa.column("label_fr", sa.String),
            sa.column("requires_vehicle", sa.Boolean),
            sa.column("sort_order", sa.Integer),
        ),
        [
            {
                "key": KEY,
                "label_de": "Kommandoposten",
                "label_fr": "Poste de commandement",
                "requires_vehicle": False,
                "sort_order": 50,
            }
        ],
    )


def downgrade() -> None:
    # The foreign key is RESTRICT, so anybody still holding the role would block
    # the delete. Releasing them first is the only way back, and it is the right
    # one: the alternative is a downgrade that fails at 02:00.
    op.execute(sa.text(f"DELETE FROM event_special_functions WHERE function_type = '{KEY}'"))
    op.execute(sa.text(f"DELETE FROM special_function_types WHERE key = '{KEY}'"))
