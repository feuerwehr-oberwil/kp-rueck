"""Formatters for print jobs.

Formats assignment slips and board snapshots for the Epson thermal printer
(58mm paper). Font A (~22 chars) for titles, Font B (~32 chars) for everything else.
"""

import logging
from datetime import datetime
from escpos.printer import Network

logger = logging.getLogger(__name__)

# Paper widths in characters for 58mm paper
WIDTH_A = 22   # Font A chars per line
WIDTH_B = 32   # Font B chars per line

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


def _init_printer(p: Network) -> None:
    """Initialize printer with correct codepage."""
    p._raw(bytes([0x1B, 0x74, 16]))  # ESC t 16 = WPC1252


def _font_a(p: Network, bold: bool = False, align: str = "left") -> None:
    """Set Font A (larger, ~22 chars/line)."""
    p.set(font="a", bold=bold, align=align,
          double_height=False, double_width=False)


def _font_b(p: Network, bold: bool = False, align: str = "left") -> None:
    """Set Font B (smaller, ~32 chars/line)."""
    p.set(font="b", bold=bold, align=align,
          double_height=False, double_width=False)


def _sep(p: Network, char: str = "-") -> None:
    """Print a full-width separator in Font B."""
    _font_b(p)
    p.text(char * WIDTH_B + "\n")


def format_assignment_slip(p: Network, payload: dict) -> None:
    """Format and print an assignment slip."""
    _init_printer(p)

    vehicles = payload.get("vehicles", [])
    location = payload.get("location", "")

    # --- Location title (Font A bold, centered) ---
    _sep(p, "=")
    _font_a(p, bold=True, align="center")
    if location:
        for line in _wrap_text(location, WIDTH_A):
            p.text(f"{line}\n")
    else:
        p.text("KEIN STANDORT\n")
    _sep(p, "=")

    # --- Incident type ---
    inc_type = payload.get("type", "")
    type_label = TYPE_LABELS.get(inc_type, inc_type.upper())
    priority = payload.get("priority", "medium")
    priority_marker = PRIORITY_MARKERS.get(priority, "")
    type_label = f"{priority_marker}{type_label}"
    if payload.get("nachbarhilfe"):
        type_label = f"{type_label} [NH]"

    _font_b(p, bold=True)
    for line in _wrap_text(type_label, WIDTH_B):
        p.text(f"{line}\n")

    # --- Description ---
    description = payload.get("description", "")
    if description:
        _font_b(p)
        for line in _wrap_text(description, WIDTH_B):
            p.text(f"{line}\n")

    # --- Contact ---
    contact = payload.get("contact", "")
    if contact:
        _font_b(p)
        p.text(f"Tel: {contact}\n")

    # --- Vehicles ---
    if vehicles:
        _sep(p)
        _font_b(p, bold=True)
        p.text("FAHRZEUGE\n")
        _font_b(p)
        for v in vehicles:
            name = v.get("name", "")
            vtype = v.get("type", "")
            line = f"  {name}"
            if vtype:
                line += f" ({vtype})"
            for wrapped in _wrap_text(line, WIDTH_B):
                p.text(f"{wrapped}\n")

    # --- Crew ---
    crew = payload.get("crew", [])
    if crew:
        _sep(p)
        _font_b(p, bold=True)
        p.text("BESATZUNG\n")
        _font_b(p)
        for person in crew:
            name = person.get("name", "")
            role = person.get("role", "")
            if role:
                line = f"  {name} ({role})"
            else:
                line = f"  {name}"
            for wrapped in _wrap_text(line, WIDTH_B):
                p.text(f"{wrapped}\n")

    # --- Materials ---
    materials = payload.get("materials", [])
    if materials:
        _sep(p)
        _font_b(p, bold=True)
        p.text("MATERIAL\n")
        _font_b(p)
        for mat in materials:
            p.text(f"  {mat.get('name', '')}\n")

    # --- Footer ---
    _sep(p)
    _font_b(p, align="center")
    p.text(f"{datetime.now().strftime('%d.%m.%Y %H:%M')}\n")
    p.text("\n")
    p.cut()


def format_board_snapshot(p: Network, payload: dict) -> None:
    """Format and print a board snapshot."""
    _init_printer(p)

    event_name = payload.get("event_name", "Ereignis")
    training = payload.get("training_flag", False)
    incidents = payload.get("incidents", [])
    vehicle_status = payload.get("vehicle_status", [])
    personnel = payload.get("personnel_summary", {})

    # --- Header (Font A bold, centered) ---
    _sep(p, "=")
    _font_a(p, bold=True, align="center")
    if training:
        p.text("ÜBUNG\n")
    else:
        p.text("EINSATZ\n")
    _font_b(p, align="center")
    if len(event_name) > WIDTH_B:
        event_name = event_name[:WIDTH_B - 3] + "..."
    p.text(f"{event_name}\n")
    _font_b(p)
    p.text(f"{datetime.now().strftime('%d.%m.%Y %H:%M')}\n")
    _sep(p, "=")

    # --- Active incidents ---
    active_incidents = [i for i in incidents if i.get("status") != "abschluss"]

    _font_b(p, bold=True)
    if active_incidents:
        p.text(f"EINSÄTZE ({len(active_incidents)})\n")
    else:
        p.text("EINSÄTZE\n")

    if active_incidents:
        for idx, inc in enumerate(active_incidents, 1):
            title = inc.get("title", "")
            status = inc.get("status", "")
            loc = inc.get("location", "")
            priority = inc.get("priority", "medium")
            inc_vehicles = inc.get("vehicles", [])
            marker = PRIORITY_MARKERS.get(priority, "")

            _font_b(p, bold=True)
            title_line = f"{idx}. {marker}{title}"
            for line in _wrap_text(title_line, WIDTH_B):
                p.text(f"{line}\n")

            _font_b(p)
            status_label = STATUS_LABELS.get(status, status)
            detail = f"  [{status_label}]"
            if loc:
                detail += f" {loc}"
            for line in _wrap_text(detail, WIDTH_B):
                p.text(f"{line}\n")
            if inc_vehicles:
                veh_line = f"  Fz: {', '.join(inc_vehicles)}"
                for line in _wrap_text(veh_line, WIDTH_B):
                    p.text(f"{line}\n")
    else:
        _font_b(p)
        p.text("Keine aktiven Einsätze.\n")

    # --- Vehicle status ---
    _sep(p)
    _font_b(p, bold=True)
    p.text("FAHRZEUGE\n")
    _font_b(p)
    for v in vehicle_status:
        name = v.get("name", "")
        vtype = v.get("type", "")
        available = v.get("available", False)
        check = "[X]" if available else "[ ]"
        status_text = "Frei" if available else "Belegt"
        line = f" {check} {name}"
        if vtype:
            line += f" ({vtype})"
        line += f" - {status_text}"
        for wrapped in _wrap_text(line, WIDTH_B):
            p.text(f"{wrapped}\n")

    # --- Personnel ---
    _sep(p)
    present = personnel.get("present", 0)
    total = personnel.get("total", 0)
    _font_b(p, bold=True)
    p.text(f"PERSONAL: {present}/{total}\n")

    p.text("\n")
    p.cut()


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
