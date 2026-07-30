"""Lageblatt (Führungsformular) PDF — the paper-fallback board snapshot.

Page 1 (or more): an A4 sheet modelled on the cantonal "Führungsformular
Elementarschaden FWI BL/BS" — one dense row per incident with Meldung Eingang
(Zeit/Wo/Was), Reko (Zeit/Wer/Rückmeldung), Auftrag (Zeit/Wer/Womit) and an
Erledigt column, followed by empty rows so operators can continue on the same
sheet by hand when the digital board is unavailable. Meant to be printed on
A3/A1 for the command post wall, hence the small type.

Appended detail pages: one block per incident with the full metadata
(description, contact, flags, complete crew, vehicles, materials, all reko
reports, internal notes) — too much for the table, essential for working
through an outage.
"""

import uuid
from datetime import datetime
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)

from ..models import Incident, RekoReport, StatusTransition
from .audit_export_service import EventReportData
from .pdf_report_service import (
    LOCAL_TZ,
    PRIORITY_LABELS,
    STATUS_LABELS,
    TYPE_LABELS,
    format_location_for_display,
)

# The handwriting continuation area: empty grid rows appended after the data.
EMPTY_ROWS = 10

# One uniform height for every data/empty row: fits three 6pt lines plus
# padding, and doubles as handwriting space.
ROW_HEIGHT = 9 * mm

_BORDER = colors.HexColor("#a1a1aa")
_HEADER_BG = colors.HexColor("#f4f4f5")

_PRIORITY_SHORT = {"high": "H", "medium": "M", "low": "T"}

# Swiss fire service rank order (highest first) and compact display prefixes.
# role_sort_order in the DB is not reliably populated, so rank by name.
_ROLE_RANK = {"offiziere": 0, "wachtmeister": 1, "korporal": 2, "mannschaft": 3}
_ROLE_ABBR = {"offiziere": "Of", "wachtmeister": "Wm", "korporal": "Kpl", "mannschaft": ""}

_CELL = ParagraphStyle(
    "lageblatt_cell",
    fontName="Helvetica",
    fontSize=6,
    leading=7.2,
    alignment=TA_LEFT,
)
_CELL_BOLD = ParagraphStyle("lageblatt_cell_bold", parent=_CELL, fontName="Helvetica-Bold")

_DETAIL_LABEL = ParagraphStyle("lageblatt_detail_label", fontName="Helvetica-Bold", fontSize=7, leading=8.5)
_DETAIL_VALUE = ParagraphStyle("lageblatt_detail_value", fontName="Helvetica", fontSize=7, leading=8.5)
_DETAIL_HEAD = ParagraphStyle("lageblatt_detail_head", fontName="Helvetica-Bold", fontSize=9, leading=11)


