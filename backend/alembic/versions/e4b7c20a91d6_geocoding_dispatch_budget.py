"""Share the geocoder request budget across backend workers.

Revision ID: e4b7c20a91d6
Revises: e5b8a90c31d2
"""

import sqlalchemy as sa
from alembic import op

revision = "e4b7c20a91d6"
down_revision = "e5b8a90c31d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "geocoding_dispatch",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("next_request_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="geocoding_dispatch_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("geocoding_dispatch")
