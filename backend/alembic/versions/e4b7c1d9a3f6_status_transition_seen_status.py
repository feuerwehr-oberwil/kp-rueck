"""status_transitions: seen_status — the status a stale board showed when it moved the card

Revision ID: e4b7c1d9a3f6
Revises: d5f1a7c3e9b2
Create Date: 2026-10-24 00:00:00.000000

Two operators, seconds apart (sweep 2026-10-23, TESTS-01): a status move whose `from_status`
is not the card's real status is now refused with 409 «Status geändert». When the operator
then chooses «Trotzdem …», the move is applied and this column keeps what their board showed,
so the Verlauf can say «war schon abgeschlossen (vor 4 s)».

Safe on existing data: nullable, nothing backfilled — every earlier row was an ordinary move.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e4b7c1d9a3f6"
down_revision: str | Sequence[str] | None = "d5f1a7c3e9b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("status_transitions", sa.Column("seen_status", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("status_transitions", "seen_status")
