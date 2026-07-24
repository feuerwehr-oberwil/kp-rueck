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
        {"name": "Triopan / Absperrband", "type": "Verbrauchsmaterial", "location": "Magazin", "status": "available", "consumable": True},
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

    The scenario is deliberately small but shows both core features:
    - ONE active, fully-staffed fire Einsatz (Brandbekämpfung, Oberwil)
    - ONE fully-equipped Auftrag ("Sturmholz Oberwil"): an ordered route of
      four tree-clearing stops after a storm front, with vehicle + crew +
      Motorsäge assigned at the route (group) level

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

    # ============================================
    # EINSATZ — the one active fire (fully staffed)
    # ============================================
    fire = models.Incident(
        id=uuid4(),
        created_by=editor_id,
        event_id=event.id,
        position=0,
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
    )
    db.add(fire)

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
            "priority": "medium",
            "location_address": "Therwilerstrasse 25, 4104 Oberwil",
            "location_lat": 47.5098,
            "location_lng": 7.5567,
            "status": "einsatz_beendet",
            "description": "Umgestürzte Fichte blockiert beide Fahrspuren. Zersägt und an den Strassenrand geräumt.",
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
        },
    ]

    # Position orders cards within each status column (0-based per column);
    # the fire already occupies einsatz/0.
    position_by_status: dict[str, int] = {"einsatz": 1}
    stops: dict[str, models.Incident] = {}
    for group_pos, stop_data in enumerate(stops_data):
        pos = position_by_status.get(stop_data["status"], 0)
        position_by_status[stop_data["status"]] = pos + 1
        stop = models.Incident(
            id=uuid4(),
            created_by=editor_id,
            event_id=event.id,
            position=pos,
            group_id=auftrag.id,
            group_position=group_pos,
            **stop_data,
        )
        db.add(stop)
        stops[stop.title] = stop

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
        "Baumann Michael",
        "Steiner Lukas",
        "Moser Lea",
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
    # ASSIGNMENTS
    # Fire: TLF + crew directly on the incident. Auftrag: vehicle + crew +
    # Motorsäge on the GROUP (route-owned, shared across all stops).
    # ============================================
    fire_assignments = [
        ("vehicle", vehicle["TLF"]),
        ("personnel", person["Müller Hans"]),
        ("personnel", person["Hoffmann Lisa"]),
        ("personnel", person["Zimmermann Fabian"]),
    ]
    for resource_type, resource in fire_assignments:
        db.add(
            models.IncidentAssignment(
                id=uuid4(),
                incident_id=fire.id,
                resource_type=resource_type,
                resource_id=resource.id,
                assigned_by=editor_id,
            )
        )

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
        (person["Schmidt Daniel"], "reko", None),
        (person["Steiner Lukas"], "magazin", None),
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
    # STATUS TRANSITIONS
    # ============================================
    def transition(incident: models.Incident, from_status: str, to_status: str, notes: str | None = None):
        return models.StatusTransition(
            id=uuid4(),
            incident_id=incident.id,
            from_status=from_status,
            to_status=to_status,
            user_id=editor_id,
            notes=notes,
        )

    transitions = [
        # Fire — eingegangen → disponiert → einsatz
        transition(fire, "eingegangen", "disponiert", "TLF disponiert"),
        transition(fire, "disponiert", "einsatz", "Vor Ort, Löschangriff läuft"),
        # Auftrag stop 1 — full trail to einsatz_beendet
        transition(stops["Baum auf Strasse"], "eingegangen", "disponiert", "Erster Stopp der Sturmholz-Route"),
        transition(stops["Baum auf Strasse"], "disponiert", "einsatz", "Vor Ort, Räumung läuft"),
        transition(stops["Baum auf Strasse"], "einsatz", "einsatz_beendet", "Fahrbahn frei, weiter zum nächsten Stopp"),
        # Auftrag stop 2 — in progress
        transition(stops["Baum auf Stromleitung"], "eingegangen", "disponiert", "Zweiter Stopp der Route"),
        transition(stops["Baum auf Stromleitung"], "disponiert", "einsatz", "Vor Ort, Netzbetreiber informiert"),
        # Auftrag stop 3 — dispatched
        transition(stops["Baum droht auf Hausdach zu stürzen"], "eingegangen", "disponiert", "Dritter Stopp der Route"),
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
