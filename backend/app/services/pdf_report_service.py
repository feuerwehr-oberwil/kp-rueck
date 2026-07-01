"""PDF after-action report (Einsatzbericht) builder.

Pure, synchronous rendering: takes an :class:`EventReportData` (gathered by
``collect_event_report_data``) plus the generating user's name and returns the
finished PDF as ``bytes``. No database access, no I/O beyond an in-memory
buffer — so it is trivially unit-testable and safe to run in a worker thread
via ``asyncio.to_thread``.

All user-facing strings live in the module-level :data:`LABELS` dict (German,
Swiss spelling) so plan 06 (i18n) can localise later by swapping the dict.
"""

import re
from datetime import UTC, datetime
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .audit_export_service import EventReportData

# ---------------------------------------------------------------------------
# Strings (German, Swiss spelling). i18n seam for plan 06.
# ---------------------------------------------------------------------------

LABELS: dict[str, str] = {
    "report_title": "Einsatzbericht",
    "training_badge": "ÜBUNG",
    "event": "Ereignis",
    "period": "Zeitraum",
    "ongoing": "laufend",
    "funkrufname": "Funkrufname",
    "generated_at": "Erstellt am",
    "generated_by": "Erstellt von",
    "none": "—",
    # Summary
    "summary_title": "Zusammenfassung",
    "incidents_total": "Einsätze gesamt",
    "personnel_involved": "Eingesetztes Personal",
    "vehicles_used": "Eingesetzte Fahrzeuge",
    "materials_used": "Eingesetztes Material",
    "reko_reports_count": "Reko-Berichte",
    "no_incidents": "Keine Einsätze erfasst",
    # Incident overview table
    "incident_list_title": "Einsatzübersicht",
    "col_nr": "Nr",
    "col_title": "Titel",
    "col_type": "Typ",
    "col_priority": "Priorität",
    "col_status": "Status",
    "col_address": "Adresse",
    "col_created": "Eingegangen",
    "col_completed": "Abgeschlossen",
    # Per-incident detail
    "details_title": "Einsatzdetails",
    "description": "Beschreibung",
    "contact": "Kontakt",
    "flags": "Merkmale",
    "nachbarhilfe": "Nachbarhilfe",
    "am_warten": "Am Warten",
    "zu_fuss": "Zu Fuss",
    "crew": "Personal",
    "vehicles": "Fahrzeuge",
    "materials": "Material",
    "status_timeline": "Statusverlauf",
    "reko": "Reko",
    "reko_relevant": "Relevant",
    "reko_power": "Stromversorgung",
    "reko_summary": "Zusammenfassung",
    "reko_notes": "Zusätzliche Notizen",
    "reko_draft": "Entwurf",
    "yes": "Ja",
    "no": "Nein",
    "released": "freigegeben",
    "footer_page": "Seite {current} von {total}",
    "assigned_since": "seit",
}

# Human-readable labels mirroring the frontend (frontend/lib/types/incidents.ts).
STATUS_LABELS: dict[str, str] = {
    "eingegangen": "Eingegangen",
    "reko": "Reko",
    "reko_done": "Reko abgeschlossen",
    "disponiert": "Disponiert",
    "einsatz": "Einsatz",
    "einsatz_beendet": "Einsatz beendet",
    "abschluss": "Abschluss",
}

TYPE_LABELS: dict[str, str] = {
    "brandbekaempfung": "Brandbekämpfung",
    "elementarereignis": "Elementarereignis",
    "strassenrettung": "Strassenrettung",
    "technische_hilfeleistung": "Technische Hilfeleistung",
    "oelwehr": "Ölwehr",
    "chemiewehr": "Chemiewehr",
    "strahlenwehr": "Strahlenwehr",
    "einsatz_bahnanlagen": "Einsatz Bahnanlagen",
    "bma_unechte_alarme": "BMA / Unechte Alarme",
    "dienstleistungen": "Dienstleistungen",
    "diverse_einsaetze": "Diverse Einsätze",
    "gerettete_menschen": "Gerettete Menschen",
    "gerettete_tiere": "Gerettete Tiere",
}

PRIORITY_LABELS: dict[str, str] = {
    "low": "Niedrig",
    "medium": "Mittel",
    "high": "Hoch",
}

# Layout constants
_PAGE_MARGIN = 18 * mm
_BRAND = colors.HexColor("#b91c1c")  # warm red (fire service identity)
_HEADER_BG = colors.HexColor("#f4f4f5")
_BORDER = colors.HexColor("#d4d4d8")


