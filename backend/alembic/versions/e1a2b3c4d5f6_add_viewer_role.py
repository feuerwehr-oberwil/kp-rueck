"""add viewer role

Allow role='viewer' on users so a real low-privilege account can log in
(normal login + cookie) and see a read-only board on shared/kiosk PCs.

Revision ID: e1a2b3c4d5f6
Revises: d2f6b1a3c4e5
Create Date: 2026-06-25 22:45:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1a2b3c4d5f6"
down_revision: str | Sequence[str] | None = "d2f6b1a3c4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: allow 'viewer' in the user role check constraint."""
    op.drop_constraint("valid_user_role", "users", type_="check")
    op.create_check_constraint("valid_user_role", "users", "role IN ('admin', 'editor', 'viewer')")


def downgrade() -> None:
    """Downgrade schema: drop 'viewer' (demote any viewers to a non-privileged editor)."""
    op.execute("UPDATE users SET role = 'editor' WHERE role = 'viewer'")
    op.drop_constraint("valid_user_role", "users", type_="check")
    op.create_check_constraint("valid_user_role", "users", "role IN ('admin', 'editor')")
