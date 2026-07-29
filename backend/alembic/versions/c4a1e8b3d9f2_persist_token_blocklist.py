"""A logout has to survive a restart

The JWT blocklist lived in a process-local dict, so every revoked token silently became
valid again the moment the container restarted — and a second instance never saw the
revocation at all. That is not what "logout" means, so the blocklist moves into the
database.

The table is deliberately identical to kp-front's ``revoked_tokens`` (same columns, same
index): the two auth stacks are forks of each other and this is code we want to keep
copyable between them.

Nothing is migrated *into* the table. The old store's contents only ever existed in the
memory of a process that this deploy is replacing, and every entry in it referred to a
token that expires within ``ACCESS_TOKEN_EXPIRE_MINUTES`` anyway. Empty is correct.

Revision ID: c4a1e8b3d9f2
Revises: b6f4c2a8e1d7
Create Date: 2026-07-29 11:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4a1e8b3d9f2"
down_revision: str | None = "b6f4c2a8e1d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # The pruning sweep filters on expires_at; the hot path hits the primary key.
    op.create_index("ix_revoked_tokens_expires_at", "revoked_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_revoked_tokens_expires_at", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
