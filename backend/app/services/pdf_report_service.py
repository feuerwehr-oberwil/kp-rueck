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
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from typing import Any, NamedTuple
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..models import Incident, IncidentAssignment, RekoReport, SchadenplatzReport
from .audit_export_service import EventReportData
from .incident_leader import effective_leader_ids

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
    "none": "–",
    # Summary
    "summary_title": "Zusammenfassung",
    "incidents_total": "Einsätze gesamt",
    "personnel_involved": "Eingesetztes Personal",
    "vehicles_used": "Eingesetzte Fahrzeuge",
    "materials_used": "Eingesetztes Material",
    "reko_reports_count": "Reko-Berichte",
    "no_incidents": "Keine Einsätze erfasst",
    # Reaction times (debrief metrics)
    "reaction_title": "Reaktionszeiten",
    "reaction_hint": "Zeit ab Eingang bis zum ersten Erreichen des Status.",
    "col_to_reko": "→ Reko",
    "col_to_disponiert": "→ Disponiert",
    "col_to_einsatz": "→ Vor Ort",
    "col_to_abschluss": "→ Abschluss",
    # Einsatztagebuch (chronological journal)
    "journal_title": "Einsatztagebuch",
    "journal_hint": "Automatisch aus den Protokolldaten erstellt.",
    "journal_empty": "Keine Einträge vorhanden.",
    "col_time": "Zeit",
    "col_incident": "Einsatz",
    "col_entry": "Eintrag",
    "col_user": "Benutzer",
    "journal_incident_created": "Einsatz erstellt: «{title}»",
    "journal_source_intake": "Telefon",
    "journal_source_divera": "Divera",
    "journal_status_change": "Status: {from_status} → {to_status}",
    "journal_assigned": "{name} zugeteilt",
    "journal_unassigned": "{name} freigegeben",
    "journal_reko_received": "Reko-Bericht eingegangen",
    "journal_divera_alarm": "Divera-Alarm ausgelöst ({count} Empfänger)",
    "journal_divera_alarm_plain": "Divera-Alarm ausgelöst",
    "journal_incident_deleted": "Einsatz gelöscht",
    "journal_incident_restored": "Einsatz wiederhergestellt",
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
    # Reko provenance (plan 26 §5.3, §7). Same vocabulary as the Rapport's lines
    # below — "(Feld)" for a crew filing, "(Funkmeldung)" for one the KP took over
    # the radio — because a reader who learns it on one block must not have to
    # learn it again on the next. "Ergänzt" rather than "Zuletzt bearbeitet": the
    # mixed report is one the crew filed and the KP added to.
    "reko_filed_field": "Erfasst von {name} (Feld), {at}",
    "reko_filed_kp": "Erfasst im KP durch {name} (Funkmeldung), {at}",
    "reko_amended_kp": "Ergänzt im KP durch {name} (Funkmeldung), {at}",
    "reko_arrived_field": "Vor Ort {at} (Feld)",
    "reko_arrived_kp": "Vor Ort {at} (Funkmeldung)",
    # Schadenplatz-Rapport (plan 25, §7)
    "rapport": "Schadenplatz-Rapport",
    "rapport_draft": "Entwurf – noch nicht abgeschlossen",
    "rapport_work": "Tätigkeit",
    "rapport_kurzbericht": "Kurzbericht",
    "rapport_handed_over": "Einsatzstelle übergeben an",
    "rapport_personnel_count": "Eingesetztes Personal (Anzahl)",
    "rapport_vehicles": "Eingesetzte Fahrzeuge",
    "rapport_board_value": "vom Board: {value}",
    "rapport_material": "Material",
    "rapport_extra_material": "Weiteres Material",
    "rapport_owner": "Eigentümer / Halter",
    "rapport_owner_phone": "Eigentümer / Halter – Telefon",
    "rapport_pickup": "Abholung nötig",
    "rapport_filed_field": "Erfasst von {name} (Feld), {at}",
    "rapport_filed_kp": "Erfasst im KP durch {name} (Funkmeldung), {at}",
    "rapport_amended_field": "Zuletzt bearbeitet von {name} (Feld), {at}",
    "rapport_amended_kp": "Zuletzt bearbeitet im KP durch {name} (Funkmeldung), {at}",
    "rapport_unknown_person": "unbekannt",
    "material_used_yes": "gebraucht",
    "material_used_no": "nicht gebraucht",
    "material_left_on_site": "vor Ort verblieben",
    "material_returned": "zurück",
    "material_consumable": "Verbrauchsmaterial",
    # A "Weiteres Material" entry standing next to real units: it has to be
    # fetched like them, but there is no assignment behind it (§18.35).
    "material_untracked": "nicht erfasst",
    "yes": "Ja",
    "no": "Nein",
    "released": "freigegeben",
    "footer_page": "Seite {current} von {total}",
    "assigned_since": "seit",
}

