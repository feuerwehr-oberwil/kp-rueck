"""add_category_sort_order_fields

Revision ID: 62602ddaaa6f
Revises: 3b2810233f06
Create Date: 2025-11-14 14:55:08.273122

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "62602ddaaa6f"
down_revision: str | Sequence[str] | None = "3b2810233f06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add role_sort_order column to personnel table
    op.add_column("personnel", sa.Column("role_sort_order", sa.Integer(), nullable=False, server_default="0"))

    # Add location_sort_order column to materials table
    op.add_column("materials", sa.Column("location_sort_order", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    """Downgrade schema."""
    # Drop the added columns
    op.drop_column("materials", "location_sort_order")
    op.drop_column("personnel", "role_sort_order")
