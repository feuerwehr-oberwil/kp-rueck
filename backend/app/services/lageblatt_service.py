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
from collections.abc import Mapping, Sequence
from datetime import datetime
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..models import (
    Incident,
    IncidentAssignment,
    IncidentGroupAssignment,
    Material,
    Personnel,
    RekoReport,
    StatusTransition,
    Vehicle,
)
from .audit_export_service import EventReportData
from .incident_leader import effective_leader_ids
from .pdf_report_service import (
    LOCAL_TZ,
    POWER_LABELS,
    PRIORITY_LABELS,
    STATUS_LABELS,
    TYPE_LABELS,
    WorkWindow,
    extra_material_left_on_site_names,
    format_location_for_display,
    logo_flowable,
    material_left_on_site_names,
    photo_grid,
    rapport_by_incident,
    rapport_work_windows,
    reko_arrival_line,
    reko_filing_lines,
    vehicle_present_names,
)
from .photo_storage import ExportPhoto

# The handwriting continuation area fills the rest of the page below the data
# (field test 07.09.: «gleich ganze Seite füllen»). When less than this many
# empty rows would fit, the grid claims a fresh full page instead — a sheet
# that offers one squeezed line is not a fallback anyone can write on.
MIN_EMPTY_ROWS = 2

# MINIMUM height for a data row and fixed height for an empty one: fits three
# 6pt lines plus padding, and doubles as handwriting space. Data rows may grow
# beyond it — a fixed height let a long Rückmeldung paint into the row below
# (field test 07.09.).
ROW_HEIGHT = 9 * mm

# Photos on the detail pages: smaller than the Einsatzrapport's — this is the
# dense operational sheet, so four to a row at postcard-thumb height, after the
# textual details of each incident.
_PHOTO_PER_ROW = 4
_PHOTO_MAX_H = 35 * mm

_BORDER = colors.HexColor("#a1a1aa")
_HEADER_BG = colors.HexColor("#f4f4f5")

_PRIORITY_SHORT = {"high": "H", "medium": "M", "low": "T"}

# Swiss fire service rank order (highest first) and compact display prefixes.
# role_sort_order in the DB is not reliably populated, so rank by name.
# «offizier» singular — the canonical spelling everywhere else in the app
# (crud/assignments._RANK_FALLBACK, both seeds). The plural key here silently
# ranked every Offizier LAST, so «Wer» named the Wachtmeister of a squad an
# Offizier was leading (field test 07.09.).
_ROLE_RANK = {"offizier": 0, "wachtmeister": 1, "korporal": 2, "mannschaft": 3}
_ROLE_ABBR = {"offizier": "Of", "wachtmeister": "Wm", "korporal": "Kpl", "mannschaft": ""}

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


def _dt_cell(dt: datetime | None) -> str:
    """Full date + clock for the table's Zeit cells, wrapping after the date.

    A bare clock was ambiguous the moment a storm ran past midnight (field
    test 07.09.); the space lets the narrow column break it onto two lines.
    """
    if dt is None:
        return ""
    return dt.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M")


def _dt_full(dt: datetime | None) -> str:
    if dt is None:
        return "–"
    return dt.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M")


def _clip(text: str | None, limit: int) -> str:
    if not text:
        return ""
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _p(text: str, bold: bool = False) -> Paragraph:
    return Paragraph(escape(text), _CELL_BOLD if bold else _CELL)


