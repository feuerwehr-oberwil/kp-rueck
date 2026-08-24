"""drop the deprecated personnel.divera_user_id dual-write column

Provider identity has lived in ``personnel_external_identities`` since
d4f9a2c7e1b3; the vendor column stayed behind as a dual-write for one
compatibility release. This drops it — but backfills first: any personnel row
that still carries a ``divera_user_id`` without a matching provider="divera"
identity row gets one, so a deployment that never re-ran the sync loses
nothing and no parity pre-check is needed before upgrading.

Downgrade restores column + index and copies the numeric identity values
back, so a rollback is alarm-addressable again immediately.

Revision ID: b7c2e5a1d4f8
Revises: a3c7e21f5b04
Create Date: 2026-08-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c2e5a1d4f8"
down_revision: str | Sequence[str] | None = "a3c7e21f5b04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Defensive backfill before the column disappears: same statement as the
    # d4f9a2c7e1b3 backfill. Bare ON CONFLICT DO NOTHING covers both unique
    # constraints — an existing identity for the person (that row is
    # authoritative, keep it) and a rare duplicate divera_user_id already
    # claimed by another person.
    op.execute(
        """
        INSERT INTO personnel_external_identities (id, personnel_id, provider, external_id)
        SELECT gen_random_uuid(), id, 'divera', divera_user_id::text
        FROM personnel
        WHERE divera_user_id IS NOT NULL
        ON CONFLICT DO NOTHING
        """
    )

    # Inverse of d2f6b1a3c4e5.
    op.drop_index("ix_personnel_divera_user_id", table_name="personnel")
    op.drop_column("personnel", "divera_user_id")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "personnel",
        sa.Column("divera_user_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_personnel_divera_user_id", "personnel", ["divera_user_id"], unique=False)
    # Refill from the identity table (numeric Divera ids only — external_id is
    # opaque text by contract, even though Divera's are digits in practice).
    op.execute(
        """
        UPDATE personnel
        SET divera_user_id = pei.external_id::integer
        FROM personnel_external_identities pei
        WHERE pei.personnel_id = personnel.id
          AND pei.provider = 'divera'
          AND pei.external_id ~ '^[0-9]+$'
        """
    )