# Human-readable labels mirroring the frontend (frontend/lib/types/incidents.ts).
STATUS_LABELS: dict[str, str] = {
    "incoming": "Eingegangen",
    "reko": "Reko",
    "reko_done": "Reko abgeschlossen",
    "enroute": "Disponiert",
    "active": "Einsatz",
    "returning": "Einsatz beendet",
    "complete": "Abschluss",
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

# All DB timestamps are UTC; reports are read by people with Swiss wall clocks.
LOCAL_TZ = ZoneInfo("Europe/Zurich")

# Layout constants
_PAGE_MARGIN = 18 * mm
_BRAND = colors.HexColor("#b91c1c")  # warm red (fire service identity)
_HEADER_BG = colors.HexColor("#f4f4f5")
_BORDER = colors.HexColor("#d4d4d8")


def _fmt_dt(dt: datetime | None) -> str:
    """Format a datetime for display (Swiss ``DD.MM.YYYY HH:MM``, local time) or em dash."""
    if dt is None:
        return LABELS["none"]
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M")


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


# ---------------------------------------------------------------------------
# Schadenplatz-Rapport rendering (plan 25, §7)
#
# Shared by the three outputs — this PDF, the Lageblatt and the Einsätze
# workbook — so the three-state material answer and the provenance wording can
# never drift between them. Pure functions over the model rows; no reportlab.
# ---------------------------------------------------------------------------


def rapport_by_incident(data: EventReportData) -> dict[uuid.UUID, SchadenplatzReport]:
    """The at-most-one Schadenplatz-Rapport per incident, keyed by incident id."""
    return {report.incident_id: report for report in data.schadenplatz_reports}


def material_checklist_rows(report: SchadenplatzReport | None) -> list[dict[str, Any]]:
    """``materials_json`` as a list of dicts, defensively (it is JSONB)."""
    if report is None or not report.materials_json:
        return []
    return [row for row in report.materials_json if isinstance(row, dict)]


def material_used_label(used: object) -> str:
    """gebraucht / nicht gebraucht — two answers since §18.32.

    "keine Angabe" is gone with the three-state control that produced it: the
    checklist is prefilled *ja* (the unit was dispatched here) and the crew
    unticks the exceptions, so an untouched row is the board's answer rather than
    a silence. Legacy ``null`` in the JSONB reads as *gebraucht*, the same way
    ``crud.feld._material_used`` reads it, so a rapport filed before the reversal
    prints the same thing on every surface.
    """
    return LABELS["material_used_no"] if used is False else LABELS["material_used_yes"]


def format_material_unit(row: Mapping[str, Any]) -> str:
    """One checklist line: ``Tauchpumpe TP-4: gebraucht, vor Ort verblieben``.

    A consumable renders **no** "vor Ort verblieben" state at all (decision 26):
    a consumable that was used is gone, so printing "nein" there would be an
    answer nobody gave and a unit nobody can go and collect.
    """
    name = str(row.get("name") or LABELS["none"])
    used = material_used_label(row.get("used"))
    if row.get("consumable"):
        return f"{name}: {used} ({LABELS['material_consumable']})"
    left = LABELS["material_left_on_site"] if row.get("left_on_site") else LABELS["material_returned"]
    return f"{name}: {used}, {left}"


def material_left_on_site_names(report: SchadenplatzReport | None) -> list[str]:
    """The units the crew left at the address — the Abholliste's raw material."""
    return [
        str(row.get("name") or LABELS["none"])
        for row in material_checklist_rows(report)
        if row.get("left_on_site") and not row.get("consumable")
    ]


def extra_material_rows(report: SchadenplatzReport | None) -> list[dict[str, Any]]:
    """ "Weiteres gebrauchtes Material" as ``{name, left_on_site}`` rows (§18.35).

    Read defensively like every other JSONB list here, and named rather than
    keyed: nothing in this list is a unit the board dispatched (decision 18).
    """
    if report is None or not report.extra_materials_json:
        return []
    rows: list[dict[str, Any]] = []
    for raw in report.extra_materials_json:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if name:
            rows.append({"name": name, "left_on_site": bool(raw.get("left_on_site"))})
    return rows


def format_extra_material(row: Mapping[str, Any]) -> str:
    """One "Weiteres Material" line: ``Pumpe vom Werkhof (vor Ort verblieben)``.

    No *gebraucht* state, on purpose (§18.35): naming a thing on this list
    already says it was used, so the only state worth printing is whether it is
    still standing at the address.
    """
    name = str(row.get("name") or LABELS["none"])
    return f"{name} ({LABELS['material_left_on_site']})" if row.get("left_on_site") else name


def extra_material_left_on_site_names(report: SchadenplatzReport | None) -> list[str]:
    """The named things the crew left behind — Abholliste material without an id.

    Marked ``nicht erfasst`` wherever they share a line with real units, because
    the difference is operational: somebody has to fetch them just the same, but
    the board cannot release them and no inventory row will ever tick back.
    """
    return [
        f"{row['name']} ({LABELS['material_untracked']})" for row in extra_material_rows(report) if row["left_on_site"]
    ]


def vehicle_checklist_rows(report: SchadenplatzReport | None) -> list[dict[str, Any]]:
    """``vehicles_json`` as a list of dicts, defensively (it is JSONB)."""
    if report is None or not report.vehicles_json:
        return []
    return [row for row in report.vehicles_json if isinstance(row, dict)]


def vehicle_present_names(report: SchadenplatzReport | None) -> list[str]:
    """The vehicles the crew confirmed were at the Schadenplatz.

    The list replaced a count on purpose: "3" answers neither "war der TLF
    dabei?" nor the paperwork behind it. An unticked vehicle simply is not on
    the line — the crew said it was not there.
    """
    return [str(row.get("name") or LABELS["none"]) for row in vehicle_checklist_rows(report) if row.get("present")]


def board_personnel_count(data: EventReportData, incident_id: uuid.UUID) -> int:
    """How many distinct people the **board** has on this incident.

    Released rows count and a re-assignment counts once — the same rule the
    rapport prefill uses, so "korrigiert" compares like with like.
    """
    personnel = {
        a.resource_id for a in data.assignments if a.incident_id == incident_id and a.resource_type == "personnel"
    }
    return len(personnel)


class WorkWindow(NamedTuple):
    """Beginn/Ende Tätigkeit, derived — never stored, never typed."""

    started_at: datetime | None
    ended_at: datetime | None


def rapport_work_windows(data: EventReportData) -> dict[uuid.UUID, WorkWindow]:
    """Beginn/Ende Tätigkeit per incident, derived from what the board recorded.

    The crew used to type these two times into the field form. It never told the
    board anything the board did not already have, so the columns went and the
    chain that used to prefill them is now the only source:

    * **Beginn** — the rapport's ``arrived_at`` ("Angekommen" on `/feld`), else
      the first transition into ``active``, else the earliest assignment.
    * **Ende** — the incident's ``field_complete_reported_at`` ("beendet"
      gemeldet), else the first transition into ``returning``/``complete``.

    Either side may stay ``None``: a Schadenplatz nobody has left yet has no Ende,
    and printing a guess would be worse than printing nothing.

    Batched on purpose. ``EventReportData`` already carries every assignment and
    every transition of the event, so an export of forty Schadenplätze walks
    those two lists **once** instead of issuing three queries per row. This is
    the single implementation for all three outputs (Einsätze-xlsx, Lageblatt,
    Einsatzbericht) — they must not be able to disagree about when a crew worked.
    """
    first_active: dict[uuid.UUID, datetime] = {}
    first_end: dict[uuid.UUID, datetime] = {}
    for t in data.transitions:
        if t.timestamp is None:
            continue
        if t.to_status == "active":
            current = first_active.get(t.incident_id)
            if current is None or t.timestamp < current:
                first_active[t.incident_id] = t.timestamp
        elif t.to_status in ("returning", "complete"):
            current = first_end.get(t.incident_id)
            if current is None or t.timestamp < current:
                first_end[t.incident_id] = t.timestamp

    earliest_assigned: dict[uuid.UUID, datetime] = {}
    for a in data.assignments:
        if a.assigned_at is None:
            continue
        current = earliest_assigned.get(a.incident_id)
        if current is None or a.assigned_at < current:
            earliest_assigned[a.incident_id] = a.assigned_at

    reports = rapport_by_incident(data)
    windows: dict[uuid.UUID, WorkWindow] = {}
    for inc in data.incidents:
        report = reports.get(inc.id)
        started = (report.arrived_at if report else None) or first_active.get(inc.id) or earliest_assigned.get(inc.id)
        ended = inc.field_complete_reported_at or first_end.get(inc.id)
        windows[inc.id] = WorkWindow(started, ended)
    return windows


def format_corrected_count(value: int | None, corrected: bool, board_value: int) -> str:
    """``7 (vom Board: 6)`` for a corrected count, ``6`` for an untouched one.

    The divergence is the information (decision 5): it says the board was behind
    reality, so the board's own number stays on the page next to it.
    """
    if value is None:
        return LABELS["none"]
    if not corrected:
        return str(value)
    return f"{value} ({LABELS['rapport_board_value'].format(value=board_value)})"


def _personnel_display(data: EventReportData, personnel_id: uuid.UUID | None) -> str:
    if not personnel_id:
        return LABELS["rapport_unknown_person"]
    person = data.personnel_map.get(personnel_id)
    return person.name if person else LABELS["rapport_unknown_person"]


def rapport_filing_lines(data: EventReportData, report: SchadenplatzReport) -> list[str]:
    """The filing identity — one line, or two for a mixed report.

    "Erfasst von Muster Hans (Feld), 08.08.2026 14:32" versus "Erfasst im KP
    durch B. Eichenberger (Funkmeldung), …". Provenance is never faked
    (decision 28): exactly one side of each ``*_by`` pair is populated per write,
    and a report the crew filed and the KP amended shows both lines.
    """
    lines: list[str] = []
    filed_at = _fmt_dt(report.submitted_at or report.created_at)
    if report.created_by_personnel_id:
        lines.append(
            LABELS["rapport_filed_field"].format(
                name=_personnel_display(data, report.created_by_personnel_id), at=filed_at
            )
        )
    elif report.created_by_user_id:
        lines.append(
            LABELS["rapport_filed_kp"].format(
                name=_user_display(data, report.created_by_user_id) or LABELS["rapport_unknown_person"],
                at=filed_at,
            )
        )

    same_author = (report.updated_by_personnel_id, report.updated_by_user_id) == (
        report.created_by_personnel_id,
        report.created_by_user_id,
    )
    if not same_author:
        amended_at = _fmt_dt(report.updated_at)
        if report.updated_by_personnel_id:
            lines.append(
                LABELS["rapport_amended_field"].format(
                    name=_personnel_display(data, report.updated_by_personnel_id), at=amended_at
                )
            )
        elif report.updated_by_user_id:
            lines.append(
                LABELS["rapport_amended_kp"].format(
                    name=_user_display(data, report.updated_by_user_id) or LABELS["rapport_unknown_person"],
                    at=amended_at,
                )
            )
    return lines


def reko_filing_lines(data: EventReportData, report: RekoReport) -> list[str]:
    """Who filed this Reko report, through which channel — one line, or two.

    The Reko report is the second artefact that can now arrive through either
    door (plan 26 §5.1), so it prints the same sentence the Schadenplatz-Rapport
    does. Its provenance columns are not symmetrical, though, and that is on
    purpose: ``submitted_by_personnel_id`` is the field's answer and the three
    ``*_by_user_id`` columns are the KP's, and a User is never guessed to be a
    Personnel (decision 6).

    The mixed case — crew filed, KP amended over the radio — is the one this
    exists for and prints both::

        Erfasst von Muster Hans (Feld), 08.08.2026 19:22
        Ergänzt im KP durch B. Eichenberger (Funkmeldung), 08.08.2026 19:41

    A report the KP both created and submitted stamps the same user in both
    columns; that is one act, not two, and prints as one line.
    """
    lines: list[str] = []
    if report.submitted_by_personnel_id:
        lines.append(
            LABELS["reko_filed_field"].format(
                name=_personnel_display(data, report.submitted_by_personnel_id),
                at=_fmt_dt(report.submitted_at),
            )
        )
    elif report.created_by_user_id:
        lines.append(
            LABELS["reko_filed_kp"].format(
                name=_user_display(data, report.created_by_user_id) or LABELS["rapport_unknown_person"],
                at=_fmt_dt(report.submitted_at),
            )
        )

    if report.updated_by_user_id and report.updated_by_user_id != report.created_by_user_id:
        lines.append(
            LABELS["reko_amended_kp"].format(
                name=_user_display(data, report.updated_by_user_id) or LABELS["rapport_unknown_person"],
                at=_fmt_dt(report.updated_at),
            )
        )
    return lines


def reko_arrival_line(report: RekoReport) -> str:
    """ "Vor Ort 19:22 (Feld)" or "(Funkmeldung)" — or nothing at all.

    The arrival carries its own author column rather than being read off the
    report's creator: since plan 26 the KP can file a report before anybody is
    on site, so inheriting the creator would render a crew's later "vor Ort" as
    a radio message. An arrival with no user FK came through the form link.
    """
    if report.arrived_at is None:
        return ""
    key = "reko_arrived_kp" if report.arrived_reported_by_user_id else "reko_arrived_field"
    return LABELS[key].format(at=_fmt_dt(report.arrived_at))


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


def _cover(data: EventReportData, generated_by: str, funkrufname: str, styles: dict[str, ParagraphStyle]) -> list[Any]:
    """Build the cover/header flowables."""
    event = data.event
    flow: list[Any] = [_p(LABELS["report_title"], styles["title"])]

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


def _fmt_duration(seconds: float | None) -> str:
    """Compact duration for the reaction-times table: "8 min", "1 h 05"."""
    if seconds is None or seconds < 0:
        return LABELS["none"]
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60:02d}"


