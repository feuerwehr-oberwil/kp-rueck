"""PDF after-action report (Einsatzrapport) builder.

Pure, synchronous rendering: takes an :class:`EventReportData` (gathered by
``collect_event_report_data``) plus the generating user's name and returns the
finished PDF as ``bytes``. No database access, no I/O beyond an in-memory
buffer – so it is trivially unit-testable and safe to run in a worker thread
via ``asyncio.to_thread``.

All user-facing strings live in :data:`rapport_rows.LABELS` (German, Swiss spelling)
so plan 06 (i18n) can localise later by swapping the dict. The pure halves are their
own modules: the vocabulary and the Schadenplatz-Rapport rows in ``rapport_rows``,
the address line in ``address_display``; this one is the reportlab half.
"""

import math
import re
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    CondPageBreak,
    HRFlowable,
    Image,
    KeepTogether,
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..models import Incident, IncidentAssignment, SchadenplatzReport
from ..schemas.journal import JournalEntryOut
from .address_display import format_location_for_display
from .audit_export_service import EventReportData
from .incident_leader import effective_leader_ids
from .journal import merged_into as journal_merged_into
from .photo_storage import ExportPhoto
from .rapport_rows import (
    LABELS,
    LOCAL_TZ,
    POWER_LABELS,
    PRIORITY_LABELS,
    STATUS_LABELS,
    STATUS_ORDER,
    TYPE_LABELS,
    WorkWindow,
    _fmt_dt,
    _text,
    board_personnel_count,
    extra_material_rows,
    extra_personnel_lines,
    format_corrected_count,
    format_extra_material,
    format_material_unit,
    material_checklist_rows,
    personnel_present_names,
    rapport_by_incident,
    rapport_filing_lines,
    rapport_work_windows,
    reko_arrival_line,
    reko_filing_lines,
    vehicle_present_names,
)
from .reaction_times import Stage, fold_merged, stage_times

# Layout constants
_PAGE_MARGIN = 18 * mm

#: SimpleDocTemplate's frame pads 6 pt on every side on top of the margins. Left out of
#: the content width, every full-width table was 12 pt wider than the frame it sits in:
#: the tables overflowed to the right of the section rules (which honour the frame), and
#: a row whose content forced a re-fit jumped 6 pt left of the column everything else
#: aligned on. Widths are measured against what the frame actually offers.
_FRAME_PADDING = 6
_CONTENT_W = A4[0] - 2 * _PAGE_MARGIN - 2 * _FRAME_PADDING

# Palette, shared with the KP-Front Einsatzrapport (`backend/app/report_pdf.py`) so the
# two documents a station files for one night look like they come from one house. The
# saturated red that used to fill every table head is gone: on a page that is mostly
# tables it was three alarm-coloured bands per sheet, which is decoration where the
# document needs hierarchy. The one warm accent left is the ÜBUNG marker, which is the
# only thing on the paper that genuinely has to shout.
_INK = colors.HexColor("#1b2330")  # headings and body text
_DIM = colors.HexColor("#5b6573")  # secondary text, column heads, filing lines
_PANEL = colors.HexColor("#eef2f7")  # table heads and label columns
_GRID = colors.HexColor("#d7dde5")  # hairlines
_ZEBRA = colors.HexColor("#f7f9fb")  # alternating rows – our tables run for pages
_EXERCISE = colors.HexColor("#b4690a")  # ÜBUNG marker

#: Width of the label column every label/value line aligns on.
#:
#: The values used to start wherever the label happened to end, so a detail block was a
#: ragged left edge of content that a reader has to scan *for* rather than *down*. One
#: column fixes that, and 40 mm is where the trade-off sits. Every label the report has
#: now fits it on one line at 9 pt: the three that used to wrap were shortened instead
#: of the column being widened, because 6 more millimetres here is 6 fewer on every
#: value line in the document for the benefit of three labels.
_LABEL_W = 40 * mm

#: The cover block's own, narrower column – its four labels are short, and a 40 mm
#: gutter under a title would read as a missing column rather than an aligned one.
_META_LABEL_W = 28 * mm

#: Letterhead bounds for the station logo. Tall enough to be recognised, short enough
#: that "Einsatzrapport" stays the first thing read on page 1.
_LOGO_MAX_W = 45 * mm
_LOGO_MAX_H = 18 * mm

#: Space a section heading needs below it before it may stay on this page. Less than
#: this and the heading moves to the next page with its content instead of sitting alone
#: at the bottom announcing something the reader has to turn the page to find.
_SECTION_MIN_SPACE = 32 * mm

#: Photo thumbnails in the incident detail blocks: three per row, height-capped.
#: ReportLab embeds the ORIGINAL bytes whatever box we draw them into, so these
#: numbers are purely layout — big enough to recognise a scene, small enough that
#: a full Reko (20 photos) costs about two pages rather than ten.
_PHOTO_PER_ROW = 3
_PHOTO_MAX_H = 55 * mm
_PHOTO_GAP = 4  # points of air between neighbouring thumbnails


class NumberedCanvas:
    """Two-pass canvas that stamps ``Seite X von Y`` plus event/date on every page.

    Standard reportlab recipe: buffer each page's state on ``showPage``, then on
    ``save`` draw the footer once the total page count is known.
    """

    def __init__(self, *args: Any, footer_left: str = "", footer_date: str = "", **kwargs: Any) -> None:
        from reportlab.pdfgen import canvas as _canvas

        self._canvas_cls = _canvas.Canvas
        self._canvas = _canvas.Canvas(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []
        self._footer_left = footer_left
        self._footer_date = footer_date

    def __getattr__(self, name: str) -> Any:
        # Delegate everything else to the wrapped canvas.
        return getattr(self._canvas, name)

    def showPage(self) -> None:  # noqa: N802 (reportlab API name)
        self._saved_page_states.append(dict(self._canvas.__dict__))
        self._canvas._startPage()

    def save(self) -> None:
        total = len(self._saved_page_states)
        for state in self._saved_page_states:
            self._canvas.__dict__.update(state)
            self._draw_footer(total)
            self._canvas_cls.showPage(self._canvas)
        self._canvas_cls.save(self._canvas)

    def _draw_footer(self, total: int) -> None:
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


def _make_canvas_factory(footer_left: str, footer_date: str) -> Callable[..., "NumberedCanvas"]:
    """Build a canvasmaker callable that injects the footer strings."""

    def factory(*args: Any, **kwargs: Any) -> NumberedCanvas:
        return NumberedCanvas(*args, footer_left=footer_left, footer_date=footer_date, **kwargs)

    return factory


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    styles = {
        # Four levels, and only four: eyebrow → title → section → incident → sub-block.
        # Every heading in the document is one of them, and each level is one step
        # smaller than the one above it so the depth is legible without reading a word.
        "eyebrow": ParagraphStyle(
            "ReportEyebrow",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11,
            textColor=_DIM,
            spaceAfter=1,
        ),
        "title": ParagraphStyle(
            "ReportTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            textColor=_INK,
            spaceAfter=2,
            alignment=TA_LEFT,
        ),
        "meta": ParagraphStyle(
            "ReportMeta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=_DIM,
        ),
        "section": ParagraphStyle(
            "ReportSection",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=_INK,
            spaceBefore=10,
            spaceAfter=2,
        ),
        # The one-line answer to "what am I looking at" under every section rule.
        "section_hint": ParagraphStyle(
            "ReportSectionHint",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=11,
            textColor=_DIM,
            spaceAfter=5,
        ),
        "incident_heading": ParagraphStyle(
            "IncidentHeading",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=_INK,
            spaceBefore=6,
            spaceAfter=2,
        ),
        # A block inside an incident that is somebody else's record – the crew's
        # Schadenplatz-Rapport. It used to be set in the same weight and at the same
        # indent as the incident's own fields, so nothing said where the board's data
        # ended and the field slip began.
        "subsection": ParagraphStyle(
            "ReportSubsection",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=12,
            textColor=_INK,
            spaceBefore=2,
            spaceAfter=2,
        ),
        "field_label": ParagraphStyle(
            "FieldLabel",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11,
            textColor=_DIM,
        ),
        # The label column of every aligned label/value line. Same size and leading as
        # `body` so the label and its value sit on one baseline across the column.
        "label_col": ParagraphStyle(
            "LabelColumn",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=_DIM,
        ),
        "meta_label": ParagraphStyle(
            "MetaLabel",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=_DIM,
        ),
        "body": ParagraphStyle(
            "ReportBody",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=_INK,
            alignment=TA_LEFT,
        ),
        "bullet": ParagraphStyle(
            "ReportBullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            alignment=TA_LEFT,
            # Small indents: the bullets now live inside the value column, which already
            # supplies the offset from the label. The old 14 pt pushed them a second time.
            leftIndent=8,
            bulletIndent=0,
            spaceAfter=1,
        ),
        "cell": ParagraphStyle(
            "ReportCell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=_INK,
        ),
        "cell_header": ParagraphStyle(
            "ReportCellHeader",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=_DIM,
        ),
        "badge": ParagraphStyle(
            "TrainingBadge",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=_EXERCISE,
            alignment=TA_LEFT,
        ),
    }
    return styles


def _rule(color: colors.Color = _INK, thickness: float = 0.8, space_after: float = 4) -> HRFlowable:
    """The hairline under a section heading – the thing that made the page scannable.

    Headings alone were four sizes of bold text floating in white space; the rule is
    what turns them into a visible level.
    """
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceBefore=1, spaceAfter=space_after)


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    """Escape then wrap text in a Paragraph so long content flows/wraps safely."""
    return Paragraph(escape(str(text)), style)


