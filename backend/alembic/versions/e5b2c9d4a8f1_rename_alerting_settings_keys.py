"""rename divera.alarm_* settings keys to alerting.*

Outbound alerting is provider-neutral (AlarmProvider protocol); the behavior
settings lose their vendor prefix. Existing values (enabled flag, custom
templates) are carried over; the rename is skipped if a target key already
exists (idempotent).

Revision ID: e5b2c9d4a8f1
Revises: d4f9a2c7e1b3
Create Date: 2026-07-19 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5b2c9d4a8f1"
down_revision: str | Sequence[str] | None = "d4f9a2c7e1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RENAMES = [
    ("divera.alarm_enabled", "alerting.enabled"),
    ("divera.alarm_title_template", "alerting.title_template"),
    ("divera.alarm_text_template", "alerting.text_template"),
]


def upgrade() -> None:
    """Upgrade schema."""
    for old, new in RENAMES:
        op.execute(
            f"UPDATE settings SET key = '{new}' WHERE key = '{old}' "
            f"AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = '{new}')"
        )
        op.execute(f"DELETE FROM settings WHERE key = '{old}'")


def downgrade() -> None:
    """Downgrade schema."""
    for old, new in RENAMES:
        op.execute(
            f"UPDATE settings SET key = '{old}' WHERE key = '{new}' "
            f"AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = '{old}')"
        )
        op.execute(f"DELETE FROM settings WHERE key = '{new}'")