def _reaction_times_table(data: EventReportData, styles: dict[str, ParagraphStyle]) -> Table:
    """Per-incident reaction metrics: time from Eingang to first reaching each
    key status. Feeds the debrief — "incident 3 sat unnoticed for 9 minutes"
    becomes a number instead of a feeling."""
    # First time each incident reached each status (transitions are per-incident).
    first_reached: dict[tuple[uuid.UUID, str], datetime] = {}
    for t in data.transitions:
        key = (t.incident_id, t.to_status)
        if key not in first_reached or t.timestamp < first_reached[key]:
            first_reached[key] = t.timestamp

    def delta(inc: Incident, status: str) -> str:
        reached = first_reached.get((inc.id, status))
        if reached is None or inc.created_at is None:
            return LABELS["none"]
        return _fmt_duration((reached - inc.created_at).total_seconds())

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
                _p(_or_none(inc.title), styles["cell"]),
                _p(delta(inc, "reko"), styles["cell"]),
                _p(delta(inc, "enroute"), styles["cell"]),
                _p(delta(inc, "active"), styles["cell"]),
                _p(delta(inc, "complete"), styles["cell"]),
            ]
        )

    col_widths = [8 * mm, 68 * mm, 24 * mm, 24 * mm, 24 * mm, 24 * mm]
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