def _time(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone(LOCAL_TZ).strftime("%H:%M")


def _dt_full(dt: datetime | None) -> str:
    if dt is None:
        return "—"
    return dt.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M")


def _clip(text: str | None, limit: int) -> str:
    if not text:
        return ""
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _p(text: str, bold: bool = False) -> Paragraph:
    return Paragraph(escape(text), _CELL_BOLD if bold else _CELL)


def _first_reko(data: EventReportData, incident_id: uuid.UUID) -> RekoReport | None:
    reports = [r for r in data.reko_reports if r.incident_id == incident_id and not r.is_draft]
    reports.sort(key=lambda r: r.submitted_at)
    return reports[0] if reports else None


def _first_transition_to(data: EventReportData, incident_id: uuid.UUID, statuses: set[str]) -> StatusTransition | None:
    hits = [t for t in data.transitions if t.incident_id == incident_id and t.to_status in statuses]
    hits.sort(key=lambda t: t.timestamp)
    return hits[0] if hits else None


def _active_resources(data: EventReportData, incident_id: uuid.UUID) -> tuple[list, list, list]:
    """(crew Personnel, vehicles Vehicle, materials Material) actively assigned."""
    active = [a for a in data.assignments if a.incident_id == incident_id and a.unassigned_at is None]
    crew = [
        data.personnel_map[a.resource_id]
        for a in active
        if a.resource_type == "personnel" and a.resource_id in data.personnel_map
    ]
    vehicles = [
        data.vehicle_map[a.resource_id]
        for a in active
        if a.resource_type == "vehicle" and a.resource_id in data.vehicle_map
    ]
    materials = [
        data.material_map[a.resource_id]
        for a in active
        if a.resource_type == "material" and a.resource_id in data.material_map
    ]
    return crew, vehicles, materials


def _rank_key(person) -> tuple:
    role = (person.role or "").lower()
    return (_ROLE_RANK.get(role, 98), person.role_sort_order, person.name)


def _mittel(inc: Incident, vehicles: list) -> list[str]:
    """Womit: vehicles, with 'Zu Fuss' treated like one more vehicle."""
    names = [v.name for v in vehicles]
    if inc.zu_fuss:
        names.append("Zu Fuss")
    return names


def _crew_compact(crew: list) -> str:
    """Highest rank + count instead of everyone: 'Of Muster +4'."""
    if not crew:
        return ""
    top = min(crew, key=_rank_key)
    abbr = _ROLE_ABBR.get((top.role or "").lower())
    if abbr is None:
        abbr = _clip(top.role or "", 8)
    label = f"{abbr} {top.name}".strip()
    extra = len(crew) - 1
    return f"{label} +{extra}" if extra else label


def _incident_row(data: EventReportData, inc: Incident, index: int, home_city: str) -> list:
    reko = _first_reko(data, inc.id)
    reko_by = ""
    if reko and reko.submitted_by_personnel_id in data.personnel_map:
        reko_by = data.personnel_map[reko.submitted_by_personnel_id].name
    dispo = _first_transition_to(data, inc.id, {"enroute", "active"})
    done = inc.status in ("returning", "complete") or inc.completed_at is not None
    crew, vehicles, _materials = _active_resources(data, inc.id)

    return [
        _p(str(index), bold=True),
        _p(_PRIORITY_SHORT.get(inc.priority, "")),
        _p(_time(inc.created_at)),
        _p(_clip(format_location_for_display(inc.location_address, home_city), 50)),
        _p(_clip(inc.title, 65)),
        _p(_time(reko.submitted_at) if reko else ""),
        _p(_clip(reko_by, 22)),
        _p(_clip(reko.summary_text if reko else "", 80)),
        _p(_time(dispo.timestamp) if dispo else ""),
        _p(_clip(_crew_compact(crew), 24)),
        _p(_clip(", ".join(_mittel(inc, vehicles)), 22)),
        _p("✓" if done else ""),
    ]


def _json_true_keys(payload) -> str:
    """Compact rendering for dangers/effort JSON: list truthy entries."""
    if not isinstance(payload, dict):
        return ""
    parts = []
    for key, value in payload.items():
        if value is True:
            parts.append(str(key))
        elif value not in (False, None, "", []):
            parts.append(f"{key}: {value}")
    return ", ".join(parts)


def _detail_rows(data: EventReportData, inc: Incident, home_city: str) -> list[tuple[str, str]]:
    """Every field the board knows, always present — empty values render as an
    em dash so operators see what is unknown (and can fill it in by hand)."""
    crew, vehicles, materials = _active_resources(data, inc.id)

    coords = "—"
    if inc.location_lat is not None and inc.location_lng is not None:
        coords = f"{float(inc.location_lat):.5f}, {float(inc.location_lng):.5f}"

    flags = []
    if inc.nachbarhilfe:
        flags.append("Nachbarhilfe" + (f" ({inc.nachbarhilfe_note})" if inc.nachbarhilfe_note else ""))
    if inc.am_warten:
        flags.append("Am Warten" + (f" ({inc.am_warten_note})" if inc.am_warten_note else ""))

    rows: list[tuple[str, str]] = [
        (
            "Typ / Priorität",
            f"{TYPE_LABELS.get(inc.type, inc.type)} / {PRIORITY_LABELS.get(inc.priority, inc.priority)}",
        ),
        ("Adresse", inc.location_address or "—"),
        ("Koordinaten", coords),
        ("Eingang", _dt_full(inc.created_at)),
        ("Quelle", {"intake": "Telefon", "divera": "Divera"}.get(inc.source or "", "Operator")),
        ("Beschreibung", inc.description or "—"),
        ("Kontakt", inc.contact or "—"),
        ("Merkmale", ", ".join(flags) or "—"),
        (
            "Personal",
            ", ".join(f"{p.name}" + (f" ({p.role})" if p.role else "") for p in sorted(crew, key=_rank_key)) or "—",
        ),
        ("Mittel", ", ".join(_mittel(inc, vehicles)) or "—"),
        ("Material", ", ".join(m.name for m in materials) or "—"),
    ]

    reports = [r for r in data.reko_reports if r.incident_id == inc.id and not r.is_draft]
    if not reports:
        rows.append(("Reko", "—"))
    for report in reports:
        who = ""
        if report.submitted_by_personnel_id in data.personnel_map:
            who = f" ({data.personnel_map[report.submitted_by_personnel_id].name})"
        parts = []
        if report.summary_text:
            parts.append(report.summary_text)
        dangers = _json_true_keys(report.dangers_json)
        if dangers:
            parts.append(f"Gefahren: {dangers}")
        effort = _json_true_keys(report.effort_json)
        if effort:
            parts.append(f"Aufwand: {effort}")
        if report.power_supply:
            parts.append(f"Strom: {report.power_supply}")
        if report.additional_notes:
            parts.append(f"Notizen: {report.additional_notes}")
        rows.append((f"Reko {_time(report.submitted_at)}{who}", " — ".join(parts) or "—"))

    # Compact status history: when each stage was first reached.
    transitions = sorted((t for t in data.transitions if t.incident_id == inc.id), key=lambda t: t.timestamp)
    seen: dict[str, str] = {}
    for t in transitions:
        seen.setdefault(t.to_status, _time(t.timestamp))
    verlauf = " → ".join(f"{STATUS_LABELS.get(s, s)} {ts}" for s, ts in seen.items())
    rows.append(("Verlauf", verlauf or "—"))

    if inc.field_complete_reported_at:
        rows.append(("Beendet gemeldet", _dt_full(inc.field_complete_reported_at)))
    rows.append(("Interne Notizen", inc.internal_notes or "—"))
    rows.append(("Abgeschlossen", _dt_full(inc.completed_at)))
    return rows


def _detail_block(data: EventReportData, inc: Incident, index: int, home_city: str) -> list:
    """One bordered card per incident: shaded header row, generous row spacing."""
    head = (
        f"{index} — {inc.title}"
        f"  ·  {STATUS_LABELS.get(inc.status, inc.status)}"
        f"  ·  Prio {_PRIORITY_SHORT.get(inc.priority, '—')}"
    )
    usable = A4[0] - 16 * mm
    rows: list[list] = [[Paragraph(escape(head), _DETAIL_HEAD), ""]]
    rows.extend(
        [Paragraph(escape(label), _DETAIL_LABEL), Paragraph(escape(value), _DETAIL_VALUE)]
        for label, value in _detail_rows(data, inc, home_city)
    )
    card = LongTable(rows, colWidths=[usable * 0.16, usable * 0.84], repeatRows=1)
    card.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.75, _BORDER),
                ("SPAN", (0, 0), (1, 0)),
                ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, _BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, 0), 4),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("TOPPADDING", (0, 1), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
            ]
        )
    )
    return [Spacer(1, 4 * mm), card]


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
            f"Datum: {now_local.strftime('%d.%m.%Y')} — Stand: {now_local.strftime('%H:%M')} Uhr",
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
        _p("Wer", bold=True),
        _p("Womit", bold=True),
        "",
    ]

    rows: list[list] = [header_group, header_sub]
    for index, inc in enumerate(data.incidents, start=1):
        rows.append(_incident_row(data, inc, index, home_city))
    for _ in range(EMPTY_ROWS):
        rows.append([""] * 12)

    usable = A4[0] - 16 * mm
    # Same width for columns of the same kind: all Zeit equal, both Wer equal.
    fractions = [0.034, 0.034, 0.052, 0.150, 0.170, 0.052, 0.085, 0.167, 0.052, 0.085, 0.085, 0.034]
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
        ("SPAN", (8, 0), (10, 0)),
        ("SPAN", (11, 0), (11, 1)),
    ]
    # Uniform row height everywhere (~3 lines at 6pt): filled and empty rows
    # read as one grid, and every row leaves handwriting space.
    table = LongTable(
        rows,
        colWidths=col_widths,
        repeatRows=2,
        rowHeights=[None, None] + [ROW_HEIGHT] * (len(data.incidents) + EMPTY_ROWS),
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

    # Detail pages: everything the board knows per incident.
    if data.incidents:
        story.append(PageBreak())
        story.append(Paragraph(f"Einsatzdetails — Stand {now_local.strftime('%H:%M')} Uhr", title_style))
        for index, inc in enumerate(data.incidents, start=1):
            story.extend(_detail_block(data, inc, index, home_city))

    doc.build(story)
    return buffer.getvalue()
