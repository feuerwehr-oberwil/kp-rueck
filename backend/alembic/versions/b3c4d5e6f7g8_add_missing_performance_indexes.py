"""Add missing performance indexes on frequently queried columns.

Revision ID: b3c4d5e6f7g8
Revises: a2b3c4d5e6f7
Create Date: 2026-02-19 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7g8"
down_revision: str = "a2b3c4d5e6f7"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Vehicle indexes
    op.create_index("idx_vehicles_status", "vehicles", ["status"])
    op.create_index("idx_vehicles_display_order", "vehicles", ["display_order"])

    # Personnel indexes
    op.create_index("idx_personnel_availability", "personnel", ["availability"])
    op.create_index("idx_personnel_role_sort_order", "personnel", ["role_sort_order"])

    # Material indexes
    op.create_index("idx_materials_status", "materials", ["status"])
    op.create_index("idx_materials_location_sort_order", "materials", ["location_sort_order"])


def downgrade() -> None:
    op.drop_index("idx_materials_location_sort_order", table_name="materials")
    op.drop_index("idx_materials_status", table_name="materials")
    op.drop_index("idx_personnel_role_sort_order", table_name="personnel")
    op.drop_index("idx_personnel_availability", table_name="personnel")
    op.drop_index("idx_vehicles_display_order", table_name="vehicles")
    op.drop_index("idx_vehicles_status", table_name="vehicles")