# ---------------------------------------------------------------------------
# Einsatztagebuch — merged, chronological journal of the whole event.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class JournalEntry:
    """One line in the Einsatztagebuch: when, which incident, what, who."""

    timestamp: datetime
    incident_ref: str  # short incident title, or "—" for event-level entries
    text: str  # German one-line description
    actor: str  # user/personnel display name, "" when unknown


def _as_utc(dt: datetime) -> datetime:
    """Normalize naive datetimes to UTC so mixed values sort/compare safely."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _truncate(text: str, limit: int = 80) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _user_display(data: EventReportData, user_id: uuid.UUID | None) -> str:
    """Resolve a user's display name (falls back to username, then '')."""
    if not user_id:
        return ""
    user = data.user_map.get(user_id)
    if not user:
        return ""
    return user.display_name or user.username


def _incident_ref(data: EventReportData, incident_id: uuid.UUID | None) -> str:
    if incident_id is None:
        return LABELS["none"]
    inc = data.incident_map.get(incident_id)
    if inc is None or not inc.title:
        return LABELS["none"]
    return _truncate(inc.title, 45)


# Incident sources worth calling out in the "erstellt" journal line.
_SOURCE_LABELS: dict[str, str] = {
    "intake": LABELS["journal_source_intake"],
    "divera": LABELS["journal_source_divera"],
}


