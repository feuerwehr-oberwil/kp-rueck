"""Drop the town defaults on training_locations

``postal_code`` defaulted to ``4104`` and ``city`` to ``Oberwil`` at the database level, so any
insert that omitted them silently placed the row in one specific Swiss municipality — on every
deployment, including stations several cantons or a border away. The application always supplies
both columns; the defaults only ever fired as a wrong answer.

Existing rows are untouched: this changes what happens to the NEXT insert, not what is already
stored. A station that really did seed the old fallback locations keeps them and can delete them
from the training surface.

Revision ID: a3d7f19c4b28
Revises: f8c2d4a6b1e3
Create Date: 2026-07-26 09:40:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3d7f19c4b28"
down_revision: str | None = "f8c2d4a6b1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("training_locations", "postal_code", server_default=None)
    op.alter_column("training_locations", "city", server_default=None)


def downgrade() -> None:
    op.alter_column(
        "training_locations",
        "postal_code",
        existing_type=sa.String(length=10),
        server_default="4104",
    )
    op.alter_column(
        "training_locations",
        "city",
        existing_type=sa.String(length=100),
        server_default="Oberwil",
    )
