"""drop schadenplatz_reports.damage_type/vehicle_count, add vehicles_json

Revision ID: a7c4e2b81f36
Revises: d4f1a72c3e58
Create Date: 2026-08-09 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a7c4e2b81f36"
down_revision: str | Sequence[str] | None = "d4f1a72c3e58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Two reversals the station asked for after using the slip in the field.

    1. **Schadensart goes.** The paper's damage-type checkboxes turned out to
       classify nothing anybody reads: the Einsatz already carries the Swiss
       statistics vocabulary in ``incidents.type``, and a second, narrower
       vocabulary next to it only asked the crew a question with no consumer.
       Both columns and the check constraint go with it.

    2. **The vehicle NUMBER becomes the vehicle LIST.** The crew confirms two
       things at the end of a job — how many people were there, and *which*
       vehicles. A count answers neither the question "was der TLF dabei?" nor
       the paperwork behind it, so ``vehicle_count``/``vehicle_count_corrected``
       are replaced by ``vehicles_json``: one row per vehicle assignment,
       prefilled ticked, exactly like the material checklist.

    Both are destructive on purpose. The counts were never the record — the
    frozen ``cost_snapshot_json`` is, and it already names every vehicle with
    its from/to, so nothing that mattered is lost.
    """
    op.add_column(
        "schadenplatz_reports",
        sa.Column("vehicles_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.drop_constraint("valid_damage_type", "schadenplatz_reports", type_="check")
    op.drop_column("schadenplatz_reports", "damage_type_other")
    op.drop_column("schadenplatz_reports", "damage_type")
    op.drop_column("schadenplatz_reports", "vehicle_count_corrected")
    op.drop_column("schadenplatz_reports", "vehicle_count")


def downgrade() -> None:
    """Put the four columns and the constraint back, empty.

    The values cannot come back — they were dropped, not archived — so a
    downgraded database has the shape of the old one with nothing in it. The
    vehicle checklist is dropped in turn.
    """
    op.add_column("schadenplatz_reports", sa.Column("vehicle_count", sa.Integer(), nullable=True))
    op.add_column(
        "schadenplatz_reports",
        sa.Column("vehicle_count_corrected", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("schadenplatz_reports", sa.Column("damage_type", sa.String(length=20), nullable=True))
    op.add_column("schadenplatz_reports", sa.Column("damage_type_other", sa.Text(), nullable=True))
    op.create_check_constraint(
        "valid_damage_type",
        "schadenplatz_reports",
        "damage_type IS NULL OR damage_type IN ('wasserschaden', 'sturmschaden', 'schneebruch', 'anderes')",
    )
    op.drop_column("schadenplatz_reports", "vehicles_json")
