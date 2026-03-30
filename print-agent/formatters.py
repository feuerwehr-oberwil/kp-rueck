"""Formatters for print jobs.

Formats assignment slips and board snapshots for the Epson thermal printer
(80mm paper). Font A (48 chars) for headers, Font B (64 chars) for body text.

Uses p.set() for font control and p._raw() with CP437 encoding for text
to preserve German umlauts (the printer's default codepage is CP437).
"""

import logging
from datetime import datetime
from escpos.printer import Network

logger = logging.getLogger(__name__)

# Paper widths in characters for 80mm paper
WIDTH_A = 48   # Font A chars per line
WIDTH_B = 64   # Font B chars per line

# Type translations for display
TYPE_LABELS = {
    "brandbekaempfung": "BRANDEINSATZ",
    "elementarereignis": "ELEMENTAREREIGNIS",
    "strassenrettung": "STRASSENRETTUNG",
    "technische_hilfeleistung": "TECHN. HILFE",
    "oelwehr": "ÖLWEHR",
    "chemiewehr": "CHEMIEWEHR",
    "strahlenwehr": "STRAHLENWEHR",
    "einsatz_bahnanlagen": "BAHNANLAGEN",
    "bma_unechte_alarme": "BMA/FEHLALARM",
    "dienstleistungen": "DIENSTLEISTUNG",
    "diverse_einsaetze": "DIVERSE",
    "gerettete_menschen": "RETTUNG MENSCH",
    "gerettete_tiere": "RETTUNG TIER",
}

STATUS_LABELS = {
    "eingegangen": "Eingegangen",
    "reko": "Rekognoszierung",
    "reko_done": "Reko abgeschlossen",
    "disponiert": "Disponiert",
    "einsatz": "Im Einsatz",
    "einsatz_beendet": "Einsatz beendet",
    "abschluss": "Abgeschlossen",
}

PRIORITY_MARKERS = {
    "high": "!!! ",
    "medium": "!! ",
    "low": "",
}


# ── Printer helpers ──────────────────────────────────────────────────

def _text(p: Network, text: str) -> None:
    """Send text encoded as CP437 (printer's default codepage)."""
    p._raw(text.encode('cp437', errors='replace'))


def _sep(p: Network, char: str = "=") -> None:
    """Print a full-width separator using Font A."""
    p.set(font="a", bold=False, align="left")
    _text(p, char * WIDTH_A + "\n")


# ── Assignment slip ──────────────────────────────────────────────────

def format_assignment_slip(p: Network, payload: dict) -> None:
    """Format and print an assignment slip."""
    vehicles = payload.get("vehicles", [])
    location = payload.get("location", "")

    # --- Location title (Font A bold, centered) ---
    _sep(p)
    p.set(font="a", bold=True, align="center")
    if location:
        for line in _wrap_text(location, WIDTH_A):
            _text(p, f"{line}\n")
    else:
        _text(p, "KEIN STANDORT\n")
    _sep(p)

    # --- Incident type + priority + details ---
    inc_type = payload.get("type", "")
    type_label = TYPE_LABELS.get(inc_type, inc_type.upper())
    priority = payload.get("priority", "medium")
    priority_marker = PRIORITY_MARKERS.get(priority, "")
    type_label = f"{priority_marker}{type_label}"
    if payload.get("nachbarhilfe"):
        type_label = f"{type_label} [Nachbarhilfe]"

    p.set(font="a", bold=True, align="left")
    for line in _wrap_text(type_label, WIDTH_A):
        _text(p, f"{line}\n")

    # Description, contact, dispatch time
    p.set(font="b", bold=False, align="left")
    description = payload.get("description", "")
    if description:
        for line in _wrap_text(description, WIDTH_B):
            _text(p, f"{line}\n")
    contact = payload.get("contact", "")
    if contact:
        _text(p, f"Tel: {contact}\n")
    created_at = payload.get("created_at", "")
    if created_at:
        try:
            dt = datetime.fromisoformat(created_at)
            _text(p, f"Alarmiert: {dt.strftime('%d.%m.%Y %H:%M')}\n")
        except (ValueError, TypeError):
            pass

    # --- Vehicles ---
    if vehicles:
        _sep(p, "-")
        p.set(font="a", bold=True, align="left")
        _text(p, "FAHRZEUGE\n")
        p.set(font="b", bold=False, align="left")
        for v in vehicles:
            name = v.get("name", "")
            vtype = v.get("type", "")
            line = f" {name}"
            if vtype:
                line += f" ({vtype})"
            for wrapped in _wrap_text(line, WIDTH_B):
                _text(p, f"{wrapped}\n")

    # --- Crew ---
    crew = payload.get("crew", [])
    if crew:
        _sep(p, "-")
        p.set(font="a", bold=True, align="left")
        _text(p, "BESATZUNG\n")
        p.set(font="b", bold=False, align="left")
        for person in crew:
            name = person.get("name", "")
            role = person.get("role", "")
            if role:
                line = f" {name} ({role})"
            else:
                line = f" {name}"
            for wrapped in _wrap_text(line, WIDTH_B):
                _text(p, f"{wrapped}\n")

    # --- Materials ---
    materials = payload.get("materials", [])
    if materials:
        _sep(p, "-")
        p.set(font="a", bold=True, align="left")
        _text(p, "MATERIAL\n")
        p.set(font="b", bold=False, align="left")
        for mat in materials:
            for wrapped in _wrap_text(f" {mat.get('name', '')}", WIDTH_B):
                _text(p, f"{wrapped}\n")

    # --- Footer ---
    _sep(p, "-")
    p.set(font="b", bold=False, align="center")
    _text(p, f"{datetime.now().strftime('%d.%m.%Y %H:%M')}\n")
    p.cut()


