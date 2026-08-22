"""Formatters for print jobs.

Formats assignment slips and board snapshots for the Epson thermal printer
(80mm paper). Font A (48 chars) for headers, Font B (64 chars) for body text.

Uses p.set() for font control and p._raw() with CP437 encoding for text
to preserve German umlauts (the printer's default codepage is CP437).
"""

import logging
from datetime import datetime
from escpos.printer import Network

from core import QR_BORDER_MODULES, QR_MIN_BOX_DOTS, qr_box_size

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
    "incoming": "Eingegangen",
    "reko": "Rekognoszierung",
    "reko_done": "Reko abgeschlossen",
    "enroute": "Disponiert",
    "active": "Im Einsatz",
    "returning": "Einsatz beendet",
    "complete": "Abgeschlossen",
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


def _qr_box_size(content: str) -> int:
    """How many dots per QR module, so the code fills the paper without overrunning it.

    `qrcode` ships with python-escpos, which is the only reason importing it here is free —
    it is asked the same question python-escpos will ask it a moment later, with the same
    error correction and border, so the module count matches what actually gets rendered.
    A sizing detail must never be what stops a slip from printing, hence the fallback.
    """
    try:
        import qrcode

        code = qrcode.QRCode(
            error_correction=qrcode.constants.ERROR_CORRECT_L, border=QR_BORDER_MODULES
        )
        code.add_data(content)
        code.make(fit=True)
        return qr_box_size(code.modules_count)
    except Exception as e:  # noqa: BLE001 - any failure here is a cosmetic one
        logger.warning("QR sizing fell back to the minimum: %s", e)
        return QR_MIN_BOX_DOTS


def _date_only(raw: object) -> str:
    """An ISO timestamp as a Swiss date, or "" when it is not one.

    Used for the printed expiry of a link. Returning "" rather than guessing is
    deliberate: a slip that names the wrong last day is worse than one that
    names none.
    """
    if not isinstance(raw, str) or not raw:
        return ""
    try:
        return datetime.fromisoformat(raw).astimezone().strftime("%d.%m.%Y")
    except ValueError:
        logger.warning("valid_until not parseable (%r) — printing the slip without it", raw)
        return ""


def _sep(p: Network, char: str = "=") -> None:
    """Print a full-width separator using Font A."""
    p.set(font="a", bold=False, align="left")
    _text(p, char * WIDTH_A + "\n")


