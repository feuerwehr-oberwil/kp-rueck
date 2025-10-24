"""remove_critical_priority

Revision ID: 0d5cc7325349
Revises: b01cf4b340e5
Create Date: 2025-10-24 22:31:34.726519

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0d5cc7325349'
down_revision: Union[str, Sequence[str], None] = 'b01cf4b340e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: Remove 'critical' priority, keep only 'low', 'medium', 'high'."""
    # Step 1: Update any existing incidents with 'critical' priority to 'high'
    op.execute("UPDATE incidents SET priority = 'high' WHERE priority = 'critical'")

    # Step 2: Drop the old constraint
    op.drop_constraint('valid_priority', 'incidents', type_='check')

    # Step 3: Add new constraint with only 3 priority levels
    op.create_check_constraint(
        'valid_priority',
        'incidents',
        "priority IN ('low', 'medium', 'high')"
    )


def downgrade() -> None:
    """Downgrade schema: Restore 'critical' priority option."""
    # Step 1: Drop the new constraint
    op.drop_constraint('valid_priority', 'incidents', type_='check')

    # Step 2: Restore old constraint with 'critical' option
    op.create_check_constraint(
        'valid_priority',
        'incidents',
        "priority IN ('low', 'medium', 'high', 'critical')"
    )
