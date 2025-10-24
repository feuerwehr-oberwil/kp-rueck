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
            # 1. SEED DEFAULT ADMIN USER
            # ============================================
            print("Creating default admin user...")
            # Hash password using bcrypt
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
                    "name": "TLF 1",
                    "type": "TLF",
                    "status": "available",
                },
                {
                    "name": "DLK",
                    "type": "DLK",
                    "status": "available",
                },
                {
                    "name": "MTW 1",
                    "type": "MTW",
                    "status": "assigned",
                },
                {
                    "name": "Pio",
                    "type": "Pionier",
                    "status": "maintenance",
                },
                {
                    "name": "KdoW",
                    "type": "Kommando",
                    "status": "available",
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
                {"name": "M. Schmidt", "role": "Fahrer", "availability": "assigned"},
                {"name": "A. Müller", "role": "Reko/EL/FU", "availability": "available"},
                {"name": "T. Weber", "role": "Mannschaft", "availability": "assigned"},
                {"name": "S. Fischer", "role": "Mannschaft", "availability": "available"},
                {"name": "K. Wagner", "role": "Fahrer", "availability": "assigned"},
                {"name": "L. Becker", "role": "Mannschaft", "availability": "available"},
                {"name": "P. Hoffmann", "role": "Reko/EL/FU", "availability": "available"},
                {"name": "J. Schulz", "role": "Mannschaft", "availability": "available"},
                {"name": "D. Richter", "role": "Gruppenführer", "availability": "available"},
                {"name": "F. Klein", "role": "Maschinist", "availability": "assigned"},
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
                {
                    "name": "Wasserpumpe TP 15/8",
                    "type": "Pumpen",
                    "status": "assigned",
                    "location": "TLF 1",
                },
                {
                    "name": "Schlauchpaket B",
                    "type": "Schläuche",
                    "status": "available",
                    "location": "Lager Raum 3",
                },
                {
                    "name": "Schlauchpaket C",
                    "type": "Schläuche",
                    "status": "available",
                    "location": "Lager Raum 3",
                },
                {
                    "name": "Atemschutzgerät",
                    "type": "Atemschutz",
                    "status": "assigned",
                    "location": "TLF 1",
                },
                {
                    "name": "Wärmebildkamera",
                    "type": "Spezialgerät",
                    "status": "available",
                    "location": "MTW 1",
                },
                {
                    "name": "Hydraulisches Rettungsgerät",
                    "type": "Spezialgerät",
                    "status": "assigned",
                    "location": "Pio",
                },
                {
                    "name": "Schaummittel 200L",
                    "type": "Löschmittel",
                    "status": "available",
                    "location": "Lager Raum 1",
                },
                {
                    "name": "Stromerzeuger 5kW",
                    "type": "Technik",
                    "status": "available",
                    "location": "DLK",
                },
                {
                    "name": "Funkgerät HRT 1",
                    "type": "Kommunikation",
                    "status": "assigned",
                    "location": "KdoW",
                },
                {
                    "name": "Erste-Hilfe-Koffer",
                    "type": "Sanitär",
                    "status": "available",
                    "location": "Lager Raum 2",
                },
            ]

            materials = []
            for material_data in materials_data:
                material = models.Material(id=uuid4(), **material_data)
                db.add(material)
                materials.append(material)

            # ============================================
            # 6. SEED SAMPLE INCIDENTS
            # ============================================
            print("Creating sample incidents...")
            now = datetime.now()

            incidents_data = [
                {
                    "title": "Wohnungsbrand",
                    "type": "fire",
                    "priority": "high",
                    "location_address": "Hauptstraße 45, 79576 Weil am Rhein",
                    "location_lat": 47.5180,
                    "location_lng": 7.5640,
                    "status": "einsatz",
                    "training_flag": False,
                    "description": "Rauchentwicklung aus Dachgeschoss gemeldet",
                    "created_by": admin_user.id,
                },
                {
                    "title": "Verkehrsunfall mit eingeklemmter Person",
                    "type": "technical",
                    "priority": "critical",
                    "location_address": "Industriepark Nord, 79576 Weil am Rhein",
                    "location_lat": 47.5145,
                    "location_lng": 7.5595,
                    "status": "disponiert",
                    "training_flag": False,
                    "description": "PKW gegen Baum, Person eingeklemmt",
                    "created_by": admin_user.id,
                },
                {
                    "title": "Fehlalarm BMA",
                    "type": "other",
                    "priority": "low",
                    "location_address": "Bahnhofstraße 12, 79576 Weil am Rhein",
                    "location_lat": 47.5125,
                    "location_lng": 7.5670,
                    "status": "abschluss",
                    "training_flag": False,
                    "description": "Brandmeldeanlage ausgelöst, kein Feuer",
                    "created_by": admin_user.id,
                    "completed_at": now - timedelta(minutes=20),
                },
                {
                    "title": "Ölspur auf Fahrbahn",
                    "type": "technical",
                    "priority": "medium",
                    "location_address": "Waldweg 8, 79576 Weil am Rhein",
                    "location_lat": 47.5200,
                    "location_lng": 7.5585,
                    "status": "eingegangen",
                    "training_flag": False,
                    "description": "Ölspur ca. 50m Länge",
                    "created_by": admin_user.id,
                },
                {
                    "title": "Übung: Brandbekämpfung Industriehalle",
                    "type": "fire",
                    "priority": "medium",
                    "location_address": "Übungsgelände Feuerwehr",
                    "location_lat": 47.5160,
                    "location_lng": 7.5620,
                    "status": "reko",
                    "training_flag": True,  # Training incident
                    "description": "Großübung Brandbekämpfung mit Atemschutz",
                    "created_by": admin_user.id,
                },
            ]

            incidents = []
            for incident_data in incidents_data:
                incident = models.Incident(id=uuid4(), **incident_data)
                db.add(incident)
                incidents.append(incident)

            await db.flush()  # Get incident IDs for assignments

            # ============================================
            # 7. SEED INCIDENT ASSIGNMENTS
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
            # 8. SEED STATUS TRANSITIONS
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
            print(f"  - Created admin user: admin / changeme123 (CHANGE IN PRODUCTION)")
            print(f"  - Created {settings_created} default settings")
            print(f"  - Created {len(vehicles)} vehicles")
            print(f"  - Created {len(personnel)} personnel")
            print(f"  - Created {len(materials)} materials")
            print(f"  - Created {len(incidents)} incidents (1 training, 4 operational)")
            print(f"  - Created {len(assignments)} resource assignments")
            print(f"  - Created {len(transitions)} status transitions")

        except Exception as e:
            print(f"❌ Error seeding database: {e}")
            await db.rollback()
            raise


if __name__ == "__main__":
    asyncio.run(seed_database())
