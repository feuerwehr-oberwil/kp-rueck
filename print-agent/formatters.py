"""Formatters for print jobs.

Formats assignment slips and board snapshots for the Epson TM-T20II/III
thermal printer (80mm paper, 42 chars per line with Font A).
"""

import logging
from datetime import datetime
from escpos.printer import Network

logger = logging.getLogger(__name__)

# Paper width in characters (Font A, 80mm paper)
LINE_WIDTH = 42

# Type translations for display
TYPE_LABELS = {
    "brandbekaempfung": "BRANDEINSATZ",
    "elementarereignis": "ELEMENTAREREIGNIS",
    "strassenrettung": "STRASSENRETTUNG",
    "technische_hilfeleistung": "TECHN. HILFE",
    "oelwehr": "OELWEHR",
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
    "high": "!!!",
    "medium": "!!",
    "low": "!",
}


def format_assignment_slip(p: Network, payload: dict) -> None:
    """
    Format and print an assignment slip.

    Layout (80mm thermal paper):
    ==========================================
               VEHICLE NAME
                 (TYPE)
    ==========================================

    INCIDENT TYPE
    Address line 1
    Address line 2 (if needed)
    Description text...
    Tel: Contact info
    ------------------------------------------
    BESATZUNG:
      Name (Role)
      Name
    ------------------------------------------
    MATERIAL:
      Item 1
      Item 2
    ------------------------------------------

              DD.MM.YYYY HH:MM

    [AUTO-CUT]
    """
    # Get vehicle info (use first vehicle if multiple)
    vehicles = payload.get("vehicles", [])
    if vehicles:
        vehicle = vehicles[0]
        vehicle_name = vehicle.get("name", "UNBEKANNT")
        vehicle_type = vehicle.get("type", "")
    else:
        vehicle_name = "KEIN FAHRZEUG"
        vehicle_type = ""

    # Header with vehicle name
    p.set(align="center", bold=True, double_height=True, double_width=True)
    p.text("=" * 21 + "\n")  # Half width due to double
    p.text(f"{vehicle_name}\n")
    if vehicle_type:
        p.set(double_height=False, double_width=False)
        p.text(f"({vehicle_type})\n")
    p.set(align="center", bold=True, double_height=True, double_width=True)
    p.text("=" * 21 + "\n")
    p.set(align="left", bold=False, double_height=False, double_width=False)
    p.text("\n")

    # Incident type
    inc_type = payload.get("type", "")
    type_label = TYPE_LABELS.get(inc_type, inc_type.upper())

    # Priority marker
    priority = payload.get("priority", "medium")
    priority_marker = PRIORITY_MARKERS.get(priority, "")
    if priority_marker:
        type_label = f"{priority_marker} {type_label}"

    # Nachbarhilfe marker
    if payload.get("nachbarhilfe"):
        type_label = f"{type_label} [NH]"

    p.set(bold=True)
    p.text(f"{type_label}\n")
    p.set(bold=False)

    # Location
    location = payload.get("location", "")
    if location:
        # Wrap long addresses
        for line in _wrap_text(location, LINE_WIDTH):
            p.text(f"{line}\n")

    # Description
    description = payload.get("description", "")
    if description:
        for line in _wrap_text(description, LINE_WIDTH):
            p.text(f"{line}\n")

    # Contact
    contact = payload.get("contact", "")
    if contact:
        p.text(f"Tel: {contact}\n")

    p.text("-" * LINE_WIDTH + "\n")

    # Crew section
    crew = payload.get("crew", [])
    if crew:
        p.set(bold=True)
        p.text("BESATZUNG:\n")
        p.set(bold=False)
        for person in crew:
            name = person.get("name", "")
            role = person.get("role", "")
            if role:
                p.text(f"  {name} ({role})\n")
            else:
                p.text(f"  {name}\n")
        p.text("-" * LINE_WIDTH + "\n")

    # Materials section
    materials = payload.get("materials", [])
    if materials:
        p.set(bold=True)
        p.text("MATERIAL:\n")
        p.set(bold=False)
        for mat in materials:
            name = mat.get("name", "")
            p.text(f"  {name}\n")
        p.text("-" * LINE_WIDTH + "\n")

    # Additional vehicles (if more than one)
    if len(vehicles) > 1:
        p.set(bold=True)
        p.text("WEITERE FAHRZEUGE:\n")
        p.set(bold=False)
        for v in vehicles[1:]:
            p.text(f"  {v.get('name', '')} ({v.get('type', '')})\n")
        p.text("-" * LINE_WIDTH + "\n")

    # Footer with timestamp
    p.text("\n")
    p.set(align="center")
    timestamp = datetime.now().strftime("%d.%m.%Y %H:%M")
    p.text(f"{timestamp}\n")
    p.text("\n")

    # Cut
    p.cut()


