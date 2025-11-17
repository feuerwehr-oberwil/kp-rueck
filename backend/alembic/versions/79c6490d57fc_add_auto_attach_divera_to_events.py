"""add auto_attach_divera to events

Revision ID: 79c6490d57fc
Revises: fccf2c43febf
Create Date: 2025-11-17 10:58:59.537704

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '79c6490d57fc'
down_revision: Union[str, Sequence[str], None] = 'fccf2c43febf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Check if column already exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [col['name'] for col in inspector.get_columns('events')]

    if 'auto_attach_divera' in columns:
        print("Column 'auto_attach_divera' already exists in 'events' table, skipping")
        return

    # Add auto_attach_divera column to events table
    op.add_column('events', sa.Column('auto_attach_divera', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    """Downgrade schema."""
    # Remove auto_attach_divera column from events table
    op.drop_column('events', 'auto_attach_divera')
