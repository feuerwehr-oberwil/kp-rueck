"""The report vocabulary and the Schadenplatz-Rapport rows – shared, and free of reportlab.

Used by the three outputs (the Einsatzrapport PDF, the Lageblatt, the Einsätze workbook) and
by the board's own texts (notifications), so the labels, the three-state material answer and
the provenance wording can never drift between them. Pure functions over the model rows: no
database access, no PDF library.
"""

import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, NamedTuple
from zoneinfo import ZoneInfo

from ..models import RekoReport, SchadenplatzReport
from .audit_export_service import EventReportData
from .reaction_times import is_merge_transition

# ---------------------------------------------------------------------------
# Strings (German, Swiss spelling). i18n seam for plan 06.
# ---------------------------------------------------------------------------

LABELS: dict[str, str] = {
    # «Gesamtereignis» because per-incident sheets exist too — this eyebrow has
    # to say which scope the reader is holding (field test 07.09.).
    "report_title": "Einsatzrapport Gesamtereignis",
    "training_badge": "ÜBUNG",
    "event": "Ereignis",
    # Begin and end as two rows, not one folded «Zeitraum» (field test 07.09.):
    # the cover keeps event time and export time apart, and a running event says
    # so explicitly instead of leaving the end implicit in a «seit».
    "event_begin": "Ereignisbeginn",
    "event_end": "Ereignisende",
    "event_end_ongoing": "laufend",
    "period_range": "{start} bis {end}",
    # «PDF erstellt», not «Erstellt am» — names WHAT was created at that clock,
    # so it cannot be misread as the event's own timestamp.
    "generated_at": "PDF erstellt",
    # Placeholder for the defensive paths only – a checklist row that carries no name
    # at all. Fields the event simply has no answer for are not printed (see
    # `_maybe_field`): a line reading "Kontakt: –" tells a reader nothing that the
    # absent line would not, and twenty of them per page bury the lines that do.
    "none": "–",
    # Summary
    "summary_title": "Zusammenfassung",
    "summary_hint": "Kennzahlen über alle Einsätze dieses Ereignisses.",
    "incidents_total": "Einsätze",
    # «Personal: 15» next to an Anwesenheit of 19 read as a contradiction
    # (field test 07.09.) — the pair below says what each number counts.
    "personnel_involved": "Eingesetztes Personal",
    "personnel_present": "Anwesendes Personal",
    "vehicles_used": "Fahrzeuge",
    "materials_used": "Material",
    "reko_reports_count": "Reko-Berichte",
    "no_incidents": "Keine Einsätze erfasst",
    # Anwesenheit (roll-call with An-/Abmeldezeit)
    "attendance_title": "Anwesenheit",
    "attendance_hint": "Personen mit Anmeldung zu diesem Ereignis, in der Reihenfolge der Mannschaftsliste. Dauer in hh:mm.",
    #: Totals over the roster, same words as the KP-Front rapport. The rounded
    #: figure only exists once the event is closed — see `_attendance_totals_line`.
    "attendance_totals": "{present} Anwesende · Einsatzstunden {raw} · gerundet {rounded}",
    "attendance_present_only": "{present} Anwesende",
    #: The end of an open attendance: somebody who arrived and never checked out. The
    #: report says so instead of leaving the cell blank – blank reads as "no data",
    #: and the whole point of the column is that the difference is visible.
    "attendance_open": "noch anwesend",
    "col_person": "Name",
    "col_function": "Funktion",
    "col_from": "Von",
    "col_to": "Bis",
    "col_duration": "Dauer",
    # Reaction times (debrief metrics)
    "reaction_title": "Reaktionszeiten",
    # Same definitions as the board's Kennzahlen (services/reaction_times.py): a card
    # that skipped a column still counts as dispatched; a reopened one is closed
    # by its last «Abgeschlossen».
    "reaction_hint": (
        "Zeit ab Eingang bis zum ersten Erreichen der Stufe (auch wenn eine Spalte übersprungen wurde; "
        "schon disponiert angelegt = 0:00; innert 2 Minuten Zurückgenommenes zählt nicht), "
        "Abschluss = letzter Abschluss. In hh:mm."
    ),
    "col_to_reko": "→ Reko",
    "col_to_disponiert": "→ Disponiert",
    "col_to_einsatz": "→ Vor Ort",
    "col_to_abschluss": "→ Abschluss",
    # Einsatztagebuch (chronological journal)
    "journal_title": "Einsatztagebuch",
    "journal_hint": "Das Einsatztagebuch des Ereignisses – automatische und manuelle Einträge, chronologisch.",
    "journal_empty": "Keine Einträge vorhanden.",
    "col_time": "Zeit",
    "col_incident": "Einsatz",
    "col_entry": "Eintrag",
    "journal_incident_created": "Einsatz erstellt: «{title}»",
    "journal_source_intake": "Telefon",
    "journal_source_divera": "Divera",
    "journal_status_change": "Status: {from_status} → {to_status}",
    "journal_assigned": "{name} zugeteilt",
    # The counterpart to "zugeteilt": it says what happened to this incident, without
    # claiming anything about where the resource went. "Freigegeben" named the board
    # operation, not the event on the ground.
    "journal_unassigned": "{name} vom Einsatz abgezogen",
    "journal_reko_received": "Reko-Bericht eingegangen",
    "journal_divera_alarm": "Divera-Alarm ausgelöst ({count} Empfänger)",
    "journal_divera_alarm_plain": "Divera-Alarm ausgelöst",
    "journal_incident_deleted": "Einsatz gelöscht",
    "journal_incident_restored": "Einsatz wiederhergestellt",
    "journal_message_from_field": "Meldung vom Feld ({name}): {text}",
    "journal_message_to_field": "Meldung an den Trupp ({name}): {text}",
    "journal_unknown_author": "unbekannt",
    "journal_incident_merge": "Meldung «{other}» zusammengeführt",
    "journal_incident_merged_into": "Zusammengeführt in «{other}»",
    "journal_incident_unmerge": "Zusammenführung mit «{other}» aufgehoben",
    # The Einsatz column of a line whose Einsatz is no longer on the board.
    "journal_ref_deleted": "{ref} (gelöscht)",
    "journal_ref_merged": "{ref} (zusammengeführt in «{target}»)",
    # A corrected manual line: newest wording, and the paper says it was corrected.
    "journal_corrected": "{text} (korrigiert {time}; ursprünglich: «{original}»)",
    # Resource overviews (field test 07.09.): who/what was where, first to
    # last, without opening every incident block. One row per assignment.
    "vehicle_overview_title": "Fahrzeug-Übersicht",
    "vehicle_overview_hint": "Jede Zuteilung eines Fahrzeugs zu einem Einsatz, in zeitlicher Reihenfolge.",
    "material_overview_title": "Material-Übersicht",
    "material_overview_hint": (
        "Jede Zuteilung von Material zu einem Einsatz. "
        "«Noch am Schadenplatz» = beim Abschluss nicht zurückgemeldet (siehe Abholung)."
    ),
    "overview_col_vehicle": "Fahrzeug",
    "overview_col_material": "Material",
    #: An open assignment on a live incident vs. one the incident's completion
    #: left standing at the address.
    "overview_still_active": "im Einsatz",
    "overview_left_on_site": "noch am Schadenplatz",
    "overview_auftrag_ref": "Auftrag «{name}» (Nr {stops})",
    # Incident overview table
    "incident_list_title": "Einsatzübersicht",
    "incident_list_hint": "Alle Einsätze des Ereignisses, in der Reihenfolge des Eingangs.",
    "col_nr": "Nr",
    "col_title": "Titel",
    "col_type": "Typ",
    "col_priority": "Priorität",
    "col_status": "Status",
    "col_address": "Adresse",
    # Short enough to fit its column head at 8 pt – "Eingegangen" and "Abgeschlossen"
    # broke mid-word ("Eingegang / en") and no width the table can spare fixes that.
    "col_created": "Eingang",
    "col_completed": "Ende",
    #: The incident's sub-title: category and the clock it came in on. Both are one-line
    #: facts about the incident as a whole, so they belong to its heading rather than to
    #: two more rows of the label column below it.
    "incident_subtitle": "{type} · {at}",
    # Per-incident detail
    "details_title": "Einsatzdetails",
    "details_hint": "Ein Block pro Einsatz, in derselben Reihenfolge wie die Übersicht.",
    # «Meldung», not «Beschreibung»: the board calls the field Meldung, and the
    # archived record must use the operator's own word (field test 07.09.).
    "description": "Meldung",
    "contact": "Kontakt",
    "flags": "Merkmale",
    "nachbarhilfe": "Nachbarhilfe",
    "am_warten": "Am Warten",
    "zu_fuss": "Zu Fuss",
    "crew": "Personal",
    # The detail block's vehicle list: vehicles plus «Zu Fuss», matching the
    # Lageblatt's word for the same row (field test 07.09.).
    "mittel": "Mittel",
    "materials": "Material",
    "status_timeline": "Statusverlauf",
    "reko": "Reko",
    "reko_relevant": "Relevant",
    "reko_power": "Stromversorgung",
    "reko_summary": "Zusammenfassung",
    "reko_notes": "Zusätzliche Notizen",
    "reko_draft": "Entwurf",
    # Reko provenance (plan 26 §5.3, §7). Same vocabulary as the Rapport's lines
    # below – "(Feld)" for a crew filing, "(Funkmeldung)" for one the KP took over
    # the radio – because a reader who learns it on one block must not have to
    # learn it again on the next. "Ergänzt" rather than "Zuletzt bearbeitet": the
    # mixed report is one the crew filed and the KP added to.
    "reko_filed_field": "Erfasst von {name} (Feld), {at}",
    "reko_filed_kp": "Erfasst im KP durch {name} (Funkmeldung), {at}",
    "reko_amended_kp": "Ergänzt im KP durch {name} (Funkmeldung), {at}",
    "reko_arrived_field": "Vor Ort {at} (Feld)",
    "reko_arrived_kp": "Vor Ort {at} (Funkmeldung)",
    # Photos attached by the field (Reko form and Schadenplatz-Rapport alike).
    "photos": "Fotos",
    # Schadenplatz-Rapport (plan 25, §7)
    "rapport": "Schadenplatz-Rapport",
    "rapport_merged": "Schadenplatz-Rapport von #{number} (zusammengeführt)",
    "rapport_draft": "Entwurf, noch nicht abgeschlossen",
    "rapport_work": "Tätigkeit",
    "rapport_work_from": "ab {at}",
    "rapport_work_to": "bis {at}",
    "rapport_kurzbericht": "Kurzbericht",
    # Short enough for the label column. "Einsatzstelle übergeben an" wrapped to two
    # lines and pushed its own value up; that it is the Einsatzstelle being handed over
    # is said by the block it stands in.
    "rapport_handed_over": "Übergeben an",
    "rapport_personnel_count": "Personal",
    "rapport_personnel_names": "Mannschaft",
    "rapport_vehicles": "Fahrzeuge",
    "rapport_board_value": "vom Board: {value}",
    "rapport_material": "Material",
    "rapport_extra_material": "Weiteres Material",
    "rapport_owner": "Eigentümer",
    # The two lines stand together, so the second does not have to repeat the first.
    "rapport_owner_phone": "Telefon",
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
    "footer_page": "Seite {current} von {total}",
    "assigned_since": "seit",
    # Sign-off. Same two roles and the same order as the KP-Front Einsatzrapport, so a
    # station files both documents the same way.
    "signatures_title": "Unterschriften",
    "signature_place_date": "Ort, Datum",
    "signature_incident_leader": "Einsatzleiter",
    "signature_commander": "Kommandant",
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

# Reko power-supply answers. Mirrors the frontend's reko.power* strings
# (frontend/messages/de.json); an unmapped value prints as-is rather than
# vanishing, but "emergency_needed" must never reach an archived report.
POWER_LABELS: dict[str, str] = {
    "unknown": "Unbekannt",
    "available": "Vorhanden",
    "unavailable": "Nicht vorhanden",
    "emergency_needed": "Notstrom benötigt",
}

# Workflow order for anything that counts or lists statuses. Sorting the dict itself
# orders by the raw key ("active" before "incoming"), which prints a breakdown in an
# order that means nothing to a reader.
STATUS_ORDER: tuple[str, ...] = (
    "incoming",
    "reko",
    "reko_done",
    "enroute",
    "active",
    "returning",
    "complete",
)

# All DB timestamps are UTC; reports are read by people with Swiss wall clocks.
LOCAL_TZ = ZoneInfo("Europe/Zurich")


def _fmt_dt(dt: datetime | None) -> str:
    """Swiss ``DD.MM.YYYY HH:MM`` in local time, or ``""`` for a missing timestamp.

    Empty rather than a dash: callers either drop the whole line (``_maybe_field``) or
    leave the table cell blank, and a grid of dashes reads as content that is not there.
    """
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(LOCAL_TZ).strftime("%d.%m.%Y %H:%M")


def _text(value: str | None) -> str:
    """A stripped string, or ``""`` for None/blank."""
    return str(value).strip() if value is not None else ""


def _tidy(line: str) -> str:
    """Drop the dangling separator a missing timestamp leaves in a filing line.

    "Erfasst von Muster Hans (Feld), " – the templates put the clock last, and a
    report that was never submitted has none.
    """
    return line.strip().rstrip(",").strip()


def _user_display(data: EventReportData, user_id: uuid.UUID | None) -> str:
    """Resolve a user's display name (falls back to username, then '')."""
    if not user_id:
        return ""
    user = data.user_map.get(user_id)
    if not user:
        return ""
    return user.display_name or user.username


# ---------------------------------------------------------------------------
# Schadenplatz-Rapport rendering (plan 25, §7)
#
# Shared by the three outputs – this PDF, the Lageblatt and the Einsätze
# workbook – so the three-state material answer and the provenance wording can
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
    """gebraucht / nicht gebraucht – two answers since §18.32.

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
    """The units the crew left at the address – the Abholliste's raw material."""
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
    """The named things the crew left behind – Abholliste material without an id.

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


def personnel_checklist_rows(report: SchadenplatzReport | None) -> list[dict[str, Any]]:
    """``personnel_json`` as a list of dicts, defensively (it is JSONB)."""
    if report is None or not report.personnel_json:
        return []
    return [row for row in report.personnel_json if isinstance(row, dict)]


def personnel_present_names(report: SchadenplatzReport | None) -> list[str]:
    """The people the crew confirmed were at the Schadenplatz.

    A list rather than the number it replaced (§18.36): "9" answers neither "war
    jemand dabei, den niemand aufgeboten hat?" nor "ist jemand gegangen?", and the
    debrief is read for exactly those two questions.
    """
    return [str(row.get("name") or LABELS["none"]) for row in personnel_checklist_rows(report) if row.get("present")]


def extra_personnel_lines(report: SchadenplatzReport | None) -> list[str]:
    """ "Bräm Urs (FW Allschwil, ab 21:00)" – somebody on no roster of this station."""
    if report is None or not report.extra_personnel_json:
        return []
    lines: list[str] = []
    for raw in report.extra_personnel_json:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        note = str(raw.get("note") or "").strip()
        lines.append(f"{name} ({note})" if note else name)
    return lines


def vehicle_present_names(report: SchadenplatzReport | None) -> list[str]:
    """The vehicles the crew confirmed were at the Schadenplatz.

    The list replaced a count on purpose: "3" answers neither "war der TLF
    dabei?" nor the paperwork behind it. An unticked vehicle simply is not on
    the line – the crew said it was not there.
    """
    return [str(row.get("name") or LABELS["none"]) for row in vehicle_checklist_rows(report) if row.get("present")]


def board_personnel_count(data: EventReportData, incident_id: uuid.UUID) -> int:
    """How many distinct people the **board** has on this incident.

    Released rows count and a re-assignment counts once – the same rule the
    rapport prefill uses, so "korrigiert" compares like with like.
    """
    personnel = {
        a.resource_id for a in data.assignments if a.incident_id == incident_id and a.resource_type == "personnel"
    }
    return len(personnel)


class WorkWindow(NamedTuple):
    """Beginn/Ende Tätigkeit, derived – never stored, never typed."""

    started_at: datetime | None
    ended_at: datetime | None


def rapport_work_windows(data: EventReportData) -> dict[uuid.UUID, WorkWindow]:
    """Beginn/Ende Tätigkeit per incident, derived from what the board recorded.

    The crew used to type these two times into the field form. It never told the
    board anything the board did not already have, so the columns went and the
    chain that used to prefill them is now the only source:

    * **Beginn** – the rapport's ``arrived_at`` ("Angekommen" on `/feld`), else
      the first transition into ``active``, else the earliest assignment.
    * **Ende** – the incident's ``field_complete_reported_at`` ("beendet"
      gemeldet), else the first transition into ``returning``/``complete``.

    Either side may stay ``None``: a Schadenplatz nobody has left yet has no Ende,
    and printing a guess would be worse than printing nothing.

    Batched on purpose. ``EventReportData`` already carries every assignment and
    every transition of the event, so an export of forty Schadenplätze walks
    those two lists **once** instead of issuing three queries per row. This is
    the single implementation for all three outputs (Einsätze-xlsx, Lageblatt,
    Einsatzrapport) – they must not be able to disagree about when a crew worked.
    """
    first_active: dict[uuid.UUID, datetime] = {}
    first_end: dict[uuid.UUID, datetime] = {}

    def note(key: uuid.UUID, t: Any) -> None:
        if t.timestamp is None or is_merge_transition(t):
            # The transition a merge writes happened at merge time, not on site.
            return
        target = (
            first_active if t.to_status == "active" else first_end if t.to_status in ("returning", "complete") else None
        )
        if target is not None and (key not in target or t.timestamp < target[key]):
            target[key] = t.timestamp

    live_of = {card.id: live for card, live in data.merged_cards}
    for t in data.transitions:
        note(t.incident_id, t)
    for t in data.merged_transitions:
        # Counts for the card it went into (its crew worked there) AND for itself
        # (a Rapport kept on it is printed with ITS window).
        note(t.incident_id, t)
        if t.incident_id in live_of:
            note(live_of[t.incident_id], t)

    earliest_assigned: dict[uuid.UUID, datetime] = {}
    for a in data.assignments:
        if a.assigned_at is None:
            continue
        current = earliest_assigned.get(a.incident_id)
        if current is None or a.assigned_at < current:
            earliest_assigned[a.incident_id] = a.assigned_at

    reports = rapport_by_incident(data)
    for merged in data.merged_rapports.values():
        for card, kept in merged:
            reports.setdefault(card.id, kept)
    windows: dict[uuid.UUID, WorkWindow] = {}
    for inc in [*data.incidents, *(card for card, _ in data.merged_cards)]:
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
        return ""
    if not corrected:
        return str(value)
    return f"{value} ({LABELS['rapport_board_value'].format(value=board_value)})"


def _personnel_display(data: EventReportData, personnel_id: uuid.UUID | None) -> str:
    if not personnel_id:
        return LABELS["rapport_unknown_person"]
    person = data.personnel_map.get(personnel_id)
    return person.name if person else LABELS["rapport_unknown_person"]


def rapport_filing_lines(data: EventReportData, report: SchadenplatzReport) -> list[str]:
    """The filing identity – one line, or two for a mixed report.

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
    return [_tidy(line) for line in lines]


def reko_filing_lines(data: EventReportData, report: RekoReport) -> list[str]:
    """Who filed this Reko report, through which channel – one line, or two.

    The Reko report is the second artefact that can now arrive through either
    door (plan 26 §5.1), so it prints the same sentence the Schadenplatz-Rapport
    does. Its provenance columns are not symmetrical, though, and that is on
    purpose: ``submitted_by_personnel_id`` is the field's answer and the three
    ``*_by_user_id`` columns are the KP's, and a User is never guessed to be a
    Personnel (decision 6).

    The mixed case – crew filed, KP amended over the radio – is the one this
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
    return [_tidy(line) for line in lines]


def reko_arrival_line(report: RekoReport) -> str:
    """ "Vor Ort 19:22 (Feld)" or "(Funkmeldung)" – or nothing at all.

    The arrival carries its own author column rather than being read off the
    report's creator: since plan 26 the KP can file a report before anybody is
    on site, so inheriting the creator would render a crew's later "vor Ort" as
    a radio message. An arrival with no user FK came through the form link.
    """
    if report.arrived_at is None:
        return ""
    key = "reko_arrived_kp" if report.arrived_reported_by_user_id else "reko_arrived_field"
    return LABELS[key].format(at=_fmt_dt(report.arrived_at))
