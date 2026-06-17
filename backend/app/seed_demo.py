"""Demo database seed script.

Creates realistic demo data for the public demo deployment.
Called by seed.py when DEMO_MODE=true.

seed_demo_event_content() is shared between the full seed/reset and the
per-session sandbox endpoint (POST /api/demo/sandbox): it fills an existing
event with the demo scenario, looking up the shared resources by name.
"""

from datetime import datetime, timedelta
from uuid import uuid4

import bcrypt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .database import async_session_maker


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
        {"name": "Müller Hans", "role": "Offiziere", "availability": "available", "tags": ["F"]},
        {"name": "Schneider Peter", "role": "Offiziere", "availability": "available", "tags": ["F", "Hö"]},
        {"name": "Weber Martin", "role": "Offiziere", "availability": "available", "tags": ["F", "Fw"]},
        {"name": "Fischer Thomas", "role": "Offiziere", "availability": "available", "tags": []},
        # Wachtmeister
        {"name": "Hoffmann Lisa", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Schmidt Daniel", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Koch René", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Baumann Michael", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Fw"]},
        {"name": "Keller Marco", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Brunner Sarah", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Hö"]},
        # Korporal
        {"name": "Steiner Lukas", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Meier Andrea", "role": "Korporal", "availability": "available", "tags": ["F"]},
        {"name": "Graf Sven", "role": "Korporal", "availability": "available", "tags": ["Hö"]},
        {"name": "Roth Til", "role": "Korporal", "availability": "available", "tags": []},
        # Mannschaft
        {"name": "Zimmermann Fabian", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Wyss Fabio", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Künzli Klara", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Studer Samuel", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Schwarz Jan", "role": "Mannschaft", "availability": "available", "tags": ["Fw"]},
        {"name": "Hartmann Mischa", "role": "Mannschaft", "availability": "available", "tags": []},
    ]
    for p in personnel_data:
        db.add(models.Personnel(id=uuid4(), **p))

    materials_data = [
        # Tauchpumpen
        {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "TLF", "status": "available"},
        {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "TLF", "status": "available"},
        {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "Pio", "status": "available"},
        {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "Pio", "status": "available"},
        {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
        {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
        {"name": "Tauchpumpe S-Gr.", "type": "Tauchpumpen", "location": "Modul", "status": "available"},
        # Wassersauger
        {"name": "Wassersauger", "type": "Wassersauger", "location": "Pio", "status": "available"},
        {"name": "Wassersauger", "type": "Wassersauger", "location": "MoWa", "status": "available"},
        {"name": "Wassersauger", "type": "Wassersauger", "location": "Bühne", "status": "available"},
        # Generatoren
        {"name": "Generator", "type": "Generatoren", "location": "TLF", "status": "available"},
        {"name": "Generator", "type": "Generatoren", "location": "MoWa", "status": "available"},
        # Sägen
        {"name": "Motorsäge Gr.", "type": "Sägen", "location": "Pio", "status": "available"},
        {"name": "Motorsäge Kl.", "type": "Sägen", "location": "Pio", "status": "available"},
        # Spannungsprüfer
        {"name": "Spannungsprüfer", "type": "Elektrowerkzeug", "location": "MoWa", "status": "available"},
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
    # INCIDENTS (~12, all statuses, Oberwil BL flood scenario)
    # ============================================
    incidents_data = [
        # --- eingegangen (3) ---
        {
            "title": "Wasserschaden Keller",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Mühlegasse 12, 4104 Oberwil",
            "location_lat": 47.5148,
            "location_lng": 7.6125,
            "status": "eingegangen",
            "description": "Wasser im Keller nach Starkregen. Bewohner melden ca. 20cm Wasser.",
        },
        {
            "title": "Wassereintritt Schulhaus",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Schulgasse 10, 4104 Oberwil",
            "location_lat": 47.5170,
            "location_lng": 7.6135,
            "status": "eingegangen",
            "description": "Wasser dringt durch Lichtschächte ins Untergeschoss des Schulhauses ein. Hauswart vor Ort.",
        },
        {
            "title": "Verstopfter Bachdurchlass",
            "type": "elementarereignis",
            "priority": "low",
            "location_address": "Marbachweg 3, 4104 Oberwil",
            "location_lat": 47.5105,
            "location_lng": 7.6090,
            "status": "eingegangen",
            "description": "Durchlass am Marbach mit Geschwemmsel verstopft, Wasser staut sich Richtung Wohnquartier.",
        },
        # --- reko (2) ---
        {
            "title": "Überflutung Tiefgarage",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Hauptstrasse 95, 4104 Oberwil",
            "location_lat": 47.5162,
            "location_lng": 7.6152,
            "status": "reko",
            "description": "Tiefgarage steht unter Wasser nach Starkregen. Ca. 50cm Wasserhöhe. 12 Fahrzeuge betroffen.",
        },
        {
            "title": "Hangrutsch droht",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Bielstrasse 18, 4104 Oberwil",
            "location_lat": 47.5200,
            "location_lng": 7.6075,
            "status": "reko",
            "description": "Durchnässter Hang oberhalb der Liegenschaft in Bewegung. Anwohner besorgt, Abklärung nötig.",
        },
        # --- reko_done (1) ---
        {
            "title": "Unterführung überflutet",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Bahnhofstrasse 4, 4104 Oberwil",
            "location_lat": 47.5143,
            "location_lng": 7.6189,
            "status": "reko_done",
            "description": "Fussgängerunterführung beim Bahnhof unter Wasser. Reko abgeschlossen: Pumpeneinsatz nötig.",
        },
        # --- disponiert (2) ---
        {
            "title": "Keller auspumpen Gewerbebetrieb",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Bottmingerstrasse 40, 4104 Oberwil",
            "location_lat": 47.5175,
            "location_lng": 7.6098,
            "status": "disponiert",
            "description": "Grundwasser im Keller eines Lagergebäudes. Ca. 40cm Wasser. Waren und Maschinen gefährdet.",
        },
        {
            "title": "Wasser in Arztpraxis",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Konsumstrasse 9, 4104 Oberwil",
            "location_lat": 47.5158,
            "location_lng": 7.6118,
            "status": "disponiert",
            "description": "Wassereintritt in Praxisräume im Hochparterre. Medizinische Geräte gefährdet.",
        },
        # --- einsatz (2) ---
        {
            "title": "Wasser im Keller EFH",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Langegasse 28, 4104 Oberwil",
            "location_lat": 47.5139,
            "location_lng": 7.6167,
            "status": "einsatz",
            "description": "Keller unter Wasser, ca. 30cm. Heizung und Elektroinstallation betroffen. Bewohner vor Ort.",
        },
        {
            "title": "Pumpeneinsatz Mehrfamilienhaus",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Therwilerstrasse 25, 4104 Oberwil",
            "location_lat": 47.5132,
            "location_lng": 7.6103,
            "status": "einsatz",
            "description": "Waschküche und Keller von MFH überflutet. Zwei Pumpen im Einsatz, Wasserstand sinkt.",
        },
        # --- einsatz_beendet (1) ---
        {
            "title": "Baum auf Strasse",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Allschwilerstrasse 61, 4104 Oberwil",
            "location_lat": 47.5188,
            "location_lng": 7.6112,
            "status": "einsatz_beendet",
            "description": "Umgestürzter Baum blockiert Fahrbahn. Keine Personen verletzt. Verkehr wird umgeleitet.",
            "completed_at": now - timedelta(minutes=45),
        },
        # --- abschluss (1) ---
        {
            "title": "Ölspur Industriegebiet",
            "type": "oelwehr",
            "priority": "low",
            "location_address": "Im Käppeli 5, 4104 Oberwil",
            "location_lat": 47.5121,
            "location_lng": 7.6183,
            "status": "abschluss",
            "description": "Ölspur ca. 80m auf Fahrbahn. Bindemittel aufgebracht. Strasse gereinigt.",
            "completed_at": now - timedelta(minutes=90),
        },
    ]

    incidents: dict[str, models.Incident] = {}
    for inc in incidents_data:
        incident = models.Incident(id=uuid4(), created_by=editor_id, event_id=event.id, **inc)
        db.add(incident)
        incidents[incident.title] = incident

    await db.flush()

    # ============================================
    # INCIDENT ASSIGNMENTS
    # ============================================
    def assign(incident_title: str, resource_type: str, resource, unassigned_at: datetime | None = None):
        return models.IncidentAssignment(
            id=uuid4(),
            incident_id=incidents[incident_title].id,
            resource_type=resource_type,
            resource_id=resource.id,
            assigned_by=editor_id,
            unassigned_at=unassigned_at,
        )

    completed_at = now - timedelta(minutes=45)
    assignments = [
        # Disponiert: vehicles on the way
        assign("Keller auspumpen Gewerbebetrieb", "vehicle", vehicle["Pio"]),
        assign("Wasser in Arztpraxis", "vehicle", vehicle["Trawa"]),
        # Einsatz: full crews on site
        assign("Wasser im Keller EFH", "vehicle", vehicle["TLF"]),
        assign("Wasser im Keller EFH", "personnel", person["Müller Hans"]),
        assign("Wasser im Keller EFH", "personnel", person["Hoffmann Lisa"]),
        assign("Wasser im Keller EFH", "personnel", person["Zimmermann Fabian"]),
        assign("Wasser im Keller EFH", "material", material[("Tauchpumpe Gr.", "TLF")]),
        assign("Wasser im Keller EFH", "material", material[("Tauchpumpe Kl.", "TLF")]),
        assign("Pumpeneinsatz Mehrfamilienhaus", "vehicle", vehicle["Mawa"]),
        assign("Pumpeneinsatz Mehrfamilienhaus", "personnel", person["Koch René"]),
        assign("Pumpeneinsatz Mehrfamilienhaus", "personnel", person["Wyss Fabio"]),
        assign("Pumpeneinsatz Mehrfamilienhaus", "material", material[("Tauchpumpe Gr.", "Pio")]),
        assign("Pumpeneinsatz Mehrfamilienhaus", "material", material[("Wassersauger", "Pio")]),
        # Einsatz beendet: had resources, now unassigned
        assign("Baum auf Strasse", "vehicle", vehicle["Mowa"], unassigned_at=completed_at),
        assign("Baum auf Strasse", "personnel", person["Schmidt Daniel"], unassigned_at=completed_at),
        assign("Baum auf Strasse", "material", material[("Motorsäge Gr.", "Pio")], unassigned_at=completed_at),
    ]
    for assignment in assignments:
        db.add(assignment)

    # ============================================
    # SPECIAL FUNCTIONS
    # ============================================
    special_functions_data = [
        (person["Müller Hans"], "driver", vehicle["TLF"]),
        (person["Weber Martin"], "driver", vehicle["Pio"]),
        (person["Hoffmann Lisa"], "driver", vehicle["Mowa"]),
        (person["Fischer Thomas"], "reko", None),
        (person["Steiner Lukas"], "magazin", None),
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
        # Unterführung (reko_done)
        transition("Unterführung überflutet", "eingegangen", "reko", "Reko-Trupp aufgeboten"),
        transition("Unterführung überflutet", "reko", "reko_done", "Pumpeneinsatz nötig, kein Personenrisiko"),
        # Pumpeneinsatz MFH (einsatz)
        transition("Pumpeneinsatz Mehrfamilienhaus", "eingegangen", "disponiert", "Mawa disponiert"),
        transition("Pumpeneinsatz Mehrfamilienhaus", "disponiert", "einsatz", "Vor Ort, Pumpen laufen"),
        # Baum auf Strasse (einsatz_beendet)
        transition("Baum auf Strasse", "eingegangen", "disponiert", "Mowa disponiert"),
        transition("Baum auf Strasse", "disponiert", "einsatz", "Vor Ort eingetroffen"),
        transition("Baum auf Strasse", "einsatz", "einsatz_beendet", "Baum beseitigt, Strasse frei"),
        # Ölspur (abschluss)
        transition("Ölspur Industriegebiet", "eingegangen", "disponiert"),
        transition("Ölspur Industriegebiet", "disponiert", "einsatz"),
        transition("Ölspur Industriegebiet", "einsatz", "einsatz_beendet", "Ölspur beseitigt"),
        transition("Ölspur Industriegebiet", "einsatz_beendet", "abschluss", "Rapport erstellt"),
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
                id=uuid4(),
                username="demo-editor",
                password_hash=editor_hash,
                role="editor",
                display_name="Demo Bearbeiter",
                is_active=True,
            )
            db.add(editor_user)

            viewer_user = models.User(
                id=uuid4(),
                username="demo-viewer",
                password_hash=viewer_hash,
                role="editor",
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
                ("firestation_latitude", "47.5154"),
                ("firestation_longitude", "7.6140"),
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
            # 3. EVENT
            # ============================================
            print("Creating demo event...")

            event = models.Event(
                id=uuid4(),
                name="Hochwasser Oberwil",
                training_flag=False,
            )
            db.add(event)
            await db.flush()

            # ============================================
            # 4-6. SHARED RESOURCES (vehicles, personnel, materials)
            # ============================================
            print("Creating shared resources...")
            await seed_demo_shared_resources(db)

            # ============================================
            # 7. EVENT CONTENT (incidents, assignments, ...)
            # ============================================
            print("Creating demo incidents...")
            await seed_demo_event_content(db, event)

            # ============================================
            # COMMIT
            # ============================================
            await db.commit()

            print("\n✅ Demo database seeded successfully!")
            print("  Demo users:")
            print("    - demo-editor / demo123 (editor)")
            print("    - demo-viewer / demo123 (viewer)")
            print(f"  - 1 event: {event.name}")
            print("  - 12 incidents across all statuses")

        except Exception as e:
            print(f"❌ Error seeding demo database: {e}")
            await db.rollback()
            raise
