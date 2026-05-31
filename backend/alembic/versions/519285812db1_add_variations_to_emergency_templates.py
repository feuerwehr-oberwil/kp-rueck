"""add_variations_to_emergency_templates

Revision ID: 519285812db1
Revises: 8cbb18ad448d
Create Date: 2026-05-30 12:33:37.883370

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = '519285812db1'
down_revision: Union[str, Sequence[str], None] = '8cbb18ad448d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add JSONB list columns for alternate titles and dispatch messages.

    Each template stays backward compatible: title_pattern / message_pattern
    are still the canonical defaults; the *_variations arrays hold optional
    alternates that the generator picks from at spawn time so two identical
    dispatch types feel different on each run.
    """
    op.add_column(
        "emergency_templates",
        sa.Column("title_variations", JSONB, nullable=True),
    )
    op.add_column(
        "emergency_templates",
        sa.Column("message_variations", JSONB, nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("emergency_templates", "message_variations")
    op.drop_column("emergency_templates", "title_variations")