# Web addresses and e-mails inside free text. Deliberately conservative: a
# false positive turns prose into a dead link, a miss just stays text.
_LINK_RE = re.compile(r"(https?://[^\s<>()]+|www\.[^\s<>()]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)")


def _tel_href(number: str) -> str:
    """``tel:`` target for a Swiss-formatted number: digits and ``+`` only."""
    return "tel:" + re.sub(r"[^\d+]", "", number)


def _link_markup(href: str, text: str) -> str:
    """One live link: underlined, ink-coloured — the accent colours stay reserved."""
    return f'<a href="{escape(href, {chr(34): "&quot;"})}"><u>{escape(text)}</u></a>'


def _linkify(text: str) -> str:
    """Escaped Paragraph markup with URLs and e-mails as live PDF links.

    On paper nothing changes; in a viewer the reader can tap what the field
    test asked for («www. Tel. @ mit Hyperlink»). Phone numbers are NOT
    guessed out of prose — the structured ``contact_phone`` carries the
    ``tel:`` link, free-text digits stay text.
    """
    parts: list[str] = []
    last = 0
    for match in _LINK_RE.finditer(text):
        parts.append(escape(text[last : match.start()]))
        token = match.group(0)
        if token.startswith(("http://", "https://")):
            href = token
        elif token.startswith("www."):
            href = f"https://{token}"
        else:
            href = f"mailto:{token}"
        parts.append(_link_markup(href, token))
        last = match.end()
    parts.append(escape(text[last:]))
    return "".join(parts)


def _widths(*fixed: float, flex: int = -1) -> list[float]:
    """Column widths where ONE column takes whatever is left of the content width.

    Hand-totalled width lists drift the moment a column is retuned, and a table that is
    a millimetre wider than the frame no longer lines up with the section rule above it.
    Give the fixed columns; the remainder is arithmetic. ``flex`` is where the remainder
    goes — the last column by default, or an index when the elastic column sits in the
    middle (the overview's Adresse, whose neighbours all have a measured minimum).
    """
    cols = list(fixed)
    cols.insert(len(cols) + 1 + flex if flex < 0 else flex, _CONTENT_W - sum(cols))
    return cols


def logo_flowable(logo: bytes | None) -> Image | None:
    """The station logo scaled into the letterhead box, or ``None``.

    Never raises: an unreadable image costs the report its logo, never its existence –
    an Einsatzrapport that fails to render because somebody uploaded a broken PNG would
    be a far worse bug than a missing crest.
    """
    if not logo:
        return None
    try:
        iw, ih = ImageReader(BytesIO(logo)).getSize()
        if iw <= 0 or ih <= 0:
            return None
        scale = min(_LOGO_MAX_W / iw, _LOGO_MAX_H / ih, 1.0)
        img = Image(BytesIO(logo), width=iw * scale, height=ih * scale)
    except Exception:  # a logo never fails a report
        return None
    img.hAlign = "LEFT"
    return img


def photo_grid(
    photos: Sequence[ExportPhoto],
    per_row: int,
    cell_w: float,
    max_h: float,
    style: ParagraphStyle,
) -> list[Any]:
    """Thumbnail rows for one incident's photos, captioned "Reko"/"Rapport" + upload time.

    Shared by the Einsatzrapport and the Lageblatt (which passes its own smaller
    sizes). Each row is a two-line table — images above, captions below — with
    ``splitByRow=0`` so a caption never strands on the next page (the whole row
    moves instead; a KeepTogether here would nest inside the callers' own
    KeepTogether, which mis-measures). Photos that came back without bytes
    (missing file, over the export cap) and photos ReportLab cannot read become
    small note lines after the grid instead of failing the document — the
    :func:`logo_flowable` rule. Returns ``[]`` for no photos.
    """
    cells: list[tuple[Image, Paragraph]] = []
    notes: list[str] = []
    for photo in photos:
        if photo.data is None:
            notes.append(photo.note or f"Foto fehlt: {photo.filename}")
            continue
        try:
            iw, ih = ImageReader(BytesIO(photo.data)).getSize()
            if iw <= 0 or ih <= 0:
                raise ValueError("empty image")
            scale = min((cell_w - _PHOTO_GAP) / iw, max_h / ih, 1.0)
            img = Image(BytesIO(photo.data), width=iw * scale, height=ih * scale)
        except Exception:  # a broken file never fails an export
            notes.append(f"Foto fehlt: {photo.filename}")
            continue
        img.hAlign = "LEFT"
        caption = photo.source if photo.taken_at is None else f"{photo.source} · {_fmt_dt(photo.taken_at)}"
        cells.append((img, Paragraph(escape(caption), style)))

    flow: list[Any] = []
    for start in range(0, len(cells), per_row):
        chunk = cells[start : start + per_row]
        pad = [""] * (per_row - len(chunk))
        table = Table(
            [[c[0] for c in chunk] + pad, [c[1] for c in chunk] + pad],
            colWidths=[cell_w] * per_row,
            hAlign="LEFT",
            splitByRow=0,
        )
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), _PHOTO_GAP),
                    ("TOPPADDING", (0, 0), (-1, 0), 2),
                    ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
                    ("TOPPADDING", (0, 1), (-1, 1), 0),
                    ("BOTTOMPADDING", (0, 1), (-1, 1), 3),
                ]
            )
        )
        flow.append(table)
    flow.extend(Paragraph(escape(note), style) for note in notes)
    return flow


