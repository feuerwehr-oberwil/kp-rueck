"""Demo database seed script.

Creates realistic demo data for the public demo deployment.
Called by seed.py when DEMO_MODE=true.
"""

from datetime import datetime, timedelta
from uuid import uuid4

import bcrypt
from sqlalchemy import delete, select

from . import models
from .database import async_session_maker


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
            # 4. VEHICLES
            # ============================================
            print("Creating vehicles...")

            vehicles_data = [
                {"name": "TLF", "type": "TLF", "display_order": 1, "status": "available", "radio_call_sign": "Omega 1"},
                {"name": "Pio", "type": "RW", "display_order": 2, "status": "available", "radio_call_sign": "Omega 2"},
                {
                    "name": "Mowa",
                    "type": "MTW",
                    "display_order": 3,
                    "status": "available",
                    "radio_call_sign": "Omega 3",
                },
                {
                    "name": "Trawa",
                    "type": "MTW",
                    "display_order": 4,
                    "status": "available",
                    "radio_call_sign": "Omega 4",
                },
                {
                    "name": "Mawa",
                    "type": "MTW",
                    "display_order": 5,
                    "status": "available",
                    "radio_call_sign": "Omega 5",
                },
            ]

            vehicles = []
            for v in vehicles_data:
                vehicle = models.Vehicle(id=uuid4(), **v)
                db.add(vehicle)
                vehicles.append(vehicle)

            # ============================================
            # 5. PERSONNEL
            # ============================================
            print("Creating personnel...")

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

            personnel = []
            for p in personnel_data:
                person = models.Personnel(id=uuid4(), **p)
                db.add(person)
                personnel.append(person)

            # ============================================
            # 6. MATERIALS
            # ============================================
            print("Creating materials...")

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

            materials = []
            for m in materials_data:
                material = models.Material(id=uuid4(), **m)
                db.add(material)
                materials.append(material)

            # ============================================
            # 7. INCIDENTS
            # ============================================
            print("Creating demo incidents...")
            now = datetime.now()

            incidents_data = [
                {
                    "title": "Wasserschaden Keller",
                    "type": "elementarereignis",
                    "priority": "medium",
                    "location_address": "Mühlegasse 12, 4104 Oberwil",
                    "location_lat": 47.5148,
                    "location_lng": 7.6125,
                    "status": "eingegangen",
                    "description": "Wasser im Keller nach Starkregen. Bewohner melden ca. 20cm Wasser.",
                    "created_by": editor_user.id,
                    "event_id": event.id,
                },
                {
                    "title": "Überflutung Tiefgarage",
                    "type": "elementarereignis",
                    "priority": "high",
                    "location_address": "Hauptstrasse 95, 4104 Oberwil",
                    "location_lat": 47.5162,
                    "location_lng": 7.6152,
                    "status": "reko",
                    "description": "Tiefgarage steht unter Wasser nach Starkregen. Ca. 50cm Wasserhöhe. 12 Fahrzeuge betroffen.",
                    "created_by": editor_user.id,
                    "event_id": event.id,
                },
                {
                    "title": "Keller auspumpen Gewerbebetrieb",
                    "type": "elementarereignis",
                    "priority": "high",
                    "location_address": "Bottmingerstrasse 40, 4104 Oberwil",
                    "location_lat": 47.5175,
                    "location_lng": 7.6098,
                    "status": "disponiert",
                    "description": "Grundwasser im Keller eines Lagergebäudes. Ca. 40cm Wasser. Waren und Maschinen gefährdet.",
                    "created_by": editor_user.id,
                    "event_id": event.id,
                },
                {
                    "title": "Wasser im Keller EFH",
                    "type": "elementarereignis",
                    "priority": "medium",
                    "location_address": "Langegasse 28, 4104 Oberwil",
                    "location_lat": 47.5139,
                    "location_lng": 7.6167,
                    "status": "einsatz",
                    "description": "Keller unter Wasser, ca. 30cm. Heizung und Elektroinstallation betroffen. Bewohner vor Ort.",
                    "created_by": editor_user.id,
                    "event_id": event.id,
                },
                {
                    "title": "Baum auf Strasse",
                    "type": "elementarereignis",
                    "priority": "medium",
                    "location_address": "Allschwilerstrasse 61, 4104 Oberwil",
                    "location_lat": 47.5188,
                    "location_lng": 7.6112,
                    "status": "einsatz_beendet",
                    "description": "Umgestürzter Baum blockiert Fahrbahn. Keine Personen verletzt. Verkehr wird umgeleitet.",
                    "created_by": editor_user.id,
                    "completed_at": now - timedelta(minutes=45),
                    "event_id": event.id,
                },
                {
                    "title": "Ölspur Industriegebiet",
                    "type": "oelwehr",
                    "priority": "low",
                    "location_address": "Im Käppeli 5, 4104 Oberwil",
                    "location_lat": 47.5121,
                    "location_lng": 7.6183,
                    "status": "abschluss",
                    "description": "Ölspur ca. 80m auf Fahrbahn. Bindemittel aufgebracht. Strasse gereinigt.",
                    "created_by": editor_user.id,
                    "completed_at": now - timedelta(minutes=90),
                    "event_id": event.id,
                },
            ]

            incidents = []
            for inc in incidents_data:
                incident = models.Incident(id=uuid4(), **inc)
                db.add(incident)
                incidents.append(incident)

            await db.flush()

            # ============================================
            # 8. INCIDENT ASSIGNMENTS
            # ============================================
            print("Creating incident assignments...")

            # Incident 3 (disponiert) - vehicle assigned
            assignments = [
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[2].id,
                    resource_type="vehicle",
                    resource_id=vehicles[1].id,  # Pio
                    assigned_by=editor_user.id,
                ),
            ]

            # Incident 4 (einsatz) - full crew assigned
            assignments.extend(
                [
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[3].id,
                        resource_type="vehicle",
                        resource_id=vehicles[0].id,  # TLF
                        assigned_by=editor_user.id,
                    ),
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[3].id,
                        resource_type="personnel",
                        resource_id=personnel[0].id,  # Müller Hans
                        assigned_by=editor_user.id,
                    ),
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[3].id,
                        resource_type="personnel",
                        resource_id=personnel[4].id,  # Hoffmann Lisa
                        assigned_by=editor_user.id,
                    ),
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[3].id,
                        resource_type="personnel",
                        resource_id=personnel[14].id,  # Zimmermann Fabian
                        assigned_by=editor_user.id,
                    ),
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[3].id,
                        resource_type="material",
                        resource_id=materials[0].id,  # Tauchpumpe Gr. TLF
                        assigned_by=editor_user.id,
                    ),
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[3].id,
                        resource_type="material",
                        resource_id=materials[1].id,  # Tauchpumpe Kl. TLF
                        assigned_by=editor_user.id,
                    ),
                ]
            )

            # Incident 5 (einsatz_beendet) - had vehicle+personnel
            assignments.extend(
                [
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[4].id,
                        resource_type="vehicle",
                        resource_id=vehicles[2].id,  # Mowa
                        assigned_by=editor_user.id,
                    ),
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[4].id,
                        resource_type="personnel",
                        resource_id=personnel[5].id,  # Schmidt Daniel
                        assigned_by=editor_user.id,
                    ),
                    models.IncidentAssignment(
                        id=uuid4(),
                        incident_id=incidents[4].id,
                        resource_type="material",
                        resource_id=materials[12].id,  # Motorsäge Gr.
                        assigned_by=editor_user.id,
                    ),
                ]
            )

            for assignment in assignments:
                db.add(assignment)

            # ============================================
            # 9. SPECIAL FUNCTIONS
            # ============================================
            print("Creating special function assignments...")

            special_functions = [
                models.EventSpecialFunction(
                    id=uuid4(),
                    event_id=event.id,
                    personnel_id=personnel[0].id,  # Müller Hans - driver TLF
                    function_type="driver",
                    vehicle_id=vehicles[0].id,
                    assigned_by=editor_user.id,
                ),
                models.EventSpecialFunction(
                    id=uuid4(),
                    event_id=event.id,
                    personnel_id=personnel[2].id,  # Weber Martin - driver Pio
                    function_type="driver",
                    vehicle_id=vehicles[1].id,
                    assigned_by=editor_user.id,
                ),
                models.EventSpecialFunction(
                    id=uuid4(),
                    event_id=event.id,
                    personnel_id=personnel[4].id,  # Hoffmann Lisa - driver Mowa
                    function_type="driver",
                    vehicle_id=vehicles[2].id,
                    assigned_by=editor_user.id,
                ),
                models.EventSpecialFunction(
                    id=uuid4(),
                    event_id=event.id,
                    personnel_id=personnel[3].id,  # Fischer Thomas - reko
                    function_type="reko",
                    vehicle_id=None,
                    assigned_by=editor_user.id,
                ),
                models.EventSpecialFunction(
                    id=uuid4(),
                    event_id=event.id,
                    personnel_id=personnel[10].id,  # Steiner Lukas - magazin
                    function_type="magazin",
                    vehicle_id=None,
                    assigned_by=editor_user.id,
                ),
            ]

            for sf in special_functions:
                db.add(sf)

            # ============================================
            # 10. STATUS TRANSITIONS
            # ============================================
            print("Creating status transitions...")

            transitions = [
                # Baum auf Strasse (einsatz_beendet) transitions
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[4].id,
                    from_status="eingegangen",
                    to_status="disponiert",
                    user_id=editor_user.id,
                    notes="Mowa disponiert",
                ),
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[4].id,
                    from_status="disponiert",
                    to_status="einsatz",
                    user_id=editor_user.id,
                    notes="Vor Ort eingetroffen",
                ),
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[4].id,
                    from_status="einsatz",
                    to_status="einsatz_beendet",
                    user_id=editor_user.id,
                    notes="Baum beseitigt, Strasse frei",
                ),
                # Ölspur (abschluss) transitions
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[5].id,
                    from_status="eingegangen",
                    to_status="disponiert",
                    user_id=editor_user.id,
                ),
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[5].id,
                    from_status="disponiert",
                    to_status="einsatz",
                    user_id=editor_user.id,
                ),
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[5].id,
                    from_status="einsatz",
                    to_status="einsatz_beendet",
                    user_id=editor_user.id,
                    notes="Ölspur beseitigt",
                ),
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[5].id,
                    from_status="einsatz_beendet",
                    to_status="abschluss",
                    user_id=editor_user.id,
                    notes="Rapport erstellt",
                ),
            ]

            for t in transitions:
                db.add(t)

            # ============================================
            # COMMIT
            # ============================================
            await db.commit()

            print("\n✅ Demo database seeded successfully!")
            print("  Demo users:")
            print("    - demo-editor / demo123 (editor)")
            print("    - demo-viewer / demo123 (viewer)")
            print(f"  - {len(vehicles)} vehicles")
            print(f"  - {len(personnel)} personnel")
            print(f"  - {len(materials)} materials")
            print(f"  - 1 event: {event.name}")
            print(f"  - {len(incidents)} incidents across all statuses")
            print(f"  - {len(assignments)} resource assignments")
            print(f"  - {len(special_functions)} special function assignments")
            print(f"  - {len(transitions)} status transitions")

        except Exception as e:
            print(f"❌ Error seeding demo database: {e}")
            await db.rollback()
            raise