def _stamp(payload: dict) -> str:
    """
    The timestamp printed in a slip's footer: when the CONTENT was captured, not when the
    paper came out.

    These are different times and the difference matters. Jobs queue: if the printer is out
    of paper, unreachable, or the agent is down, the backlog drains later — every formatter
    used to call `datetime.now()`, so a board snapshot frozen at 12:15 printed at 14:32 with
    "14:32" on it. AUSFALL_SOP.md tells the operator to trust that footer to know how current
    the paper board is, so a wrong one does not merely mislead, it misleads the one procedure
    that exists for when the screens are gone.

    `printed_at` is set by the backend when the job is created (api/print.py). Falls back to
    now() when it is missing or unparseable — an older backend or a hand-made payload should
    still print, just without the guarantee.
    """
    raw = payload.get("printed_at")
    if isinstance(raw, str) and raw:
        try:
            # Backend sends UTC ISO-8601; show it in the printer's local time, which is what
            # the person holding the slip is comparing against the clock on the wall.
            return datetime.fromisoformat(raw).astimezone().strftime("%d.%m.%Y %H:%M")
        except ValueError:
            logger.warning("printed_at not parseable (%r) — stamping current time", raw)
    return datetime.now().strftime("%d.%m.%Y %H:%M")


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

    # Zu Fuss flag
    if payload.get("zu_fuss"):
        _text(p, ">> ZU FUSS <<\n")

    # Nachbarhilfe note
    nachbarhilfe_note = payload.get("nachbarhilfe_note", "")
    if payload.get("nachbarhilfe") and nachbarhilfe_note:
        for line in _wrap_text(f"Nachbarhilfe: {nachbarhilfe_note}", WIDTH_B):
            _text(p, f"{line}\n")

    # Internal notes
    internal_notes = payload.get("internal_notes", "")
    if internal_notes:
        for line in _wrap_text(f"Notizen: {internal_notes}", WIDTH_B):
            _text(p, f"{line}\n")

    # --- Vehicles ---
    if vehicles:
        _sep(p, "-")
        p.set(font="a", bold=True, align="left")
        _text(p, "FAHRZEUGE\n")
        p.set(font="b", bold=False, align="left")
        for v in vehicles:
            name = v.get("name", "")
            callsign = v.get("radio_call_sign", "")
            driver = v.get("driver", "")
            driver_stay = v.get("driver_stay", False)
            line = f" {name}"
            if callsign:
                line += f" ({callsign})"
            for wrapped in _wrap_text(line, WIDTH_B):
                _text(p, f"{wrapped}\n")
            if driver:
                stay_text = "bleibt vor Ort" if driver_stay else "kehrt zurueck"
                driver_line = f"   Fahrer: {driver} [{stay_text}]"
                for wrapped in _wrap_text(driver_line, WIDTH_B):
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
            # «EL» first, so the line starts with the one thing that decides who
            # the rest of the crew reports to.
            prefix = "EL " if person.get("is_leader") else ""
            if role:
                line = f" {prefix}{name} ({role})"
            else:
                line = f" {prefix}{name}"
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

    # --- Reko Summary ---
    reko_summary = payload.get("reko_summary")
    if reko_summary:
        _sep(p, "-")
        p.set(font="a", bold=True, align="left")
        _text(p, "REKO-ERGEBNIS\n")
        p.set(font="b", bold=False, align="left")
        relevant = reko_summary.get("is_relevant")
        if relevant is not None:
            _text(p, f" Relevant: {'Ja' if relevant else 'Nein'}\n")
        dangers = reko_summary.get("dangers", [])
        if dangers:
            _text(p, f" Gefahren: {', '.join(dangers)}\n")
        personnel_count = reko_summary.get("personnel_count")
        if personnel_count:
            _text(p, f" Personalbedarf: {personnel_count}\n")
        est_duration = reko_summary.get("estimated_duration")
        if est_duration:
            _text(p, f" Dauer: {est_duration}h\n")
        summary_text = reko_summary.get("summary_text", "")
        if summary_text:
            for line in _wrap_text(f" {summary_text}", WIDTH_B):
                _text(p, f"{line}\n")

    # --- Rapport QR (plan 25, decision 19) ---
    #
    # The second QR on the Einsatzzettel: the same event token with the incident
    # appended, so the crew that carries this slip lands on /feld with THIS
    # Schadenplatz already selected. A shortcut, not a second door — the global
    # QR on the poster stays the door, and this can only preselect the incident,
    # never the person: the slip is printed before it is known who drives.
    #
    # Absent on an older backend, or when the installation has no configured
    # origin to point a phone at. Then the slip simply prints as it always did.
    #
    # The Feld-Code rides along under the QR: since the code exists, the link on
    # its own opens nothing, and a slip that carries only half of the pair sends
    # a crew to a prompt they cannot answer. Printed in Font A so it survives a
    # wet glove and a torch. Missing on an older backend — then the QR prints
    # alone, exactly as before.
    feld_qr = payload.get("feld_qr", "")
    if feld_qr:
        _sep(p, "-")
        p.set(font="a", bold=True, align="center")
        _text(p, "RAPPORT\n")
        p.set(font="b", bold=False, align="center")
        _text(p, "Scannen: Angekommen / beendet / Rapport\n")
        p.qr(feld_qr, size=_qr_box_size(feld_qr), center=True)
        feld_code = payload.get("feld_code", "")
        if feld_code:
            p.set(font="a", bold=True, align="center")
            _text(p, f"Code: {feld_code}\n")

    # --- Footer ---
    _sep(p, "-")
    p.set(font="b", bold=False, align="center")
    _text(p, f"{_stamp(payload)}\n")
    p.cut()