def _cover(
    data: EventReportData,
    styles: dict[str, ParagraphStyle],
    logo: bytes | None = None,
) -> list[Any]:
    """Build the cover/header flowables.

    The event is the title; "Einsatzrapport" is the eyebrow above it. It used to be the
    other way round – the document *type* set 22 pt in red over the event name at 15 pt –
    which gave the loudest line on page 1 to the one word every copy of this file shares.
    """
    event = data.event
    heading: list[Any] = [_p(LABELS["report_title"], styles["eyebrow"])]
    if event.training_flag:
        # Above the title, before anything else is read, and no filled badge: an Übung
        # has to be legible AS one, but it is a qualifier on the title, not a stop sign.
        heading.append(_p(LABELS["training_badge"], styles["badge"]))
    heading.append(_p(event.name, styles["title"]))

    # Letterhead: the mark left, the title block right of it. Stacked, the logo would
    # push the title down the page and read as a picture *above* a report rather than
    # the letterhead of one.
    logo_img = logo_flowable(logo)
    flow: list[Any]
    if logo_img is None:
        flow = list(heading)
    else:
        lw = logo_img.drawWidth + 6 * mm
        head = Table([[logo_img, heading]], colWidths=[lw, _CONTENT_W - lw], hAlign="LEFT")
        head.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        flow = [head]

    flow.append(_rule(color=_INK, thickness=1.0, space_after=5))

    # No Funkrufname row and no «Erstellt von» (field test 07.09.): neither says
    # anything about THIS event — KP-Front prints neither, and who exported is
    # the audit log's answer. `generated_by` stays in the PDF's author metadata.
    meta_lines = [
        (LABELS["event_begin"], _fmt_dt(event.created_at)),
        (LABELS["event_end"], _fmt_dt(event.archived_at) if event.archived_at else LABELS["event_end_ongoing"]),
        (LABELS["generated_at"], _fmt_dt(datetime.now(UTC))),
    ]
    for label, value in meta_lines:
        if not value:
            continue
        flow.append(_label_value_row(label, _p(value, styles["meta"]), styles, _META_LABEL_W, label_style="meta_label"))

    return flow


def _resource_name(data: EventReportData, assignment: IncidentAssignment) -> str:
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


def _summary_table(data: EventReportData, styles: dict[str, ParagraphStyle]) -> Table:
    """Build the summary counts table."""
    incidents = data.incidents
    status_counts: dict[str, int] = {}
    for inc in incidents:
        status_counts[inc.status] = status_counts.get(inc.status, 0) + 1

    distinct_personnel = {a.resource_id for a in data.assignments if a.resource_type == "personnel"}
    distinct_vehicles = {a.resource_id for a in data.assignments if a.resource_type == "vehicle"}
    distinct_materials = {a.resource_id for a in data.assignments if a.resource_type == "material"}

    # Incidents total, broken down by status inline – in the order the board works
    # through, not alphabetically by the raw key.
    ordered = [s for s in STATUS_ORDER if s in status_counts]
    ordered += sorted(s for s in status_counts if s not in STATUS_ORDER)
    status_breakdown = ", ".join(f"{STATUS_LABELS.get(s, s)}: {status_counts[s]}" for s in ordered)
    # Distinct persons who arrived — the Anwesenheit section's own count, so the
    # two numbers can be read against each other (eingesetzt ≤ anwesend).
    present_personnel = {a.personnel_id for a in data.attendance}

    rows = [
        (LABELS["incidents_total"], f"{len(incidents)}" + (f"  ({status_breakdown})" if status_breakdown else "")),
        (LABELS["personnel_involved"], str(len(distinct_personnel))),
        (LABELS["personnel_present"], str(len(present_personnel))),
        (LABELS["vehicles_used"], str(len(distinct_vehicles))),
        (LABELS["materials_used"], str(len(distinct_materials))),
        (LABELS["reko_reports_count"], str(len(data.reko_reports))),
    ]

    # 46 mm, not the shared 40: «Eingesetztes Personal» is the longest label in
    # the document and would wrap at 40 — this table stands alone, so the wider
    # column costs no alignment elsewhere.
    table_data = [[_p(label, styles["field_label"]), _p(value, styles["cell"])] for label, value in rows]
    table = Table(table_data, colWidths=_widths(46 * mm), hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("BACKGROUND", (0, 0), (0, -1), _PANEL),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _fmt_duration(seconds: float | None) -> str:
    """Duration as a clock reading – ``00:08``, ``02:05``, ``102:00``.

    One shape for the whole column, so the numbers can be compared straight down it.
    The old mixed "8 min" / "1 h 05" made the reader re-read the unit on every cell;
    hours are zero-padded so the column edge stays straight (field test 07.09.).
    """
    if seconds is None or seconds < 0:
        return ""
    minutes = int(seconds // 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


# Einsatzstunden rounding — the SAME rule as KP-Front's rapport (its
# lib/attendanceHours.ts, deliberately: one station, one Sold arithmetic):
# per person, UP to the next 30-minute block once 5 minutes past the previous
# one, then summed. Rounding the sum instead would give the same Einsatz a
# different answer depending on how many people came. The rule itself is not
# printed — it belongs in the Weisung; the raw figure beside the rounded one
# is what keeps the rounded one checkable.
_HOURS_STEP_MIN = 30
_HOURS_GRACE_MIN = 5


def _rounded_minutes(minutes: int) -> int:
    if minutes <= _HOURS_GRACE_MIN:
        return 0
    return _HOURS_STEP_MIN * math.ceil((minutes - _HOURS_GRACE_MIN) / _HOURS_STEP_MIN)


def _attendance_totals_line(data: EventReportData) -> str:
    """«19 Anwesende · Einsatzstunden 74:26 · gerundet 72:30» — or, on a RUNNING
    event, the headcount alone: an open attendance has no honest duration until
    the event's end supplies the missing checkout (KP-Front's print path draws
    the same line, and hours of an unfinished event are not billable anyway)."""
    present = len(data.attendance)
    if data.event.archived_at is None:
        return LABELS["attendance_present_only"].format(present=present)
    raw = 0
    rounded = 0
    for record in data.attendance:
        if record.checked_in_at is None:
            continue
        left = record.checked_out_at or data.event.archived_at
        minutes = int(max(0.0, (_as_utc(left) - _as_utc(record.checked_in_at)).total_seconds()) // 60)
        raw += minutes
        rounded += _rounded_minutes(minutes)
    return LABELS["attendance_totals"].format(
        present=present, raw=_fmt_duration(raw * 60), rounded=_fmt_duration(rounded * 60)
    )


def _attendance_table(data: EventReportData, styles: dict[str, ParagraphStyle]) -> LongTable:
    """Who was here, from when to when – one row per person who arrived.

    A LongTable like the Einsatztagebuch, because a storm event checks in the whole
    Mannschaft and the list has to split across pages with its header repeating.

    Two honest gaps, neither of them invented:

    * somebody who is still here has no departure – the Bis cell says «noch anwesend»
      and the Dauer cell stays empty rather than being closed against the print time,
    * somebody who never arrived is not in ``data.attendance`` at all (the collector
      drops rows without ``checked_in_at``), so the list never lengthens itself with
      people who were not there.
    """
    header = [
        _p(LABELS["col_person"], styles["cell_header"]),
        _p(LABELS["col_function"], styles["cell_header"]),
        _p(LABELS["col_from"], styles["cell_header"]),
        _p(LABELS["col_to"], styles["cell_header"]),
        _p(LABELS["col_duration"], styles["cell_header"]),
    ]
    rows = [header]
    for record in data.attendance:
        person = data.personnel_map.get(record.personnel_id)
        arrived = record.checked_in_at
        left = record.checked_out_at
        duration = (
            _fmt_duration((_as_utc(left) - _as_utc(arrived)).total_seconds())
            if arrived is not None and left is not None
            else ""
        )
        rows.append(
            [
                _p(person.name if person else str(record.personnel_id), styles["cell"]),
                _p(_text(person.role) if person else "", styles["cell"]),
                _p(_fmt_dt(arrived), styles["cell"]),
                _p(_fmt_dt(left) if left is not None else LABELS["attendance_open"], styles["cell"]),
                _p(duration, styles["cell"]),
            ]
        )

    # Same 25mm clock columns as the Einsatzübersicht (a full "05.08.2026 15:21" is
    # 24.8mm with padding, and «noch anwesend» 22.6mm); Funktion and Dauer are measured
    # the same way, and the name column absorbs the rest.
    col_widths = _widths(30 * mm, 25 * mm, 25 * mm, 15 * mm, flex=0)
    table = LongTable(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _PANEL),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, _GRID),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ZEBRA]),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _reaction_times_table(data: EventReportData, styles: dict[str, ParagraphStyle]) -> Table:
    """Per-incident reaction metrics: time from Eingang to each key stage. Feeds the
    debrief – "incident 3 sat unnoticed for 9 minutes" becomes a number instead of a
    feeling.

    The stage times come from `services/reaction_times.py`, the same computation the
    board's Kennzahlen view aggregates into median / P90 – one definition of
    «Disponiert», «Vor Ort» and «Abschluss» for the wall and the paper."""
    # A merged card's history counts from the first report of the place (R2 review).
    folded, steps = fold_merged(data.incidents, data.transitions, data.merged_cards, data.merged_transitions)
    times = stage_times(folded, steps)

    def delta(inc: Incident, stage: Stage) -> str:
        seconds = times[inc.id].get(stage)
        return "" if seconds is None else _fmt_duration(seconds)

    header = [
        _p(LABELS["col_nr"], styles["cell_header"]),
        _p(LABELS["col_title"], styles["cell_header"]),
        _p(LABELS["col_to_reko"], styles["cell_header"]),
        _p(LABELS["col_to_disponiert"], styles["cell_header"]),
        _p(LABELS["col_to_einsatz"], styles["cell_header"]),
        _p(LABELS["col_to_abschluss"], styles["cell_header"]),
    ]
    rows = [header]
    for idx, inc in enumerate(data.incidents, 1):
        rows.append(
            [
                _p(str(idx), styles["cell"]),
                _p(_text(inc.title), styles["cell"]),
                _p(delta(inc, "reko"), styles["cell"]),
                _p(delta(inc, "dispatched"), styles["cell"]),
                _p(delta(inc, "on_scene"), styles["cell"]),
                _p(delta(inc, "closed"), styles["cell"]),
            ]
        )

    col_widths = _widths(8 * mm, 66 * mm, 24 * mm, 24 * mm, 24 * mm)
    table = Table(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _PANEL),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, _GRID),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ZEBRA]),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


