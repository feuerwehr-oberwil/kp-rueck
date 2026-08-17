"""special functions: a lookup table instead of a CHECK constraint

Revision ID: d5a1c83e64b7
Revises: c9f14b2e7d03
Create Date: 2026-08-17 00:20:00.000000

Plan 26, decision 5. ``event_special_functions.function_type`` was pinned by

    CHECK (function_type IN ('driver', 'reko', 'magazin'))

so a fourth role — Verkehrsdienst, Pikett, Telefondienst — meant a migration,
which is exactly the sprawl the plan set out to end. The values move into a
seeded table a station can add to, and the column gets a foreign key to it.

**Deliberately only the values.** What a role *does* — which sections `/feld`
shows it, whether it needs a vehicle — stays in code. A visibility rule
expressed as configuration is a much harder thing to keep correct and to test,
and §2.2 is already the risky part of this plan; the table exists so a station
can name a role, not so it can invent an authorization model.

``requires_vehicle`` is carried as data because the CHECK that enforces it
(``driver_requires_vehicle``) is per-row and stays where it is — this column
tells the UI which picker to show, nothing more.

Seeded with the three that existed plus ``telefondienst``, which the station's
paper checklist has named for years ("Check-In, Telefonist und …") without the
schema ever knowing about it.

Downgrade restores the CHECK — and drops any row using a role added since,
because there is nowhere for it to go.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5a1c83e64b7"
down_revision: str | Sequence[str] | None = "c9f14b2e7d03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED = [
    ("driver", "Fahrer", "Chauffeur", True, 10),
    ("reko", "Reko", "Reco", False, 20),
    ("magazin", "Magazin", "Magasin", False, 30),
    ("telefondienst", "Telefondienst", "Service téléphonique", False, 40),
]


def upgrade() -> None:
    op.create_table(
        "special_function_types",
        sa.Column("key", sa.String(length=32), primary_key=True),
        sa.Column("label_de", sa.String(length=64), nullable=False),
        sa.Column("label_fr", sa.String(length=64), nullable=True),
        # UI only — the per-row CHECK is what actually enforces it for drivers.
        sa.Column("requires_vehicle", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
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
                "key": key,
                "label_de": label_de,
                "label_fr": label_fr,
                "requires_vehicle": requires_vehicle,
                "sort_order": sort_order,
            }
            for key, label_de, label_fr, requires_vehicle, sort_order in SEED
        ],
    )

    # The constraint goes; the foreign key takes over. RESTRICT rather than
    # CASCADE: deleting a role somebody is currently assigned to should fail
    # loudly, not quietly strip the Ereignis of its Reko.
    op.drop_constraint("valid_function_type", "event_special_functions", type_="check")
    op.create_foreign_key(
        "fk_special_function_type",
        "event_special_functions",
        "special_function_types",
        ["function_type"],
        ["key"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_special_function_type", "event_special_functions", type_="foreignkey")
    # Anything using a role added after this migration has nowhere to go back to.
    op.execute(sa.text("DELETE FROM event_special_functions WHERE function_type NOT IN ('driver', 'reko', 'magazin')"))
    op.create_check_constraint(
        "valid_function_type",
        "event_special_functions",
        "function_type IN ('driver', 'reko', 'magazin')",
    )
    op.drop_table("special_function_types")