class _HandwritingGrid(Flowable):  # type: ignore[misc]  # reportlab ships no stubs — Flowable is Any
    """Empty continuation rows filling whatever the page has left under the table.

    ``wrap`` sizes the grid to the available height (minus a reserve for the
    footer line). Fewer than :data:`MIN_EMPTY_ROWS` would fit → it reports a
    height larger than available, which makes platypus move it to a fresh page
    and re-``wrap`` it against the full frame — a whole page of empty rows.
    """

    def __init__(self, col_widths: Sequence[float], footer_reserve: float) -> None:
        super().__init__()
        self._col_widths = list(col_widths)
        self._footer_reserve = footer_reserve
        self._rows = 0

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:  # noqa: N803 (reportlab API)
        rows = int((availHeight - self._footer_reserve) // ROW_HEIGHT)
        if rows < MIN_EMPTY_ROWS:
            return availWidth, availHeight + 1
        self._rows = rows
        self.width = sum(self._col_widths)
        self.height = rows * ROW_HEIGHT
        return self.width, self.height

    def draw(self) -> None:
        canvas = self.canv
        canvas.saveState()
        canvas.setStrokeColor(_BORDER)
        canvas.setLineWidth(0.5)
        xs = [0.0]
        for width in self._col_widths:
            xs.append(xs[-1] + width)
        top = self._rows * ROW_HEIGHT
        for row in range(self._rows + 1):
            canvas.line(0, row * ROW_HEIGHT, xs[-1], row * ROW_HEIGHT)
        for x in xs:
            canvas.line(x, 0, x, top)
        canvas.restoreState()


def _first_reko(data: EventReportData, incident_id: uuid.UUID) -> RekoReport | None:
    reports = [r for r in data.reko_reports if r.incident_id == incident_id and not r.is_draft]
    reports.sort(key=lambda r: r.submitted_at)
    return reports[0] if reports else None


def _first_transition_to(data: EventReportData, incident_id: uuid.UUID, statuses: set[str]) -> StatusTransition | None:
    hits = [t for t in data.transitions if t.incident_id == incident_id and t.to_status in statuses]
    hits.sort(key=lambda t: t.timestamp)
    return hits[0] if hits else None


def _active_resources(data: EventReportData, inc: Incident) -> tuple[list[Personnel], list[Vehicle], list[Material]]:
    """(crew Personnel, vehicles Vehicle, materials Material) actively assigned.

    An Auftrag stop's squad rides on the group, not on the incident — so each
    kind falls back to the route-level assignments when the incident has none
    of its own (field test 07.09.: the Sturmholz stops printed an empty «Wer»).
    """
    active: list[IncidentAssignment | IncidentGroupAssignment] = [
        a for a in data.assignments if a.incident_id == inc.id and a.unassigned_at is None
    ]
    if inc.group_id is not None:
        group_active = [
            a for a in data.group_assignments if a.incident_group_id == inc.group_id and a.unassigned_at is None
        ]
        for res_type in ("personnel", "vehicle", "material"):
            if not any(a.resource_type == res_type for a in active):
                active.extend(a for a in group_active if a.resource_type == res_type)
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


def _leader_ids(data: EventReportData, inc: Incident) -> set[uuid.UUID]:
    """The Einsatzleiter(s) of ONE incident.

    `is_leader` is a property of a single assignment, so this must never be
    computed event-wide: one incident's leader may not reorder another's crew.

    Active flag first, `Incident.leader_personnel_id` behind it — a completed
    incident has no active assignments left at all, so the flag alone answers
    "nobody" for every Schadenplatz that is already done.
    """
    active = {
        a.resource_id
        for a in data.assignments
        if a.incident_id == inc.id and a.resource_type == "personnel" and a.unassigned_at is None and a.is_leader
    }
    return effective_leader_ids(inc, active)


def _rank_key(person: Personnel) -> tuple[int, int, str]:
    role = (person.role or "").lower()
    return (_ROLE_RANK.get(role, 98), person.role_sort_order, person.name)


def _mittel(inc: Incident, vehicles: list[Vehicle]) -> list[str]:
    """Womit: vehicles, with 'Zu Fuss' treated like one more vehicle."""
    names = [v.name for v in vehicles]
    if inc.zu_fuss:
        names.append("Zu Fuss")
    return names


def _crew_compact(crew: list[Personnel]) -> str:
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


def _incident_row(data: EventReportData, inc: Incident, index: int, home_city: str) -> list[Any]:
    reko = _first_reko(data, inc.id)
    reko_by = ""
    if reko and reko.submitted_by_personnel_id in data.personnel_map:
        reko_by = data.personnel_map[reko.submitted_by_personnel_id].name
    dispo = _first_transition_to(data, inc.id, {"enroute", "active"})
    done = inc.status in ("returning", "complete") or inc.completed_at is not None
    crew, vehicles, _materials = _active_resources(data, inc)

    return [
        _p(str(index), bold=True),
        _p(_PRIORITY_SHORT.get(inc.priority, "")),
        _p(_dt_cell(inc.created_at)),
        _p(_clip(format_location_for_display(inc.location_address, home_city), 50)),
        _p(_clip(inc.title, 65)),
        _p(_dt_cell(reko.submitted_at) if reko else ""),
        _p(_clip(reko_by, 22)),
        # Generous: rows grow with their content now, and the operator asked for
        # the full Rückmeldung over a truncated one. The clip only guards against
        # a novel-length summary eating the sheet — the detail pages carry it all.
        _p(_clip(reko.summary_text if reko else "", 220)),
        _p(_dt_cell(dispo.timestamp) if dispo else ""),
        _p(_clip(_crew_compact(crew), 24)),
        _p(_clip(", ".join(_mittel(inc, vehicles)), 22)),
        _p("✓" if done else ""),
    ]


# German labels for the reko form's dangers JSON (frontend reko.dangerLabels —
# same words the crew ticked). An unmapped key prints as-is rather than vanishing.
_DANGER_LABELS = {
    "fire": "Feuer",
    "fire_danger": "Brandgefahr",
    "explosion": "Explosionsgefahr",
    "collapse": "Einsturzgefahr",
    "chemical": "Gefahrstoffe",
    "electrical": "Elektrische Gefahr",
}


def _dangers_text(payload: Any) -> str:
    """Gefahren line in the crew's words — the raw keys («collapse») printed on a
    sheet that non-technical readers work from (field test 07.09.)."""
    if not isinstance(payload, dict):
        return ""
    parts = [_DANGER_LABELS.get(key, str(key)) for key, value in payload.items() if value is True]
    if payload.get("other_notes"):
        parts.append(str(payload["other_notes"]))
    return ", ".join(parts)


def _effort_text(payload: Any) -> str:
    """Aufwand line from the reko form's effort JSON, in German prose instead of
    «personnel_count: 4, vehicles_needed: ['Pio']»."""
    if not isinstance(payload, dict):
        return ""
    parts = []
    if payload.get("personnel_count"):
        parts.append(f"{payload['personnel_count']} Personen")
    if payload.get("vehicles_needed"):
        parts.append(f"Fahrzeuge: {', '.join(str(v) for v in payload['vehicles_needed'])}")
    if payload.get("equipment_needed"):
        parts.append(f"Gerät: {', '.join(str(e) for e in payload['equipment_needed'])}")
    if payload.get("estimated_duration_hours"):
        parts.append(f"ca. {payload['estimated_duration_hours']} h")
    return ", ".join(parts)


def _detail_rows(data: EventReportData, inc: Incident, home_city: str) -> list[tuple[str, str]]:
    """Every field the board knows, always present — empty values render as an
    em dash so operators see what is unknown (and can fill it in by hand)."""
    crew, vehicles, materials = _active_resources(data, inc)
    leaders = _leader_ids(data, inc)

    coords = "–"
    if inc.location_lat is not None and inc.location_lng is not None:
        # Decimal degrees with hemisphere («47.51080° N, 7.55480° E») — the
        # professional notation the field test asked for; the bare pair read
        # like debugger output.
        lat, lng = float(inc.location_lat), float(inc.location_lng)
        coords = f"{abs(lat):.5f}° {'N' if lat >= 0 else 'S'}, {abs(lng):.5f}° {'E' if lng >= 0 else 'W'}"

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
        ("Adresse", inc.location_address or "–"),
        ("Koordinaten", coords),
        ("Eingang", _dt_full(inc.created_at)),
        # «KP», not «Operator» (field test 07.09.): a board-created incident was
        # captured in the command post, and that is the station's word for it.
        ("Quelle", {"intake": "Telefon", "divera": "Divera"}.get(inc.source or "", "KP")),
        ("Meldung", inc.description or "–"),
        # Name AND number: on the paper fallback the phone is the whole point
        # of the row — it is what the KP dials when the screens are dead.
        ("Kontakt", " · ".join(p for p in (inc.contact, inc.contact_phone) if p) or "–"),
        ("Merkmale", ", ".join(flags) or "–"),
    ]

    # A stop names its route: the crew below is the Auftrag's squad, and the
    # sheet has to say which route it is working and where this address sits.
    if inc.group_id is not None and inc.group_id in data.group_map:
        group = data.group_map[inc.group_id]
        stops = sorted((i for i in data.incidents if i.group_id == inc.group_id), key=lambda i: i.group_position)
        pos = next((n for n, stop in enumerate(stops, start=1) if stop.id == inc.id), None)
        rows.append(("Auftrag", group.name if pos is None else f"{group.name} – Stopp {pos} von {len(stops)}"))

    rows += [
        (
            "Personal",
            # EL first (plan 25, decision 23), rank order underneath — the sort key
            # keeps the existing `_rank_key` ordering for everyone who is not the EL.
            ", ".join(
                f"{p.name}" + (f" ({p.role})" if p.role else "")
                for p in sorted(crew, key=lambda p: (p.id not in leaders, _rank_key(p)))
            )
            or "–",
        ),
        ("Mittel", ", ".join(_mittel(inc, vehicles)) or "–"),
        ("Material", ", ".join(m.name for m in materials) or "–"),
    ]

    # "Vor Ort" is read off every report including drafts: an arrival is a fact
    # about the incident, and a crew that pinged and has not filed yet is exactly
    # the state the paper fallback has to show.
    for report in sorted(
        (r for r in data.reko_reports if r.incident_id == inc.id and r.arrived_at is not None),
        key=lambda r: r.arrived_at or datetime.min,
    ):
        rows.append(("Reko vor Ort", reko_arrival_line(report)))

    reports = [r for r in data.reko_reports if r.incident_id == inc.id and not r.is_draft]
    if not reports:
        rows.append(("Reko", "–"))
    for report in reports:
        # Who filed it and through which channel, in the same words every other
        # output uses (plan 26 §7). This replaces the bare name that used to sit
        # in the row label: a crew-filed report the KP amended over the radio has
        # two authors, which a label in brackets cannot say.
        parts = reko_filing_lines(data, report)
        if report.summary_text:
            parts.append(report.summary_text)
        dangers = _dangers_text(report.dangers_json)
        if dangers:
            parts.append(f"Gefahren: {dangers}")
        effort = _effort_text(report.effort_json)
        if effort:
            parts.append(f"Aufwand: {effort}")
        if report.power_supply:
            parts.append(f"Strom: {POWER_LABELS.get(report.power_supply, report.power_supply)}")
        if report.additional_notes:
            parts.append(f"Notizen: {report.additional_notes}")
        rows.append((f"Reko {_time(report.submitted_at)}", " – ".join(parts) or "–"))

    # Compact status history: when each stage was first reached.
    transitions = sorted((t for t in data.transitions if t.incident_id == inc.id), key=lambda t: t.timestamp)
    seen: dict[str, str] = {}
    for t in transitions:
        seen.setdefault(t.to_status, _time(t.timestamp))
    verlauf = " → ".join(f"{STATUS_LABELS.get(s, s)} {ts}" for s, ts in seen.items())
    rows.append(("Verlauf", verlauf or "–"))

    if inc.field_complete_reported_at:
        rows.append(("Beendet gemeldet", _dt_full(inc.field_complete_reported_at)))

    # The Schadenplatz-Rapport's own family of rows (plan 25, §7) — they join
    # "Beendet gemeldet", which is the field's other message to this sheet.
    # Only rendered when the crew (or the KP) actually said something: 23
    # Schadenplätze times four em dashes is noise on a sheet printed to be
    # written on.
    rapport = rapport_by_incident(data).get(inc.id)
    if rapport is not None:
        # Derived, not stored (see `rapport_work_windows`): the crew stopped
        # typing a window the board had already recorded twice over.
        window = rapport_work_windows(data).get(inc.id, WorkWindow(None, None))
        if window.started_at or window.ended_at:
            rows.append(("Tätigkeit", f"{_dt_full(window.started_at)} – {_dt_full(window.ended_at)}"))
        if rapport.handed_over_to:
            rows.append(("Übergeben an", rapport.handed_over_to))
        rapport_vehicles = vehicle_present_names(rapport)
        if rapport_vehicles:
            rows.append(("Fahrzeuge", ", ".join(rapport_vehicles)))
        # One row for everything still standing at the address, tracked units and
        # named "Weiteres Material" alike (§18.35). The sheet is printed so the
        # KP can work when the screens are dead, and the question it answers is
        # "was liegt noch dort" — a borrowed pump counts, and it is marked
        # `nicht erfasst` because nobody can release it off a board.
        left = material_left_on_site_names(rapport) + extra_material_left_on_site_names(rapport)
        if left:
            rows.append(("Material vor Ort", ", ".join(left)))

    # An open Abholung outlives `complete` (decision 24) — a crew still standing
    # at an address belongs on the sheet the KP prints when the screens die.
    if inc.pickup_needed:
        note = f" – {inc.pickup_note}" if inc.pickup_note else ""
        since = _dt_full(inc.pickup_requested_at) if inc.pickup_requested_at else "–"
        rows.append(("Abholung offen", f"seit {since}{note}"))

    rows.append(("Interne Notizen", inc.internal_notes or "–"))
    rows.append(("Abgeschlossen", _dt_full(inc.completed_at)))
    return rows


