"""harmonize_availability_status_to_available_unavailable

Revision ID: 1fab06fcd242
Revises: 2565181f99b1
Create Date: 2026-01-22 10:20:10.402972

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1fab06fcd242"
down_revision: str | Sequence[str] | None = "2565181f99b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: Harmonize availability/status to only 'available' and 'unavailable'."""

    # === PERSONNEL: Map old values to new ===
    # 'assigned' -> 'available' (assignment is tracked via incident_assignments table)
    # 'off_duty' -> 'unavailable'
    # 'inactive' -> 'unavailable'
    op.execute("UPDATE personnel SET availability = 'available' WHERE availability = 'assigned'")
    op.execute("UPDATE personnel SET availability = 'unavailable' WHERE availability IN ('off_duty', 'inactive')")

    # Drop old constraint and create new one
    op.drop_constraint("valid_personnel_availability", "personnel", type_="check")
    op.create_check_constraint(
        "valid_personnel_availability",
        "personnel",
        "availability IN ('available', 'unavailable')"
    )

    # === VEHICLES: Map old values to new ===
    # 'assigned' -> 'available' (assignment is tracked via incident_assignments table)
    # 'planned' -> 'unavailable'
    # 'maintenance' -> 'unavailable'
    op.execute("UPDATE vehicles SET status = 'available' WHERE status = 'assigned'")
    op.execute("UPDATE vehicles SET status = 'unavailable' WHERE status IN ('planned', 'maintenance')")

    # Drop old constraint and create new one
    op.drop_constraint("valid_vehicle_status", "vehicles", type_="check")
    op.create_check_constraint(
        "valid_vehicle_status",
        "vehicles",
        "status IN ('available', 'unavailable')"
    )

    # === MATERIALS: Map old values to new ===
    # 'assigned' -> 'available' (assignment is tracked via incident_assignments table)
    # 'planned' -> 'unavailable'
    # 'maintenance' -> 'unavailable'
    op.execute("UPDATE materials SET status = 'available' WHERE status = 'assigned'")
    op.execute("UPDATE materials SET status = 'unavailable' WHERE status IN ('planned', 'maintenance')")

    # Drop old constraint and create new one
    op.drop_constraint("valid_material_status", "materials", type_="check")
    op.create_check_constraint(
        "valid_material_status",
        "materials",
        "status IN ('available', 'unavailable')"
    )


def downgrade() -> None:
    """Downgrade schema: Restore original status options (cannot fully restore data)."""

    # Note: We cannot restore which items were 'assigned', 'planned', or 'maintenance'
    # as that information is lost in the upgrade. This only restores the constraints.

    # Personnel
    op.drop_constraint("valid_personnel_availability", "personnel", type_="check")
    op.create_check_constraint(
        "valid_personnel_availability",
        "personnel",
        "availability IN ('available', 'assigned', 'unavailable')"
    )

    # Vehicles
    op.drop_constraint("valid_vehicle_status", "vehicles", type_="check")
    op.create_check_constraint(
        "valid_vehicle_status",
        "vehicles",
        "status IN ('available', 'assigned', 'planned', 'maintenance')"
    )

    # Materials
    op.drop_constraint("valid_material_status", "materials", type_="check")
    op.create_check_constraint(
        "valid_material_status",
        "materials",
        "status IN ('available', 'assigned', 'planned', 'maintenance')"
    )
