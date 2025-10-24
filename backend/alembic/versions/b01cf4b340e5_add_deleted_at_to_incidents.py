"""add_deleted_at_to_incidents

Revision ID: b01cf4b340e5
Revises: dd20084b9da4
Create Date: 2025-10-24 20:12:59.720358

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b01cf4b340e5'
down_revision: Union[str, Sequence[str], None] = 'dd20084b9da4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('incidents', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('incidents', 'deleted_at')
