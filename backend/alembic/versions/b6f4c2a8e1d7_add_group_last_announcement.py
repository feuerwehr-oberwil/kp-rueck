"""Remember the last Funkdurchsage of an Auftrag

An Auftrag with four stops used to produce four identical radio announcements: every stop that
reached «Disponiert» read out the whole crew again. The first stop IS the Auftragsvergabe, every
later one is a continuation — but telling those apart needs to know what was announced last, and
that has to hold across a reload, a second device and the wall screen. Hence four columns on the
Auftrag rather than something in the browser.

``last_announced_fingerprint`` is an opaque digest of the route's crew/vehicles/material at the
time of the announcement; it is compared for equality only. When it changes, the route picked up
resources since the last call and the full announcement is due again.

Revision ID: b6f4c2a8e1d7
Revises: a3d7f19c4b28
Create Date: 2026-07-27 09:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision: str = "b6f4c2a8e1d7"
down_revision: str | None = "a3d7f19c4b28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("incident_groups", sa.Column("last_announced_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("incident_groups", sa.Column("last_announced_fingerprint", sa.Text(), nullable=True))
    op.add_column("incident_groups", sa.Column("last_announced_stop_id", PG_UUID(as_uuid=True), nullable=True))
    op.add_column(
        "incident_groups",
        sa.Column("last_announced_full", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("incident_groups", "last_announced_full")
    op.drop_column("incident_groups", "last_announced_stop_id")
    op.drop_column("incident_groups", "last_announced_fingerprint")
    op.drop_column("incident_groups", "last_announced_at")
