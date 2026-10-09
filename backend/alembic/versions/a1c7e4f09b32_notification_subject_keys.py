"""notifications: subject_keys — who a grouped notification is about

Revision ID: a1c7e4f09b32
Revises: c4e8a2f61d97
Create Date: 2026-10-09 00:00:00.000000

The time-on-duty warning is one row for the whole crew, rewritten in place. To
know whom a dismissal acknowledged, the row records the people it named
(«<personnel_id>@<checked_in_at>», one key per shift). Somebody past the
threshold who is not among the acknowledged keys raises a new row.

Safe on existing data: the column is nullable and nothing is backfilled. Rows
without keys (every other type, and per-person fatigue rows from before the
grouping) are ignored by that check.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c7e4f09b32"
down_revision: str | Sequence[str] | None = "c4e8a2f61d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("subject_keys", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "subject_keys")
