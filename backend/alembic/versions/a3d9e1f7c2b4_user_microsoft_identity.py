"""Link a user to its Microsoft Entra identity (tenant id + object id).

The Microsoft login used to find a user by e-mail, a claim that can change. It now finds
the user by the immutable pair and stores it on the first login. Both columns start NULL:
an existing account is linked by its e-mail on its next Microsoft login.

Revision ID: a3d9e1f7c2b4
Revises: d5a1c7e3b9f2
"""

import sqlalchemy as sa
from alembic import op

revision = "a3d9e1f7c2b4"
down_revision = "d5a1c7e3b9f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("microsoft_tid", sa.String(36), nullable=True))
    op.add_column("users", sa.Column("microsoft_oid", sa.String(36), nullable=True))
    op.create_unique_constraint("uq_users_microsoft_identity", "users", ["microsoft_tid", "microsoft_oid"])


def downgrade() -> None:
    op.drop_constraint("uq_users_microsoft_identity", "users", type_="unique")
    op.drop_column("users", "microsoft_oid")
    op.drop_column("users", "microsoft_tid")
