"""pin the Einsatzleiter once an operator picks one

Revision ID: d4a91c7e05b8
Revises: c3f8a1d29b47
Create Date: 2026-08-05 18:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4a91c7e05b8"
down_revision: str | Sequence[str] | None = "c3f8a1d29b47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Distinguish a derived Einsatzleiter from a chosen one.

    The board now keeps the role on the highest-ranking person present and
    re-picks whenever the crew changes, so an incident is never left with no EL
    on the Funkspruch or the printed slip. That automatic choice has to yield to
    a human one: this flag records that an operator picked deliberately, after
    which nothing re-derives the role for that incident (or route) again.

    Defaults to false everywhere, including existing rows — no incident has been
    hand-assigned a leader before this release, so deriving one for all of them
    is exactly right.
    """
    for table in ("incidents", "incident_groups"):
        op.add_column(
            table,
            sa.Column("leader_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    """Drop the flag. Every leader becomes indistinguishable from a derived one."""
    for table in ("incident_groups", "incidents"):
        op.drop_column(table, "leader_manual")
