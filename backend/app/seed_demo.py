"""Demo database seed script.

Creates realistic demo data for the public demo deployment.
Called by seed.py when DEMO_MODE=true.

seed_demo_event_content() is shared between the full seed/reset and the
per-session sandbox endpoint (POST /api/demo/sandbox): it fills an existing
event with the demo scenario, looking up the shared resources by name.
"""

from datetime import datetime, timedelta
from uuid import UUID, uuid4

import bcrypt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .database import async_session_maker
from .seed_training import seed_training_data

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
    # Rank order so the roster sorts Offizier → Wachtmeister → Korporal → Mannschaft
    # instead of alphabetically by role.
    role_order = {"Offizier": 1, "Wachtmeister": 2, "Korporal": 3, "Mannschaft": 4}
    for p in personnel_data:
        db.add(models.Personnel(id=uuid4(), role_sort_order=role_order.get(p["role"], 99), **p))

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
        {"name": "Ölbindemittel", "type": "Ölwehr", "location": "Magazin", "status": "available", "consumable": True},
        {"name": "Ölsperre", "type": "Ölwehr", "location": "Pio", "status": "available"},
        # An unlimited consumable example
        {
            "name": "Triopan / Absperrband",
            "type": "Verbrauchsmaterial",
            "location": "Magazin",
            "status": "available",
            "consumable": True,
        },
    ]
    # Depot order for the location filter/grouping: the mobile depots (vehicles,
    # closest to the scene) first, the central Magazin last.
    location_order = {"TLF": 1, "Pio": 2, "MoWa": 3, "Trawa": 4, "Magazin": 5}
    for m in materials_data:
        m.setdefault("location_sort_order", location_order.get(m["location"], 99))
        db.add(models.Material(id=uuid4(), **m))

    # A transportable "Pumpenmodul" currently loaded on the Trawa — a material
    # group of three pumps that move together with the vehicle.
    pump_module = models.MaterialGroup(
        id=uuid4(),
        name="Pumpenmodul",
        location="Trawa",
        description="Pumpenmodul, aufgeladen auf Trawa",
    )
    db.add(pump_module)
    for pump in ("Tauchpumpe Gr.", "Tauchpumpe Kl.", "Tauchpumpe S-Gr."):
        db.add(
            models.Material(
                id=uuid4(),
                name=pump,
                type="Tauchpumpen",
                location="Trawa",
                location_sort_order=location_order["Trawa"],
                status="available",
                group_id=pump_module.id,
            )
        )

    await db.flush()


