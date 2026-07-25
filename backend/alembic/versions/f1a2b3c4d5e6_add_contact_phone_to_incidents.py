"""add contact_phone to incidents

Adds a dedicated direct-contact phone number for the reporter (Melder/Anrufer),
separate from the free-text `contact` field, so it can be rendered as a
tappable tel: link.

Revision ID: f1a2b3c4d5e6
Revises: e5b2c9d4a8f1
Create Date: 2026-07-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "e5b2c9d4a8f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("incidents", sa.Column("contact_phone", sa.String(length=50), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("incidents", "contact_phone")