# ── Board snapshot ───────────────────────────────────────────────────

def format_board_snapshot(p: Network, payload: dict) -> None:
    """Format and print a board snapshot."""
    event_name = payload.get("event_name", "Ereignis")
    training = payload.get("training_flag", False)
    incidents = payload.get("incidents", [])
    vehicle_status = payload.get("vehicle_status", [])
    personnel = payload.get("personnel_summary", {})

    # --- Header (Font A bold, centered) ---
    p.set(font="a", bold=True, align="center")
    if training:
        _text(p, "ÜBUNG\n")
    else:
        _text(p, "EINSATZ\n")
    p.set(font="b", bold=False, align="center")
    if len(event_name) > WIDTH_B:
        event_name = event_name[:WIDTH_B - 3] + "..."
    _text(p, f"{event_name}\n")
    _sep(p)

    # --- Filter incidents based on options ---
    include_completed = payload.get("include_completed", False)
    include_vehicles_section = payload.get("include_vehicles", True)
    include_personnel_section = payload.get("include_personnel", True)

    if include_completed:
        filtered_incidents = incidents
    else:
        filtered_incidents = [i for i in incidents if i.get("status") != "abschluss"]

    p.set(font="a", bold=True, align="left")
    if filtered_incidents:
        _text(p, f"EINSÄTZE ({len(filtered_incidents)})\n")
    else:
        _text(p, "EINSÄTZE\n")

    if filtered_incidents:
        for idx, inc in enumerate(filtered_incidents, 1):
            if idx > 1:
                _sep(p, "-")

            title = inc.get("title", "")
            status = inc.get("status", "")
            loc = inc.get("location", "")
            priority = inc.get("priority", "medium")
            inc_type = inc.get("type", "")
            inc_vehicles = inc.get("vehicles", [])
            inc_crew = inc.get("crew", [])
            inc_materials = inc.get("materials", [])
            description = inc.get("description", "")
            contact = inc.get("contact", "")
            nachbarhilfe = inc.get("nachbarhilfe", False)
            marker = PRIORITY_MARKERS.get(priority, "")

            p.set(font="a", bold=True, align="left")
            title_line = f"{idx}. {marker}{title}"
            for line in _wrap_text(title_line, WIDTH_A):
                _text(p, f"{line}\n")

            p.set(font="b", bold=False, align="left")
            status_label = STATUS_LABELS.get(status, status)
            type_label = TYPE_LABELS.get(inc_type, inc_type.upper())
            detail = f" [{status_label}] {type_label}"
            if nachbarhilfe:
                detail += " [Nachbarhilfe]"
            for line in _wrap_text(detail, WIDTH_B):
                _text(p, f"{line}\n")
            if loc:
                for line in _wrap_text(f" {loc}", WIDTH_B):
                    _text(p, f"{line}\n")
            if description:
                for line in _wrap_text(f" {description}", WIDTH_B):
                    _text(p, f"{line}\n")
            if contact:
                _text(p, f" Tel: {contact}\n")
            if inc_vehicles:
                veh_line = f" Fz: {', '.join(inc_vehicles)}"
                for line in _wrap_text(veh_line, WIDTH_B):
                    _text(p, f"{line}\n")
            if inc_crew:
                names = [c.get("name", "") for c in inc_crew]
                crew_line = f" Pers: {', '.join(names)}"
                for line in _wrap_text(crew_line, WIDTH_B):
                    _text(p, f"{line}\n")
            if inc_materials:
                mat_names = [m.get("name", "") for m in inc_materials]
                mat_line = f" Mat: {', '.join(mat_names)}"
                for line in _wrap_text(mat_line, WIDTH_B):
                    _text(p, f"{line}\n")
    else:
        p.set(font="b", bold=False, align="left")
        _text(p, "Keine aktiven Einsätze.\n")

    # --- Vehicle status ---
    if include_vehicles_section:
        _sep(p, "-")
        p.set(font="a", bold=True, align="left")
        _text(p, "FAHRZEUGE\n")
        p.set(font="b", bold=False, align="left")
        for v in vehicle_status:
            name = v.get("name", "")
            available = v.get("available", False)
            check = "X" if available else " "
            status_text = "Frei" if available else "Belegt"
            line = f"[{check}] {name} {status_text}"
            for wrapped in _wrap_text(line, WIDTH_B):
                _text(p, f"{wrapped}\n")

    # --- Personnel ---
    if include_personnel_section:
        _sep(p, "-")
        p.set(font="a", bold=True, align="left")
        _text(p, f"PERSONAL: {personnel.get('present', 0)}/{personnel.get('total', 0)}\n")
        personnel_list = payload.get("personnel_list", [])
        if personnel_list:
            p.set(font="b", bold=False, align="left")
            for person in personnel_list:
                name = person.get("name", "")
                role = person.get("role", "")
                assigned = person.get("assigned", False)
                check = " " if assigned else "X"
                line = f"[{check}] {name}"
                if role:
                    line += f" ({role})"
                for wrapped in _wrap_text(line, WIDTH_B):
                    _text(p, f"{wrapped}\n")

    _sep(p, "-")
    p.set(font="b", bold=False, align="center")
    _text(p, f"{datetime.now().strftime('%d.%m.%Y %H:%M')}\n")
    p.cut()


# ── Utilities ────────────────────────────────────────────────────────

def _wrap_text(text: str, width: int) -> list[str]:
    """Wrap text to specified width, preserving words."""
    if not text:
        return []

    words = text.split()
    lines = []
    current_line = ""

    for word in words:
        if not current_line:
            current_line = word
        elif len(current_line) + 1 + len(word) <= width:
            current_line += " " + word
        else:
            lines.append(current_line)
            current_line = word

    if current_line:
        lines.append(current_line)

    return lines
