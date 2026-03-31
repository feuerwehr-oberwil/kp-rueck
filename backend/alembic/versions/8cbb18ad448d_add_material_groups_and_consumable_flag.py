"""add material groups and consumable flag

Revision ID: 8cbb18ad448d
Revises: d1a2b3c4d5e6
Create Date: 2026-03-31 20:43:00.062986

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '8cbb18ad448d'
down_revision: Union[str, Sequence[str], None] = 'd1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create material_groups table
    op.create_table(
        'material_groups',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('location', sa.String(255), nullable=False, server_default=''),
        sa.Column('location_sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # Add consumable flag to materials
    op.add_column('materials', sa.Column('consumable', sa.Boolean(), nullable=False, server_default='false'))

    # Add group_id FK to materials
    op.add_column('materials', sa.Column('group_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_materials_group_id',
        'materials', 'material_groups',
        ['group_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('idx_materials_group_id', 'materials', ['group_id'])


def downgrade() -> None:
    op.drop_index('idx_materials_group_id', table_name='materials')
    op.drop_constraint('fk_materials_group_id', 'materials', type_='foreignkey')
    op.drop_column('materials', 'group_id')
    op.drop_column('materials', 'consumable')
    op.drop_table('material_groups')
