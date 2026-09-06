"""One-use browser-bound Microsoft login transactions.

Revision ID: b9e6d3c20a71
Revises: a3c7e21f5b04
"""

import sqlalchemy as sa
from alembic import op

revision = "b9e6d3c20a71"
down_revision = "a3c7e21f5b04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "microsoft_login_transactions",
        sa.Column("state_hash", sa.String(64), primary_key=True),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("code_verifier", sa.String(128), nullable=False),
        sa.Column("nonce", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_microsoft_login_transactions_expires_at", "microsoft_login_transactions", ["expires_at"])


def downgrade() -> None:
    op.drop_table("microsoft_login_transactions")
