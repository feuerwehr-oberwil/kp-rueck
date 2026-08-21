"""incidents: who reported it from the field

Revision ID: f3b6a92c1e40
Revises: e2f7b91d4c56
Create Date: 2026-08-17 12:20:00.000000

A Meldung from `/feld` recorded its reporter in the audit log and nowhere else
(`created_by` is a FK to `users`, and a field reporter has no login on purpose).
That is enough to answer "who was that" afterwards and not enough for the thing
it is actually needed for: showing somebody the Meldungen they made, so the one
who typed the house number is the one who can fix it — instead of the correction
going over the radio while the KP is already dispatching.

Nullable, no backfill. Old Meldungen keep their reporter in the audit row; they
simply do not appear in anybody's "Von mir gemeldet" list, which is honest — the
list is a working surface for the current Ereignis, not a history.

SET NULL rather than CASCADE: taking a person off the roster must never delete
the Schadenplätze they reported.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3b6a92c1e40"
down_revision: str | Sequence[str] | None = "e2f7b91d4c56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "incidents",
        sa.Column("reported_by_personnel_id", sa.UUID(), nullable=True),
    )
    op.create_index(
        "ix_incidents_reported_by_personnel_id",
        "incidents",
        ["reported_by_personnel_id"],
    )
    op.create_foreign_key(
        "fk_incidents_reported_by_personnel",
        "incidents",
        "personnel",
        ["reported_by_personnel_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_incidents_reported_by_personnel", "incidents", type_="foreignkey")
    op.drop_index("ix_incidents_reported_by_personnel_id", table_name="incidents")
    op.drop_column("incidents", "reported_by_personnel_id")
