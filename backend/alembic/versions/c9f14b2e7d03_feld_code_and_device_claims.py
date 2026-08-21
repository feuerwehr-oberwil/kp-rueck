"""feld: the four digits under the poster, and the devices that used them

Revision ID: c9f14b2e7d03
Revises: b3e8f1c07a92
Create Date: 2026-08-16 21:40:00.000000

Plan 26, decisions 13, 22, 28 and 30.

Until now the `/feld` link *was* the credential: whoever held the URL could read
the picker and write as any crew in the Ereignis. That is defensible for a poster
inside a locked vehicle hall and indefensible for a printed Einsatzzettel that
leaves in a vehicle and stays valid for thirty days.

``events.feld_code`` is four digits shown under the QR and on the board. It
proves *presence at this Ereignis*, not identity — which is the actual threat
model: the brigade is trusted, a forwarded link is not. Backfilled with a random
code per existing event rather than a constant, so no two events share one and
nothing has to be re-printed to become safe.

``feld_device_claims`` records the phone on the other end. A JWT cannot be
recalled, so a bound token names a row here and dies with it. That is what makes
"alle Geräte abmelden" possible for a lost phone, and it is what lets the board
show *how many* devices redeemed the code — decision 28 chose visible sharing
over a hard cap, because locking out real firefighters mid-storm is the worse
failure.

The table holds no user agent, no IP, no fingerprint. The count is what the KP
needs, and this is the one surface of kp-rueck that touches citizen PII (§9).

Downgrade drops both. Every device is then unlocked again by definition, which
is the pre-plan-26 behaviour.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f14b2e7d03"
down_revision: str | Sequence[str] | None = "b3e8f1c07a92"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable first, then backfilled per row, then tightened: a server_default
    # would have given every existing Ereignis the *same* code.
    op.add_column("events", sa.Column("feld_code", sa.String(length=4), nullable=True))
    op.execute(sa.text("UPDATE events SET feld_code = LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0')"))
    op.alter_column("events", "feld_code", nullable=False)

    op.create_table(
        "feld_device_claims",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("personnel_id", sa.UUID(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["personnel_id"], ["personnel.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_feld_device_claims_event", "feld_device_claims", ["event_id"])
    op.create_index(
        "idx_feld_device_claims_live",
        "feld_device_claims",
        ["event_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_feld_device_claims_live", table_name="feld_device_claims")
    op.drop_index("idx_feld_device_claims_event", table_name="feld_device_claims")
    op.drop_table("feld_device_claims")
    op.drop_column("events", "feld_code")
