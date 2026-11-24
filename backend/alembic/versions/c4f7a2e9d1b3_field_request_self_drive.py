"""An Abholung work item stores how it was answered: «Wir fahren selbst» or a lift.

The request list labels an Abholung the crew closed with «Wir fahren selbst» as «fährt
selbst · Name» (`FieldRequest.done_in_field`). Who closed the row cannot tell that: the
Übungssteuerung simulates the crew's answer under the KP user and a lift under a simulated
crew member. So the answer is stored.

No backfill: existing rows read false, the generic «erledigt» they showed before this
label existed. Downgrade drops the column.

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


def downgrade() -> None:
    op.drop_column("field_requests", "self_drive")
