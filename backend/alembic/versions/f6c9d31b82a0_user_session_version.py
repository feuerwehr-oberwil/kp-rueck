"""Revoke a user's login sessions on password reset or deactivation.

Revision ID: f6c9d31b82a0
Revises: e4b7c20a91d6
"""

import sqlalchemy as sa
from alembic import op

revision = "f6c9d31b82a0"
down_revision = "e4b7c20a91d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("session_version", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("users", "session_version")
