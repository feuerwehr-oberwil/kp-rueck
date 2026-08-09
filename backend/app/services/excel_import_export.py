"""Excel import/export service for bulk data management."""

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime
from io import BytesIO
from typing import Any, Literal

import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Material, Personnel, Vehicle
from .audit_export_service import EventReportData
from .pdf_report_service import (
    LOCAL_TZ,
    WorkWindow,
    board_personnel_count,
    material_checklist_rows,
    material_left_on_site_names,
    material_used_label,
    rapport_by_incident,
    rapport_filing_lines,
    rapport_work_windows,
    vehicle_present_names,
)

# Column definitions
PERSONNEL_COLUMNS = [
    ("name", True),  # (column_name, required)
    ("role", False),
    ("status", False),
]

# The personnel column was called "availability" until the field was renamed to
# match Vehicle.status / Material.status. Workbooks exported before that are still
# accepted on import; only the header differs, the values never did.
LEGACY_PERSONNEL_COLUMNS = [("availability" if name == "status" else name) for name, _ in PERSONNEL_COLUMNS]

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
        raise ExcelImportError(f"Invalid Excel file: {e!s}") from e

    result: dict[str, list[dict[str, Any]]] = {"personnel": [], "vehicles": [], "materials": []}

    # Validate Personnel sheet
    if "Personnel" in wb.sheetnames:
        ws = wb["Personnel"]
        headers = [cell.value for cell in ws[1]]
        expected_headers = [col[0] for col in PERSONNEL_COLUMNS]

        if headers == LEGACY_PERSONNEL_COLUMNS:
            headers = expected_headers
        if headers != expected_headers:
            raise ExcelImportError(f"Personnel sheet: Expected columns {expected_headers}, got {headers}")

        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if all(cell is None for cell in row):
                continue  # Skip empty rows

            row_data = dict(zip(expected_headers, row, strict=False))

            # Validate required fields
            if not row_data.get("name"):
                raise ExcelImportError(f"Personnel row {row_idx}: 'name' is required")

            # Validate enum values
            if row_data.get("status") and row_data["status"] not in PERSONNEL_STATUSES:
                raise ExcelImportError(
                    f"Personnel row {row_idx}: Invalid status '{row_data['status']}'. "
                    f"Must be one of: {PERSONNEL_STATUSES}"
                )

            # Set defaults
            if not row_data.get("status"):
                row_data["status"] = "unavailable"

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

            row_data = dict(zip(expected_headers, row, strict=False))

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
                raise ExcelImportError(f"Vehicles row {row_idx}: display_order must be an integer") from None

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

            row_data = dict(zip(expected_headers, row, strict=False))

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
    personnel_result = await db.execute(select(Personnel).order_by(Personnel.name))
    personnel = personnel_result.scalars().all()
    vehicle_result = await db.execute(select(Vehicle).order_by(Vehicle.display_order))
    vehicles = vehicle_result.scalars().all()
    material_result = await db.execute(select(Material).order_by(Material.location, Material.name))
    materials = material_result.scalars().all()

    # openpyxl workbook building is pure CPU — keep it off the event loop
    # so a large export doesn't freeze every operator's requests (audit H4).
    return await asyncio.to_thread(_build_export_workbook, personnel, vehicles, materials)


