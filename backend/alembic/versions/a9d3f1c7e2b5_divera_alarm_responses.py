"""divera_emergencies: the Rückmeldungen Divera reports on the alarm

Revision ID: a9d3f1c7e2b5
Revises: d9a4c2e7b1f3
Create Date: 2026-10-08 00:00:00.000000

The poller already GETs ``/alarms`` every 30 s while somebody is connected, and
every alarm in that answer carries who was alarmed, who read it and who answered
under which status («Komme», «Komme nicht», …). The parser dropped all of it.
Two nullable columns keep the latest normalised snapshot per pool alarm
(``services/divera_responses.py``) and when it last changed.

Safe on existing data: both columns are nullable and nothing reads a NULL as
anything but «no answers yet».
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9d3f1c7e2b5"
down_revision: str | Sequence[str] | None = "d9a4c2e7b1f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "divera_emergencies",
        sa.Column("responses_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "divera_emergencies",
        sa.Column("responses_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("divera_emergencies", "responses_updated_at")
    op.drop_column("divera_emergencies", "responses_json")