def _fmt_dt(dt: datetime | None) -> str:
    """Format a datetime for display (Swiss ``DD.MM.YYYY HH:MM``) or em dash."""
    if dt is None:
        return LABELS["none"]
    return dt.strftime("%d.%m.%Y %H:%M")


def _or_none(value: str | None) -> str:
    """Return a stripped string or the em-dash placeholder for empty/None."""
    if value is None:
        return LABELS["none"]
    text = str(value).strip()
    return text if text else LABELS["none"]


def format_location_for_display(full_address: str | None, home_city: str) -> str:
    """Python mirror of the frontend ``formatLocationForDisplay`` (lib/utils.ts).

    Strips home-city / region / country / postcode noise. Returns ``""`` when the
    location is only the home city (redundant) so callers can hide or fall back.
    """
    if not full_address:
        return ""
    if not home_city:
        return full_address
    parts = [p.strip() for p in full_address.split(",")]
    home_parts = [p.strip() for p in home_city.split(",")]
    contains_home = any(any(hp.lower() in ap.lower() for ap in parts) for hp in home_parts)

    if contains_home:
        house_number = ""
        street_name = ""
        for part in parts:
            pl = part.lower()
            if re.fullmatch(r"\d{4}", part):
                continue
            if pl in ("switzerland", "schweiz", "basel-landschaft", "basel-stadt"):
                continue
            if any(hp.lower() in pl for hp in home_parts):
                continue
            if pl.startswith("bezirk"):
                continue
            if part.isdigit():
                house_number = part
                continue
            if not street_name:
                street_name = part
        if street_name:
            return f"{street_name} {house_number}" if house_number else street_name
        return ""  # nothing more specific than the home city

    house_number = ""
    street = ""
    for part in parts:
        if re.fullmatch(r"\d{4}", part):
            continue
        if part.isdigit():
            house_number = part
            continue
        if not street:
            street = part
    city = None
    for idx, part in enumerate(parts):
        if idx == 0 or part.isdigit():
            continue
        if part.lower() in ("switzerland", "schweiz"):
            continue
        if re.match(r"^(basel-landschaft|basel-stadt|bezirk|region)", part.lower()):
            continue
        city = part
        break
    formatted_street = f"{street} {house_number}" if house_number else street
    return f"{formatted_street}, {city}" if city else formatted_street


class NumberedCanvas:
    """Two-pass canvas that stamps ``Seite X von Y`` plus event/date on every page.

    Standard reportlab recipe: buffer each page's state on ``showPage``, then on
    ``save`` draw the footer once the total page count is known.
    """

    def __init__(self, *args, footer_left: str = "", footer_date: str = "", **kwargs):
        from reportlab.pdfgen import canvas as _canvas

        self._canvas_cls = _canvas.Canvas
        self._canvas = _canvas.Canvas(*args, **kwargs)
        self._saved_page_states: list[dict] = []
        self._footer_left = footer_left
        self._footer_date = footer_date

    def __getattr__(self, name):
        # Delegate everything else to the wrapped canvas.
        return getattr(self._canvas, name)

    def showPage(self):  # noqa: N802 (reportlab API name)
        self._saved_page_states.append(dict(self._canvas.__dict__))
        self._canvas._startPage()

    def save(self):
        total = len(self._saved_page_states)
        for state in self._saved_page_states:
            self._canvas.__dict__.update(state)
            self._draw_footer(total)
            self._canvas_cls.showPage(self._canvas)
        self._canvas_cls.save(self._canvas)

    def _draw_footer(self, total: int):
        page_num = self._canvas.getPageNumber()
        width = A4[0]
        y = 10 * mm
        self._canvas.setFont("Helvetica", 8)
        self._canvas.setFillColor(colors.HexColor("#71717a"))
        # Left: event name + generation date
        left = self._footer_left
        if self._footer_date:
            left = f"{left}  ·  {self._footer_date}" if left else self._footer_date
        self._canvas.drawString(_PAGE_MARGIN, y, left[:120])
        # Right: page X of Y
        page_label = LABELS["footer_page"].format(current=page_num, total=total)
        self._canvas.drawRightString(width - _PAGE_MARGIN, y, page_label)