# ── Test print ───────────────────────────────────────────────────────

def format_test_print(p: Network, payload: dict) -> None:
    """Format and print a test slip to verify the full printing chain."""
    _sep(p)
    p.set(font="a", bold=True, align="center")
    _text(p, "TESTDRUCK\n")
    p.set(font="b", bold=False, align="center")
    _text(p, "KP Rueck Thermodruck\n")
    _sep(p)

    p.set(font="b", bold=False, align="left")
    _text(p, "Drucker erfolgreich verbunden.\n")
    _text(p, "Umlaute: aeoeue / ÄÖÜ äöü\n")

    requested_by = payload.get("requested_by", "")
    if requested_by:
        for line in _wrap_text(f"Ausgeloest von: {requested_by}", WIDTH_B):
            _text(p, f"{line}\n")

    _sep(p, "-")
    p.set(font="b", bold=False, align="center")
    _text(p, f"{_stamp(payload)}\n")
    p.cut()


# ── QR-code slip ─────────────────────────────────────────────────────

def format_qr_code_slip(p: Network, payload: dict) -> None:
    """Format and print a QR-code slip (shareable link as QR + text).

    Used for the Check-In / Reko / Viewer / Walk-In slide-up links so an
    operator can hand someone a paper slip with a scannable link.

    The Feld slip carries two fields more — ``code`` and ``valid_until``. The
    scanned page asks for four digits and says nothing about where they are
    written, because the answer is "on this slip"; a slip without them leads to
    a prompt it cannot answer. Both are optional, so every other link, and an
    older backend, print exactly as before.
    """
    qr_content = payload.get("qr_content", "")
    title = payload.get("title", "")
    subtitle = payload.get("subtitle", "")
    code = str(payload.get("code") or "").strip()
    valid_until = payload.get("valid_until")

    _sep(p)
    if title:
        p.set(font="a", bold=True, align="center")
        for line in _wrap_text(title, WIDTH_A):
            _text(p, f"{line}\n")
    _sep(p)

    if subtitle:
        p.set(font="b", bold=False, align="center")
        for line in _wrap_text(subtitle, WIDTH_B):
            _text(p, f"{line}\n")
        _text(p, "\n")

    if qr_content:
        # ec defaults to QR_ECLEVEL_L. The size is fitted to the content rather than fixed:
        # a check-in link carries a token and needs far more modules than a bare URL, so one
        # constant either wastes paper width on the long case or the roll on the short one.
        p.qr(qr_content, size=_qr_box_size(qr_content), center=True)
        p.set(font="b", bold=False, align="center")
        _text(p, "\nScannen zum Öffnen\n")

    if code:
        # Font A, bold, spaced: four digits read once, at arm's length, with a
        # torch and a wet glove. The spaces are what keep 4712 from being read
        # as a year.
        _sep(p, "-")
        p.set(font="b", bold=False, align="center")
        _text(p, "CODE EINGEBEN\n")
        p.set(font="a", bold=True, align="center")
        _text(p, f"{' '.join(code)}\n")
        # Only the date: a slip in the Magazin is compared against a calendar,
        # never against a clock. An unreadable date prints nothing at all — a
        # wrong expiry is worse than none.
        expiry = _date_only(valid_until)
        if expiry:
            p.set(font="b", bold=False, align="center")
            _text(p, f"Gültig bis {expiry}\n")

    _sep(p, "-")
    p.set(font="b", bold=False, align="center")
    _text(p, f"Gedruckt {_stamp(payload)}\n")
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
        filtered_incidents = [i for i in incidents if i.get("status") != "complete"]

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
                # Handle both string list (legacy) and object list (new format)
                if inc_vehicles and isinstance(inc_vehicles[0], dict):
                    veh_parts = []
                    for v in inc_vehicles:
                        vname = v.get("name", "")
                        callsign = v.get("radio_call_sign", "")
                        driver = v.get("driver", "")
                        driver_stay = v.get("driver_stay", False)
                        part = f"{vname}"
                        if callsign:
                            part += f" ({callsign})"
                        if driver:
                            stay = "bleibt" if driver_stay else "kehrt zurueck"
                            part += f" [F: {driver}, {stay}]"
                        veh_parts.append(part)
                    veh_line = f" Fz: {', '.join(veh_parts)}"
                else:
                    veh_line = f" Fz: {', '.join(inc_vehicles)}"
                for line in _wrap_text(veh_line, WIDTH_B):
                    _text(p, f"{line}\n")
            if inc_crew:
                names = [
                    ("EL " if c.get("is_leader") else "") + c.get("name", "") for c in inc_crew
                ]
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
                # Provenance, never faked (plan 26 §7): this person did not tap
                # their own name on the check-in link — an operator ticked it at
                # the board off a radio roll-call. Nothing is printed for the
                # normal case, so the marker means something when it appears.
                if person.get("channel") == "kp":
                    line += " (Funkmeldung)"
                for wrapped in _wrap_text(line, WIDTH_B):
                    _text(p, f"{wrapped}\n")

    _sep(p, "-")
    p.set(font="b", bold=False, align="center")
    _text(p, f"{_stamp(payload)}\n")
    p.cut()