def _build_export_workbook(
    personnel: Sequence[Personnel], vehicles: Sequence[Vehicle], materials: Sequence[Material]
) -> BytesIO:
    """Blocking workbook construction — runs in a worker thread."""
    wb = Workbook()
    wb.remove(wb.active)

    # Personnel sheet
    ws_personnel = wb.create_sheet("Personnel")
    ws_personnel.append([col[0] for col in PERSONNEL_COLUMNS])
    for cell in ws_personnel[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

    for person in personnel:
        ws_personnel.append(
            [
                person.name,
                person.role or "",
                person.status,
            ]
        )

    # Vehicles sheet
    ws_vehicles = wb.create_sheet("Vehicles")
    ws_vehicles.append([col[0] for col in VEHICLE_COLUMNS])
    for cell in ws_vehicles[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

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


# ---------------------------------------------------------------------------
# Einsätze export (plan 25, §7 / decision 21)
#
# One wide row per Schadenplatz. It matches **no** external format on purpose:
# somebody retypes this into the billing system by hand, and that system is
# archaic enough that mirroring its layout buys nothing — so the sheet optimises
# for being *read while retyping*: human headers, everything about one
# Schadenplatz on one line, and no derived person-hours column (nothing
# downstream asked for one; `cost_snapshot_json` keeps the per-person from/to if
# that ever changes). It just does not need that name on it: the crew filling
# the slip is recording an Einsatz, not writing an invoice.
# ---------------------------------------------------------------------------

# (header, column width), in the reading order of the paper slip.
EINSAETZE_COLUMNS: list[tuple[str, int]] = [
    ("Einsatz-Nr.", 11),
    ("Adresse", 34),
    ("Beginn", 17),
    ("Ende", 17),
    ("Dauer", 9),
    ("Personal", 9),
    ("Personal korrigiert", 20),
    ("Fahrzeuge", 34),
    # One column, not four (§18.10): the form asks one free-text question, so
    # splitting the answer back into Name/Strasse/Ort/KFZ here would be guessing.
    ("Eigentümer / Halter", 46),
    ("Material gebraucht", 46),
    ("Material vor Ort verblieben", 34),
    ("Weiteres Material", 28),
    ("Kurzbericht", 60),
    ("Erfasst von", 44),
]


def _local_dt(value: datetime | None) -> str:
    """``DD.MM.YYYY HH:MM`` in Swiss local time, or empty.

    This sheet is read by a person with a wall clock, not by a machine — hence
    local time here where the audit export uses ISO 8601.
    """
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M")


def format_duration(start: datetime | None, end: datetime | None) -> str:
    """``h:mm`` between the two Tätigkeit timestamps, or empty.

    Computed, never stored, so it always agrees with the Beginn/Ende on its own
    row — which are themselves derived from the board (`rapport_work_windows`).
    """
    if start is None or end is None:
        return ""
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    if end.tzinfo is None:
        end = end.replace(tzinfo=UTC)
    minutes = int((end - start).total_seconds() // 60)
    if minutes < 0:
        return ""
    return f"{minutes // 60}:{minutes % 60:02d}"


def _corrected_cell(corrected: bool, board_value: int) -> str:
    """``Ja (Board: 6)`` — the flag plus the number the crew disagreed with.

    The divergence is itself information (decision 5): it says the board was
    behind reality, and a corrected count without the board's own number next
    to it is just a number.
    """
    return f"Ja (Board: {board_value})" if corrected else ""


def build_einsaetze_workbook(data: EventReportData) -> BytesIO:
    """One row per Schadenplatz, including the ones **without** a rapport.

    A missing rapport is a blank row carrying its address, never a missing row:
    there is no acceptance step by design (decision 10), so the gaps have to be
    visible to whoever writes the invoices.
    """
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Einsätze")

    for col_num, (header, width) in enumerate(EINSAETZE_COLUMNS, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="left", vertical="top")
        ws.column_dimensions[cell.column_letter].width = width
    ws.freeze_panes = "A2"

    reports = rapport_by_incident(data)
    # Beginn/Ende are derived from the board once for the whole sheet — the crew
    # no longer types them, and this walks the already-loaded assignments and
    # transitions rather than querying per row.
    windows = rapport_work_windows(data)

    for row_num, (index, incident) in enumerate(enumerate(data.incidents, 1), 2):
        report = reports.get(incident.id)

        values: list[Any]
        if report is None:
            values = [index, incident.location_address or "", *[""] * (len(EINSAETZE_COLUMNS) - 2)]
        else:
            window = windows.get(incident.id, WorkWindow(None, None))
            values = [
                index,
                incident.location_address or "",
                _local_dt(window.started_at),
                _local_dt(window.ended_at),
                format_duration(window.started_at, window.ended_at),
                report.personnel_count if report.personnel_count is not None else "",
                _corrected_cell(report.personnel_count_corrected, board_personnel_count(data, incident.id)),
                # The vehicles the crew ticked, by name: which ones were there is
                # the question the billing side actually asks, and a number
                # answers it for nobody.
                ", ".join(vehicle_present_names(report)),
                report.owner_note or "",
                # Every unit with its own answer, "nicht gebraucht" included
                # (decision 16) and "keine Angabe" as the third state a crew can
                # give (decision 14). Consumables carry no left-on-site state at
                # all, which is why that lives in its own column (decision 26).
                "; ".join(
                    f"{row.get('name') or '?'}: {material_used_label(row.get('used'))}"
                    for row in material_checklist_rows(report)
                ),
                ", ".join(material_left_on_site_names(report)),
                report.extra_material_note or "",
                report.kurzbericht or "",
                " · ".join(rapport_filing_lines(data, report)),
            ]

        for col_num, value in enumerate(values, 1):
            cell = ws.cell(row=row_num, column=col_num, value=value)
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output


async def export_einsaetze_excel(data: EventReportData) -> BytesIO:
    """Build the Einsätze workbook off the event loop (audit H4)."""
    return await asyncio.to_thread(build_einsaetze_workbook, data)