def _make_canvas_factory(footer_left: str, footer_date: str):
    """Build a canvasmaker callable that injects the footer strings."""

    def factory(*args, **kwargs):
        return NumberedCanvas(*args, footer_left=footer_left, footer_date=footer_date, **kwargs)

    return factory


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "ReportTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=_BRAND,
            spaceAfter=2,
            alignment=TA_LEFT,
        ),
        "event": ParagraphStyle(
            "ReportEvent",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=19,
            spaceAfter=2,
        ),
        "meta": ParagraphStyle(
            "ReportMeta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#52525b"),
        ),
        "section": ParagraphStyle(
            "ReportSection",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=colors.HexColor("#18181b"),
            spaceBefore=10,
            spaceAfter=6,
        ),
        "incident_heading": ParagraphStyle(
            "IncidentHeading",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#18181b"),
            spaceBefore=6,
            spaceAfter=2,
        ),
        "field_label": ParagraphStyle(
            "FieldLabel",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor("#3f3f46"),
        ),
        "body": ParagraphStyle(
            "ReportBody",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            alignment=TA_LEFT,
        ),
        "bullet": ParagraphStyle(
            "ReportBullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            alignment=TA_LEFT,
            leftIndent=14,
            bulletIndent=4,
            spaceAfter=1,
        ),
        "cell": ParagraphStyle(
            "ReportCell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
        ),
        "cell_header": ParagraphStyle(
            "ReportCellHeader",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=colors.white,
        ),
        "badge": ParagraphStyle(
            "TrainingBadge",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.white,
            alignment=TA_LEFT,
        ),
    }
    return styles


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    """Escape then wrap text in a Paragraph so long content flows/wraps safely."""
    return Paragraph(escape(str(text)), style)


def _cover(data: EventReportData, generated_by: str, funkrufname: str, styles: dict) -> list:
    """Build the cover/header flowables."""
    event = data.event
    flow: list = [_p(LABELS["report_title"], styles["title"])]

    if event.training_flag:
        badge = Table(
            [[_p(LABELS["training_badge"], styles["badge"])]],
            colWidths=[30 * mm],
        )
        badge.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ea580c")),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        badge.hAlign = "LEFT"
        flow.append(Spacer(1, 4))
        flow.append(badge)

    flow.append(Spacer(1, 6))
    flow.append(_p(event.name, styles["event"]))

    period_start = _fmt_dt(event.created_at)
    period_end = _fmt_dt(event.archived_at) if event.archived_at else LABELS["ongoing"]
    meta_lines = [
        f"<b>{escape(LABELS['period'])}:</b> {escape(period_start)} – {escape(period_end)}",
        f"<b>{escape(LABELS['funkrufname'])}:</b> {escape(_or_none(funkrufname))}",
        f"<b>{escape(LABELS['generated_at'])}:</b> {escape(_fmt_dt(datetime.now(UTC)))}",
        f"<b>{escape(LABELS['generated_by'])}:</b> {escape(_or_none(generated_by))}",
    ]
    flow.append(Spacer(1, 4))
    for line in meta_lines:
        flow.append(Paragraph(line, styles["meta"]))

    return flow


def _resource_name(data: EventReportData, assignment) -> str:
    """Resolve a display name for an assignment's resource."""
    rid = assignment.resource_id
    if assignment.resource_type == "personnel":
        p = data.personnel_map.get(rid)
        return p.name if p else str(rid)
    if assignment.resource_type == "vehicle":
        v = data.vehicle_map.get(rid)
        if not v:
            return str(rid)
        return f"{v.name} ({v.radio_call_sign})" if v.radio_call_sign else v.name
    if assignment.resource_type == "material":
        m = data.material_map.get(rid)
        return m.name if m else str(rid)
    return str(rid)


