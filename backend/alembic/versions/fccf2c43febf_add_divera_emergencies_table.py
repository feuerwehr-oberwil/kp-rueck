"""add_divera_emergencies_table

Revision ID: fccf2c43febf
Revises: 0d9651aa45bb
Create Date: 2025-11-17 10:15:10.700498

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'fccf2c43febf'
down_revision: Union[str, Sequence[str], None] = '0d9651aa45bb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Check if table already exists (may have been created manually)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'divera_emergencies' in inspector.get_table_names():
        print("Table 'divera_emergencies' already exists, skipping creation")
        return

    op.create_table(
        'divera_emergencies',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('divera_id', sa.Integer(), nullable=False),
        sa.Column('divera_number', sa.String(length=50), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('text', sa.Text(), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('latitude', sa.Numeric(precision=10, scale=8), nullable=True),
        sa.Column('longitude', sa.Numeric(precision=11, scale=8), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('raw_payload_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('attached_to_event_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('attached_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_incident_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['attached_to_event_id'], ['events.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_incident_id'], ['incidents.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('divera_id')
    )

    # Create indexes
    op.create_index('idx_divera_emergencies_divera_id', 'divera_emergencies', ['divera_id'], unique=False)
    op.create_index('idx_divera_emergencies_received_at', 'divera_emergencies', ['received_at'], unique=False)
    op.create_index('idx_divera_emergencies_attached', 'divera_emergencies', ['attached_to_event_id'], unique=False)
    op.create_index('idx_divera_emergencies_archived', 'divera_emergencies', ['is_archived'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('idx_divera_emergencies_archived', table_name='divera_emergencies')
    op.drop_index('idx_divera_emergencies_attached', table_name='divera_emergencies')
    op.drop_index('idx_divera_emergencies_received_at', table_name='divera_emergencies')
    op.drop_index('idx_divera_emergencies_divera_id', table_name='divera_emergencies')
    op.drop_table('divera_emergencies')
