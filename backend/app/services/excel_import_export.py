"""Excel import/export service for bulk data management."""

from io import BytesIO
from typing import Any, Literal

import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Material, Personnel, Vehicle

# Column definitions
PERSONNEL_COLUMNS = [
    ("name", True),  # (column_name, required)
    ("role", False),
    ("availability", False),
]

VEHICLE_COLUMNS = [
    ("name", True),
    ("type", True),
    ("display_order", True),
    ("status", True),
    ("radio_call_sign", True),
]

MATERIAL_COLUMNS = [
    ("name", True),
    ("type", True),
    ("location", True),
    ("description", False),
]

# Valid enum values
VEHICLE_TYPES = ["TLF", "DLK", "MTW", "KDO", "KdoW", "VRW", "RW", "Anhänger"]
VEHICLE_STATUSES = ["available", "unavailable"]
PERSONNEL_STATUSES = ["available", "unavailable"]
# Material types are no longer hardcoded - validation now accepts any non-empty string


class ExcelImportError(Exception):
    """Excel import validation error."""

    pass


def generate_empty_template() -> BytesIO:
    """Generate empty Excel template with example rows."""
    wb = Workbook()
    wb.remove(wb.active)  # Remove default sheet

    # Personnel sheet
    ws_personnel = wb.create_sheet("Personnel")
    ws_personnel.append([col[0] for col in PERSONNEL_COLUMNS])
    # Header styling
    for cell in ws_personnel[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    # Example rows
    ws_personnel.append(["Max Mustermann", "Fahrer", "available"])
    ws_personnel.append(["Anna Schmidt", "", "unavailable"])

    # Vehicles sheet
    ws_vehicles = wb.create_sheet("Vehicles")
    ws_vehicles.append([col[0] for col in VEHICLE_COLUMNS])
    for cell in ws_vehicles[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    ws_vehicles.append(["TLF 1", "TLF", "1", "available", "Florian 1"])
    ws_vehicles.append(["DLK 1", "DLK", "2", "available", "Florian 2"])

    # Materials sheet
    ws_materials = wb.create_sheet("Materials")
    ws_materials.append([col[0] for col in MATERIAL_COLUMNS])
    for cell in ws_materials[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
    # Example with duplicates showing multiple items
    ws_materials.append(["Tauchpumpe Gr.", "Tauchpumpen", "TLF", ""])
    ws_materials.append(["Tauchpumpe Kl.", "Tauchpumpen", "TLF", ""])
    ws_materials.append(["Wassersauger", "Wassersauger", "Pio", ""])

    # Save to BytesIO
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def validate_and_parse_excel(
    file_bytes: bytes,
) -> dict[str, list[dict[str, Any]]]:
    """
    Validate and parse Excel file.

    Returns dict with keys: 'personnel', 'vehicles', 'materials'
    Each value is a list of row dicts.

    Raises ExcelImportError if validation fails.
    """
    try:
        wb = openpyxl.load_workbook(BytesIO(file_bytes))
    except Exception as e:
        raise ExcelImportError(f"Invalid Excel file: {str(e)}")

    result = {"personnel": [], "vehicles": [], "materials": []}

    # Validate Personnel sheet
    if "Personnel" in wb.sheetnames:
        ws = wb["Personnel"]
        headers = [cell.value for cell in ws[1]]
        expected_headers = [col[0] for col in PERSONNEL_COLUMNS]

        if headers != expected_headers:
            raise ExcelImportError(f"Personnel sheet: Expected columns {expected_headers}, got {headers}")

        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if all(cell is None for cell in row):
                continue  # Skip empty rows

            row_data = dict(zip(expected_headers, row))

            # Validate required fields
            if not row_data.get("name"):
                raise ExcelImportError(f"Personnel row {row_idx}: 'name' is required")

            # Validate enum values
            if row_data.get("availability") and row_data["availability"] not in PERSONNEL_STATUSES:
                raise ExcelImportError(
                    f"Personnel row {row_idx}: Invalid availability '{row_data['availability']}'. "
                    f"Must be one of: {PERSONNEL_STATUSES}"
                )

            # Set defaults
            if not row_data.get("availability"):
                row_data["availability"] = "unavailable"

            result["personnel"].append(row_data)

    # Validate Vehicles sheet
    if "Vehicles" in wb.sheetnames:
        ws = wb["Vehicles"]
        headers = [cell.value for cell in ws[1]]
        expected_headers = [col[0] for col in VEHICLE_COLUMNS]

        if headers != expected_headers:
            raise ExcelImportError(f"Vehicles sheet: Expected columns {expected_headers}, got {headers}")

        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if all(cell is None for cell in row):
                continue

            row_data = dict(zip(expected_headers, row))

            # Validate required fields
            required = ["name", "type", "display_order", "status", "radio_call_sign"]
            for field in required:
                if not row_data.get(field):
                    raise ExcelImportError(f"Vehicles row {row_idx}: '{field}' is required")

            # Validate status enum
            if row_data["status"] not in VEHICLE_STATUSES:
                raise ExcelImportError(
                    f"Vehicles row {row_idx}: Invalid status '{row_data['status']}'. Must be one of: {VEHICLE_STATUSES}"
                )

            # Validate display_order is integer
            try:
                row_data["display_order"] = int(row_data["display_order"])
            except (ValueError, TypeError):
                raise ExcelImportError(f"Vehicles row {row_idx}: display_order must be an integer")

            result["vehicles"].append(row_data)

    # Validate Materials sheet
    if "Materials" in wb.sheetnames:
        ws = wb["Materials"]
        headers = [cell.value for cell in ws[1]]
        expected_headers = [col[0] for col in MATERIAL_COLUMNS]

        if headers != expected_headers:
            raise ExcelImportError(f"Materials sheet: Expected columns {expected_headers}, got {headers}")

        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if all(cell is None for cell in row):
                continue

            row_data = dict(zip(expected_headers, row))

            # Validate required fields
            required = ["name", "type", "location"]
            for field in required:
                if not row_data.get(field):
                    raise ExcelImportError(f"Materials row {row_idx}: '{field}' is required")

            # No hardcoded validation for material type - accepts any non-empty string
            # This allows flexibility for different material categories

            result["materials"].append(row_data)

    return result


async def import_data(
    db: AsyncSession,
    parsed_data: dict[str, list[dict[str, Any]]],
    mode: Literal["replace", "merge", "append"],
    user_id: str,
) -> dict[str, int]:
    """
    Import parsed data into database.

    Modes:
    - replace: Delete all existing, insert new
    - merge: Update existing by name, add new (not implemented - use replace or append)
    - append: Keep existing, add new

    Returns counts: {personnel: X, vehicles: Y, materials: Z}
    """
    counts = {"personnel": 0, "vehicles": 0, "materials": 0}

    if mode == "replace":
        # Delete all existing
        await db.execute(delete(Personnel))
        await db.execute(delete(Vehicle))
        await db.execute(delete(Material))
        await db.commit()
    elif mode == "merge":
        # Merge not implemented in this version - requires UUID matching
        # For now, treat as replace
        await db.execute(delete(Personnel))
        await db.execute(delete(Vehicle))
        await db.execute(delete(Material))
        await db.commit()

    # Insert personnel
    for person_data in parsed_data.get("personnel", []):
        personnel = Personnel(**person_data)
        db.add(personnel)
        counts["personnel"] += 1

    # Insert vehicles
    for vehicle_data in parsed_data.get("vehicles", []):
        vehicle = Vehicle(**vehicle_data)
        db.add(vehicle)
        counts["vehicles"] += 1

    # Insert materials (duplicate rows = multiple items)
    for material_data in parsed_data.get("materials", []):
        material = Material(**material_data)
        db.add(material)
        counts["materials"] += 1

    await db.commit()

    return counts


async def export_data_to_excel(db: AsyncSession) -> BytesIO:
    """Export all personnel, vehicles, and materials to Excel."""
    wb = Workbook()
    wb.remove(wb.active)

    # Personnel sheet
    ws_personnel = wb.create_sheet("Personnel")
    ws_personnel.append([col[0] for col in PERSONNEL_COLUMNS])
    for cell in ws_personnel[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

    result = await db.execute(select(Personnel).order_by(Personnel.name))
    personnel = result.scalars().all()
    for person in personnel:
        ws_personnel.append(
            [
                person.name,
                person.role or "",
                person.availability,
            ]
        )

    # Vehicles sheet
    ws_vehicles = wb.create_sheet("Vehicles")
    ws_vehicles.append([col[0] for col in VEHICLE_COLUMNS])
    for cell in ws_vehicles[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

    result = await db.execute(select(Vehicle).order_by(Vehicle.display_order))
    vehicles = result.scalars().all()
    for vehicle in vehicles:
        ws_vehicles.append(
            [
                vehicle.name,
                vehicle.type,
                vehicle.display_order,
                vehicle.status,
                vehicle.radio_call_sign,
            ]
        )

    # Materials sheet
    ws_materials = wb.create_sheet("Materials")
    ws_materials.append([col[0] for col in MATERIAL_COLUMNS])
    for cell in ws_materials[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

    result = await db.execute(select(Material).order_by(Material.location, Material.name))
    materials = result.scalars().all()
    for material in materials:
        ws_materials.append(
            [
                material.name,
                material.type,
                material.location,
                material.description or "",
            ]
        )

    # Save to BytesIO
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output