def build_journal_entries(data: EventReportData) -> list[JournalEntry]:
    """Build the merged Einsatztagebuch timeline from whitelisted sources.

    Sources: incident creation, status transitions, resource (un)assignments,
    submitted reko reports, and the whitelisted audit rows (Divera alarms,
    incident delete/restore). Anything else — field-level updates, logins,
    exports, settings changes — is deliberately excluded.
    """
    entries: list[JournalEntry] = []

    # Incident created
    for inc in data.incidents:
        if inc.created_at is None:
            continue
        text = LABELS["journal_incident_created"].format(title=_truncate(inc.title or LABELS["none"], 60))
        source_label = _SOURCE_LABELS.get(getattr(inc, "source", None) or "")
        if source_label:
            text += f" ({source_label})"
        entries.append(
            JournalEntry(inc.created_at, _incident_ref(data, inc.id), text, _user_display(data, inc.created_by))
        )

    # Status transitions
    for t in data.transitions:
        if t.timestamp is None:
            continue
        text = LABELS["journal_status_change"].format(
            from_status=STATUS_LABELS.get(t.from_status, t.from_status),
            to_status=STATUS_LABELS.get(t.to_status, t.to_status),
        )
        entries.append(
            JournalEntry(t.timestamp, _incident_ref(data, t.incident_id), text, _user_display(data, t.user_id))
        )

    # Resource assignments / releases (assignment rows carry the timestamps)
    for a in data.assignments:
        name = _resource_name(data, a)
        ref = _incident_ref(data, a.incident_id)
        if a.assigned_at is not None:
            entries.append(
                JournalEntry(
                    a.assigned_at,
                    ref,
                    LABELS["journal_assigned"].format(name=name),
                    _user_display(data, a.assigned_by),
                )
            )
        if a.unassigned_at is not None:
            # No user is recorded for the release — leave the actor empty.
            entries.append(JournalEntry(a.unassigned_at, ref, LABELS["journal_unassigned"].format(name=name), ""))

    # Reko reports (submitted only — drafts are not yet "incoming")
    for reko in data.reko_reports:
        if reko.is_draft or reko.submitted_at is None:
            continue
        text = LABELS["journal_reko_received"]
        if reko.summary_text:
            text += f": {_truncate(reko.summary_text, 80)}"
        personnel = data.personnel_map.get(reko.submitted_by_personnel_id) if reko.submitted_by_personnel_id else None
        entries.append(
            JournalEntry(
                reko.submitted_at, _incident_ref(data, reko.incident_id), text, personnel.name if personnel else ""
            )
        )

    # Whitelisted audit rows (Divera alarms, incident delete/restore)
    for entry in data.audit_entries:
        if entry.timestamp is None:
            continue
        if entry.action_type == "divera_alarm":
            recipients = (entry.changes_json or {}).get("recipients")
            if recipients:
                text = LABELS["journal_divera_alarm"].format(count=len(recipients))
            else:
                text = LABELS["journal_divera_alarm_plain"]
        elif entry.action_type == "delete":
            text = LABELS["journal_incident_deleted"]
        elif entry.action_type == "restore":
            text = LABELS["journal_incident_restored"]
        else:
            continue  # defensive: never render non-whitelisted actions
        entries.append(
            JournalEntry(
                entry.timestamp, _incident_ref(data, entry.resource_id), text, _user_display(data, entry.user_id)
            )
        )

    entries.sort(key=lambda e: _as_utc(e.timestamp))
    return entries


