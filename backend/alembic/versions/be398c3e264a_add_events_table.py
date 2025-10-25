"""add_events_table

Revision ID: be398c3e264a
Revises: 0d5cc7325349
Create Date: 2025-10-25 20:20:32.921902

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'be398c3e264a'
down_revision: Union[str, Sequence[str], None] = '0d5cc7325349'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Upgrade schema: Add events table and event-scope incidents.

    Changes:
    1. Create events table
    2. Create default event for existing incidents
    3. Add event_id to incidents table
    4. Migrate existing incidents to default event
    5. Add foreign key constraint with CASCADE delete
    6. Remove training_flag from incidents (move to events)
    """
    # Step 1: Create events table
    op.create_table(
        'events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('training_flag', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_activity_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Step 2: Add indexes on events table
    op.create_index('ix_events_archived_at', 'events', ['archived_at'])
    op.create_index('ix_events_last_activity_at', 'events', ['last_activity_at'])

    # Step 3: Create default event for existing incidents
    default_event_id = str(uuid.uuid4())
    op.execute(f"""
        INSERT INTO events (id, name, training_flag, created_at, updated_at, last_activity_at)
        VALUES ('{default_event_id}', 'Migrated Incidents', false, NOW(), NOW(), NOW())
    """)

    # Step 4: Add event_id column to incidents (nullable initially)
    op.add_column('incidents',
        sa.Column('event_id', postgresql.UUID(as_uuid=True), nullable=True)
    )

    # Step 5: Migrate all existing incidents to the default event
    op.execute(f"""
        UPDATE incidents SET event_id = '{default_event_id}' WHERE event_id IS NULL
    """)

    # Step 6: Make event_id non-nullable now that all rows have values
    op.alter_column('incidents', 'event_id', nullable=False)

    # Step 7: Add foreign key constraint with CASCADE delete
    op.create_foreign_key(
        'fk_incidents_event_id',
        'incidents', 'events',
        ['event_id'], ['id'],
        ondelete='CASCADE'
    )

    # Step 8: Add index on event_id for fast filtering
    op.create_index('ix_incidents_event_id', 'incidents', ['event_id'])

    # Step 9: Remove training_flag from incidents table (now on events)
    op.drop_index('idx_incidents_training', 'incidents')
    op.drop_column('incidents', 'training_flag')


def downgrade() -> None:
    """
    Downgrade schema: Restore incidents.training_flag and remove events table.

    This migration reverses the event management system changes.
    """
    # Step 1: Add training_flag back to incidents
    op.add_column('incidents',
        sa.Column('training_flag', sa.Boolean, nullable=False, server_default='false')
    )

    # Step 2: Restore training_flag values from events
    op.execute("""
        UPDATE incidents i
        SET training_flag = e.training_flag
        FROM events e
        WHERE i.event_id = e.id
    """)

    # Step 3: Recreate training_flag index
    op.create_index('idx_incidents_training', 'incidents', ['training_flag'])

    # Step 4: Drop foreign key and indexes
    op.drop_constraint('fk_incidents_event_id', 'incidents', type_='foreignkey')
    op.drop_index('ix_incidents_event_id', 'incidents')

    # Step 5: Drop event_id column
    op.drop_column('incidents', 'event_id')

    # Step 6: Drop events table indexes
    op.drop_index('ix_events_last_activity_at', 'events')
    op.drop_index('ix_events_archived_at', 'events')

    # Step 7: Drop events table
    op.drop_table('events')
