"""Revoke field credentials issued before the security upgrade.

Revision ID: e5b8a90c31d2
Revises: d2a7f91c60e4
"""

import sqlalchemy as sa
from alembic import op

revision = "e5b8a90c31d2"
down_revision = "d2a7f91c60e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Retain history and prior revocation timestamps. Poster links and event
    # codes are unaffected, so devices can enter the normal unlock flow again.
    for name in ("feld_device_claims", "feld_unlock_claims"):
        claims = sa.table(name, sa.column("revoked_at", sa.DateTime(timezone=True)))
        op.execute(claims.update().where(claims.c.revoked_at.is_(None)).values(revoked_at=sa.func.now()))


def downgrade() -> None:
    # Revocation is irreversible: a rollback must not resurrect lost devices.
    pass