def _journal_table(entries: list[JournalEntry], styles: dict[str, ParagraphStyle]) -> LongTable:
    """Dense, paginating journal table (LongTable so hundreds of rows split
    cleanly across pages; header repeats)."""
    # HH:MM is enough within one day; add the date when the event spans days.
    # Local dates/times — the journal is read against Swiss wall clocks.
    spans_days = len({_as_utc(e.timestamp).astimezone(LOCAL_TZ).date() for e in entries}) > 1
    time_fmt = "%d.%m. %H:%M" if spans_days else "%H:%M"

    header = [
        _p(LABELS["col_time"], styles["cell_header"]),
        _p(LABELS["col_incident"], styles["cell_header"]),
        _p(LABELS["col_entry"], styles["cell_header"]),
        _p(LABELS["col_user"], styles["cell_header"]),
    ]
    rows = [header]
    for e in entries:
        rows.append(
            [
                _p(_as_utc(e.timestamp).astimezone(LOCAL_TZ).strftime(time_fmt), styles["cell"]),
                _p(e.incident_ref, styles["cell"]),
                _p(e.text, styles["cell"]),
                _p(e.actor or LABELS["none"], styles["cell"]),
            ]
        )

    col_widths = [20 * mm, 40 * mm, 84 * mm, 28 * mm]
    table = LongTable(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), _BRAND),
                ("GRID", (0, 0), (-1, -1), 0.5, _BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _incident_overview_table(data: EventReportData, styles: dict[str, ParagraphStyle], home_city: str = "") -> Table:
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


def _field(label: str, value: str, styles: dict[str, ParagraphStyle]) -> Paragraph:
    """A single label/value line used inside incident detail blocks.

    Returns a Paragraph (not a Table) so very long values wrap and split across
    pages — a Table row cannot break, which overflows for long descriptions.
    """
    return Paragraph(f"<b>{escape(label)}:</b> {escape(str(value))}", styles["body"])


def _bullet_field(label: str, items: list[str], styles: dict[str, ParagraphStyle]) -> list[Any]:
    """A label line followed by one bullet per item.

    Falls back to an inline ``Label: —`` line when there are no items, so empty
    lists stay compact. Each bullet is its own Paragraph so long entries wrap.
    """
    if not items:
        return [_field(label, LABELS["none"], styles)]
    flow: list[Any] = [Paragraph(f"<b>{escape(label)}:</b>", styles["body"])]
    for item in items:
        flow.append(Paragraph(escape(str(item)), styles["bullet"], bulletText="•"))
    return flow


def _incident_detail(
    data: EventReportData, inc: Incident, index: int, styles: dict[str, ParagraphStyle], home_city: str = ""
) -> list[Any]:
    """Build the detail block flowables for a single incident."""
    block: list[Any] = []
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
        ("vehicle", LABELS["vehicles"]),
        ("material", LABELS["materials"]),
    ):
        items = [a for a in inc_assignments if a.resource_type == res_type]
        # EL first (plan 25, decision 23). `is_leader` belongs to one assignment,
        # so this only ever reorders this incident's crew; a stable sort keeps the
        # rest in assignment order. Vehicles and materials never carry the flag.
        #
        # Resolved, not read raw: this report is written about incidents that are
        # over, and completing one releases every assignment and clears the flag
        # from all of them — so the raw flag names nobody exactly where the
        # record matters most (plan 25, decision 29).
        items.sort(key=lambda a: a.resource_id not in leader_ids)
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
        # Channel first: the rest of the block is what was reported, and this is
        # who reported it and how it reached the board (plan 26 §7). Nothing is
        # printed for a field arrival's *absence* — "no Reko on site" is already
        # what an empty line says.
        arrival = reko_arrival_line(reko)
        if arrival:
            parts.append(arrival)
        parts.extend(reko_filing_lines(data, reko))
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

    # Schadenplatz-Rapport (plan 25, §7) — the field slip this app replaced.
    report = rapport_by_incident(data).get(inc.id)
    if report is not None:
        block.extend(_rapport_block(data, inc, report, styles))

    block.append(Spacer(1, 8))
    return block


