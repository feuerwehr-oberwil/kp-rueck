"""An Abholung work item stores how it was answered: «Wir fahren selbst» or a lift.

The request list read «fährt selbst» from who closed the row (a crew member without a user),
but the Übungssteuerung simulates the crew's answer under the KP user and a lift under a
simulated crew member, so the label was wrong there. Existing rows keep that old reading.

Revision ID: c4f7a2e9d1b3
Revises: b8e4f2a6c1d7
"""

import sqlalchemy as sa
from alembic import op

revision = "c4f7a2e9d1b3"
down_revision = "b8e4f2a6c1d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("field_requests", sa.Column("self_drive", sa.Boolean(), server_default="false", nullable=False))
    op.execute(
        "UPDATE field_requests SET self_drive = true"
        " WHERE kind = 'pickup' AND status = 'done' AND done_by_user_id IS NULL AND done_by_name IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("field_requests", "self_drive")
