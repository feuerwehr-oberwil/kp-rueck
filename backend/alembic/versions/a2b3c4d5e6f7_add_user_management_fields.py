"""Add user management fields and update role constraint.

Revision ID: a2b3c4d5e6f7
Revises: a1b2c3d4e5f6
Create Date: 2026-02-03 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add new columns to users table
    op.add_column("users", sa.Column("display_name", sa.String(100), nullable=False, server_default=""))
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"))

    # Drop old constraint and add new one
    # Note: constraint name may vary, try both common patterns
    try:
        op.drop_constraint("valid_user_role", "users", type_="check")
    except Exception:
        # Constraint might have different name in some environments
        pass

    op.create_check_constraint(
        "valid_user_role",
        "users",
        "role IN ('admin', 'editor')",
    )

    # Update existing 'editor' users to remain as 'editor' (no change needed)
    # Update any 'viewer' users to 'editor' (viewers should be token-only)
    op.execute("UPDATE users SET role = 'editor' WHERE role = 'viewer'")


def downgrade() -> None:
    # Drop new constraint and restore old one
    op.drop_constraint("valid_user_role", "users", type_="check")
    op.create_check_constraint(
        "valid_user_role",
        "users",
        "role IN ('editor', 'viewer')",
    )

    # Update any 'admin' users back to 'editor'
    op.execute("UPDATE users SET role = 'editor' WHERE role = 'admin'")

    # Remove added columns
    op.drop_column("users", "is_active")
    op.drop_column("users", "display_name")
