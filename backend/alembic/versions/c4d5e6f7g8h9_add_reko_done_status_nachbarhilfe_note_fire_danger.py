"""Add reko_done status, nachbarhilfe_note, and fire_danger to reko dangers

Revision ID: c4d5e6f7g8h9
Revises: b3c4d5e6f7a8
Create Date: 2026-03-19 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7g8h9"
down_revision: str | None = "b3c4d5e6f7a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add reko_done to valid_status constraint
    op.drop_constraint("valid_status", "incidents", type_="check")
    op.create_check_constraint(
        "valid_status",
        "incidents",
        "status IN ('eingegangen', 'reko', 'reko_done', 'disponiert', 'einsatz', 'einsatz_beendet', 'abschluss')",
    )

    # Add nachbarhilfe_note column
    op.add_column("incidents", sa.Column("nachbarhilfe_note", sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove nachbarhilfe_note column
    op.drop_column("incidents", "nachbarhilfe_note")

    # Revert valid_status constraint
    op.drop_constraint("valid_status", "incidents", type_="check")
    op.create_check_constraint(
        "valid_status",
        "incidents",
        "status IN ('eingegangen', 'reko', 'disponiert', 'einsatz', 'einsatz_beendet', 'abschluss')",
    )