def format_board_snapshot(p: Network, payload: dict) -> None:
    """
    Format and print a board snapshot.

    Layout (80mm thermal paper):
    ==========================================
            EINSATZUEBERSICHT
              Event Name
    ==========================================
    Erstellt: DD.MM.YYYY HH:MM

    AKTIVE EINSAETZE (X):
    ------------------------------------------
    1. Incident Title
       [Status] Location
       Fz: Vehicle1, Vehicle2
    ------------------------------------------
    2. Incident Title
       [Status] Location
    ------------------------------------------

    FAHRZEUGE:
      [X] Vehicle1 (Type) - Frei
      [ ] Vehicle2 (Type) - Im Einsatz
    ------------------------------------------

    PERSONAL: X anwesend

    [AUTO-CUT]
    """
    event_name = payload.get("event_name", "Ereignis")
    training = payload.get("training_flag", False)
    incidents = payload.get("incidents", [])
    vehicle_status = payload.get("vehicle_status", [])
    personnel = payload.get("personnel_summary", {})

    # Header
    p.set(align="center", bold=True, double_height=True, double_width=True)
    p.text("=" * 21 + "\n")
    if training:
        p.text("UEBUNG\n")
    else:
        p.text("EINSATZ\n")
    p.set(double_height=False, double_width=False, bold=False)
    # Truncate event name if too long
    if len(event_name) > 40:
        event_name = event_name[:37] + "..."
    p.text(f"{event_name}\n")
    p.set(bold=True, double_height=True, double_width=True)
    p.text("=" * 21 + "\n")
    p.set(align="left", bold=False, double_height=False, double_width=False)

    # Timestamp
    timestamp = datetime.now().strftime("%d.%m.%Y %H:%M")
    p.text(f"Erstellt: {timestamp}\n\n")

    # Active incidents (not abschluss)
    active_incidents = [i for i in incidents if i.get("status") != "abschluss"]

    if active_incidents:
        p.set(bold=True)
        p.text(f"AKTIVE EINSAETZE ({len(active_incidents)}):\n")
        p.set(bold=False)
        p.text("-" * LINE_WIDTH + "\n")

        for idx, inc in enumerate(active_incidents, 1):
            title = inc.get("title", "")
            status = inc.get("status", "")
            location = inc.get("location", "")
            priority = inc.get("priority", "medium")
            vehicles = inc.get("vehicles", [])

            # Priority marker
            marker = PRIORITY_MARKERS.get(priority, "")

            # Title line
            p.set(bold=True)
            title_line = f"{idx}. {marker}{title}"
            for line in _wrap_text(title_line, LINE_WIDTH):
                p.text(f"{line}\n")
            p.set(bold=False)

            # Status and location
            status_label = STATUS_LABELS.get(status, status)
            status_line = f"   [{status_label}]"
            if location:
                status_line += f" {location}"
            for line in _wrap_text(status_line, LINE_WIDTH):
                p.text(f"{line}\n")

            # Vehicles
            if vehicles:
                veh_line = f"   Fz: {', '.join(vehicles)}"
                for line in _wrap_text(veh_line, LINE_WIDTH):
                    p.text(f"{line}\n")

            p.text("-" * LINE_WIDTH + "\n")
    else:
        p.text("Keine aktiven Einsaetze.\n")
        p.text("-" * LINE_WIDTH + "\n")

    p.text("\n")

    # Vehicle status
    p.set(bold=True)
    p.text("FAHRZEUGE:\n")
    p.set(bold=False)

    for v in vehicle_status:
        name = v.get("name", "")
        vtype = v.get("type", "")
        available = v.get("available", False)

        check = "[X]" if available else "[ ]"
        status_text = "Frei" if available else "Belegt"
        line = f"  {check} {name}"
        if vtype:
            line += f" ({vtype})"
        line += f" - {status_text}"
        p.text(f"{line}\n")

    p.text("-" * LINE_WIDTH + "\n")
    p.text("\n")

    # Personnel summary
    present = personnel.get("present", 0)
    total = personnel.get("total", 0)
    p.set(bold=True)
    p.text(f"PERSONAL: {present} anwesend (von {total})\n")
    p.set(bold=False)

    p.text("\n")

    # Cut
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