def _rapport_block(
    data: EventReportData,
    inc: Incident,
    report: SchadenplatzReport,
    styles: dict[str, ParagraphStyle],
) -> list[Any]:
    """The "Schadenplatz-Rapport" lines of one incident's detail block."""
    flow: list[Any] = [Paragraph(f"<b>{escape(LABELS['rapport'])}</b>", styles["body"])]
    if report.is_draft:
        flow.append(_p(LABELS["rapport_draft"], styles["meta"]))

    # Beginn/Ende Tätigkeit is derived (see `rapport_work_windows`), not stored:
    # the crew never typed it, the board recorded it.
    window = rapport_work_windows(data).get(inc.id, WorkWindow(None, None))
    if window.started_at or window.ended_at:
        flow.append(
            _field(
                LABELS["rapport_work"],
                f"{_fmt_dt(window.started_at)} – {_fmt_dt(window.ended_at)}",
                styles,
            )
        )

    flow.append(
        _field(
            LABELS["rapport_personnel_count"],
            format_corrected_count(
                report.personnel_count, report.personnel_count_corrected, board_personnel_count(data, inc.id)
            ),
            styles,
        )
    )
    # The vehicles are a list the crew ticked, not a number it corrected.
    vehicles = vehicle_present_names(report)
    flow.append(_field(LABELS["rapport_vehicles"], ", ".join(vehicles) if vehicles else LABELS["none"], styles))

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
    # verblieben" (§18.35) — the whole reason this stopped being one line of
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
    # than a fragment of prose precisely so a reader can dial it — printing it
    # inside the name line would put it back where it could not be found.
    if report.owner_name:
        flow.append(_field(LABELS["rapport_owner"], report.owner_name, styles))
    if report.owner_phone:
        flow.append(_field(LABELS["rapport_owner_phone"], report.owner_phone, styles))

    if inc.pickup_needed:
        note = f" ({inc.pickup_note})" if inc.pickup_note else ""
        flow.append(_field(LABELS["rapport_pickup"], f"{_fmt_dt(inc.pickup_requested_at)}{note}", styles))

    for line in rapport_filing_lines(data, report):
        flow.append(_p(line, styles["meta"]))
    return flow


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
        title=f"{LABELS['report_title']} – {event.name}",
        author=generated_by or "",
    )

    story: list[Any] = []
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

        # Reaction times (debrief metrics)
        story.append(_p(LABELS["reaction_title"], styles["section"]))
        story.append(_reaction_times_table(data, styles))
        story.append(_p(LABELS["reaction_hint"], styles["meta"]))
        story.append(Spacer(1, 12))

        # Einsatztagebuch (merged, chronological journal)
        story.append(_p(LABELS["journal_title"], styles["section"]))
        story.append(_p(LABELS["journal_hint"], styles["meta"]))
        story.append(Spacer(1, 4))
        journal_entries = build_journal_entries(data)
        if journal_entries:
            story.append(_journal_table(journal_entries, styles))
        else:
            story.append(_p(LABELS["journal_empty"], styles["body"]))
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
