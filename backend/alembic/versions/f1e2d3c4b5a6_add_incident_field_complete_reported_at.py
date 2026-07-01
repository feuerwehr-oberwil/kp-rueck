"""add incident field_complete_reported_at

Field crews report an incident finished ("Einsatz beendet") from the training
conductor console. This is informational only — it surfaces a badge on the
card so the operator can decide to close the incident; it never changes status
on its own. Nullable timestamp, set when the field reports completion.

Revision ID: f1e2d3c4b5a6
Revises: c7d8e9f0a1b2
Create Date: 2026-07-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1e2d3c4b5a6"
down_revision: str | Sequence[str] | None = "c7d8e9f0a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable field_complete_reported_at timestamp to incidents."""
    op.add_column(
        "incidents",
        sa.Column("field_complete_reported_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Drop the field_complete_reported_at column."""
    op.drop_column("incidents", "field_complete_reported_at")
