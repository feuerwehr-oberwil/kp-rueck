"""Database seed script.

Run with: uv run python -m app.seed
"""
import asyncio
from datetime import datetime, timedelta
from uuid import uuid4

import bcrypt
from sqlalchemy import select

from . import models
from .database import async_session_maker


async def seed_database() -> None:
    """Seed the database with initial data."""
    async with async_session_maker() as db:
        try:
            # Check if data already exists
            result = await db.execute(select(models.User))
            if result.scalars().first():
                print("Database already seeded. Skipping...")
                return

            print("Seeding database...")

            # ============================================
            # 1. SEED DEFAULT USERS
            # ============================================
            print("Creating default users...")

            # Create dev-bypass user (required for auth bypass mode)
            import uuid
            dev_user = models.User(
                id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
                username="dev-user",
                password_hash="",  # Not used in bypass mode
                role="editor",
            )
            db.add(dev_user)

            # Create admin user
            password = "changeme123"  # CHANGE IN PRODUCTION
            password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

            admin_user = models.User(
                id=uuid4(),
                username="admin",
                password_hash=password_hash,
                role="editor",
            )
            db.add(admin_user)
            await db.flush()  # Get the ID for foreign key references

            # ============================================
            # 2. SEED DEFAULT SETTINGS
            # ============================================
            print("Creating default settings...")
            default_settings_data = [
                ("polling_interval_ms", "5000"),
                ("training_mode", "false"),
                ("auto_archive_timeout_hours", "24"),
                ("notification_enabled", "false"),
                ("alarm_webhook_secret", "CHANGE_ME_IN_PRODUCTION"),
                ("firestation_name", "Demo Fire Department"),
                ("firestation_latitude", "47.51637699933488"),
                ("firestation_longitude", "7.561800450458299"),
                ("home_city", "Oberwil, 4104, Switzerland"),
                ("map_mode", "online"),  # online=OSM only, auto=fallback, offline=local tiles (dev only)
            ]

            settings_created = 0
            for key, value in default_settings_data:
                # Check if setting already exists
                result = await db.execute(
                    select(models.Setting).where(models.Setting.key == key)
                )
                existing = result.scalar_one_or_none()

                if not existing:
                    setting = models.Setting(
                        key=key,
                        value=value,
                        updated_by=admin_user.id,
                    )
                    db.add(setting)
                    settings_created += 1

            print(f"  - Settings: {settings_created} new, {len(default_settings_data) - settings_created} already exist")

            # ============================================
            # 3. SEED VEHICLES
            # ============================================
            print("Creating vehicles...")
            vehicles_data = [
                {
                    "name": "TLF",
                    "type": "TLF",
                    "display_order": 1,
                    "status": "available",
                    "radio_call_sign": "Omega 1",
                },
                {
                    "name": "Pio",
                    "type": "RW",
                    "display_order": 2,
                    "status": "available",
                    "radio_call_sign": "Omega 2",
                },
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
            for vehicle_data in vehicles_data:
                vehicle = models.Vehicle(id=uuid4(), **vehicle_data)
                db.add(vehicle)
                vehicles.append(vehicle)

            # ============================================
            # 4. SEED PERSONNEL
            # ============================================
            print("Creating personnel...")
            personnel_data = [
                # Offiziere (Hptm, Oblt, Fw, Four, Lt, Adj)
                {"name": "Imhof Sebastiaan", "role": "Offiziere", "availability": "available", "tags": ["F"]},
                {"name": "Weber Martin", "role": "Offiziere", "availability": "available", "tags": ["F", "Hö"]},
                {"name": "Kaiser Sandra", "role": "Offiziere", "availability": "available", "tags": ["F", "Fw"]},
                {"name": "Baumann Michael", "role": "Offiziere", "availability": "available", "tags": []},
                {"name": "Leuenberger Luca", "role": "Offiziere", "availability": "available", "tags": ["F"]},
                {"name": "Steiner Lukas", "role": "Offiziere", "availability": "available", "tags": ["F", "Hö"]},
                {"name": "Hofer Max", "role": "Offiziere", "availability": "available", "tags": ["F", "Fw"]},

                # Wachtmeister
                {"name": "Lehmann Bastian", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
                {"name": "Schmidt Daniel", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
                {"name": "Brunner Sarah", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
                {"name": "Wagner Klaus", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Fw"]},
                {"name": "Meyer Stefan", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
                {"name": "Hess Silvan", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Hö"]},
                {"name": "Roth Til", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
                {"name": "Arnold Samuel", "role": "Wachtmeister", "availability": "available", "tags": []},
                {"name": "Kaufmann Alain", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
                {"name": "Wyss Fabio", "role": "Wachtmeister", "availability": "available", "tags": []},

                # Korporal
                {"name": "Vogel Simon", "role": "Korporal", "availability": "available", "tags": []},
                {"name": "Meier Andrea", "role": "Korporal", "availability": "available", "tags": ["F"]},
                {"name": "Kessler Paolo", "role": "Korporal", "availability": "available", "tags": ["Hö"]},
                {"name": "Huber Stefan", "role": "Korporal", "availability": "available", "tags": []},
                {"name": "Bachmann Simon", "role": "Korporal", "availability": "available", "tags": []},
                {"name": "Künzli Klara", "role": "Korporal", "availability": "available", "tags": ["F"]},
                {"name": "Bühler Rico", "role": "Korporal", "availability": "available", "tags": ["Hö"]},
                {"name": "Jost Melissa", "role": "Korporal", "availability": "available", "tags": []},
                {"name": "Hoffmann Lisa", "role": "Korporal", "availability": "available", "tags": []},
                {"name": "Schwarz Jan", "role": "Korporal", "availability": "available", "tags": []},
                {"name": "Graf Sven", "role": "Korporal", "availability": "available", "tags": ["F"]},

                # Mannschaft (Rf, Sdt, Rekr)
                {"name": "Koch René", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Aebischer Yannick", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Kunz Gabor", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Buri Marysol", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Burri Alessandro", "role": "Mannschaft", "availability": "available", "tags": ["Fw"]},
                {"name": "Fischer Thomas", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Lang Dimitri", "role": "Mannschaft", "availability": "available", "tags": ["Fw"]},
                {"name": "Schmid Tizian", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Schneider Peter", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Zimmermann Fabian", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Aebi Lionel", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Moser Florian", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Bühlmann Carina", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "König Sina", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Iten Alexandre", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Wenger Luzia", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Christen Sandro", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Studer Samuel", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Keller Marco", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Egger Olivier", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Hartmann Mischa", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Frei Dominik", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Suter Raoul", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Ammann Manuel", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Becker Andreas", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Gasser Julia", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Käser Koray", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Berger Maja", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Müller Hans", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Widmer Nico", "role": "Mannschaft", "availability": "available", "tags": []},
                {"name": "Gerber Sandro", "role": "Mannschaft", "availability": "available", "tags": []},
            ]

            personnel = []
            for person_data in personnel_data:
                person = models.Personnel(id=uuid4(), **person_data)
                db.add(person)
                personnel.append(person)

            # ============================================
            # 5. SEED MATERIALS
            # ============================================
            print("Creating materials...")
            materials_data = [
                # Tauchpumpen
                {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "TLF", "status": "available"},
                {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "TLF", "status": "available"},
                {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "TLF", "status": "available"},
                {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "Pio", "status": "available"},
                {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "Pio", "status": "available"},
                {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
                {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
                {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
                {"name": "Tauchpumpe S-Gr.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
                {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "MoWa", "status": "available"},
                {"name": "Tauchpumpe S-Kl.", "type": "Tauchpumpen", "location": "Modul", "status": "available"},
                {"name": "Tauchpumpe S-Gr.", "type": "Tauchpumpen", "location": "Modul", "status": "available"},
                {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "Container", "status": "available"},
                {"name": "Tauchpumpe Kl.", "type": "Tauchpumpen", "location": "Bühne", "status": "available"},
                {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "Bühne", "status": "available"},
                {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "Bühne", "status": "available"},
                {"name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "location": "Bühne", "status": "available"},

                # Wassersauger
                {"name": "Wassersauger", "type": "Wassersauger", "location": "Pio", "status": "available"},
                {"name": "Wassersauger", "type": "Wassersauger", "location": "Modul", "status": "available"},
                {"name": "Wassersauger", "type": "Wassersauger", "location": "MoWa", "status": "available"},
                {"name": "Wassersauger", "type": "Wassersauger", "location": "MoWa", "status": "available"},
                {"name": "Wassersauger", "type": "Wassersauger", "location": "Bühne", "status": "available"},
                {"name": "Wassersauger", "type": "Wassersauger", "location": "Bühne", "status": "available"},
                {"name": "Wassersauger", "type": "Wassersauger", "location": "Bühne", "status": "available"},
                {"name": "Wassersauger Kl.", "type": "Wassersauger", "location": "Bühne", "status": "available"},

                # Sägen
                {"name": "Motorsäge Gr.", "type": "Sägen", "location": "Pio", "status": "available"},
                {"name": "Motorsäge Kl.", "type": "Sägen", "location": "Pio", "status": "available"},
                {"name": "Rettsäge", "type": "Sägen", "location": "Pio", "status": "available"},
                {"name": "Motorsäge", "type": "Sägen", "location": "Bühne", "status": "available"},
                {"name": "Motorsäge", "type": "Sägen", "location": "Bühne", "status": "available"},
                {"name": "Motorsäge", "type": "Sägen", "location": "Bühne", "status": "available"},

                # Generatoren
                {"name": "Generator", "type": "Generatoren", "location": "TLF", "status": "available"},
                {"name": "Generator", "type": "Generatoren", "location": "MoWa", "status": "available"},
                {"name": "Generator", "type": "Generatoren", "location": "Bühne", "status": "available"},

                # Spannungsprüfer
                {"name": "Spannungsprüfer", "type": "Elektrowerkzeug", "location": "MoWa", "status": "available"},
            ]

            # Anhänger (Trailers) - separate category
            trailers_data = [
                {"name": "MS-Zivil", "type": "Anhänger", "location": "Depot", "status": "available"},
                {"name": "MS-Porsche", "type": "Anhänger", "location": "Depot", "status": "available"},
                {"name": "Anhänger-Zivil", "type": "Anhänger", "location": "Depot", "status": "available"},
            ]

            materials = []
            for material_data in materials_data:
                material = models.Material(id=uuid4(), **material_data)
                db.add(material)
                materials.append(material)

            # Add trailers to materials
            for trailer_data in trailers_data:
                trailer = models.Material(id=uuid4(), **trailer_data)
                db.add(trailer)
                materials.append(trailer)

            # ============================================
            # 6. SEED SAMPLE EVENTS
            # ============================================
            print("Creating sample events...")

            # Create operational event
            operational_event = models.Event(
                id=uuid4(),
                name="Einsätze 26.10.2025",
                training_flag=False,
            )
            db.add(operational_event)

            # Create training event
            training_event = models.Event(
                id=uuid4(),
                name="Übung 26.10.2025",
                training_flag=True,
            )
            db.add(training_event)

            await db.flush()  # Get event IDs for incidents

            # ============================================
            # 7. SEED SAMPLE INCIDENTS
            # ============================================
            print("Creating sample incidents...")
            now = datetime.now()

            incidents_data = [
                {
                    "title": "Wohnungsbrand",
                    "type": "brandbekaempfung",
                    "priority": "high",
                    "location_address": "Hauptstraße 45, 79576 Weil am Rhein",
                    "location_lat": 47.5180,
                    "location_lng": 7.5640,
                    "status": "einsatz",
                    "description": "Rauchentwicklung aus Dachgeschoss gemeldet",
                    "created_by": admin_user.id,
                    "event_id": operational_event.id,
                },
                {
                    "title": "Verkehrsunfall mit eingeklemmter Person",
                    "type": "strassenrettung",
                    "priority": "high",
                    "location_address": "Industriepark Nord, 79576 Weil am Rhein",
                    "location_lat": 47.5145,
                    "location_lng": 7.5595,
                    "status": "disponiert",
                    "description": "PKW gegen Baum, Person eingeklemmt",
                    "created_by": admin_user.id,
                    "event_id": operational_event.id,
                },
                {
                    "title": "Fehlalarm BMA",
                    "type": "bma_unechte_alarme",
                    "priority": "low",
                    "location_address": "Bahnhofstraße 12, 79576 Weil am Rhein",
                    "location_lat": 47.5125,
                    "location_lng": 7.5670,
                    "status": "abschluss",
                    "description": "Brandmeldeanlage ausgelöst, kein Feuer",
                    "created_by": admin_user.id,
                    "completed_at": now - timedelta(minutes=20),
                    "event_id": operational_event.id,
                },
                {
                    "title": "Ölspur auf Fahrbahn",
                    "type": "technische_hilfeleistung",
                    "priority": "medium",
                    "location_address": "Waldweg 8, 79576 Weil am Rhein",
                    "location_lat": 47.5200,
                    "location_lng": 7.5585,
                    "status": "eingegangen",
                    "description": "Ölspur ca. 50m Länge",
                    "created_by": admin_user.id,
                    "event_id": operational_event.id,
                },
                {
                    "title": "Übung: Brandbekämpfung Industriehalle",
                    "type": "brandbekaempfung",
                    "priority": "medium",
                    "location_address": "Übungsgelände Feuerwehr",
                    "location_lat": 47.5160,
                    "location_lng": 7.5620,
                    "status": "reko",
                    "description": "Großübung Brandbekämpfung mit Atemschutz",
                    "created_by": admin_user.id,
                    "event_id": training_event.id,
                },
            ]

            incidents = []
            for incident_data in incidents_data:
                incident = models.Incident(id=uuid4(), **incident_data)
                db.add(incident)
                incidents.append(incident)

            await db.flush()  # Get incident IDs for assignments

            # ============================================
            # 8. SEED INCIDENT ASSIGNMENTS
            # ============================================
            print("Creating incident assignments...")

            # Assign resources to first incident (Wohnungsbrand)
            assignments = [
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[0].id,
                    resource_type="vehicle",
                    resource_id=vehicles[0].id,  # TLF 1
                    assigned_by=admin_user.id,
                ),
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[0].id,
                    resource_type="personnel",
                    resource_id=personnel[0].id,  # M. Schmidt
                    assigned_by=admin_user.id,
                ),
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[0].id,
                    resource_type="personnel",
                    resource_id=personnel[2].id,  # T. Weber
                    assigned_by=admin_user.id,
                ),
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[0].id,
                    resource_type="material",
                    resource_id=materials[0].id,  # Wasserpumpe
                    assigned_by=admin_user.id,
                ),
            ]

            # Assign resources to second incident (Verkehrsunfall)
            assignments.extend([
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[1].id,
                    resource_type="vehicle",
                    resource_id=vehicles[3].id,  # Pio
                    assigned_by=admin_user.id,
                ),
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[1].id,
                    resource_type="personnel",
                    resource_id=personnel[4].id,  # K. Wagner
                    assigned_by=admin_user.id,
                ),
                models.IncidentAssignment(
                    id=uuid4(),
                    incident_id=incidents[1].id,
                    resource_type="material",
                    resource_id=materials[5].id,  # Hydraulisches Rettungsgerät
                    assigned_by=admin_user.id,
                ),
            ])

            for assignment in assignments:
                db.add(assignment)

            # ============================================
            # 9. SEED STATUS TRANSITIONS
            # ============================================
            print("Creating status transitions...")

            # Add some status transitions for completed incident
            transitions = [
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[2].id,
                    from_status="eingegangen",
                    to_status="disponiert",
                    user_id=admin_user.id,
                    notes="Fahrzeug alarmiert",
                ),
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[2].id,
                    from_status="disponiert",
                    to_status="einsatz",
                    user_id=admin_user.id,
                    notes="Vor Ort eingetroffen",
                ),
                models.StatusTransition(
                    id=uuid4(),
                    incident_id=incidents[2].id,
                    from_status="einsatz",
                    to_status="abschluss",
                    user_id=admin_user.id,
                    notes="Fehlalarm bestätigt",
                ),
            ]

            for transition in transitions:
                db.add(transition)

            # ============================================
            # COMMIT ALL CHANGES
            # ============================================
            await db.commit()
            print("\n✅ Database seeded successfully!")
            print(f"  - Created dev-user (for auth bypass) and admin user: admin / changeme123 (CHANGE IN PRODUCTION)")
            print(f"  - Created {settings_created} default settings")
            print(f"  - Created {len(vehicles)} vehicles")
            print(f"  - Created {len(personnel)} personnel")
            print(f"  - Created {len(materials)} materials")
            print(f"  - Created 2 events (1 training, 1 operational)")
            print(f"  - Created {len(incidents)} incidents (1 training, 4 operational)")
            print(f"  - Created {len(assignments)} resource assignments")
            print(f"  - Created {len(transitions)} status transitions")

        except Exception as e:
            print(f"❌ Error seeding database: {e}")
            await db.rollback()
            raise


if __name__ == "__main__":
    asyncio.run(seed_database())
