"""feld_code_attempts: wrong Feld-Codes per phone and per address; no more Ereignis-wide rotation

Revision ID: a7d3f1c9e2b4
Revises: 568e14cea8c5
Create Date: 2026-11-15 00:00:00.000000

Wrong Feld-Codes used to be counted per (IP, Ereignis) in memory, plus an Ereignis-wide
counter on `events` that rotated the code at 30 – which let anybody with the poster link lock
every crew out of the door by typing wrong codes. Now each phone and each address gets five
tries, then waits 1, 5, then 15 minutes (crud/feld/access.py), counted in this table so a
restart gives nobody a fresh budget. The code moves only by hand («Neu generieren»).

Safe on existing data: the new table starts empty; the two dropped columns held only a
counter. Downgrade restores them at zero.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7d3f1c9e2b4"
down_revision: str | Sequence[str] | None = "568e14cea8c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feld_code_attempts",
        sa.Column("event_id", PG_UUID(as_uuid=True), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject", sa.String(80), nullable=False),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("event_id", "subject"),
    )
    op.drop_column("events", "feld_code_failures_since")
    op.drop_column("events", "feld_code_failures")


def downgrade() -> None:
    op.add_column("events", sa.Column("feld_code_failures", sa.Integer(), server_default="0", nullable=False))
    op.add_column("events", sa.Column("feld_code_failures_since", sa.DateTime(timezone=True), nullable=True))
    op.drop_table("feld_code_attempts")
