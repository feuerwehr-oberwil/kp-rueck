"""Untrusted operational text stays data in PDFs and every XLSX export."""

from datetime import UTC, datetime
from io import BytesIO
from unittest.mock import Mock
from uuid import uuid4

import openpyxl
import pytest
from pypdf import PdfReader

from app.models import Event, Incident, Material, Personnel, SchadenplatzReport, User, Vehicle
from app.services.audit_export_service import EventReportData, _build_audit_workbook
from app.services.excel_import_export import ARCHIVE_SHEET, _build_export_workbook, build_einsaetze_workbook
from app.services.lageblatt_service import build_lageblatt_pdf


def _data(name: str, incidents: list[Incident] | None = None) -> EventReportData:
    return EventReportData(
        event=Event(id=uuid4(), name=name, training_flag=False, created_at=datetime.now(UTC)),
        incidents=incidents or [],
        assignments=[],
        transitions=[],
        reko_reports=[],
    )


@pytest.mark.parametrize("source", ["http://127.0.0.1:9/private.png", "file:///private/station.png"])
def test_lageblatt_event_name_cannot_load_images(monkeypatch, source):
    image_reader = Mock(side_effect=AssertionError("Event text attempted server-side image I/O"))
    monkeypatch.setattr("reportlab.platypus.paraparser.ImageReader", image_reader)
    name = f'<img src="{source}"/>'

    pdf = build_lageblatt_pdf(_data(name))

    image_reader.assert_not_called()
    assert name in "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)


@pytest.mark.parametrize("text", ["=1+1", '=HYPERLINK("https://example.invalid", "click")', "#N/A"])
def test_inventory_and_archive_exports_preserve_text_cells(text):
    vehicle = Vehicle(name=text, type=text, display_order=3, status="available", radio_call_sign=text)
    material = Material(name=text, type=text, location=text, description=text)
    vehicle.archived_at = material.archived_at = datetime.now(UTC)
    output = _build_export_workbook(
        [Personnel(name=text, role=text, status="available")], [vehicle], [material], [vehicle], [material]
    )
    wb = openpyxl.load_workbook(output)
    for sheet_name, coordinate in [("Personnel", "A2"), ("Vehicles", "A2"), ("Materials", "A2"), (ARCHIVE_SHEET, "B3")]:
        cell = wb[sheet_name][coordinate]
        assert (cell.value, cell.data_type) == (text, "s")
    assert wb["Vehicles"]["C2"].value == 3
    assert wb["Vehicles"]["C2"].data_type == "n"


def test_incident_and_audit_exports_cannot_create_formulas():
    text = "=1+1"
    incident = Incident(
        id=uuid4(),
        title=text,
        location_address=text,
        type="elementarereignis",
        priority="medium",
        status="incoming",
        nachbarhilfe=False,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    data = _data(text, [incident])
    data.schadenplatz_reports = [SchadenplatzReport(incident_id=incident.id, owner_name=text, kurzbericht=text)]
    user = User(username=text, display_name=text)

    audit, _ = _build_audit_workbook(data, user)
    for output in [audit, build_einsaetze_workbook(data)]:
        wb = openpyxl.load_workbook(output)
        cells = [cell for sheet in wb for row in sheet for cell in row if cell.value == text]
        assert cells
        assert all(cell.data_type == "s" for cell in cells)
