"""Allow Reko form credentials to carry field device provenance.

Revision ID: d2a7f91c60e4
Revises: c6d2f8a31e90
"""

import sqlalchemy as sa
from alembic import op

revision = "d2a7f91c60e4"
down_revision = "c6d2f8a31e90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "reko_reports", "token", existing_type=sa.String(500), type_=sa.String(1024), existing_nullable=False
    )


def downgrade() -> None:
    # Keep room for already-issued credentials; truncating them would destroy
    # the report-to-form association. Older app versions can read this column.
    pass
