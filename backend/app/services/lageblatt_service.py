"""Lageblatt (Führungsformular) PDF — the paper-fallback board snapshot.

Generates an A4 sheet modelled on the cantonal "Führungsformular
Elementarschaden FWI BL/BS": one row per incident with Meldung Eingang
(Zeit/Wo/Was), Reko (Zeit/Wer/Rückmeldung), Auftrag (Zeit/Wer/Womit) and an
Erledigt column, followed by empty rows so operators can continue on the same
sheet by hand when the digital board is unavailable.
"""

import uuid
from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)

from ..models import Incident, RekoReport, StatusTransition
from .audit_export_service import EventReportData
from .pdf_report_service import LOCAL_TZ, format_location_for_display

# The handwriting continuation area: empty grid rows appended after the data.
EMPTY_ROWS = 10

_BORDER = colors.HexColor("#a1a1aa")
_HEADER_BG = colors.HexColor("#f4f4f5")

_PRIORITY_SHORT = {"high": "H", "medium": "M", "low": "T"}

_CELL = ParagraphStyle(
    "lageblatt_cell",
    fontName="Helvetica",
    fontSize=6.5,
    leading=8,
    alignment=TA_LEFT,
)
_CELL_BOLD = ParagraphStyle("lageblatt_cell_bold", parent=_CELL, fontName="Helvetica-Bold")


