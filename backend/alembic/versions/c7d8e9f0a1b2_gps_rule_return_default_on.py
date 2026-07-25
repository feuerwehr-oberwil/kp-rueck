"""gps rule_return default ON

Roll out the changed default for gps.rule_return_enabled (the confirm-only
"vehicle back at magazin -> prompt to release" rule) to already-seeded
databases. Settings are create-if-missing, so the new default in
DEFAULT_SETTINGS does not reach existing rows on its own.

Safe one-time flip: only touches the row if it still holds the previous default
("false"), so a deliberate user choice is never clobbered. Rule B is confirm-only
and additionally gated behind the master switch + magazin coordinates, so this
changes nothing until GPS automation is configured and enabled.

Revision ID: c7d8e9f0a1b2
Revises: e1a2b3c4d5f6
Create Date: 2026-06-26 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: str | Sequence[str] | None = "e1a2b3c4d5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE settings SET value = 'true' WHERE key = 'gps.rule_return_enabled' AND value = 'false'")


def downgrade() -> None:
    op.execute("UPDATE settings SET value = 'false' WHERE key = 'gps.rule_return_enabled' AND value = 'true'")
