"""add_nachbarhilfe_flag_to_incidents

Revision ID: 9452137d14fc
Revises: 3a8f9c1d2e5b
Create Date: 2026-02-01 11:18:05.871861

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9452137d14fc'
down_revision: Union[str, Sequence[str], None] = '3a8f9c1d2e5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add nachbarhilfe flag to incidents table."""
    op.add_column(
        'incidents',
        sa.Column('nachbarhilfe', sa.Boolean(), nullable=False, server_default=sa.text('false'))
    )


def downgrade() -> None:
    """Remove nachbarhilfe flag from incidents table."""
    op.drop_column('incidents', 'nachbarhilfe')