def _detail_block(
    data: EventReportData,
    inc: Incident,
    index: int,
    home_city: str,
    photos: Sequence[ExportPhoto] = (),
) -> list[Any]:
    """One bordered card per incident: shaded header row, generous row spacing.

    Photos (Reko + Rapport) follow AFTER the card rather than inside it: a LongTable
    row cannot split, so a cell holding five rows of thumbnails would overflow the
    frame — as free flowables the grid breaks between rows like everything else.
    """
    head = (
        f"{index} – {inc.title}"
        f"  ·  {STATUS_LABELS.get(inc.status, inc.status)}"
        f"  ·  Prio {_PRIORITY_SHORT.get(inc.priority, '–')}"
    )
    usable = A4[0] - 16 * mm
    rows: list[list[Any]] = [[Paragraph(escape(head), _DETAIL_HEAD), ""]]
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
    flow: list[Any] = [Spacer(1, 4 * mm), card]

    grid = photo_grid(photos, _PHOTO_PER_ROW, usable / _PHOTO_PER_ROW, _PHOTO_MAX_H, _CELL)
    if grid:
        first, *rest = grid
        # Label + first row stay together so "Fotos" never announces images overleaf.
        flow.append(KeepTogether([Spacer(1, 1.5 * mm), Paragraph("Fotos", _DETAIL_LABEL), first]))
        flow.extend(rest)
    return flow


