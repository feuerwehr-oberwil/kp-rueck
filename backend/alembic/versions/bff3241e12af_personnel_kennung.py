"""personnel: kennung — tells two people of the same name apart

Revision ID: bff3241e12af
Revises: e4b7c1d9a3f6
Create Date: 2026-10-26 00:00:00.000000

Two roster people can share a name («Meier Alex»). The Kennung (Jahrgang «1985», Personal-Nr.
«412», …) is what the board shows beside the name when it does. Name + Kennung is unique among
the roster, but enforced by the writers (`crud.personnel`, the Excel import), NOT by an index:
stations already have such pairs without a Kennung, and a unique index would fail this
migration on exactly their data. Existing rows are left as they are – nothing is backfilled.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "bff3241e12af"
down_revision: str | Sequence[str] | None = "e4b7c1d9a3f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("personnel", sa.Column("kennung", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("personnel", "kennung")
