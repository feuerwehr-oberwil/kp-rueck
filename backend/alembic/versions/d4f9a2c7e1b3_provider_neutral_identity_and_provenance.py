"""provider-neutral personnel identities and incident provenance

Two pieces of the provider-neutral data model:

1. ``personnel_external_identities`` — providers (Divera, Alamos, …) attach
   identity (provider slug + opaque external id) to canonical local personnel
   instead of vendor columns. Existing ``personnel.divera_user_id`` values are
   backfilled as provider="divera" rows; the legacy column stays as a
   deprecated dual-write for one compatibility release.

2. ``incidents.source_ref`` — the alarm's id in the delivering system, set
   when an incident is created from a pool alarm (pairs with the existing
   ``source`` column).

Revision ID: d4f9a2c7e1b3
Revises: c3e8f1a6b2d9
Create Date: 2026-07-19 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f9a2c7e1b3"
down_revision: str | Sequence[str] | None = "c3e8f1a6b2d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "personnel_external_identities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "personnel_id",
            UUID(as_uuid=True),
            sa.ForeignKey("personnel.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("external_id", sa.Text(), nullable=False),
        sa.Column("metadata_json", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider", "external_id", name="uq_personnel_ext_provider_external_id"),
        sa.UniqueConstraint("personnel_id", "provider", name="uq_personnel_ext_personnel_provider"),
    )
    op.create_index(
        "ix_personnel_external_identities_personnel_id",
        "personnel_external_identities",
        ["personnel_id"],
    )
    # Backfill from the deprecated vendor column (idempotent on re-run)
    op.execute(
        """
        INSERT INTO personnel_external_identities (id, personnel_id, provider, external_id)
        SELECT gen_random_uuid(), id, 'divera', divera_user_id::text
        FROM personnel
        WHERE divera_user_id IS NOT NULL
        ON CONFLICT (personnel_id, provider) DO NOTHING
        """
    )

    op.add_column("incidents", sa.Column("source_ref", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("incidents", "source_ref")
    op.drop_index(
        "ix_personnel_external_identities_personnel_id",
        table_name="personnel_external_identities",
    )
    op.drop_table("personnel_external_identities")
