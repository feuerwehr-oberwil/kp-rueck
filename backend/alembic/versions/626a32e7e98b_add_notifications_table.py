"""add notifications table

Revision ID: 626a32e7e98b
Revises: 15f9942dbb87
Create Date: 2025-10-26 23:05:44.399823

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '626a32e7e98b'
down_revision: Union[str, Sequence[str], None] = '15f9942dbb87'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create notifications table
    op.create_table(
        'notifications',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('type', sa.String(length=50), nullable=False),
        sa.Column('severity', sa.String(length=20), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('incident_id', sa.UUID(), nullable=True),
        sa.Column('event_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('dismissed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dismissed_by', sa.UUID(), nullable=True),
        sa.CheckConstraint(
            "severity IN ('critical', 'warning', 'info')",
            name='valid_notification_severity'
        ),
        sa.CheckConstraint(
            "type IN ('time_overdue', 'no_personnel', 'no_materials', 'personnel_fatigue', "
            "'missing_location', 'missing_personnel', 'missing_vehicle', 'event_size_limit')",
            name='valid_notification_type'
        ),
        sa.ForeignKeyConstraint(['incident_id'], ['incidents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['dismissed_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes
    op.create_index('idx_notifications_event', 'notifications', ['event_id'])
    op.create_index('idx_notifications_incident', 'notifications', ['incident_id'])
    op.create_index('idx_notifications_dismissed', 'notifications', ['dismissed'])
    op.create_index('idx_notifications_created_at', 'notifications', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    # Drop indexes
    op.drop_index('idx_notifications_created_at', table_name='notifications')
    op.drop_index('idx_notifications_dismissed', table_name='notifications')
    op.drop_index('idx_notifications_incident', table_name='notifications')
    op.drop_index('idx_notifications_event', table_name='notifications')

    # Drop notifications table
    op.drop_table('notifications')
