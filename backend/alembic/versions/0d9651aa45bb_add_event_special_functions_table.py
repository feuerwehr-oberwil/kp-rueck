"""add_event_special_functions_table

Revision ID: 0d9651aa45bb
Revises: 62602ddaaa6f
Create Date: 2025-11-14 15:51:56.191933

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0d9651aa45bb"
down_revision: str | Sequence[str] | None = "62602ddaaa6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "event_special_functions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", UUID(as_uuid=True), nullable=False),
        sa.Column("personnel_id", UUID(as_uuid=True), nullable=False),
        sa.Column("function_type", sa.String(20), nullable=False),
        sa.Column("vehicle_id", UUID(as_uuid=True), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("assigned_by", UUID(as_uuid=True), nullable=True),
        # Foreign keys
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["personnel_id"], ["personnel.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_by"], ["users.id"]),
        # Check constraints
        sa.CheckConstraint("function_type IN ('driver', 'reko', 'magazin')", name="valid_function_type"),
        sa.CheckConstraint(
            "(function_type != 'driver') OR (function_type = 'driver' AND vehicle_id IS NOT NULL)",
            name="driver_requires_vehicle",
        ),
        # Unique constraints
        sa.UniqueConstraint("event_id", "vehicle_id", name="unique_event_vehicle_driver"),
        sa.UniqueConstraint(
            "event_id", "personnel_id", "function_type", "vehicle_id", name="unique_personnel_function_assignment"
        ),
    )

    # Create indexes
    op.create_index("idx_event_special_functions_event", "event_special_functions", ["event_id"])
    op.create_index("idx_event_special_functions_personnel", "event_special_functions", ["personnel_id"])
    op.create_index(
        "idx_event_special_functions_function_type", "event_special_functions", ["event_id", "function_type"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_event_special_functions_function_type", table_name="event_special_functions")
    op.drop_index("idx_event_special_functions_personnel", table_name="event_special_functions")
    op.drop_index("idx_event_special_functions_event", table_name="event_special_functions")
    op.drop_table("event_special_functions")
