"""Share links of an Ereignis can be taken back: one generation number per kind of link.

A check-in, viewer or alarm-intake link carries the generation it was issued with and opens
the Ereignis only while the two are equal. Every Ereignis starts at 0, and a link issued
before this migration counts as 0, so existing links keep working until they expire or are
revoked.

Revision ID: b8e4f2a6c1d7
Revises: a3d9e1f7c2b4
"""

import sqlalchemy as sa
from alembic import op

revision = "b8e4f2a6c1d7"
down_revision = "a3d9e1f7c2b4"
branch_labels = None
depends_on = None

COLUMNS = ("checkin_link_generation", "viewer_link_generation", "alarm_link_generation")


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column("events", sa.Column(column, sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    for column in COLUMNS:
        op.drop_column("events", column)