def _summary_table(data: EventReportData, styles: dict) -> Table:
    """Build the summary counts table."""
    incidents = data.incidents
    status_counts: dict[str, int] = {}
    for inc in incidents:
        status_counts[inc.status] = status_counts.get(inc.status, 0) + 1

    distinct_personnel = {a.resource_id for a in data.assignments if a.resource_type == "personnel"}
    distinct_vehicles = {a.resource_id for a in data.assignments if a.resource_type == "vehicle"}
    distinct_materials = {a.resource_id for a in data.assignments if a.resource_type == "material"}

    # incidents total, broken down by status inline
    status_breakdown = ", ".join(f"{STATUS_LABELS.get(s, s)}: {c}" for s, c in sorted(status_counts.items()))
    rows = [
        (LABELS["incidents_total"], f"{len(incidents)}" + (f"  ({status_breakdown})" if status_breakdown else "")),
        (LABELS["personnel_involved"], str(len(distinct_personnel))),
        (LABELS["vehicles_used"], str(len(distinct_vehicles))),
        (LABELS["materials_used"], str(len(distinct_materials))),
        (LABELS["reko_reports_count"], str(len(data.reko_reports))),
    ]

    table_data = [[_p(label, styles["field_label"]), _p(value, styles["cell"])] for label, value in rows]
    table = Table(table_data, colWidths=[55 * mm, 117 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, _BORDER),
                ("BACKGROUND", (0, 0), (0, -1), _HEADER_BG),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _incident_overview_table(data: EventReportData, styles: dict, home_city: str = "") -> Table:
    """One row per incident: nr, title, type, priority, status, address, times."""
    header = [
        _p(LABELS["col_nr"], styles["cell_header"]),
        _p(LABELS["col_title"], styles["cell_header"]),
        _p(LABELS["col_type"], styles["cell_header"]),
        _p(LABELS["col_address"], styles["cell_header"]),
        _p(LABELS["col_created"], styles["cell_header"]),
        _p(LABELS["col_completed"], styles["cell_header"]),
    ]
    rows = [header]
    for idx, inc in enumerate(data.incidents, 1):
        rows.append(
            [
                _p(str(idx), styles["cell"]),
                _p(_or_none(inc.title), styles["cell"]),
                _p(TYPE_LABELS.get(inc.type, inc.type), styles["cell"]),
                _p(_or_none(format_location_for_display(inc.location_address, home_city)), styles["cell"]),
                _p(_fmt_dt(inc.created_at), styles["cell"]),
                _p(_fmt_dt(inc.completed_at), styles["cell"]),
            ]
        )

    # Column widths tuned for A4 portrait content area (172mm, ~2mm safety).
    col_widths = [8 * mm, 50 * mm, 26 * mm, 52 * mm, 18 * mm, 18 * mm]
    table = Table(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
                ("GRID", (0, 0), (-1, -1), 0.5, _BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _field(label: str, value: str, styles: dict) -> Paragraph:
    """A single label/value line used inside incident detail blocks.

    Returns a Paragraph (not a Table) so very long values wrap and split across
    pages — a Table row cannot break, which overflows for long descriptions.
    """
    return Paragraph(f"<b>{escape(label)}:</b> {escape(str(value))}", styles["body"])


def _bullet_field(label: str, items: list[str], styles: dict) -> list:
    """A label line followed by one bullet per item.

    Falls back to an inline ``Label: —`` line when there are no items, so empty
    lists stay compact. Each bullet is its own Paragraph so long entries wrap.
    """
    if not items:
        return [_field(label, LABELS["none"], styles)]
    flow: list = [Paragraph(f"<b>{escape(label)}:</b>", styles["body"])]
    for item in items:
        flow.append(Paragraph(escape(str(item)), styles["bullet"], bulletText="•"))
    return flow


def _incident_detail(data: EventReportData, inc, index: int, styles: dict, home_city: str = "") -> list:
    """Build the detail block flowables for a single incident."""
    block: list = []
    # Heading = address (the incident's "name"); fall back to title, then em dash.
    # Locations equal to the home city are hidden (redundant) → fall back to title.
    heading_name = format_location_for_display(inc.location_address, home_city) or inc.title or LABELS["none"]
    block.append(_p(f"{index}. {heading_name}", styles["incident_heading"]))

    # Title line = category (incident type)
    block.append(_p(TYPE_LABELS.get(inc.type, inc.type), styles["meta"]))
    block.append(Spacer(1, 2))

    # Priority and status, each on its own row, below the category line
    block.append(_field(LABELS["col_priority"], PRIORITY_LABELS.get(inc.priority, inc.priority), styles))
    block.append(_field(LABELS["col_status"], STATUS_LABELS.get(inc.status, inc.status), styles))

    # Alarm / received time
    block.append(_field(LABELS["col_created"], _fmt_dt(inc.created_at), styles))

    block.append(_field(LABELS["description"], _or_none(inc.description), styles))
    block.append(_field(LABELS["contact"], _or_none(inc.contact), styles))

    # Flags
    flag_parts = []
    if inc.nachbarhilfe:
        note = f" ({inc.nachbarhilfe_note})" if inc.nachbarhilfe_note else ""
        flag_parts.append(f"{LABELS['nachbarhilfe']}{note}")
    if inc.am_warten:
        note = f" ({inc.am_warten_note})" if inc.am_warten_note else ""
        flag_parts.append(f"{LABELS['am_warten']}{note}")
    if inc.zu_fuss:
        flag_parts.append(LABELS["zu_fuss"])
    flags_text = ", ".join(flag_parts) if flag_parts else LABELS["none"]
    block.append(_field(LABELS["flags"], flags_text, styles))

    # Assignments by resource type
    inc_assignments = [a for a in data.assignments if a.incident_id == inc.id]
    for res_type, label in (
        ("personnel", LABELS["crew"]),
        ("vehicle", LABELS["vehicles"]),
        ("material", LABELS["materials"]),
    ):
        items = [a for a in inc_assignments if a.resource_type == res_type]
        lines = []
        for a in items:
            name = _resource_name(data, a)
            span = f"{LABELS['assigned_since']} {_fmt_dt(a.assigned_at)}"
            if a.unassigned_at:
                span = f"{_fmt_dt(a.assigned_at)} – {_fmt_dt(a.unassigned_at)}"
            lines.append(f"{name} ({span})")
        block.extend(_bullet_field(label, lines, styles))

    # Status transition timeline
    inc_transitions = [t for t in data.transitions if t.incident_id == inc.id]
    if inc_transitions:
        lines = []
        for t in inc_transitions:
            user = data.user_map.get(t.user_id) if t.user_id else None
            user_name = user.username if user else LABELS["none"]
            from_label = STATUS_LABELS.get(t.from_status, t.from_status)
            to_label = STATUS_LABELS.get(t.to_status, t.to_status)
            lines.append(f"{_fmt_dt(t.timestamp)}: {from_label} → {to_label} ({user_name})")
        block.extend(_bullet_field(LABELS["status_timeline"], lines, styles))

    # Reko report summaries (text fields only)
    inc_reko = [r for r in data.reko_reports if r.incident_id == inc.id]
    for reko in inc_reko:
        parts = []
        if reko.is_relevant is not None:
            parts.append(f"{LABELS['reko_relevant']}: {LABELS['yes'] if reko.is_relevant else LABELS['no']}")
        if reko.power_supply:
            parts.append(f"{LABELS['reko_power']}: {reko.power_supply}")
        if reko.summary_text:
            parts.append(f"{LABELS['reko_summary']}: {reko.summary_text}")
        if reko.additional_notes:
            parts.append(f"{LABELS['reko_notes']}: {reko.additional_notes}")
        if reko.is_draft:
            parts.append(f"({LABELS['reko_draft']})")
        block.extend(_bullet_field(LABELS["reko"], parts, styles))

    block.append(Spacer(1, 8))
    return block


def build_event_report_pdf(
    data: EventReportData,
    generated_by: str,
    funkrufname: str = "",
    home_city: str = "",
) -> bytes:
    """Render the after-action report PDF.

    Args:
        data: Fully-loaded event data from ``collect_event_report_data``.
        generated_by: Username of the person generating the report (footer/meta).
        funkrufname: Radio callsign from settings (``get_setting_value``).
        home_city: Configured home city; locations equal to it are hidden.

    Returns:
        The finished PDF document as ``bytes`` (starts with ``%PDF``).
    """
    styles = _styles()
    buffer = BytesIO()

    event = data.event
    footer_date = _fmt_dt(datetime.now(UTC))
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=_PAGE_MARGIN,
        rightMargin=_PAGE_MARGIN,
        topMargin=_PAGE_MARGIN,
        bottomMargin=_PAGE_MARGIN,
        title=f"{LABELS['report_title']} — {event.name}",
        author=generated_by or "",
    )

    story: list = []
    story.extend(_cover(data, generated_by, funkrufname, styles))
    story.append(Spacer(1, 10))

    # Summary
    story.append(_p(LABELS["summary_title"], styles["section"]))
    story.append(_summary_table(data, styles))
    story.append(Spacer(1, 10))

    if not data.incidents:
        story.append(_p(LABELS["no_incidents"], styles["body"]))
    else:
        # Overview table
        story.append(_p(LABELS["incident_list_title"], styles["section"]))
        story.append(_incident_overview_table(data, styles, home_city))
        story.append(Spacer(1, 12))

        # Per-incident detail sections
        story.append(_p(LABELS["details_title"], styles["section"]))
        for idx, inc in enumerate(data.incidents, 1):
            block = _incident_detail(data, inc, idx, styles, home_city)
            # KeepTogether for small blocks; large blocks flow across pages.
            story.append(KeepTogether(block))

    doc.build(
        story,
        canvasmaker=_make_canvas_factory(footer_left=event.name, footer_date=footer_date),
    )

    return buffer.getvalue()
