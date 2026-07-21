"""Demo database seed script.

Creates realistic demo data for the public demo deployment.
Called by seed.py when DEMO_MODE=true.

seed_demo_event_content() is shared between the full seed/reset and the
per-session sandbox endpoint (POST /api/demo/sandbox): it fills an existing
event with the demo scenario, looking up the shared resources by name.
"""

from datetime import datetime
from uuid import UUID, uuid4

import bcrypt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .database import async_session_maker

# Stable UUIDs for the demo users. The demo reset truncates + re-seeds the
# users table every few hours; using fixed IDs (instead of uuid4()) means a
# pre-reset session token's `sub` still resolves to a user afterwards, so
# logged-in demo visitors are not kicked out with "Sitzung abgelaufen" on
# every reset cycle.
DEMO_EDITOR_ID = UUID("de300000-0000-0000-0000-0000000ed170")
DEMO_VIEWER_ID = UUID("de300000-0000-0000-0000-000000001e70")


async def seed_demo_shared_resources(db: AsyncSession) -> None:
    """Create the shared demo resources (vehicles, personnel, materials).

    Flushes but does not commit; the caller controls the transaction.
    """
    vehicles_data = [
        {"name": "TLF", "type": "TLF", "display_order": 1, "status": "available", "radio_call_sign": "Omega 1"},
        {"name": "Pio", "type": "RW", "display_order": 2, "status": "available", "radio_call_sign": "Omega 2"},
        {"name": "Mowa", "type": "MTW", "display_order": 3, "status": "available", "radio_call_sign": "Omega 3"},
        {"name": "Trawa", "type": "MTW", "display_order": 4, "status": "available", "radio_call_sign": "Omega 4"},
        {"name": "Mawa", "type": "MTW", "display_order": 5, "status": "available", "radio_call_sign": "Omega 5"},
    ]
    for v in vehicles_data:
        db.add(models.Vehicle(id=uuid4(), **v))

    personnel_data = [
        # Offiziere
        {"name": "Müller Hans", "role": "Offizier", "availability": "available", "tags": ["F"]},
        {"name": "Schneider Peter", "role": "Offizier", "availability": "available", "tags": ["F", "Hö"]},
        {"name": "Weber Martin", "role": "Offizier", "availability": "available", "tags": ["F", "Fw"]},
        {"name": "Fischer Thomas", "role": "Offizier", "availability": "available", "tags": []},
        {"name": "Ackermann Reto", "role": "Offizier", "availability": "available", "tags": ["F"]},
        # Wachtmeister
        {"name": "Hoffmann Lisa", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Schmidt Daniel", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Koch René", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Baumann Michael", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Fw"]},
        {"name": "Keller Marco", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Brunner Sarah", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Hö"]},
        {"name": "Bühler Nadja", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Frei Marc", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Fw"]},
        {"name": "Suter Beat", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Widmer Anna", "role": "Wachtmeister", "availability": "available", "tags": ["Hö"]},
        # Korporal
        {"name": "Steiner Lukas", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Meier Andrea", "role": "Korporal", "availability": "available", "tags": ["F"]},
        {"name": "Graf Sven", "role": "Korporal", "availability": "available", "tags": ["Hö"]},
        {"name": "Roth Til", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Gerber Elias", "role": "Korporal", "availability": "available", "tags": ["F"]},
        {"name": "Lüthi Sophie", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Kaufmann Nico", "role": "Korporal", "availability": "available", "tags": ["Fw"]},
        {"name": "Moser Lea", "role": "Korporal", "availability": "available", "tags": ["F"]},
        {"name": "Wenger Tim", "role": "Korporal", "availability": "available", "tags": []},
        # Mannschaft
        {"name": "Zimmermann Fabian", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Wyss Fabio", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Künzli Klara", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Studer Samuel", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Schwarz Jan", "role": "Mannschaft", "availability": "available", "tags": ["Fw"]},
        {"name": "Hartmann Mischa", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Berger Yves", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Christen Mia", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Vogel Timo", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Egli Sarah", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Bianchi Luca", "role": "Mannschaft", "availability": "available", "tags": ["Fw"]},
        {"name": "Portmann Jonas", "role": "Mannschaft", "availability": "available", "tags": []},
    ]
    for p in personnel_data:
        db.add(models.Personnel(id=uuid4(), **p))

    # Storage locations: the three vehicles (TLF / Pio / MoWa) plus a single
    # "Magazin" depot. (Earlier demo data had separate "Modul"/"Bühne"
    # locations — consolidated into Magazin.)
    materials_data = [
        # Tauchpumpen
        {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "TLF", "status": "available"},
        {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "TLF", "status": "available"},
        {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "Pio", "status": "available"},
        {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "Pio", "status": "available"},
        {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
        {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
        {"name": "Tauchpumpe S-Gr.", "type": "Tauchpumpen", "location": "Magazin", "status": "available"},
        {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "Magazin", "status": "available"},
        {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "Magazin", "status": "available"},
        # Wassersauger
        {"name": "Wassersauger", "type": "Wassersauger", "location": "Pio", "status": "available"},
        {"name": "Wassersauger", "type": "Wassersauger", "location": "MoWa", "status": "available"},
        {"name": "Wassersauger", "type": "Wassersauger", "location": "Magazin", "status": "available"},
        # Generatoren
        {"name": "Generator", "type": "Generatoren", "location": "TLF", "status": "available"},
        {"name": "Generator", "type": "Generatoren", "location": "MoWa", "status": "available"},
        {"name": "Generator", "type": "Generatoren", "location": "Magazin", "status": "available"},
        # Sägen
        {"name": "Motorsäge Gr.", "type": "Sägen", "location": "Pio", "status": "available"},
        {"name": "Motorsäge Kl.", "type": "Sägen", "location": "Pio", "status": "available"},
        {"name": "Motorsäge Gr.", "type": "Sägen", "location": "Magazin", "status": "available"},
        # Elektrowerkzeug
        {"name": "Spannungsprüfer", "type": "Elektrowerkzeug", "location": "MoWa", "status": "available"},
        {"name": "Trennschleifer", "type": "Elektrowerkzeug", "location": "Magazin", "status": "available"},
        # Beleuchtung
        {"name": "Lichtmast", "type": "Beleuchtung", "location": "MoWa", "status": "available"},
        {"name": "Flutlichtstrahler", "type": "Beleuchtung", "location": "Magazin", "status": "available"},
        # Ölwehr
        {"name": "Ölbindemittel", "type": "Ölwehr", "location": "Magazin", "status": "available"},
        {"name": "Ölsperre", "type": "Ölwehr", "location": "Pio", "status": "available"},
        # Schläuche
        {"name": "Schlauch B", "type": "Schläuche", "location": "TLF", "status": "available"},
        {"name": "Schlauch C", "type": "Schläuche", "location": "TLF", "status": "available"},
    ]
    for m in materials_data:
        db.add(models.Material(id=uuid4(), **m))

    await db.flush()


async def seed_demo_event_content(db: AsyncSession, event: models.Event) -> None:
    """Fill an existing event with the demo scenario content.

    Creates incidents, assignments, special functions, and status transitions
    for the given event. Shared resources (vehicles/personnel/materials) are
    looked up by name from the DB — they are NOT created here.

    Flushes but does not commit; the caller controls the transaction.
    """
    # Editor user for created_by/assigned_by (fall back to any user, e.g. in tests)
    result = await db.execute(select(models.User).where(models.User.username == "demo-editor"))
    editor_user = result.scalar_one_or_none()
    if editor_user is None:
        result = await db.execute(select(models.User).limit(1))
        editor_user = result.scalars().first()
    editor_id = editor_user.id if editor_user else None

    # Look up shared resources by name (materials by name + location, names repeat)
    result = await db.execute(select(models.Vehicle))
    vehicle = {v.name: v for v in result.scalars().all()}

    result = await db.execute(select(models.Personnel))
    person = {p.name: p for p in result.scalars().all()}

    result = await db.execute(select(models.Material))
    material = {(m.name, m.location): m for m in result.scalars().all()}

    now = datetime.now()

    # ============================================
    # INCIDENTS (a realistic spread across all board columns, Basel-Landschaft)
    # The Oberwil "Wasser im Keller EFH" stays the fully-staffed active Einsatz;
    # the others fill the remaining kanban columns so the demo board looks alive.
    # ============================================
    incidents_data = [
        # --- EINGEGANGEN (6) ---
        {
            "title": "Ölspur auf Fahrbahn",
            "type": "oelwehr",
            "priority": "low",
            "location_address": "Hauptstrasse 12, 4153 Reinach",
            "location_lat": 47.4948,
            "location_lng": 7.5931,
            "status": "eingegangen",
            "description": "Ölspur über ca. 200m nach Verkehrsunfall gemeldet.",
        },
        {
            "title": "Rauchentwicklung Mehrfamilienhaus",
            "type": "brandbekaempfung",
            "priority": "high",
            "location_address": "Baslerstrasse 45, 4123 Allschwil",
            "location_lat": 47.5486,
            "location_lng": 7.5361,
            "status": "eingegangen",
            "description": "Rauch aus Kellerfenster gemeldet, Bewohner alarmiert.",
        },
        {
            "title": "Person in Aufzug eingeschlossen",
            "type": "technische_hilfeleistung",
            "priority": "medium",
            "location_address": "Hauptstrasse 68, 4102 Binningen",
            "location_lat": 47.5401,
            "location_lng": 7.5695,
            "status": "eingegangen",
            "description": "Zwei Personen in steckengebliebenem Lift.",
        },
        {
            "title": "Baum auf Strasse",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Oberwilerstrasse 5, 4103 Bottmingen",
            "location_lat": 47.5217,
            "location_lng": 7.5751,
            "status": "eingegangen",
            "description": "Umgestürzter Baum blockiert Fahrbahn nach Sturm.",
        },
        {
            "title": "Wasserrohrbruch Tiefgarage",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Bahnhofstrasse 22, 4106 Therwil",
            "location_lat": 47.4993,
            "location_lng": 7.5545,
            "status": "eingegangen",
            "description": "Wasser tritt in Tiefgarage ein, mehrere Fahrzeuge betroffen.",
        },
        {
            "title": "Gasgeruch gemeldet",
            "type": "chemiewehr",
            "priority": "high",
            "location_address": "Hauptstrasse 30, 4147 Aesch",
            "location_lat": 47.4692,
            "location_lng": 7.5936,
            "status": "eingegangen",
            "description": "Anwohner meldet Gasgeruch im Treppenhaus.",
        },
        # --- REKO (3) ---
        {
            "title": "Brand Gartenhaus",
            "type": "brandbekaempfung",
            "priority": "medium",
            "location_address": "Im Brühl 8, 4107 Ettingen",
            "location_lat": 47.4783,
            "location_lng": 7.5528,
            "status": "reko",
            "description": "Gartenhaus in Vollbrand, Reko läuft.",
        },
        {
            "title": "Unfall mit Betriebsmittelaustritt",
            "type": "strassenrettung",
            "priority": "high",
            "location_address": "Kägenstrasse 10, 4153 Reinach",
            "location_lat": 47.4901,
            "location_lng": 7.5889,
            "status": "reko",
            "description": "PW-Unfall, Betriebsstoffe ausgetreten.",
        },
        {
            "title": "Überflutete Unterführung",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Mühlemattstrasse 3, 4104 Oberwil",
            "location_lat": 47.5128,
            "location_lng": 7.5567,
            "status": "reko",
            "description": "Unterführung nach Starkregen überflutet.",
        },
        # --- REKO ABGESCHLOSSEN (3) ---
        {
            "title": "Kellerbrand abgeklärt",
            "type": "brandbekaempfung",
            "priority": "medium",
            "location_address": "Lettenweg 15, 4123 Allschwil",
            "location_lat": 47.5523,
            "location_lng": 7.5402,
            "status": "reko_done",
            "description": "Reko abgeschlossen, Brandherd lokalisiert.",
        },
        {
            "title": "Tierrettung Katze",
            "type": "gerettete_tiere",
            "priority": "low",
            "location_address": "Schlossgasse 4, 4102 Binningen",
            "location_lat": 47.5379,
            "location_lng": 7.5721,
            "status": "reko_done",
            "description": "Katze auf Baum, Lage erkundet.",
        },
        {
            "title": "Ausgelaufenes Heizöl",
            "type": "oelwehr",
            "priority": "medium",
            "location_address": "Ringstrasse 9, 4106 Therwil",
            "location_lat": 47.5021,
            "location_lng": 7.5583,
            "status": "reko_done",
            "description": "Heizöl im Keller, Ausmass erkundet.",
        },
        # --- DISPONIERT / ANFAHRT (2) ---
        {
            "title": "Fahrzeugbrand Parkplatz",
            "type": "brandbekaempfung",
            "priority": "high",
            "location_address": "Christoph Merian-Ring 25, 4153 Reinach",
            "location_lat": 47.4869,
            "location_lng": 7.5972,
            "status": "disponiert",
            "description": "PW brennt auf Parkplatz, Kräfte auf Anfahrt.",
        },
        {
            "title": "Sturmschaden Dach",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Talstrasse 14, 4103 Bottmingen",
            "location_lat": 47.5189,
            "location_lng": 7.5789,
            "status": "disponiert",
            "description": "Dachziegel lösen sich, Absperrung nötig.",
        },
        # --- EINSATZ (2) ---
        {
            "title": "Wasser im Keller EFH",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Langegasse 28, 4104 Oberwil",
            "location_lat": 47.5144091848039,
            "location_lng": 7.5612134821807935,
            "status": "einsatz",
            "description": "Keller unter Wasser, ca. 30cm. Heizung und Elektroinstallation betroffen. Bewohner vor Ort.",
        },
        {
            "title": "Wohnungsbrand 2. OG",
            "type": "brandbekaempfung",
            "priority": "high",
            "location_address": "Gartenstrasse 18, 4123 Allschwil",
            "location_lat": 47.5461,
            "location_lng": 7.5333,
            "status": "einsatz",
            "description": "Zimmerbrand, Löscharbeiten laufen, eine Person gerettet.",
        },
        # --- BEENDET / RÜCKFAHRT (2) ---
        {
            "title": "Auslaufende Betriebsstoffe Garage",
            "type": "oelwehr",
            "priority": "medium",
            "location_address": "Dorfstrasse 7, 4107 Ettingen",
            "location_lat": 47.4761,
            "location_lng": 7.5561,
            "status": "einsatz_beendet",
            "description": "Betriebsstoffe gebunden, Rückbau läuft.",
        },
        {
            "title": "Kleinbrand Container",
            "type": "brandbekaempfung",
            "priority": "low",
            "location_address": "Industriestrasse 3, 4147 Aesch",
            "location_lat": 47.4711,
            "location_lng": 7.5883,
            "status": "einsatz_beendet",
            "description": "Containerbrand gelöscht, Rückfahrt.",
        },
        # --- ABGESCHLOSSEN (3) ---
        {
            "title": "Ölspur Hauptstrasse",
            "type": "oelwehr",
            "priority": "low",
            "location_address": "Hauptstrasse 55, 4104 Oberwil",
            "location_lat": 47.5162,
            "location_lng": 7.5598,
            "status": "abschluss",
            "description": "Ölspur gebunden und gereinigt. Einsatz abgeschlossen.",
        },
        {
            "title": "Wespennest entfernt",
            "type": "diverse_einsaetze",
            "priority": "low",
            "location_address": "Weidenweg 2, 4106 Therwil",
            "location_lat": 47.4978,
            "location_lng": 7.5602,
            "status": "abschluss",
            "description": "Wespennest entfernt, Einsatz beendet.",
        },
        {
            "title": "Türöffnung für Rettungsdienst",
            "type": "technische_hilfeleistung",
            "priority": "medium",
            "location_address": "Austrasse 40, 4153 Reinach",
            "location_lat": 47.4922,
            "location_lng": 7.5915,
            "status": "abschluss",
            "description": "Türöffnung erfolgt, Übergabe an Sanität.",
        },
    ]

    # Position orders cards within each status column (0-based per column).
    position_by_status: dict[str, int] = {}
    incidents: dict[str, models.Incident] = {}
    for inc in incidents_data:
        pos = position_by_status.get(inc["status"], 0)
        position_by_status[inc["status"]] = pos + 1
        incident = models.Incident(
            id=uuid4(), created_by=editor_id, event_id=event.id, position=pos, **inc
        )
        db.add(incident)
        incidents[incident.title] = incident

    await db.flush()

    # ============================================
    # PERSONNEL CHECK-INS (event attendance)
    # A realistic subset of the roster is already checked in so the board's
    # personnel panel is pre-populated with available firefighters.
    # ============================================
    checked_in_names = [
        "Müller Hans",
        "Schneider Peter",
        "Weber Martin",
        "Hoffmann Lisa",
        "Schmidt Daniel",
        "Koch René",
        "Steiner Lukas",
        "Meier Andrea",
        "Zimmermann Fabian",
        "Wyss Fabio",
    ]
    for name in checked_in_names:
        db.add(
            models.EventAttendance(
                id=uuid4(),
                event_id=event.id,
                personnel_id=person[name].id,
                checked_in=True,
                checked_in_at=now,
            )
        )

    # ============================================
    # INCIDENT ASSIGNMENTS (crew + vehicle + pumps on site)
    # ============================================
    def assign(incident_title: str, resource_type: str, resource):
        return models.IncidentAssignment(
            id=uuid4(),
            incident_id=incidents[incident_title].id,
            resource_type=resource_type,
            resource_id=resource.id,
            assigned_by=editor_id,
        )

    assignments = [
        assign("Wasser im Keller EFH", "vehicle", vehicle["TLF"]),
        assign("Wasser im Keller EFH", "personnel", person["Müller Hans"]),
        assign("Wasser im Keller EFH", "personnel", person["Hoffmann Lisa"]),
        assign("Wasser im Keller EFH", "personnel", person["Zimmermann Fabian"]),
        assign("Wasser im Keller EFH", "material", material[("Tauchpumpe Gr.", "TLF")]),
        assign("Wasser im Keller EFH", "material", material[("Tauchpumpe Kl.", "TLF")]),
        # Second active Einsatz — Wohnungsbrand
        assign("Wohnungsbrand 2. OG", "vehicle", vehicle["Mowa"]),
        assign("Wohnungsbrand 2. OG", "personnel", person["Koch René"]),
        assign("Wohnungsbrand 2. OG", "personnel", person["Meier Andrea"]),
        assign("Wohnungsbrand 2. OG", "personnel", person["Künzli Klara"]),
        # Disponiert — Fahrzeugbrand on the way
        assign("Fahrzeugbrand Parkplatz", "vehicle", vehicle["Trawa"]),
        assign("Fahrzeugbrand Parkplatz", "personnel", person["Schneider Peter"]),
        assign("Fahrzeugbrand Parkplatz", "personnel", person["Graf Sven"]),
        # Winding down — Betriebsstoffe Garage
        assign("Auslaufende Betriebsstoffe Garage", "vehicle", vehicle["Mawa"]),
        assign("Auslaufende Betriebsstoffe Garage", "personnel", person["Wyss Fabio"]),
        assign("Auslaufende Betriebsstoffe Garage", "personnel", person["Roth Til"]),
    ]
    for assignment in assignments:
        db.add(assignment)

    # ============================================
    # SPECIAL FUNCTIONS
    # ============================================
    special_functions_data = [
        (person["Müller Hans"], "driver", vehicle["TLF"]),
        (person["Weber Martin"], "driver", vehicle["Pio"]),
        (person["Schmidt Daniel"], "reko", None),
        (person["Steiner Lukas"], "magazin", None),
        # Drivers for the other staffed incidents (each on a distinct vehicle)
        (person["Koch René"], "driver", vehicle["Mowa"]),
        (person["Schneider Peter"], "driver", vehicle["Trawa"]),
        (person["Wyss Fabio"], "driver", vehicle["Mawa"]),
    ]
    special_functions = [
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=event.id,
            personnel_id=p.id,
            function_type=function_type,
            vehicle_id=v.id if v else None,
            assigned_by=editor_id,
        )
        for p, function_type, v in special_functions_data
    ]
    for sf in special_functions:
        db.add(sf)

    # ============================================
    # STATUS TRANSITIONS
    # ============================================
    def transition(incident_title: str, from_status: str, to_status: str, notes: str | None = None):
        return models.StatusTransition(
            id=uuid4(),
            incident_id=incidents[incident_title].id,
            from_status=from_status,
            to_status=to_status,
            user_id=editor_id,
            notes=notes,
        )

    transitions = [
        transition("Wasser im Keller EFH", "eingegangen", "disponiert", "TLF disponiert"),
        transition("Wasser im Keller EFH", "disponiert", "einsatz", "Vor Ort, Pumpen laufen"),
        # Wohnungsbrand — eingegangen → disponiert → einsatz
        transition("Wohnungsbrand 2. OG", "eingegangen", "disponiert", "Mowa disponiert"),
        transition("Wohnungsbrand 2. OG", "disponiert", "einsatz", "Löscharbeiten laufen"),
        # Fahrzeugbrand — eingegangen → disponiert
        transition("Fahrzeugbrand Parkplatz", "eingegangen", "disponiert", "Trawa auf Anfahrt"),
        # Betriebsstoffe Garage — full trail to einsatz_beendet
        transition("Auslaufende Betriebsstoffe Garage", "eingegangen", "disponiert", "Mawa disponiert"),
        transition("Auslaufende Betriebsstoffe Garage", "disponiert", "einsatz", "Vor Ort"),
        transition("Auslaufende Betriebsstoffe Garage", "einsatz", "einsatz_beendet", "Rückbau, Rückfahrt"),
        # Reko incidents — eingegangen → reko
        transition("Brand Gartenhaus", "eingegangen", "reko", "Reko unterwegs"),
        transition("Unfall mit Betriebsmittelaustritt", "eingegangen", "reko", "Reko unterwegs"),
        # Reko-done incidents — eingegangen → reko → reko_done
        transition("Kellerbrand abgeklärt", "reko", "reko_done", "Reko abgeschlossen"),
        transition("Ausgelaufenes Heizöl", "reko", "reko_done", "Reko abgeschlossen"),
        # Abschluss incidents — closed out
        transition("Ölspur Hauptstrasse", "einsatz", "abschluss", "Einsatz abgeschlossen"),
        transition("Türöffnung für Rettungsdienst", "einsatz", "abschluss", "Übergabe erfolgt"),
    ]
    for t in transitions:
        db.add(t)

    await db.flush()


async def seed_demo_database() -> None:
    """Seed the database with demo data for public demo deployment."""
    async with async_session_maker() as db:
        try:
            # Check if data already exists
            result = await db.execute(select(models.User))
            if result.scalars().first():
                print("Demo database already seeded. Skipping...")
                return

            # Clean up migration artifacts (e.g. "Migrated Incidents" default event)
            await db.execute(delete(models.Event))
            await db.flush()

            print("Seeding demo database...")

            # ============================================
            # 1. DEMO USERS
            # ============================================
            print("Creating demo users...")

            editor_hash = bcrypt.hashpw(b"demo123", bcrypt.gensalt()).decode("utf-8")
            viewer_hash = bcrypt.hashpw(b"demo123", bcrypt.gensalt()).decode("utf-8")

            editor_user = models.User(
                id=DEMO_EDITOR_ID,
                username="demo-editor",
                password_hash=editor_hash,
                role="editor",
                display_name="Demo Bearbeiter",
                is_active=True,
            )
            db.add(editor_user)

            viewer_user = models.User(
                id=DEMO_VIEWER_ID,
                username="demo-viewer",
                password_hash=viewer_hash,
                role="viewer",
                display_name="Demo Betrachter",
                is_active=True,
            )
            db.add(viewer_user)
            await db.flush()

            # ============================================
            # 2. SETTINGS
            # ============================================
            print("Creating demo settings...")

            demo_settings = [
                ("firestation_name", "Feuerwehr Oberwil"),
                ("firestation_latitude", "47.51637699933488"),
                ("firestation_longitude", "7.561800450458299"),
                ("home_city", "Oberwil, BL"),
                ("polling_interval_ms", "5000"),
                ("training_mode", "false"),
                ("map_mode", "online"),
                ("auto_archive_timeout_hours", "24"),
                ("notification_enabled", "false"),
            ]

            for key, value in demo_settings:
                setting = models.Setting(
                    key=key,
                    value=value,
                    updated_by=editor_user.id,
                )
                db.add(setting)

            # ============================================
            # 3. SHARED RESOURCES (vehicles, personnel, materials)
            # ============================================
            # No base event/scenario is seeded here. Every demo visitor —
            # editor AND viewer — auto-creates their own "Demo-Lage #xxxx"
            # sandbox on login via POST /api/demo/sandbox, which fills it from
            # seed_demo_event_content(). Seeding only the shared resources avoids
            # a generic shared event nobody owns.
            print("Creating shared resources...")
            await seed_demo_shared_resources(db)

            # ============================================
            # COMMIT
            # ============================================
            await db.commit()

            print("\n✅ Demo database seeded successfully!")
            print("  Demo users:")
            print("    - demo-editor / demo123 (editor)")
            print("    - demo-viewer / demo123 (viewer)")
            print("  - shared resources only; each login creates its own Demo-Lage sandbox")

        except Exception as e:
            print(f"❌ Error seeding demo database: {e}")
            await db.rollback()
            raise
