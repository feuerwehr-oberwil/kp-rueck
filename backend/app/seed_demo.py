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
    # INCIDENT (single active Einsatz, Oberwil BL)
    # ============================================
    incidents_data = [
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
    ]

    incidents: dict[str, models.Incident] = {}
    for inc in incidents_data:
        incident = models.Incident(id=uuid4(), created_by=editor_id, event_id=event.id, **inc)
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
            print("  - 1 incident (active Einsatz)")
            print("  - 10 personnel checked in")

        except Exception as e:
            print(f"❌ Error seeding demo database: {e}")
            await db.rollback()
            raise
