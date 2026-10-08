"""Every notification's German sentence and its params come from one builder.

The sentences are pinned to what the previous release wrote, word for word: the dedup
and auto-resolve logic match on ``message``, an older client still shows it, and a row
from before ``params`` existed must look the same as a new one. The params are pinned
because they are the contract with ``frontend/lib/notification-format.ts``.
"""

import json

import pytest

from app.services import notification_params as texts
from app.services.storage_usage import BYTES_PER_GB

CASES = [
    # (built, message, params)
    (
        texts.time_in_status("Mühlemattstrasse 18", 56, "enroute", "Disponiert"),
        "Mühlemattstrasse 18: 56m im Status «Disponiert»",
        {"variant": "status", "place": "Mühlemattstrasse 18", "minutes": 56, "status": "enroute"},
    ),
    (
        texts.time_not_archived("Hauptstrasse 41", 65),
        "Hauptstrasse 41: seit 1h 5m abgeschlossen, nicht archiviert",
        {"variant": "not_archived", "place": "Hauptstrasse 41", "minutes": 65},
    ),
    (
        texts.no_personnel(),
        "Kein Personal mehr verfügbar - alle eingecheckten Personen sind zugewiesen",
        {},
    ),
    (
        texts.materials("Depot", 0),
        "Keine Einheiten von 'Depot' mehr verfügbar",
        {"location": "Depot", "available": 0},
    ),
    (
        texts.materials("TLF", 2),
        "Nur noch 2 Einheiten von 'TLF' verfügbar",
        {"location": "TLF", "available": 2},
    ),
    (
        texts.fatigue([(f"P{i}", 300) for i in range(7)], 4),
        "7 Personen seit über 4 h im Einsatz: P0 (5 h), P1 (5 h), P2 (5 h), P3 (5 h), P4 (5 h) und 2 weitere",
        {"hours": 4, "count": 7, "people": [{"name": f"P{i}", "hours": 5} for i in range(5)], "more": 2},
    ),
    (
        texts.missing_location("Kellerbrand"),
        "Einsatz 'Kellerbrand' hat keine geokodierte Position",
        {"title": "Kellerbrand"},
    ),
    (
        texts.storage_limit("database", int(4.7 * BYTES_PER_GB), 4),
        "Datenbank: 4,7 GB belegt – Limit von 4 GB überschritten",
        {"store": "database", "used_gb": 4.7, "limit_gb": 4},
    ),
    (
        texts.storage_limit("photos", int(5.25 * BYTES_PER_GB), 5.0),
        "Foto-Speicher: 5,2 GB belegt – Limit von 5.0 GB überschritten",
        {"store": "photos", "used_gb": 5.2, "limit_gb": 5.0},
    ),
    (
        texts.vehicle_on_site("TLF", "Mühlemattstrasse 18"),
        "TLF vor Ort: Mühlemattstrasse 18",
        {"variant": "on_site", "vehicle": "TLF", "place": "Mühlemattstrasse 18"},
    ),
    (
        texts.vehicle_returned("TLF"),
        "TLF zurück im Magazin",
        {"variant": "returned", "vehicle": "TLF"},
    ),
    (
        texts.reko_arrived("Mühlemattstrasse 18", "Lisa Hoffmann"),
        "Reko vor Ort: Lisa Hoffmann bei Mühlemattstrasse 18",
        {"place": "Mühlemattstrasse 18", "by": "Lisa Hoffmann"},
    ),
    (
        texts.reko_arrived("Mühlemattstrasse 18", None),
        "Reko vor Ort: Mühlemattstrasse 18",
        {"place": "Mühlemattstrasse 18", "by": None},
    ),
    (
        texts.reko_submitted("Hauptstrasse 41", "Lisa Hoffmann", True, 3, 2.0, ["fire", "chemical"]),
        "Reko abgeschlossen: Hauptstrasse 41 von Lisa Hoffmann – Einsatz relevant "
        "(3 Pers., ~2.0h, Gefahren: Feuer, Gefahrstoffe)",
        {
            "place": "Hauptstrasse 41",
            "by": "Lisa Hoffmann",
            "relevant": True,
            "personnel_count": 3,
            "duration_hours": 2.0,
            "dangers": ["fire", "chemical"],
        },
    ),
    (
        texts.reko_submitted("Hauptstrasse 41", None, False, None, None, []),
        "Reko abgeschlossen: Hauptstrasse 41 – Kein Einsatz nötig",
        {
            "place": "Hauptstrasse 41",
            "by": None,
            "relevant": False,
            "personnel_count": None,
            "duration_hours": None,
            "dangers": [],
        },
    ),
    (
        texts.field_arrived("Mühlemattstrasse 18", "field", "Bendik Dimitri", "active"),
        "Angekommen: Mühlemattstrasse 18 · Bendik Dimitri – Karte in «Einsatz» verschoben",
        {"place": "Mühlemattstrasse 18", "moved_to": "active", "actor_kind": "field", "actor_name": "Bendik Dimitri"},
    ),
    (
        texts.field_complete("Mühlemattstrasse 18", "gps", None, None),
        "Einsatz beendet gemeldet: Mühlemattstrasse 18 · automatisch (GPS)",
        {"place": "Mühlemattstrasse 18", "moved_to": None, "actor_kind": "gps", "actor_name": None},
    ),
    (
        texts.field_pickup("Bahnhofstrasse 1", "field", "Bendik Dimitri", needed=True, note="2 Personen hinten"),
        "Abholung nötig: Bahnhofstrasse 1 (2 Personen hinten) · Bendik Dimitri",
        {
            "place": "Bahnhofstrasse 1",
            "needed": True,
            "note": "2 Personen hinten",
            "actor_kind": "field",
            "actor_name": "Bendik Dimitri",
        },
    ),
    (
        texts.field_pickup("Bahnhofstrasse 1", "kp", "ignored", needed=False, note="stale"),
        "Abholung erledigt: Bahnhofstrasse 1 · im KP erfasst",
        {"place": "Bahnhofstrasse 1", "needed": False, "note": None, "actor_kind": "kp", "actor_name": None},
    ),
    (
        texts.field_message("Bahnhofstrasse 1", "field", "Bendik Dimitri", "Verstärkung nötig"),
        "Meldung vom Feld (Bendik Dimitri) – Bahnhofstrasse 1: Verstärkung nötig",
        {
            "place": "Bahnhofstrasse 1",
            "text": "Verstärkung nötig",
            "actor_kind": "field",
            "actor_name": "Bendik Dimitri",
        },
    ),
    (
        texts.field_message("Bahnhofstrasse 1", "field", None, "Strom ist weg"),
        "Meldung vom Feld: Strom ist weg",
        {"place": "Bahnhofstrasse 1", "text": "Strom ist weg", "actor_kind": "field", "actor_name": None},
    ),
    (
        texts.field_message("Hauptstrasse 41", "kp", None, "Bitte: 2 Pumpen"),
        "Meldung vom Feld (im KP erfasst) – Hauptstrasse 41: Bitte: 2 Pumpen",
        {"place": "Hauptstrasse 41", "text": "Bitte: 2 Pumpen", "actor_kind": "kp", "actor_name": None},
    ),
    (
        texts.rapport_submitted("Bahnhofstrasse 1", "field", None),
        "Rapport erfasst: Bahnhofstrasse 1 · vom Feld",
        {"place": "Bahnhofstrasse 1", "actor_kind": "field", "actor_name": None},
    ),
    (
        texts.field_report("Hauptstrasse 41", "Fabio Wyss", direct=False),
        "Meldung vom Feld: Hauptstrasse 41 (Fabio Wyss)",
        {"place": "Hauptstrasse 41", "by": "Fabio Wyss", "direct": False},
    ),
    (
        texts.field_report("Hauptstrasse 41", "Fabio Wyss", direct=True),
        "Meldung vom Feld – Trupp fährt direkt hin: Hauptstrasse 41 (Fabio Wyss)",
        {"place": "Hauptstrasse 41", "by": "Fabio Wyss", "direct": True},
    ),
    (
        texts.feld_code_rotated("Unwetter"),
        "Feld-Code für Unwetter nach zu vielen Fehlversuchen neu erzeugt",
        {"event": "Unwetter"},
    ),
    (
        texts.training_new("Kellerbrand", "Bahnhofstrasse 1, 4104 Oberwil"),
        "Neuer Übungs-Einsatz: Kellerbrand (Bahnhofstrasse 1, 4104 Oberwil)",
        {"variant": "new", "title": "Kellerbrand", "address": "Bahnhofstrasse 1, 4104 Oberwil"},
    ),
    (
        texts.training_escalation("Wasser im Keller", "Wasser steigt"),
        "Lage verschärft: Wasser im Keller – Wasser steigt",
        {"variant": "escalation", "title": "Wasser im Keller", "text": "Wasser steigt"},
    ),
    (
        texts.training_reinforcement("Wasser im Keller", "2 Pumpen nötig"),
        "Feld fordert Verstärkung: 2 Pumpen nötig – Wasser im Keller",
        {"variant": "reinforcement", "title": "Wasser im Keller", "text": "2 Pumpen nötig"},
    ),
    (
        texts.training_vehicle_down("TLF", "Wasser im Keller"),
        "Fahrzeug TLF ausgefallen: Wasser im Keller – Ersatz disponieren",
        {"variant": "vehicle_down", "vehicle": "TLF", "title": "Wasser im Keller"},
    ),
]


@pytest.mark.parametrize(("built", "message", "params"), CASES)
def test_sentence_and_params(built, message, params):
    assert built == (message, params)
    # Stored in a JSONB column and sent as JSON: nothing in it may need a custom encoder.
    assert json.loads(json.dumps(built[1])) == params


def test_duration_reads_like_it_always_did():
    assert texts.duration_de(0) == "0m"
    assert texts.duration_de(59) == "59m"
    assert texts.duration_de(60) == "1h 0m"
    assert texts.duration_de(-3) == "0m"


def test_fatigue_message_stays_the_service_entry_point():
    from app.services.notification_service import fatigue_message

    assert fatigue_message([("Müller Hans", 5 * 60 + 10)], 4) == "Seit über 4 h im Einsatz: Müller Hans (5 h)"
