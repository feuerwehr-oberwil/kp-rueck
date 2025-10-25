"""Add personnel check-in tracking

Revision ID: 06b032721f70
Revises: be398c3e264a
Create Date: 2025-10-25 21:43:32.198414

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '06b032721f70'
down_revision: Union[str, Sequence[str], None] = 'be398c3e264a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add check-in tracking fields to personnel table
    op.add_column('personnel', sa.Column('checked_in', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('personnel', sa.Column('checked_in_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('personnel', sa.Column('checked_out_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('idx_personnel_checked_in', 'personnel', ['checked_in'], unique=False)

    # Add check-in constraint
    op.create_check_constraint(
        'valid_checkin_availability',
        'personnel',
        "(checked_in = false) OR (checked_in = true AND availability != 'unavailable')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Remove check-in constraint
    op.drop_constraint('valid_checkin_availability', 'personnel', type_='check')

    # Remove check-in tracking fields
    op.drop_index('idx_personnel_checked_in', table_name='personnel')
    op.drop_column('personnel', 'checked_out_at')
    op.drop_column('personnel', 'checked_in_at')
    op.drop_column('personnel', 'checked_in')