# ---------------------------------------------------------------------------
# Einsatztagebuch – merged, chronological journal of the whole event.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class JournalEntry:
    """One line in the Einsatztagebuch: when, which incident, what.

    Deliberately no actor. Who clicked which button is what the audit log is for, and
    it is exported next to this report; carrying it here bought a fourth column that
    said "Demo Bearbeiter" three hundred times and cost the Eintrag column its width.
    """

    timestamp: datetime
    incident_ref: str  # short incident title, or "" for event-level entries
    text: str  # German one-line description


def _as_utc(dt: datetime) -> datetime:
    """Normalize naive datetimes to UTC so mixed values sort/compare safely."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _truncate(text: str, limit: int = 80) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _row_incident_ref(row: JournalEntryOut, merged: dict[uuid.UUID, str]) -> str:
    """The incident's short title for the journal's second column, or "" – an
    event-level entry belongs to no incident and an empty cell says so.

    An Einsatz that no longer stands on the board keeps its lines (the record is
    append-only) and says why it is gone: merged into another card, or deleted.
    """
    if not row.incident_title:
        return ""
    ref = _truncate(row.incident_title, 45)
    if row.incident_id is not None and row.incident_id in merged:
        return LABELS["journal_ref_merged"].format(ref=ref, target=_truncate(merged[row.incident_id], 45))
    if row.incident_deleted:
        return LABELS["journal_ref_deleted"].format(ref=ref)
    return ref


# Field facts (`kind == "field"`, `data.type`) and who reported them.
_FIELD_LABELS: dict[str, str] = {
    "field_arrived": "Vor Ort gemeldet",
    "field_arrived_cleared": "Meldung «vor Ort» zurückgenommen",
    "field_complete": "Einsatz beendet gemeldet",
    "field_complete_cleared": "Meldung «beendet» zurückgenommen",
    "field_pickup_requested": "Abholung nötig",
    "field_pickup_cleared": "Abholung erledigt",
    "rapport_submitted": "Schadenplatz-Rapport erfasst",
    "reko_arrived": "Reko vor Ort",
    "reko_arrived_cleared": "Reko-Ankunft zurückgenommen",
    "field_request_in_progress": "Anfrage in Arbeit",
    "field_request_done": "Anfrage erledigt",
    "field_request_open": "Anfrage wieder offen",
}
_FIELD_SOURCES: dict[str, str] = {"kp": "im KP erfasst", "gps": "GPS"}

# Incident sources worth calling out in the "erstellt" journal line.
_SOURCE_LABELS: dict[str, str] = {
    "intake": LABELS["journal_source_intake"],
    "divera": LABELS["journal_source_divera"],
}


def journal_row_text(row: JournalEntryOut) -> str:
    """One journal row as the German sentence the Einsatztagebuch prints.

    The rows themselves carry structured facts (`services/journal.py`); this is where they
    become German. The app says the same in the reader's language (`lib/journal.ts`).
    """
    data = row.data or {}
    kind = row.kind
    if kind == "incident":
        action = data.get("action")
        if action == "deleted":
            return LABELS["journal_incident_deleted"]
        if action == "restored":
            return LABELS["journal_incident_restored"]
        if action in ("merge", "merged_into", "unmerge"):
            other = data.get("other_title") or LABELS["none"]
            return LABELS[f"journal_incident_{action}"].format(other=_truncate(str(other), 60))
        title = row.incident_title or data.get("title") or LABELS["none"]
        text = LABELS["journal_incident_created"].format(title=_truncate(title, 60))
        source_label = _SOURCE_LABELS.get(data.get("source") or "")
        return f"{text} ({source_label})" if source_label else text
    if kind == "status":
        from_status = data.get("from_status") or ""
        to_status = data.get("to_status") or ""
        return LABELS["journal_status_change"].format(
            from_status=STATUS_LABELS.get(from_status, from_status),
            to_status=STATUS_LABELS.get(to_status, to_status),
        )
    if kind == "assignment":
        name = data.get("resource_name") or LABELS["none"]
        label = "journal_unassigned" if data.get("action") == "unassigned" else "journal_assigned"
        return LABELS[label].format(name=name)
    if kind == "reko":
        text = LABELS["journal_reko_received"]
        return f"{text}: {_truncate(row.text, 80)}" if row.text else text
    if kind == "alarm":
        count = data.get("recipients")
        if count:
            return LABELS["journal_divera_alarm"].format(count=count)
        return LABELS["journal_divera_alarm_plain"]
    if kind == "field":
        field_label = _FIELD_LABELS.get(str(data.get("type") or ""))
        if field_label is None:
            return row.text or ""  # a field fact of a type this build does not know
        line = f"{field_label}: {row.text}" if row.text else field_label
        source = _FIELD_SOURCES.get(str(data.get("source") or ""))
        return f"{line} ({source})" if source else line
    if kind == "message":
        label = "journal_message_to_field" if data.get("direction") == "to_field" else "journal_message_from_field"
        who = row.author_name or LABELS["journal_unknown_author"]
        return LABELS[label].format(name=who, text=row.text or "")
    # manual lines: the sentence as it was written
    return row.text or ""


def build_journal_entries(data: EventReportData) -> list[JournalEntry]:
    """The Einsatztagebuch chapter — the Ereignis' journal log, oldest first.

    Single source: the same rows the board's journal drawer shows (`journal_entries`).
    A corrected manual line prints in its newest wording at its ORIGINAL time, and says
    that it was corrected and what it said before — the paper hides nothing either.
    """
    corrections: dict[uuid.UUID, list[JournalEntryOut]] = {}
    for row in data.journal:
        if row.corrects_id is not None:
            corrections.setdefault(row.corrects_id, []).append(row)

    merged = journal_merged_into(data.journal)
    entries: list[JournalEntry] = []
    for row in data.journal:
        if row.corrects_id is not None:
            continue
        text = journal_row_text(row)
        later = sorted(corrections.get(row.id, []), key=lambda r: _as_utc(r.created_at))
        if later:
            latest = later[-1]
            text = LABELS["journal_corrected"].format(
                text=latest.text or "",
                time=_as_utc(latest.created_at).astimezone(LOCAL_TZ).strftime("%H:%M"),
                original=_truncate(row.text or "", 80),
            )
        entries.append(JournalEntry(row.occurred_at, _row_incident_ref(row, merged), text))

    entries.sort(key=lambda e: _as_utc(e.timestamp))
    return entries


def _journal_table(entries: list[JournalEntry], styles: dict[str, ParagraphStyle]) -> LongTable:
    """Dense, paginating journal table (LongTable so hundreds of rows split
    cleanly across pages; header repeats)."""
    # HH:MM is enough within one day; add the date when the event spans days.
    # Local dates/times – the journal is read against Swiss wall clocks.
    spans_days = len({_as_utc(e.timestamp).astimezone(LOCAL_TZ).date() for e in entries}) > 1
    time_fmt = "%d.%m. %H:%M" if spans_days else "%H:%M"

    header = [
        _p(LABELS["col_time"], styles["cell_header"]),
        _p(LABELS["col_incident"], styles["cell_header"]),
        _p(LABELS["col_entry"], styles["cell_header"]),
    ]
    rows = [header]
    for e in entries:
        rows.append(
            [
                _p(_as_utc(e.timestamp).astimezone(LOCAL_TZ).strftime(time_fmt), styles["cell"]),
                _p(e.incident_ref, styles["cell"]),
                _p(e.text, styles["cell"]),
            ]
        )

    col_widths = _widths(20 * mm, 44 * mm)
    table = LongTable(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _PANEL),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, _GRID),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ZEBRA]),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _incident_overview_table(data: EventReportData, styles: dict[str, ParagraphStyle], home_city: str = "") -> Table:
    """One row per incident: nr, title, type, address, received, completed.

    Priority and status are deliberately not here – they belong to the incident's own
    block, and six columns is what fits at 8 pt without a head breaking mid-word.
    """
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
                _p(_text(inc.title), styles["cell"]),
                _p(TYPE_LABELS.get(inc.type, inc.type), styles["cell"]),
                _p(_text(format_location_for_display(inc.location_address, home_city)), styles["cell"]),
                _p(_fmt_dt(inc.created_at), styles["cell"]),
                _p(_fmt_dt(inc.completed_at), styles["cell"]),
            ]
        )

    # Measured, not guessed (Helvetica 8 pt + 8 pt cell padding): "Elementarereignis" is
    # 25.6mm and appears in almost every row, and "05.08.2026 15:21" is 24.8mm — at 22mm
    # both clock columns broke every date away from its own time, which is two lines per
    # row for a value that reads as one. Adresse absorbs the rest (39.8mm against a
    # longest address of 37.5mm).
    col_widths = _widths(8 * mm, 46 * mm, 26 * mm, 25 * mm, 25 * mm, flex=3)
    table = Table(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _PANEL),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, _GRID),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ZEBRA]),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _resource_overview_table(
    data: EventReportData, styles: dict[str, ParagraphStyle], res_type: str
) -> LongTable | None:
    """One row per vehicle/material assignment: which Einsatz, from when, how it
    ended — «Bis» holds the release clock, «im Einsatz» while it is still out,
    or «noch am Schadenplatz» when the incident closed over an open assignment
    (the Abholliste case). Auftrag rows name the route and its stop numbers.
    ``None`` when nothing of the kind was ever assigned — no empty section.
    """
    resource_map: Mapping[uuid.UUID, Any] = data.vehicle_map if res_type == "vehicle" else data.material_map
    index = {inc.id: i for i, inc in enumerate(data.incidents, start=1)}

    def until_cell(unassigned_at: datetime | None, done: bool) -> str:
        if unassigned_at:
            return _fmt_dt(unassigned_at)
        return LABELS["overview_left_on_site"] if done else LABELS["overview_still_active"]

    entries: list[tuple[str, datetime, str, str, str]] = []
    for a in data.assignments:
        if a.resource_type != res_type or a.resource_id not in resource_map:
            continue
        inc = data.incident_map.get(a.incident_id)
        if inc is None:
            continue
        nr = index.get(inc.id)
        label = f"{nr} – {_text(inc.title)}" if nr else _text(inc.title)
        done = inc.status == "complete" or inc.completed_at is not None
        entries.append(
            (
                resource_map[a.resource_id].name,
                _as_utc(a.assigned_at),
                label,
                _fmt_dt(a.assigned_at),
                until_cell(a.unassigned_at, done),
            )
        )
    for ga in data.group_assignments:
        if ga.resource_type != res_type or ga.resource_id not in resource_map:
            continue
        group = data.group_map.get(ga.incident_group_id)
        if group is None:
            continue
        stops = sorted((i for i in data.incidents if i.group_id == group.id), key=lambda i: i.group_position)
        stop_numbers = ", ".join(str(index[s.id]) for s in stops if s.id in index)
        done = bool(stops) and all(s.status == "complete" or s.completed_at is not None for s in stops)
        entries.append(
            (
                resource_map[ga.resource_id].name,
                _as_utc(ga.assigned_at),
                LABELS["overview_auftrag_ref"].format(name=group.name, stops=stop_numbers or "–"),
                _fmt_dt(ga.assigned_at),
                until_cell(ga.unassigned_at, done),
            )
        )
    if not entries:
        return None
    entries.sort(key=lambda e: (e[0], e[1]))

    resource_label = LABELS["overview_col_vehicle"] if res_type == "vehicle" else LABELS["overview_col_material"]
    rows = [
        [
            _p(resource_label, styles["cell_header"]),
            _p(LABELS["col_incident"], styles["cell_header"]),
            _p(LABELS["col_from"], styles["cell_header"]),
            _p(LABELS["col_to"], styles["cell_header"]),
        ]
    ]
    rows.extend(
        [_p(name, styles["cell"]), _p(label, styles["cell"]), _p(von, styles["cell"]), _p(bis, styles["cell"])]
        for name, _sort, label, von, bis in entries
    )

    # The 25mm clock column from the other tables; «noch am Schadenplatz» gets
    # 32mm so it stays one line, and the Einsatz label absorbs the rest.
    table = LongTable(rows, colWidths=_widths(32 * mm, 25 * mm, 32 * mm, flex=1), repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _PANEL),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, _GRID),
                ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ZEBRA]),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _label_value_row(
    label: str,
    value: Any,
    styles: dict[str, ParagraphStyle],
    label_width: float = _LABEL_W,
    label_style: str = "label_col",
) -> Table:
    """One label/value line, the value starting at a fixed column.

    A borderless one-row Table rather than a single Paragraph: the whole point is that
    the values line up, which a "``<b>Label:</b> value``" paragraph cannot do – its
    value starts wherever the label happens to end.

    ``splitInRow`` is what makes the table safe here. A table row normally cannot break,
    so a 4000-character Beschreibung in a plain Table would overflow the page instead of
    flowing onto the next one – which is exactly why this used to be a Paragraph. With
    the flag set, ReportLab splits *inside* the row and long values (and long bullet
    lists, passed as a list of flowables) continue on the following page.
    """
    row = Table(
        [[Paragraph(f"<b>{escape(label)}:</b>", styles[label_style]), value]],
        colWidths=[label_width, _CONTENT_W - label_width],
        hAlign="LEFT",
        splitInRow=1,
    )
    row.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (0, -1), 4),
                ("RIGHTPADDING", (1, 0), (1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return row


def _field(label: str, value: str, styles: dict[str, ParagraphStyle]) -> Table:
    """A single label/value line used inside incident detail blocks."""
    return _label_value_row(label, _p(value, styles["body"]), styles)


def _maybe_field(label: str, value: str | None, styles: dict[str, ParagraphStyle]) -> list[Any]:
    """The label/value line, or nothing at all when there is no value.

    This report is a record, not a form to fill in: "Kontakt: –" tells a reader exactly
    what the absent line tells them, and five of those per incident over twenty-one
    incidents is most of the paper. Anything printed here is something that happened.
    """
    text = _text(value)
    return [_field(label, text, styles)] if text else []


def _bullet_field(label: str, items: list[str], styles: dict[str, ParagraphStyle]) -> list[Any]:
    """A label with one bullet per item, the bullets aligned in the value column.

    An empty list prints nothing – same reasoning as :func:`_maybe_field`. Each bullet
    is its own Paragraph so long entries wrap.
    """
    if not items:
        return []
    bullets = [Paragraph(escape(str(item)), styles["bullet"], bulletText="•") for item in items]
    return [_label_value_row(label, bullets, styles)]


def _incident_detail(
    data: EventReportData,
    inc: Incident,
    index: int,
    styles: dict[str, ParagraphStyle],
    home_city: str = "",
    photos: Sequence[ExportPhoto] = (),
) -> list[Any]:
    """Build the detail block flowables for a single incident."""
    # Heading = address (the incident's "name"); fall back to title, then the dash.
    # Locations equal to the home city are hidden (redundant) → fall back to title.
    heading_name = format_location_for_display(inc.location_address, home_city) or inc.title or LABELS["none"]

    # Sub-title = category and time of alarm. The time used to be a row of the label
    # column; it identifies the incident rather than describing it, so it belongs up here
    # with the category, and the block below starts on what the incident *was*.
    incident_type = TYPE_LABELS.get(inc.type, inc.type)
    received = _fmt_dt(inc.created_at)
    subtitle = LABELS["incident_subtitle"].format(type=incident_type, at=received) if received else incident_type

    # The heading travels with the first few lines it introduces. A block long enough to
    # split across pages splits *below* this group, so no page ever ends on an incident
    # number whose incident starts overleaf.
    block: list[Any] = [
        KeepTogether(
            [
                _p(f"{index}. {heading_name}", styles["incident_heading"]),
                _p(subtitle, styles["meta"]),
                Spacer(1, 2),
                _field(LABELS["col_priority"], PRIORITY_LABELS.get(inc.priority, inc.priority), styles),
                _field(LABELS["col_status"], STATUS_LABELS.get(inc.status, inc.status), styles),
            ]
        )
    ]

    # Free text with live links; the Kontakt row also carries the reporter's
    # number as a tap-to-call tel: link (it used to not print at all).
    description = _text(inc.description)
    if description:
        block.append(_label_value_row(LABELS["description"], Paragraph(_linkify(description), styles["body"]), styles))
    contact_parts = []
    if _text(inc.contact):
        contact_parts.append(_linkify(_text(inc.contact)))
    if _text(inc.contact_phone):
        phone = _text(inc.contact_phone)
        contact_parts.append(_link_markup(_tel_href(phone), phone))
    if contact_parts:
        block.append(_label_value_row(LABELS["contact"], Paragraph(" · ".join(contact_parts), styles["body"]), styles))

    # Flags. Zu Fuss is NOT one of them: it is how the squad moves, so it lives
    # under «Mittel» with the vehicles — where the Lageblatt already files it.
    flag_parts = []
    if inc.nachbarhilfe:
        note = f" ({inc.nachbarhilfe_note})" if inc.nachbarhilfe_note else ""
        flag_parts.append(f"{LABELS['nachbarhilfe']}{note}")
    if inc.am_warten:
        note = f" ({inc.am_warten_note})" if inc.am_warten_note else ""
        flag_parts.append(f"{LABELS['am_warten']}{note}")
    block.extend(_maybe_field(LABELS["flags"], ", ".join(flag_parts), styles))

    # Assignments by resource type
    inc_assignments = [a for a in data.assignments if a.incident_id == inc.id]
    leader_ids = effective_leader_ids(
        inc,
        {
            a.resource_id
            for a in inc_assignments
            if a.resource_type == "personnel" and a.unassigned_at is None and a.is_leader
        },
    )
    for res_type, label in (
        ("personnel", LABELS["crew"]),
        ("vehicle", LABELS["mittel"]),
        ("material", LABELS["materials"]),
    ):
        items = [a for a in inc_assignments if a.resource_type == res_type]
        # EL first (plan 25, decision 23). `is_leader` belongs to one assignment,
        # so this only ever reorders this incident's crew; a stable sort keeps the
        # rest in assignment order. Vehicles and materials never carry the flag.
        #
        # Resolved, not read raw: this report is written about incidents that are
        # over, and completing one releases every assignment and clears the flag
        # from all of them – so the raw flag names nobody exactly where the
        # record matters most (plan 25, decision 29).
        items.sort(key=lambda a: a.resource_id not in leader_ids)
        lines = []
        for a in items:
            name = _resource_name(data, a)
            span = f"{LABELS['assigned_since']} {_fmt_dt(a.assigned_at)}"
            if a.unassigned_at:
                span = LABELS["period_range"].format(start=_fmt_dt(a.assigned_at), end=_fmt_dt(a.unassigned_at))
            lines.append(f"{name} ({span})")
        # «Zu Fuss» reads as one more Mittel — no clock, the flag has none.
        if res_type == "vehicle" and inc.zu_fuss:
            lines.append(LABELS["zu_fuss"])
        block.extend(_bullet_field(label, lines, styles))

    # Status transition timeline. No operator name on the line: which account moved the
    # card is an audit-log question, and the audit export answers it in full.
    inc_transitions = [t for t in data.transitions if t.incident_id == inc.id]
    lines = [
        f"{_fmt_dt(t.timestamp)}: "
        f"{STATUS_LABELS.get(t.from_status, t.from_status)} → {STATUS_LABELS.get(t.to_status, t.to_status)}"
        for t in inc_transitions
    ]
    block.extend(_bullet_field(LABELS["status_timeline"], lines, styles))

    # Reko report summaries (text fields only)
    inc_reko = [r for r in data.reko_reports if r.incident_id == inc.id]
    for reko in inc_reko:
        parts = []
        # Channel first: the rest of the block is what was reported, and this is
        # who reported it and how it reached the board (plan 26 §7). Nothing is
        # printed for a field arrival's *absence* – "no Reko on site" is already
        # what an empty line says.
        arrival = reko_arrival_line(reko)
        if arrival:
            parts.append(arrival)
        parts.extend(reko_filing_lines(data, reko))
        if reko.is_relevant is not None:
            parts.append(f"{LABELS['reko_relevant']}: {LABELS['yes'] if reko.is_relevant else LABELS['no']}")
        if reko.power_supply:
            parts.append(f"{LABELS['reko_power']}: {POWER_LABELS.get(reko.power_supply, reko.power_supply)}")
        if reko.summary_text:
            parts.append(f"{LABELS['reko_summary']}: {reko.summary_text}")
        if reko.additional_notes:
            parts.append(f"{LABELS['reko_notes']}: {reko.additional_notes}")
        if reko.is_draft:
            parts.append(f"({LABELS['reko_draft']})")
        block.extend(_bullet_field(LABELS["reko"], parts, styles))

    # Schadenplatz-Rapport (plan 25, §7) – the field slip this app replaced.
    report = rapport_by_incident(data).get(inc.id)
    if report is not None:
        block.extend(_rapport_block(data, inc, report, styles))
    # A card merged into this one (directly or along a chain) whose crew had filed
    # its own Rapport too (one per Einsatz, so it stays on the merged card's row):
    # printed here, under its own heading and with its own work window, so neither
    # record is lost (owner decision 10.10.2026).
    for merged_inc, merged_report in data.merged_rapports.get(inc.id, []):
        block.extend(
            _rapport_block(
                data,
                merged_inc,
                merged_report,
                styles,
                heading=LABELS["rapport_merged"].format(number=merged_inc.number or "?"),
                # Its crew moved with the merge: the board's count is the surviving card's.
                board_incident=inc,
            )
        )

    # Fotos vom Feld — Reko and Rapport photos in one grid, each caption naming its
    # source. Last in the block: they illustrate the record above, they are not it.
    # No photos → no heading (the `_maybe_field` reasoning).
    grid = photo_grid(photos, _PHOTO_PER_ROW, _CONTENT_W / _PHOTO_PER_ROW, _PHOTO_MAX_H, styles["meta"])
    if grid:
        first, *rest = grid
        # The sub-heading travels with the first row, same rule as every heading here.
        block.append(KeepTogether([Spacer(1, 3), _p(LABELS["photos"], styles["subsection"]), first]))
        block.extend(rest)

    block.append(Spacer(1, 8))
    return block


def _format_work_window(window: WorkWindow) -> str:
    """``17:45 bis 20:18``, or a one-sided ``ab``/``bis`` when only one end is known.

    The old format printed the missing end as a placeholder, which read as a range that
    closed on nothing.
    """
    start, end = _fmt_dt(window.started_at), _fmt_dt(window.ended_at)
    if start and end:
        return LABELS["period_range"].format(start=start, end=end)
    if start:
        return LABELS["rapport_work_from"].format(at=start)
    if end:
        return LABELS["rapport_work_to"].format(at=end)
    return ""


def _rapport_block(
    data: EventReportData,
    inc: Incident,
    report: SchadenplatzReport,
    styles: dict[str, ParagraphStyle],
    heading: str | None = None,
    board_incident: Incident | None = None,
) -> list[Any]:
    """The "Schadenplatz-Rapport" lines of one incident's detail block.

    Set as its own level (a bold sub-heading) rather than as more fields in the same
    weight: this is the crew's record inside the KP's, and the page has to say so. No
    rule above it, though – nothing separates one incident from the next, so a line here
    would make the rapport read as the bigger break of the two, which it is not.
    """
    head: list[Any] = [Spacer(1, 3), _p(heading or LABELS["rapport"], styles["subsection"])]
    if report.is_draft:
        head.append(_p(LABELS["rapport_draft"], styles["meta"]))

    # Beginn/Ende Tätigkeit is derived (see `rapport_work_windows`), not stored:
    # the crew never typed it, the board recorded it.
    window = rapport_work_windows(data).get(inc.id, WorkWindow(None, None))
    head.extend(_maybe_field(LABELS["rapport_work"], _format_work_window(window), styles))

    # Names where the crew gave names, the bare count where the rapport predates
    # the checklist. The board's own number stays alongside whenever the two
    # disagree – that divergence says the board was behind reality (decision 5).
    crew_names = personnel_present_names(report) + extra_personnel_lines(report)
    head.extend(
        _maybe_field(
            LABELS["rapport_personnel_count"],
            format_corrected_count(
                report.personnel_count,
                report.personnel_count_corrected,
                board_personnel_count(data, (board_incident or inc).id),
            ),
            styles,
        )
    )
    if crew_names:
        head.extend(_bullet_field(LABELS["rapport_personnel_names"], crew_names, styles))
    # Same rule as the incident heading: the sub-heading never ends a page alone.
    flow: list[Any] = [KeepTogether(head)]
    # The vehicles are a list the crew ticked, not a number it corrected.
    vehicles = vehicle_present_names(report)
    flow.extend(_maybe_field(LABELS["rapport_vehicles"], ", ".join(vehicles), styles))

    # Material: one bullet per unit, `gebraucht` as ja/nein (§18.32), and no
    # "vor Ort verblieben" state on a consumable (decision 26).
    flow.extend(
        _bullet_field(
            LABELS["rapport_material"],
            [format_material_unit(row) for row in material_checklist_rows(report)],
            styles,
        )
    )
    # Weiteres Material: one bullet per entry, each carrying its own "vor Ort
    # verblieben" (§18.35) – the whole reason this stopped being one line of
    # comma-separated text. Somebody reading the report has to be able to tell
    # which of the three borrowed things is still standing in the cellar.
    extra = extra_material_rows(report)
    if extra:
        flow.extend(
            _bullet_field(
                LABELS["rapport_extra_material"],
                [format_extra_material(row) for row in extra],
                styles,
            )
        )

    if report.kurzbericht:
        flow.append(_field(LABELS["rapport_kurzbericht"], report.kurzbericht, styles))
    if report.handed_over_to:
        flow.append(_field(LABELS["rapport_handed_over"], report.handed_over_to, styles))

    # Name and phone, on their own lines (§18.31). The phone is a field rather
    # than a fragment of prose precisely so a reader can dial it – printing it
    # inside the name line would put it back where it could not be found.
    if report.owner_name:
        flow.append(_field(LABELS["rapport_owner"], report.owner_name, styles))
    if report.owner_phone:
        phone = _text(report.owner_phone)
        flow.append(
            _label_value_row(
                LABELS["rapport_owner_phone"], Paragraph(_link_markup(_tel_href(phone), phone), styles["body"]), styles
            )
        )

    # The Abholung belongs to the card the crew is on now; a kept Rapport of a merged
    # card does not repeat it (its pickup moved with the merge).
    if board_incident is None and inc.pickup_needed:
        note = f" ({inc.pickup_note})" if inc.pickup_note else ""
        flow.append(_field(LABELS["rapport_pickup"], f"{_fmt_dt(inc.pickup_requested_at)}{note}", styles))

    for line in rapport_filing_lines(data, report):
        flow.append(_p(line, styles["meta"]))
    return flow


def _section(title: str, styles: dict[str, ParagraphStyle], description: str = "") -> list[Any]:
    """A section heading: title, rule, and one line saying what is under it.

    Every top-level section is built by this function, so they cannot drift apart –
    the reaction times used to explain themselves *below* their table while the journal
    explained itself above its own. The heading will not be left stranded at the foot
    of a page.
    """
    flow: list[Any] = [CondPageBreak(_SECTION_MIN_SPACE), _p(title, styles["section"]), _rule()]
    if description:
        flow.append(_p(description, styles["section_hint"]))
    return flow


def _signature_block(styles: dict[str, ParagraphStyle], kommandant: str = "") -> list[Any]:
    """Ort/Datum plus a signature line for Einsatzleiter and Kommandant.

    Same two roles, same order as the KP-Front Einsatzrapport, so a station files both
    documents for one night the same way. Dotted leaders rather than solid rules: the
    convention already says "write here" on every other form in the building.

    ``kommandant``: the configured name, pre-printed on the Kommandant line the way
    KP-Front does it — empty prints just the label.

    The four columns are measured, not chosen. Fixed 26 mm label columns left a 9 mm hole
    between "Ort, Datum:" and the line it belongs to, and made the gutter between the two
    pairs *negative* (-2.2 mm) – the row was 172 mm wide in a 169.8 mm frame, which is why
    the right-hand line ran into the margin. Each label column is now as wide as its own
    text, and the two write-in lines split what is left.
    """
    date_label = f"{LABELS['signature_place_date']}:"
    roles = (LABELS["signature_incident_leader"], LABELS["signature_commander"])
    font, size = styles["label_col"].fontName, styles["label_col"].fontSize
    pad = 3 * mm  # breathing room between a label and the line it introduces
    gutter = 10 * mm  # between the Ort/Datum pair and the signature pair

    date_w = stringWidth(date_label, font, size) + pad
    # Both roles share a width so the two signature lines start at the same x.
    role_w = max(stringWidth(f"{r}:", font, size) for r in roles) + pad
    line_w = (_CONTENT_W - date_w - role_w - gutter) / 2

    def row(role: str, name: str = "") -> Table:
        # A configured name sits ON the line (the dotted leader stays underneath —
        # the signature itself still goes there); an empty name leaves the line bare.
        cells = [
            _p(date_label, styles["label_col"]),
            "",
            _p(f"{role}:", styles["label_col"]),
            _p(name, styles["body"]) if name else "",
        ]
        table = Table([cells], colWidths=[date_w, line_w, role_w + gutter, line_w], hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    # The gutter lives inside the second label's cell, so the row still
                    # sums to exactly the content width.
                    ("LEFTPADDING", (2, 0), (2, 0), gutter),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                    ("LINEBELOW", (1, 0), (1, 0), 0.5, _DIM, None, (1, 2)),
                    ("LINEBELOW", (3, 0), (3, 0), 0.5, _DIM, None, (1, 2)),
                ]
            )
        )
        return table

    return [
        KeepTogether(
            [
                *_section(LABELS["signatures_title"], styles),
                row(LABELS["signature_incident_leader"]),
                row(LABELS["signature_commander"], _text(kommandant)),
            ]
        )
    ]


def build_event_report_pdf(
    data: EventReportData,
    generated_by: str,
    home_city: str = "",
    logo: bytes | None = None,
    photos: Mapping[uuid.UUID, Sequence[ExportPhoto]] | None = None,
    station_name: str = "",
    kommandant: str = "",
) -> bytes:
    """Render the after-action report PDF.

    Args:
        data: Fully-loaded event data from ``collect_event_report_data``.
        generated_by: Username of the exporting user — PDF author metadata + audit, no cover row.
        home_city: Configured home city; locations equal to it are hidden.
        station_name: The organization (``firestation_name`` setting) for the running
            footer — with only the logo carrying it, a black-and-white copy of the
            report named no Feuerwehr at all (field test 07.09.).
        kommandant: Configured Kommandant name, pre-printed on the signature line.
        logo: Station logo as PNG/JPEG bytes (``services.branding.get_report_logo``).
            ``None`` – or anything unreadable – simply renders no letterhead.
        photos: Pre-loaded Reko/Rapport photos per incident id (the caller reads the
            files — this builder stays free of I/O). ``None`` renders no photo blocks.

    Returns:
        The finished PDF document as ``bytes`` (starts with ``%PDF``).
    """
    styles = _styles()
    buffer = BytesIO()

    event = data.event
    # The running footer dates the EVENT, not the print job. "Erstellt am" on the cover
    # already says when this PDF was made; repeating it on all forty pages next to the
    # event name meant the one date a reader picking up a loose page needs – which
    # operation is this? – was the one date the footer did not carry.
    footer_date = _fmt_dt(event.created_at)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=_PAGE_MARGIN,
        rightMargin=_PAGE_MARGIN,
        topMargin=_PAGE_MARGIN,
        bottomMargin=_PAGE_MARGIN,
        title=f"{LABELS['report_title']}: {event.name}",
        author=generated_by or "",
    )

    story: list[Any] = []
    story.extend(_cover(data, styles, logo))
    story.append(Spacer(1, 10))

    # Summary
    story.extend(_section(LABELS["summary_title"], styles, LABELS["summary_hint"]))
    story.append(_summary_table(data, styles))
    story.append(Spacer(1, 10))

    # Anwesenheit – event-level, so it sits with the summary rather than inside the
    # incident chapters, and it is simply absent when nobody checked in. A station
    # that does not use the check-in link would otherwise carry an empty heading on
    # every report it ever files.
    if data.attendance:
        story.extend(_section(LABELS["attendance_title"], styles, LABELS["attendance_hint"]))
        story.append(_p(_attendance_totals_line(data), styles["body"]))
        story.append(Spacer(1, 4))
        story.append(_attendance_table(data, styles))
        story.append(Spacer(1, 12))

    if not data.incidents:
        story.append(_p(LABELS["no_incidents"], styles["body"]))
    else:
        # Overview table
        story.extend(_section(LABELS["incident_list_title"], styles, LABELS["incident_list_hint"]))
        story.append(_incident_overview_table(data, styles, home_city))
        story.append(Spacer(1, 12))

        # Fahrzeug-/Material-Übersicht: what was where, without opening every
        # incident block (field test 07.09.). Skipped entirely when the event
        # never assigned that kind of resource.
        for res_type, title_key, hint_key in (
            ("vehicle", "vehicle_overview_title", "vehicle_overview_hint"),
            ("material", "material_overview_title", "material_overview_hint"),
        ):
            overview = _resource_overview_table(data, styles, res_type)
            if overview is not None:
                story.extend(_section(LABELS[title_key], styles, LABELS[hint_key]))
                story.append(overview)
                story.append(Spacer(1, 12))

        # Reaction times (debrief metrics)
        story.extend(_section(LABELS["reaction_title"], styles, LABELS["reaction_hint"]))
        story.append(_reaction_times_table(data, styles))
        story.append(Spacer(1, 12))

        # Einsatztagebuch (merged, chronological journal)
        story.extend(_section(LABELS["journal_title"], styles, LABELS["journal_hint"]))
        journal_entries = build_journal_entries(data)
        if journal_entries:
            story.append(_journal_table(journal_entries, styles))
        else:
            story.append(_p(LABELS["journal_empty"], styles["body"]))
        story.append(Spacer(1, 12))

        # Per-incident detail sections. The heading is glued to the first incident so it
        # cannot introduce a section that starts on the next page.
        #
        # The blocks FLOW; they are not each wrapped in a KeepTogether. That wrapper used
        # to push any incident that did not fit whole onto a fresh page, which on a real
        # storm event (21 Schadenplätze) meant page after page ending three-quarters
        # empty – 14 pages of paper for 12 pages of report. What actually has to hold
        # together is the heading and the lines directly under it, and `_incident_detail`
        # keeps those together itself. An incident that genuinely runs long now continues
        # overleaf instead of buying a whole page.
        details_heading = _section(LABELS["details_title"], styles, LABELS["details_hint"])
        for idx, inc in enumerate(data.incidents, 1):
            block = _incident_detail(data, inc, idx, styles, home_city, (photos or {}).get(inc.id, ()))
            if idx == 1:
                block = [*details_heading, *block]
            story.extend(block)

    story.extend(_signature_block(styles, kommandant))

    # The organization leads the footer: the logo is the only other place it
    # appears, and a photocopy loses the logo before it loses 8pt text.
    footer_left = f"{station_name}  ·  {event.name}" if _text(station_name) else event.name
    doc.build(
        story,
        canvasmaker=_make_canvas_factory(footer_left=footer_left, footer_date=footer_date),
    )

    return buffer.getvalue()