def build_lageblatt_pdf(
    data: EventReportData,
    home_city: str = "",
    photos: Mapping[uuid.UUID, Sequence[ExportPhoto]] | None = None,
    logo: bytes | None = None,
    station_name: str = "",
) -> bytes:
    """Render the Lageblatt PDF and return it as bytes.

    ``photos``: pre-loaded Reko/Rapport photos per incident id (the caller reads
    the files — this builder stays free of I/O). ``None`` renders no photos.
    ``logo``: station logo bytes (``services.branding.get_report_logo``) — same
    letterhead as the Einsatzrapport, so the two sheets a station files for one
    night carry the same mark.
    ``station_name``: the organization (``firestation_name`` setting) for the
    footer line — the logo must not be the only thing naming the Feuerwehr.
    """
    now_local = datetime.now(LOCAL_TZ)
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=8 * mm,
        rightMargin=8 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f"Lageblatt – {data.event.name}",
    )

    title_style = ParagraphStyle("lageblatt_title", fontName="Helvetica-Bold", fontSize=11, leading=14)
    meta_style = ParagraphStyle("lageblatt_meta", fontName="Helvetica", fontSize=8, leading=10)

    heading = [
        Paragraph(f"Ereignis: {data.event.name}", title_style),
        Paragraph(
            f"Datum: {now_local.strftime('%d.%m.%Y')} – Stand: {now_local.strftime('%H:%M')} Uhr",
            meta_style,
        ),
    ]
    # Letterhead like the Einsatzrapport's: mark left, title block beside it.
    logo_img = logo_flowable(logo)
    usable = A4[0] - 16 * mm
    story: list[Any]
    if logo_img is None:
        story = list(heading)
    else:
        lw = logo_img.drawWidth + 6 * mm
        head = Table([[logo_img, heading]], colWidths=[lw, usable - lw], hAlign="LEFT")
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
        story = [head]
    story.append(Spacer(1, 3 * mm))

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

    rows: list[list[Any]] = [header_group, header_sub]
    for index, inc in enumerate(data.incidents, start=1):
        rows.append(_incident_row(data, inc, index, home_city))

    # Same width for columns of the same kind: all Zeit equal, both Wer equal.
    # Zeit is sized so «07.09.2026» fits on one line at 6pt (the clock wraps
    # underneath); the extra width comes out of the two free-text columns.
    fractions = [0.034, 0.034, 0.064, 0.150, 0.152, 0.064, 0.085, 0.149, 0.064, 0.085, 0.085, 0.034]
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
    # Data rows get ROW_HEIGHT as a MINIMUM and grow with their content — a
    # fixed height overprinted the next row as soon as a Rückmeldung wrapped
    # past three lines. Short rows still match the handwriting grid below, so
    # the sheet reads as one table.
    n_data = len(data.incidents)
    table = LongTable(
        rows,
        colWidths=col_widths,
        repeatRows=2,
        minRowHeights=[0, 0] + [ROW_HEIGHT] * n_data,
    )
    table.setStyle(TableStyle(style))
    story.append(table)

    # The handwriting continuation: empty rows to the bottom of the page (or a
    # fresh full page, see _HandwritingGrid). 8 mm reserve keeps the footer
    # line on the same sheet as the grid it signs.
    story.append(_HandwritingGrid(col_widths, footer_reserve=8 * mm))

    footer_style = ParagraphStyle(
        "lageblatt_footer", fontName="Helvetica", fontSize=6.5, leading=8, textColor=colors.grey
    )
    footer_text = "KP Rück – Lageblatt (angelehnt an Führungsformular Elementarschaden FWI BL/BS)"
    if station_name.strip():
        footer_text = f"{station_name.strip()} · {footer_text}"
    story.append(Spacer(1, 2 * mm))
    story.append(
        Paragraph(
            escape(footer_text),
            footer_style,
        )
    )

    # Detail pages: everything the board knows per incident.
    if data.incidents:
        story.append(PageBreak())
        story.append(Paragraph(f"Einsatzdetails – Stand {now_local.strftime('%H:%M')} Uhr", title_style))
        for index, inc in enumerate(data.incidents, start=1):
            story.extend(_detail_block(data, inc, index, home_city, (photos or {}).get(inc.id, ())))

    doc.build(story)
    return buffer.getvalue()
