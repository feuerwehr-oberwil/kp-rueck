"""notifications: structured params beside the German sentence

Revision ID: f3b9d2c47e15
Revises: c4e8a2f61d97
Create Date: 2026-10-09 00:00:00.000000

A notification stored only a German sentence the server composed, and the
client took it apart again with regular expressions to lay it out — so a
French-speaking KP read German in the bell. From now on every row also carries
the facts it is made of (`params`, JSONB, keyed per `type`), and the client
renders them through its own catalogue.

Safe on existing data: the column is nullable and nothing is backfilled. A row
without `params` is shown as its stored sentence, which is what it showed
before. `message` stays NOT NULL and keeps being written.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3b9d2c47e15"
down_revision: str | Sequence[str] | None = "c4e8a2f61d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("params", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "params")