async def seed_demo_event_content(db: AsyncSession, event: models.Event) -> None:
    """Fill an existing event with the demo scenario content.

    One coherent story: a summer storm front passed over Oberwil BL about
    three hours ago. The board is deliberately FULL so every feature has
    something to show:

    - ~16 storm/water incidents (Wasser im Keller, überflutete Strassen,
      abgedeckte Dächer, …) spread across ALL seven kanban columns, weighted
      toward the early columns like a real storm evening
    - ONE featured non-storm fire Einsatz (Brand Dachstock, fully staffed)
    - ONE fully-equipped Auftrag ("Sturmholz Oberwil"): an ordered route of
      four tree-clearing stops, with vehicle + crew + Motorsäge assigned at
      the route (group) level
    - a working Reko slice: three in-progress Rekos (reko person assigned,
      no report yet) and four COMPLETED reko reports on later-stage incidents,
      each with a matching assignment row so the dashboard counts add up

    Also creates the check-ins, special functions, and status transitions.
    Shared resources (vehicles/personnel/materials) are looked up by name
    from the DB — they are NOT created here.

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

    def ago(minutes: int) -> datetime:
        return now - timedelta(minutes=minutes)

    # Position orders cards within each status column (0-based per column);
    # every incident below draws its slot from this shared counter.
    position_by_status: dict[str, int] = {}
    incidents: dict[str, models.Incident] = {}

    def add_incident(**data) -> models.Incident:
        pos = position_by_status.get(data["status"], 0)
        position_by_status[data["status"]] = pos + 1
        incident = models.Incident(id=uuid4(), created_by=editor_id, event_id=event.id, position=pos, **data)
        db.add(incident)
        incidents[incident.title] = incident
        return incident

    # ============================================
    # FEATURED EINSATZ — the one active fire (fully staffed, non-storm)
    # ============================================
    add_incident(
        title="Brand Dachstock Einfamilienhaus",
        type="brandbekaempfung",
        priority="high",
        location_address="Langegasse 28, 4104 Oberwil",
        location_lat=47.5144091848039,
        location_lng=7.5612134821807935,
        status="einsatz",
        description=(
            "Rauch aus dem Dachstock gemeldet, bei Eintreffen Flammen im Dachbereich. "
            "Bewohner haben das Gebäude selbstständig verlassen. "
            "Löschangriff über die Fassade läuft."
        ),
        contact="Bühler Werner (Nachbar, Melder)",
        contact_phone="061 401 12 34",
        created_at=ago(50),
    )

    # ============================================
    # STORM INCIDENTS — the bread-and-butter Elementarereignisse the front
    # left behind, spread across all seven columns (backlog piling up in the
    # early columns, a few already worked off).
    # ============================================
    storm_incidents_data = [
        # --- EINGEGANGEN (5) — the phone keeps ringing ---
        {
            "title": "Wasser im Keller MFH",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Mühlemattstrasse 12, 4104 Oberwil",
            "location_lat": 47.5172,
            "location_lng": 7.5588,
            "status": "eingegangen",
            "description": "Bewohnerin meldet ca. 20 cm Wasser im Keller des Mehrfamilienhauses, Waschküche betroffen.",
            "contact": "Meier Ruth (Bewohnerin)",
            "contact_phone": "061 401 22 18",
            "created_at": ago(25),
        },
        {
            "title": "Verstopfte Dolen Hauptstrasse",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Hauptstrasse 40, 4104 Oberwil",
            "location_lat": 47.5148,
            "location_lng": 7.5605,
            "status": "eingegangen",
            "description": "Mehrere Dolen durch Laub und Geschiebe verstopft, Wasser staut sich auf der Fahrbahn.",
            "am_warten": True,
            "am_warten_note": "Zurückgestellt, bis Kräfte frei sind",
            "created_at": ago(18),
        },
        {
            "title": "Wasser im Keller EFH",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Allschwilerstrasse 14, 4104 Oberwil",
            "location_lat": 47.5201,
            "location_lng": 7.5559,
            "status": "eingegangen",
            "description": "Keller läuft über die Lichtschächte voll, Heizungsraum betroffen.",
            "contact": "Bürgin Anton (Eigentümer)",
            "contact_phone": "079 512 44 87",
            "created_at": ago(12),
        },
        {
            "title": "Ziegel auf Gehweg",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Bahnhofstrasse 8, 4104 Oberwil",
            "location_lat": 47.5135,
            "location_lng": 7.5628,
            "status": "eingegangen",
            "description": "Sturmböe hat mehrere Dachziegel gelöst, Ziegel liegen auf dem Gehweg. Absperrung nötig.",
            "created_at": ago(8),
        },
        {
            "title": "Umgestürzte Baustellenabschrankung",
            "type": "technische_hilfeleistung",
            "priority": "low",
            "location_address": "Reinacherstrasse 30, 4104 Oberwil",
            "location_lat": 47.5119,
            "location_lng": 7.5662,
            "status": "eingegangen",
            "description": "Bauabschrankung auf die Strasse gestürzt, Fahrbahn teilweise blockiert.",
            "created_at": ago(5),
        },
        # --- REKO (3) — reko person on site, report still pending ---
        {
            "title": "Überflutete Unterführung",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Bahnhofstrasse 22, 4104 Oberwil",
            "location_lat": 47.5128,
            "location_lng": 7.5635,
            "status": "reko",
            "description": "Unterführung nach Starkregen überflutet, ein Fahrzeug steckengeblieben. Polizei vor Ort.",
            "contact": "Polizei Basel-Landschaft",
            "contact_phone": "061 553 35 35",
            "created_at": ago(45),
        },
        {
            "title": "Wasser in Tiefgarage",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Wasserturmstrasse 2, 4104 Oberwil",
            "location_lat": 47.5210,
            "location_lng": 7.5601,
            "status": "reko",
            "description": "Wasser dringt über die Einfahrtsrampe in die Tiefgarage ein, mehrere Fahrzeuge betroffen.",
            "created_at": ago(40),
        },
        {
            "title": "Wasser im Keller Gewerbebau",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Ziegeleistrasse 18, 4104 Oberwil",
            "location_lat": 47.5162,
            "location_lng": 7.5521,
            "status": "reko",
            "description": "Lagerkeller einer Schreinerei unter Wasser, Maschinen und Holzlager gefährdet.",
            "created_at": ago(35),
        },
        # --- REKO ABGESCHLOSSEN (2) — completed reports seeded below ---
        {
            "title": "Abgedecktes Dach Scheune",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Rebbergstrasse 5, 4104 Oberwil",
            "location_lat": 47.5185,
            "location_lng": 7.5642,
            "status": "reko_done",
            "description": "Sturm hat Teile des Scheunendachs abgedeckt. Reko abgeschlossen, Notabdeckung nötig.",
            "created_at": ago(105),
        },
        {
            "title": "Wasser im Keller Doppelhaus",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Kirchgasse 3, 4104 Oberwil",
            "location_lat": 47.5151,
            "location_lng": 7.5598,
            "status": "reko_done",
            "description": "Ca. 25 cm Wasser im Keller, Elektroverteilung betroffen. Reko abgeschlossen.",
            "created_at": ago(100),
        },
        # --- DISPONIERT (2) ---
        {
            "title": "Überflutete Strasse",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Ringstrasse 11, 4104 Oberwil",
            "location_lat": 47.5091,
            "location_lng": 7.5602,
            "status": "disponiert",
            "description": "Strasse auf ca. 50 m überflutet, Wasser läuft in angrenzende Vorgärten. Mowa auf Anfahrt.",
            "created_at": ago(30),
        },
        {
            "title": "Wasser im Keller Reihen-EFH",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Schulstrasse 9, 4104 Oberwil",
            "location_lat": 47.5143,
            "location_lng": 7.5571,
            "status": "disponiert",
            "description": "Keller unter Wasser. Gruppe geht mit Tauchpumpe zu Fuss vom Magazin.",
            "zu_fuss": True,
            "created_at": ago(28),
        },
        # --- EINSATZ (1, neben Brand + Auftrag-Stopp) ---
        {
            "title": "Wasser in Tiefgarage Zentrum",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Poststrasse 6, 4104 Oberwil",
            "location_lat": 47.5139,
            "location_lng": 7.5613,
            "status": "einsatz",
            "description": "Tiefgarage ca. 40 cm unter Wasser. Trawa mit Pumpenmodul vor Ort, Pumpen laufen.",
            "created_at": ago(90),
        },
        # --- EINSATZ BEENDET (1) ---
        {
            "title": "Ölfilm auf Dorfbach",
            "type": "oelwehr",
            "priority": "medium",
            "location_address": "Bättwilerstrasse 7, 4104 Oberwil",
            "location_lat": 47.5108,
            "location_lng": 7.5548,
            "status": "einsatz_beendet",
            "description": "Heizöl aus überflutetem Tankraum in den Bach gelangt. Ölsperre gesetzt, Rückbau läuft.",
            "created_at": ago(170),
        },
        # --- ABGESCHLOSSEN (2) ---
        {
            "title": "Wasser im Keller Praxis",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Hauptstrasse 55, 4104 Oberwil",
            "location_lat": 47.5155,
            "location_lng": 7.5595,
            "status": "abschluss",
            "description": "Wenig Wasser über Lichtschacht eingedrungen. Kontrolliert, kein Einsatz der Feuerwehr nötig.",
            "created_at": ago(175),
            "completed_at": ago(40),
        },
        {
            "title": "Wasser im Keller Einliegerwohnung",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Gartenstrasse 18, 4104 Oberwil",
            "location_lat": 47.5167,
            "location_lng": 7.5624,
            "status": "abschluss",
            "description": "Keller ausgepumpt und mit Wassersauger getrocknet. Einsatz abgeschlossen.",
            "created_at": ago(180),
            "completed_at": ago(55),
        },
    ]
    for inc in storm_incidents_data:
        add_incident(**inc)

    # ============================================
    # AUFTRAG — "Sturmholz Oberwil" (ordered route of tree-clearing stops)
    # Stops are real incidents carrying group_id/group_position; the vehicle,
    # crew and Motorsäge ride on the Auftrag itself (route-level assignments),
    # shared across all stops.
    # ============================================
    auftrag = models.IncidentGroup(
        id=uuid4(),
        event_id=event.id,
        name="Sturmholz Oberwil",
        color="#10b981",
        notes="Sturmschäden nach Gewitterfront: Sturmholz räumen, Stopps in Routenreihenfolge abarbeiten.",
        position=0,
        created_by=editor_id,
    )
    db.add(auftrag)
    # Flush the Auftrag first: Incident.group_id has no ORM relationship (the
    # group's `incidents` is viewonly), so the unit of work would not order the
    # inserts and the stops' FK would fail otherwise.
    await db.flush()

    # Route stops in group_position order (first stop already done, second in
    # progress — so the Auftrag progress roll-up shows real numbers).
    stops_data = [
        {
            "title": "Baum auf Strasse",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Therwilerstrasse 25, 4104 Oberwil",
            "location_lat": 47.5098,
            "location_lng": 7.5567,
            "status": "einsatz_beendet",
            "description": "Umgestürzte Fichte blockiert beide Fahrspuren. Zersägt und an den Strassenrand geräumt.",
            "created_at": ago(125),
        },
        {
            "title": "Baum auf Stromleitung",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Rebbergstrasse 31, 4104 Oberwil",
            "location_lat": 47.5188,
            "location_lng": 7.5648,
            "status": "einsatz",
            "description": "Ast liegt auf der Niederspannungsleitung. Netzbetreiber informiert, Strasse gesperrt.",
            "created_at": ago(120),
        },
        {
            "title": "Baum droht auf Hausdach zu stürzen",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Lettenweg 4, 4104 Oberwil",
            "location_lat": 47.5122,
            "location_lng": 7.5583,
            "status": "disponiert",
            "description": "Angebrochene Birke neigt sich über das Hausdach. Sicherung und kontrollierter Abtrag mit Motorsäge nötig.",
            "created_at": ago(115),
        },
        {
            "title": "Bäume auf Waldweg",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Bättwilerstrasse (Waldrand), 4104 Oberwil",
            "location_lat": 47.5108,
            "location_lng": 7.5548,
            "status": "eingegangen",
            "description": "Mehrere Bäume über dem Waldweg. Keine Personen gefährdet, Räumung sobald Kapazität frei.",
            "created_at": ago(110),
        },
    ]
    for group_pos, stop_data in enumerate(stops_data):
        add_incident(group_id=auftrag.id, group_position=group_pos, **stop_data)

    await db.flush()

    # ============================================
    # PERSONNEL CHECK-INS (event attendance)
    # The storm brought out a large part of the roster; every person that is
    # (or was) assigned to an incident below MUST be checked in here.
    # ============================================
    checked_in_names = [
        "Müller Hans",
        "Schneider Peter",
        "Weber Martin",
        "Hoffmann Lisa",
        "Koch René",
        "Baumann Michael",
        "Keller Marco",
        "Brunner Sarah",
        "Frei Marc",
        "Suter Beat",
        "Steiner Lukas",
        "Meier Andrea",
        "Gerber Elias",
        "Kaufmann Nico",
        "Moser Lea",
        "Zimmermann Fabian",
        "Wyss Fabio",
    ]
    for i, name in enumerate(checked_in_names):
        db.add(
            models.EventAttendance(
                id=uuid4(),
                event_id=event.id,
                personnel_id=person[name].id,
                checked_in=True,
                checked_in_at=ago(165 - i * 2),
            )
        )

    # ============================================
    # ASSIGNMENTS
    # Fire + storm incidents: resources directly on the incident.
    # Auftrag: vehicle + crew + Motorsäge on the GROUP (route-owned, shared
    # across all stops). Each vehicle/person is actively assigned at most once.
    # ============================================
    def assign(incident_title: str, resource_type: str, resource, *, driver_stay: bool = False):
        # `driver_stay` = Fahrzeug und Fahrer bleiben vor Ort. Default False means "zurück",
        # which is right for a vehicle that only delivers crew or material — but wrong for a
        # TLF at a fire, which stays and supplies the water.
        return models.IncidentAssignment(
            id=uuid4(),
            incident_id=incidents[incident_title].id,
            resource_type=resource_type,
            resource_id=resource.id,
            assigned_by=editor_id,
            driver_stay=driver_stay,
        )

    assignments = [
        # Fire — TLF + three crew. The TLF STAYS: it is the water supply for the attack, so a
        # demo that showed "TLF (zurück)" at a Dachstockbrand was teaching the wrong picture.
        assign("Brand Dachstock Einfamilienhaus", "vehicle", vehicle["TLF"], driver_stay=True),
        assign("Brand Dachstock Einfamilienhaus", "personnel", person["Müller Hans"]),
        assign("Brand Dachstock Einfamilienhaus", "personnel", person["Hoffmann Lisa"]),
        assign("Brand Dachstock Einfamilienhaus", "personnel", person["Zimmermann Fabian"]),
        # In-progress Rekos — reko person on site, form still pending
        assign("Überflutete Unterführung", "personnel", person["Keller Marco"]),
        assign("Wasser in Tiefgarage", "personnel", person["Brunner Sarah"]),
        assign("Wasser im Keller Gewerbebau", "personnel", person["Frei Marc"]),
        # Disponiert — Mowa on the flooded street
        assign("Überflutete Strasse", "vehicle", vehicle["Mowa"]),
        assign("Überflutete Strasse", "personnel", person["Koch René"]),
        assign("Überflutete Strasse", "material", material[("Tauchpumpe Gr.", "MoWa")]),
        # Disponiert — a group walking from the Magazin (zu Fuss)
        assign("Wasser im Keller Reihen-EFH", "personnel", person["Meier Andrea"]),
        assign("Wasser im Keller Reihen-EFH", "material", material[("Tauchpumpe Kl.", "Magazin")]),
        # Einsatz — Trawa with the Pumpenmodul pumping out the Tiefgarage
        assign("Wasser in Tiefgarage Zentrum", "vehicle", vehicle["Trawa"]),
        assign("Wasser in Tiefgarage Zentrum", "personnel", person["Schneider Peter"]),
        assign("Wasser in Tiefgarage Zentrum", "personnel", person["Wyss Fabio"]),
        assign("Wasser in Tiefgarage Zentrum", "material", material[("Tauchpumpe Gr.", "Trawa")]),
        assign("Wasser in Tiefgarage Zentrum", "material", material[("Tauchpumpe S-Gr.", "Trawa")]),
        # Winding down — Ölwehr on the Dorfbach
        assign("Ölfilm auf Dorfbach", "vehicle", vehicle["Mawa"]),
        assign("Ölfilm auf Dorfbach", "personnel", person["Kaufmann Nico"]),
        assign("Ölfilm auf Dorfbach", "material", material[("Ölsperre", "Pio")]),
        assign("Ölfilm auf Dorfbach", "material", material[("Ölbindemittel", "Magazin")]),
    ]
    for assignment in assignments:
        db.add(assignment)

    auftrag_assignments = [
        ("vehicle", vehicle["Pio"]),
        ("personnel", person["Weber Martin"]),
        ("personnel", person["Baumann Michael"]),
        ("personnel", person["Moser Lea"]),
        ("material", material[("Motorsäge Gr.", "Pio")]),
    ]
    for resource_type, resource in auftrag_assignments:
        db.add(
            models.IncidentGroupAssignment(
                id=uuid4(),
                incident_group_id=auftrag.id,
                resource_type=resource_type,
                resource_id=resource.id,
                assigned_by=editor_id,
            )
        )

    # ============================================
    # SPECIAL FUNCTIONS
    # ============================================
    special_functions_data = [
        (person["Müller Hans"], "driver", vehicle["TLF"]),
        (person["Weber Martin"], "driver", vehicle["Pio"]),
        (person["Koch René"], "driver", vehicle["Mowa"]),
        (person["Schneider Peter"], "driver", vehicle["Trawa"]),
        (person["Kaufmann Nico"], "driver", vehicle["Mawa"]),
        (person["Steiner Lukas"], "magazin", None),
        # The Reko pool: three currently out on reconnaissance, two already
        # back with submitted reports.
        (person["Keller Marco"], "reko", None),
        (person["Brunner Sarah"], "reko", None),
        (person["Frei Marc"], "reko", None),
        (person["Suter Beat"], "reko", None),
        (person["Gerber Elias"], "reko", None),
    ]
    for p, function_type, v in special_functions_data:
        db.add(
            models.EventSpecialFunction(
                id=uuid4(),
                event_id=event.id,
                personnel_id=p.id,
                function_type=function_type,
                vehicle_id=v.id if v else None,
                assigned_by=editor_id,
            )
        )

    # ============================================
    # COMPLETED REKO REPORTS
    # Reko results for incidents that already passed reconnaissance, so the
    # Reko-Ergebnis (detail + display) and the reko dashboard show real data.
    # Each report has a matching crew record for its author: ACTIVE on
    # reko_done incidents (the board shows who did the reko), HISTORICAL
    # (already unassigned) on later stages so nobody is shown as actively
    # assigned to two emergencies at once. Done/total dashboard counts derive
    # from the completed report + the assignment row.
    # (title, author, is_relevant, dangers, power_supply, effort, summary, arrived/submitted minutes ago)
    # ============================================
    no_dangers = {
        "fire": False,
        "fire_danger": False,
        "explosion": False,
        "collapse": False,
        "chemical": False,
        "electrical": False,
        "other_notes": None,
    }
    reko_reports_data = [
        (
            "Abgedecktes Dach Scheune",
            "Suter Beat",
            True,
            {**no_dangers, "collapse": True},
            "available",
            {
                "personnel_count": 4,
                "vehicles_needed": ["Pio"],
                "equipment_needed": ["Flutlichtstrahler"],
                "estimated_duration_hours": 2.5,
            },
            "Mehrere Ziegelreihen abgedeckt, Unterdach beschädigt. Absturzgefahr, Notabdeckung mit Blachen nötig.",
            95,
            78,
        ),
        (
            "Wasser im Keller Doppelhaus",
            "Gerber Elias",
            True,
            {**no_dangers, "electrical": True},
            "emergency_needed",
            {
                "personnel_count": 3,
                "vehicles_needed": ["Trawa"],
                "equipment_needed": ["Tauchpumpe Kl.", "Wassersauger"],
                "estimated_duration_hours": 1.5,
            },
            "Ca. 25 cm Wasser im Keller, Elektroverteilung betroffen, Strom abgestellt. Auspumpen mit Tauchpumpe nötig.",
            90,
            72,
        ),
        (
            "Ölfilm auf Dorfbach",
            "Suter Beat",
            True,
            {**no_dangers, "chemical": True},
            "available",
            {
                "personnel_count": 3,
                "vehicles_needed": ["Mawa"],
                "equipment_needed": ["Ölsperre", "Ölbindemittel"],
                "estimated_duration_hours": 1.5,
            },
            "Heizöl aus überflutetem Tankraum in den Bach gelangt. Ölsperre und Bindemittel erforderlich.",
            158,
            145,
        ),
        (
            "Wasser im Keller Praxis",
            "Gerber Elias",
            False,
            dict(no_dangers),
            "available",
            {"personnel_count": 2, "vehicles_needed": [], "equipment_needed": [], "estimated_duration_hours": 0.5},
            "Nur wenig Wasser über den Lichtschacht eingedrungen, kein Einsatz der Feuerwehr nötig. Bewohner instruiert.",
            168,
            160,
        ),
    ]
    for i, (title, author, is_relevant, dangers, power, effort, summary, arrived_min, submitted_min) in enumerate(
        reko_reports_data
    ):
        author_p = person[author]
        db.add(
            models.RekoReport(
                id=uuid4(),
                incident_id=incidents[title].id,
                token=f"demo-reko-{i}",
                arrived_at=ago(arrived_min),
                submitted_at=ago(submitted_min),
                is_relevant=is_relevant,
                dangers_json=dangers,
                effort_json=effort,
                power_supply=power,
                summary_text=summary,
                submitted_by_personnel_id=author_p.id,
                is_draft=False,
            )
        )
        status = incidents[title].status
        db.add(
            models.IncidentAssignment(
                id=uuid4(),
                incident_id=incidents[title].id,
                resource_type="personnel",
                resource_id=author_p.id,
                assigned_by=editor_id,
                unassigned_at=None if status == "reko_done" else ago(submitted_min - 2),
            )
        )

    # ============================================
    # STATUS TRANSITIONS (selective trails for the Einsatztagebuch)
    # ============================================
    def transition(incident_title: str, from_status: str, to_status: str, minutes_ago: int, notes: str | None = None):
        return models.StatusTransition(
            id=uuid4(),
            incident_id=incidents[incident_title].id,
            from_status=from_status,
            to_status=to_status,
            timestamp=ago(minutes_ago),
            user_id=editor_id,
            notes=notes,
        )

    transitions = [
        # Fire — eingegangen → disponiert → einsatz
        transition("Brand Dachstock Einfamilienhaus", "eingegangen", "disponiert", 45, "TLF disponiert"),
        transition("Brand Dachstock Einfamilienhaus", "disponiert", "einsatz", 38, "Vor Ort, Löschangriff läuft"),
        # Auftrag stop 1 — full trail to einsatz_beendet
        transition("Baum auf Strasse", "eingegangen", "disponiert", 110, "Erster Stopp der Sturmholz-Route"),
        transition("Baum auf Strasse", "disponiert", "einsatz", 95, "Vor Ort, Räumung läuft"),
        transition("Baum auf Strasse", "einsatz", "einsatz_beendet", 70, "Fahrbahn frei, weiter zum nächsten Stopp"),
        # Auftrag stop 2 — in progress
        transition("Baum auf Stromleitung", "eingegangen", "disponiert", 65, "Zweiter Stopp der Route"),
        transition("Baum auf Stromleitung", "disponiert", "einsatz", 40, "Vor Ort, Netzbetreiber informiert"),
        # Auftrag stop 3 — dispatched
        transition("Baum droht auf Hausdach zu stürzen", "eingegangen", "disponiert", 30, "Dritter Stopp der Route"),
        # In-progress Rekos
        transition("Überflutete Unterführung", "eingegangen", "reko", 40, "Reko aufgeboten"),
        transition("Wasser in Tiefgarage", "eingegangen", "reko", 33, "Reko aufgeboten"),
        transition("Wasser im Keller Gewerbebau", "eingegangen", "reko", 27, "Reko aufgeboten"),
        # Completed Rekos
        transition("Abgedecktes Dach Scheune", "eingegangen", "reko", 98, "Reko aufgeboten"),
        transition("Abgedecktes Dach Scheune", "reko", "reko_done", 76, "Reko abgeschlossen, Bericht liegt vor"),
        transition("Wasser im Keller Doppelhaus", "eingegangen", "reko", 93, "Reko aufgeboten"),
        transition("Wasser im Keller Doppelhaus", "reko", "reko_done", 70, "Reko abgeschlossen"),
        # Disponiert
        transition("Überflutete Strasse", "eingegangen", "disponiert", 20, "Mowa disponiert"),
        transition("Wasser im Keller Reihen-EFH", "eingegangen", "disponiert", 15, "Gruppe zu Fuss unterwegs"),
        # Einsatz — Tiefgarage Zentrum
        transition("Wasser in Tiefgarage Zentrum", "eingegangen", "disponiert", 82, "Trawa mit Pumpenmodul disponiert"),
        transition("Wasser in Tiefgarage Zentrum", "disponiert", "einsatz", 68, "Vor Ort, Pumpen laufen"),
        # Ölwehr Dorfbach — reko trail, then worked and finished
        transition("Ölfilm auf Dorfbach", "eingegangen", "reko", 160, "Reko aufgeboten"),
        transition("Ölfilm auf Dorfbach", "reko", "reko_done", 143, "Reko abgeschlossen"),
        transition("Ölfilm auf Dorfbach", "disponiert", "einsatz", 120, "Mawa vor Ort, Ölsperre gesetzt"),
        transition("Ölfilm auf Dorfbach", "einsatz", "einsatz_beendet", 45, "Rückbau läuft"),
        # Closed out
        transition("Wasser im Keller Praxis", "eingegangen", "reko", 170, "Reko aufgeboten"),
        transition("Wasser im Keller Praxis", "reko", "reko_done", 159, "Reko abgeschlossen"),
        transition("Wasser im Keller Praxis", "reko_done", "abschluss", 40, "Kein Einsatz nötig, abgeschlossen"),
        transition(
            "Wasser im Keller Einliegerwohnung", "einsatz", "abschluss", 55, "Keller ausgepumpt, Einsatz abgeschlossen"
        ),
    ]
    for t in transitions:
        db.add(t)

    await db.flush()


async def seed_demo_database() -> None:
    """Seed the database with demo data for public demo deployment."""
    # Training controls depend on these global template/location pools. Keep
    # this outside the "already seeded" guard so existing demo deployments are
    # repaired on startup as well as after a full demo reset.
    await seed_training_data(skip_geocoding=True)

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
