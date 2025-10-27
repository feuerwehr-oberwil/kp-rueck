"""add_training_automation_tables

Revision ID: b803ba1b851c
Revises: 626a32e7e98b
Create Date: 2025-10-27 14:08:25.797038

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b803ba1b851c'
down_revision: Union[str, Sequence[str], None] = '626a32e7e98b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create emergency_templates table
    op.create_table(
        'emergency_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('title_pattern', sa.String(255), nullable=False),
        sa.Column('incident_type', sa.String(50), nullable=False),
        sa.Column('category', sa.String(20), nullable=False),
        sa.Column('message_pattern', sa.Text, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.CheckConstraint("category IN ('normal', 'critical')", name='valid_emergency_category'),
    )

    # Create training_locations table
    op.create_table(
        'training_locations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('street', sa.String(255), nullable=False),
        sa.Column('house_number', sa.String(20), nullable=False),
        sa.Column('postal_code', sa.String(10), nullable=False, server_default='4104'),
        sa.Column('city', sa.String(100), nullable=False, server_default='Oberwil'),
        sa.Column('building_type', sa.String(50), nullable=True),
        sa.Column('latitude', sa.Numeric(10, 8), nullable=True),
        sa.Column('longitude', sa.Numeric(11, 8), nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.true()),
    )

    # Add indexes
    op.create_index('ix_emergency_templates_category', 'emergency_templates', ['category'])
    op.create_index('ix_emergency_templates_is_active', 'emergency_templates', ['is_active'])
    op.create_index('ix_training_locations_is_active', 'training_locations', ['is_active'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_training_locations_is_active', 'training_locations')
    op.drop_index('ix_emergency_templates_is_active', 'emergency_templates')
    op.drop_index('ix_emergency_templates_category', 'emergency_templates')
    op.drop_table('training_locations')
    op.drop_table('emergency_templates')