# ── Abholliste ───────────────────────────────────────────────────────

def format_abholliste(p: Network, payload: dict) -> None:
    """The material half of the Restliste on paper (plan 25, decision 25).

    Address · unit · since when, one line each — the sheet somebody takes along
    the next morning. Not a report and not a board snapshot: it is a driving
    list, so it stays flat and sorted by address rather than grouped by anything
    clever. Material left on site is a *different day's* job and is deliberately
    NOT merged with the Trupp-Abholung flag.
    """
    event_name = payload.get("event_name", "Ereignis")
    training = payload.get("training_flag", False)
    units = payload.get("units", [])

    p.set(font="a", bold=True, align="center")
    _text(p, "ABHOLLISTE\n")
    p.set(font="b", bold=False, align="center")
    if training:
        _text(p, "ÜBUNG\n")
    if len(event_name) > WIDTH_B:
        event_name = event_name[:WIDTH_B - 3] + "..."
    _text(p, f"{event_name}\n")
    _sep(p)

    if not units:
        p.set(font="b", bold=False, align="left")
        _text(p, "Kein Material mehr vor Ort.\n")
    else:
        # Address first: the sheet is read from a vehicle, and the address is
        # what decides the order of the drive.
        for unit in sorted(units, key=lambda u: ((u.get("address") or "").lower(), u.get("name") or "")):
            p.set(font="a", bold=True, align="left")
            for line in _wrap_text(unit.get("address") or "Ohne Adresse", WIDTH_A):
                _text(p, f"{line}\n")

            p.set(font="b", bold=False, align="left")
            name = unit.get("name") or "Unbekannt"
            location = unit.get("location")
            detail = f" {name}" + (f" -> {location}" if location else "")
            # "Weiteres Material" the crew named itself: it is on the drive like
            # everything else, but nobody can tick it back into a depot and the
            # time below is when the rapport was filed, not when it was sent.
            # `tracked` is absent in jobs queued by an older backend, and absent
            # means the ordinary case.
            if unit.get("tracked") is False:
                detail += " (nicht erfasst)"
            for line in _wrap_text(detail, WIDTH_B):
                _text(p, f"{line}\n")

            since = unit.get("since")
            if since:
                try:
                    stamp = datetime.fromisoformat(since).astimezone().strftime("%d.%m. %H:%M")
                    _text(p, f"   seit {stamp}\n")
                except (ValueError, TypeError):
                    pass
            _text(p, "\n")

        p.set(font="b", bold=False, align="left")
        _text(p, f"{len(units)} Geraet(e) noch vor Ort\n")

    requested_by = payload.get("requested_by", "")
    if requested_by:
        for line in _wrap_text(f"Ausgeloest von: {requested_by}", WIDTH_B):
            _text(p, f"{line}\n")

    _sep(p, "-")
    p.set(font="b", bold=False, align="center")
    _text(p, f"{_stamp(payload)}\n")
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