def _time(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone(LOCAL_TZ).strftime("%H:%M")


def _clip(text: str | None, limit: int) -> str:
    if not text:
        return ""
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _p(text: str, bold: bool = False) -> Paragraph:
    from xml.sax.saxutils import escape

    return Paragraph(escape(text), _CELL_BOLD if bold else _CELL)


def _first_reko(data: EventReportData, incident_id: uuid.UUID) -> RekoReport | None:
    reports = [r for r in data.reko_reports if r.incident_id == incident_id and not r.is_draft]
    reports.sort(key=lambda r: r.submitted_at)
    return reports[0] if reports else None


def _first_transition_to(data: EventReportData, incident_id: uuid.UUID, statuses: set[str]) -> StatusTransition | None:
    hits = [t for t in data.transitions if t.incident_id == incident_id and t.to_status in statuses]
    hits.sort(key=lambda t: t.timestamp)
    return hits[0] if hits else None


def _auftrag_resources(data: EventReportData, incident_id: uuid.UUID) -> str:
    """Compact 'Wer/Womit': vehicles first, then crew, '+N' beyond three names."""
    active = [a for a in data.assignments if a.incident_id == incident_id and a.unassigned_at is None]
    vehicles = [
        data.vehicle_map[a.resource_id].name
        for a in active
        if a.resource_type == "vehicle" and a.resource_id in data.vehicle_map
    ]
    crew = [
        data.personnel_map[a.resource_id].name
        for a in active
        if a.resource_type == "personnel" and a.resource_id in data.personnel_map
    ]
    names = vehicles + crew
    if len(names) > 3:
        names = names[:3] + [f"+{len(names) - 3}"]
    return ", ".join(names)


def _incident_row(data: EventReportData, inc: Incident, index: int, home_city: str) -> list:
    reko = _first_reko(data, inc.id)
    reko_by = ""
    if reko and reko.submitted_by_personnel_id in data.personnel_map:
        reko_by = data.personnel_map[reko.submitted_by_personnel_id].name
    dispo = _first_transition_to(data, inc.id, {"disponiert", "einsatz"})
    done = inc.status in ("einsatz_beendet", "abschluss") or inc.completed_at is not None

    return [
        _p(str(index), bold=True),
        _p(_PRIORITY_SHORT.get(inc.priority, "")),
        _p(_time(inc.created_at)),
        _p(_clip(format_location_for_display(inc.location_address, home_city), 45)),
        _p(_clip(inc.title, 60)),
        _p(_time(reko.submitted_at) if reko else ""),
        _p(_clip(reko_by, 24)),
        _p(_clip(reko.summary_text if reko else "", 70)),
        _p(_time(dispo.timestamp) if dispo else ""),
        _p(_clip(_auftrag_resources(data, inc.id), 40)),
        _p("✓" if done else ""),
    ]


def build_lageblatt_pdf(data: EventReportData, home_city: str = "") -> bytes:
    """Render the Lageblatt PDF and return it as bytes."""
    now_local = datetime.now(LOCAL_TZ)
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=8 * mm,
        rightMargin=8 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f"Lageblatt — {data.event.name}",
    )

    title_style = ParagraphStyle("lageblatt_title", fontName="Helvetica-Bold", fontSize=11, leading=14)
    meta_style = ParagraphStyle("lageblatt_meta", fontName="Helvetica", fontSize=8, leading=10)

    story = [
        Paragraph(f"Ereignis: {data.event.name}", title_style),
        Paragraph(
            f"Datum: {now_local.strftime('%d.%m.%Y')} — Stand: {now_local.strftime('%H:%M')} Uhr"
            " — bei Ausfall des digitalen Boards gilt dieses Blatt; Änderungen von Hand mit Zeit nachführen.",
            meta_style,
        ),
        Spacer(1, 3 * mm),
    ]

    # Two header rows: group labels with SPANs, then the sub-columns —
    # mirroring the cantonal Führungsformular so crews recognise the layout.
    header_group = [
        _p("Nr", bold=True),
        _p("Prio", bold=True),
        _p("Meldung Eingang", bold=True),
        "",
        "",
        _p("Reko", bold=True),
        "",
        "",
        _p("Auftrag", bold=True),
        "",
        _p("Erl.", bold=True),
    ]
    header_sub = [
        "",
        "",
        _p("Zeit", bold=True),
        _p("Wo", bold=True),
        _p("Was", bold=True),
        _p("Zeit", bold=True),
        _p("Wer", bold=True),
        _p("Rückmeldung", bold=True),
        _p("Zeit", bold=True),
        _p("Wer / Womit", bold=True),
        "",
    ]

    rows: list[list] = [header_group, header_sub]
    for index, inc in enumerate(data.incidents, start=1):
        rows.append(_incident_row(data, inc, index, home_city))
    for _ in range(EMPTY_ROWS):
        rows.append([""] * 11)

    usable = A4[0] - 16 * mm
    fractions = [0.040, 0.040, 0.062, 0.150, 0.180, 0.062, 0.095, 0.155, 0.062, 0.114, 0.040]
    col_widths = [usable * f for f in fractions]

    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, _BORDER),
        ("BACKGROUND", (0, 0), (-1, 1), _HEADER_BG),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        # Group header spans (Nr/Prio/Erl. span both header rows)
        ("SPAN", (0, 0), (0, 1)),
        ("SPAN", (1, 0), (1, 1)),
        ("SPAN", (2, 0), (4, 0)),
        ("SPAN", (5, 0), (7, 0)),
        ("SPAN", (8, 0), (9, 0)),
        ("SPAN", (10, 0), (10, 1)),
    ]
    # Fixed-height empty rows: comfortable handwriting space.
    table = LongTable(
        rows,
        colWidths=col_widths,
        repeatRows=2,
        rowHeights=[None] * (2 + len(data.incidents)) + [9 * mm] * EMPTY_ROWS,
    )
    table.setStyle(TableStyle(style))
    story.append(table)

    footer_style = ParagraphStyle(
        "lageblatt_footer", fontName="Helvetica", fontSize=6.5, leading=8, textColor=colors.grey
    )
    story.append(Spacer(1, 2 * mm))
    story.append(
        Paragraph(
            "KP Rück — Lageblatt (angelehnt an Führungsformular Elementarschaden FWI BL/BS)",
            footer_style,
        )
    )

    doc.build(story)
    return buffer.getvalue()
