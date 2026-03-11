"""Add email to users for Microsoft auth.

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-03-11 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7a8"
down_revision: str | None = "b3c4d5e6f7g8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add email column (nullable, unique) for Microsoft/OIDC login
    op.add_column("users", sa.Column("email", sa.String(255), nullable=True))
    op.create_unique_constraint("uq_users_email", "users", ["email"])

    # Make password_hash nullable (allows passwordless Microsoft-only users)
    op.alter_column("users", "password_hash", nullable=True)


def downgrade() -> None:
    # Restore password_hash as NOT NULL (set empty string for any NULL values first)
    op.execute("UPDATE users SET password_hash = '' WHERE password_hash IS NULL")
    op.alter_column("users", "password_hash", nullable=False)

    # Remove email column
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_column("users", "email")
