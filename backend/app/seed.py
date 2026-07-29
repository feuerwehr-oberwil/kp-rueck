"""Database seed script.

Run with: uv run python -m app.seed
"""

import asyncio
import os
import secrets
from datetime import datetime, timedelta
from uuid import uuid4

import bcrypt
from sqlalchemy import select

from app.environment import is_production_environment

from . import models
from .database import async_session_maker
from .seed_training import seed_training_data


def get_admin_password() -> str:
    """
    Get admin password for seeding.

    Security: In production, ADMIN_SEED_PASSWORD must be explicitly set.
    In development, generates a random password if not provided.
    """
    is_production = is_production_environment()
    admin_password = os.getenv("ADMIN_SEED_PASSWORD", "")

    if admin_password:
        # Validate provided password
        if len(admin_password) < 12:
            raise ValueError("ADMIN_SEED_PASSWORD must be at least 12 characters long")
        return admin_password

    if is_production:
        raise ValueError(
            "ADMIN_SEED_PASSWORD environment variable is required in production. "
            "Generate one (openssl rand -base64 24) and set it in your .env."
        )

    # Development: Generate random password
    generated_password = secrets.token_urlsafe(16)  # 128-bit random
    return generated_password


def get_shared_account_password(env_var: str, dev_default: str) -> str:
    """
    Password for the shared editor/viewer accounts.

    Security: in production the env var must be explicitly set — same rule as
    ADMIN_SEED_PASSWORD. Otherwise a fresh/restored DB would go live with
    internet-facing editor/editor and viewer/viewer logins (audit point 15).
    """
    is_production = is_production_environment()
    password = os.getenv(env_var, "")

    if password:
        if len(password) < 12:
            raise ValueError(f"{env_var} must be at least 12 characters long")
        return password

    if is_production:
        raise ValueError(
            f"{env_var} environment variable is required in production. "
            "Generate one (openssl rand -base64 24) and set it in your .env."
        )

    return dev_default


async def _seed_sample_operations(db, admin_user, vehicles, personnel, materials) -> None:
    """Seed sample events, incidents, assignments, special functions, and
    status transitions - development fixtures only.

    Never run in production: on a fresh or restored DB the non-training
    sample incidents would appear as REAL operations on the board.
    """
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
        # Water-focused incidents (main focus)
        {
            "title": "Wasser im Keller Einfamilienhaus",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Mühleweg 23, Musterstadt",
            "location_lat": 47.5596,
            "location_lng": 7.5886,
            "status": "einsatz",
            "description": "Keller unter Wasser, ca. 30cm. Heizung und Elektroinstallation betroffen. Bewohner vor Ort.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Überflutung Tiefgarage",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Hauptstrasse 95, Musterstadt",
            "location_lat": 47.5610,
            "location_lng": 7.5900,
            "status": "disponiert",
            "description": "Tiefgarage steht unter Wasser nach Starkregen. Ca. 50cm Wasserhöhe. 12 Fahrzeuge betroffen.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Wasserschaden Mehrfamilienhaus",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Bahnhofstrasse 45, Musterstadt",
            "location_lat": 47.5580,
            "location_lng": 7.5870,
            "status": "eingegangen",
            "description": "Wasser dringt durch Kellerfenster. Waschküche und Kellerabteile überflutet. 3 Stockwerke betroffen.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Keller auspumpen Gewerbebetrieb",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Gewerbestrasse 12, Musterstadt",
            "location_lat": 47.5620,
            "location_lng": 7.5920,
            "status": "reko",
            "description": "Grundwasser im Keller eines Lagergebäudes. Ca. 40cm Wasser. Waren und Maschinen gefährdet.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        # Diverse other incidents
        {
            "title": "Baum auf Strasse",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Waldstrasse 78, Musterstadt",
            "location_lat": 47.5630,
            "location_lng": 7.5850,
            "status": "einsatz",
            "description": "Umgestürzter Baum blockiert Fahrbahn. Keine Personen verletzt. Verkehr wird umgeleitet.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Ölspur Industriegebiet",
            "type": "oelwehr",
            "priority": "low",
            "location_address": "Industriestrasse 8, Musterstadt",
            "location_lat": 47.5570,
            "location_lng": 7.5910,
            "status": "abschluss",
            "description": "Ölspur ca. 80m auf Fahrbahn. Bindemittel aufgebracht. Strasse gereinigt.",
            "created_by": admin_user.id,
            "completed_at": now - timedelta(minutes=35),
            "event_id": operational_event.id,
        },
        {
            "title": "Dachziegel lose nach Sturm",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Kirchgasse 5, Musterstadt",
            "location_lat": 47.5600,
            "location_lng": 7.5895,
            "status": "abschluss",
            "description": "Mehrere Dachziegel durch Sturmböen gelöst. Absturzgefahr auf Gehweg. Bereich abgesperrt.",
            "created_by": admin_user.id,
            "completed_at": now - timedelta(minutes=55),
            "event_id": operational_event.id,
        },
        # Training incident
        {
            "title": "Übung: Keller auspumpen",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Übungsgelände Feuerwehr",
            "location_lat": 47.5605,
            "location_lng": 7.5890,
            "status": "reko",
            "description": "Übung Wasserschadeneinsatz mit Tauchpumpen und Wassersaugern.",
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
    assignments.extend(
        [
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
        ]
    )

    for assignment in assignments:
        db.add(assignment)

    # ============================================
    # 9. SEED EVENT SPECIAL FUNCTIONS
    # ============================================
    print("Creating special function assignments...")

    # Assign drivers to vehicles for the operational event
    special_functions = [
        # Drivers for operational event
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=operational_event.id,
            personnel_id=personnel[0].id,  # Imhof Sebastiaan (Offizier with F tag)
            function_type="driver",
            vehicle_id=vehicles[0].id,  # TLF
            assigned_by=admin_user.id,
        ),
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=operational_event.id,
            personnel_id=personnel[1].id,  # Weber Martin (Offizier with F tag)
            function_type="driver",
            vehicle_id=vehicles[1].id,  # Pio
            assigned_by=admin_user.id,
        ),
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=operational_event.id,
            personnel_id=personnel[7].id,  # Lehmann Bastian (Wachtmeister with F tag)
            function_type="driver",
            vehicle_id=vehicles[2].id,  # Mowa
            assigned_by=admin_user.id,
        ),
        # Reko assignment for operational event
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=operational_event.id,
            personnel_id=personnel[3].id,  # Baumann Michael (Offizier)
            function_type="reko",
            vehicle_id=None,
            assigned_by=admin_user.id,
        ),
        # Magazin assignment for operational event
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=operational_event.id,
            personnel_id=personnel[15].id,  # Arnold Samuel (Wachtmeister)
            function_type="magazin",
            vehicle_id=None,
            assigned_by=admin_user.id,
        ),
        # Different assignments for training event
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=training_event.id,
            personnel_id=personnel[4].id,  # Leuenberger Luca (Offizier with F tag)
            function_type="driver",
            vehicle_id=vehicles[0].id,  # TLF (different driver than operational)
            assigned_by=admin_user.id,
        ),
        models.EventSpecialFunction(
            id=uuid4(),
            event_id=training_event.id,
            personnel_id=personnel[5].id,  # Steiner Lukas (Offizier)
            function_type="reko",
            vehicle_id=None,
            assigned_by=admin_user.id,
        ),
    ]

    for special_func in special_functions:
        db.add(special_func)

    # ============================================
    # 10. SEED STATUS TRANSITIONS
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

    print(
        f"  - Created {len(incidents)} sample incidents, {len(assignments)} assignments, "
        f"{len(special_functions)} special functions, {len(transitions)} transitions (dev only)"
    )


async def _seed_sample_resources(db) -> tuple[list, list, list]:
    """Seed a fictional station's vehicles, personnel and materials -
    development fixtures only.

    Never run in production, for the same reason as the sample operations
    below: a fleet, a roster and a material catalogue are operational DATA,
    not scaffolding. On a fresh or restored production DB these would put
    another station's five vehicles and 57 firefighters on the board, and
    the first act of setting up would be deleting them. A production
    deployment starts empty and fills up through the Excel import
    (docs/SETUP.md section 3).
    """
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

    # Generic personnel (common Swiss surnames)
    personnel_data = [
        # Offiziere (Officers)
        {"name": "Müller Hans", "role": "Offizier", "availability": "available", "tags": ["F"]},
        {"name": "Schneider Peter", "role": "Offizier", "availability": "available", "tags": ["F", "Hö"]},
        {"name": "Weber Martin", "role": "Offizier", "availability": "available", "tags": ["F", "Fw"]},
        {"name": "Fischer Thomas", "role": "Offizier", "availability": "available", "tags": []},
        {"name": "Meyer Stefan", "role": "Offizier", "availability": "available", "tags": ["F"]},
        {"name": "Wagner Klaus", "role": "Offizier", "availability": "available", "tags": ["F", "Hö"]},
        {"name": "Becker Andreas", "role": "Offizier", "availability": "available", "tags": ["F", "Fw"]},
        # Wachtmeister (Sergeants)
        {"name": "Hoffmann Lisa", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Schmidt Daniel", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Koch René", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Baumann Michael", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Fw"]},
        {"name": "Keller Marco", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Brunner Sarah", "role": "Wachtmeister", "availability": "available", "tags": ["F", "Hö"]},
        {"name": "Gerber Sandro", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Frei Dominik", "role": "Wachtmeister", "availability": "available", "tags": []},
        {"name": "Huber Stefan", "role": "Wachtmeister", "availability": "available", "tags": ["F"]},
        {"name": "Schmid Tizian", "role": "Wachtmeister", "availability": "available", "tags": []},
        # Korporal (Corporals)
        {"name": "Steiner Lukas", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Meier Andrea", "role": "Korporal", "availability": "available", "tags": ["F"]},
        {"name": "Graf Sven", "role": "Korporal", "availability": "available", "tags": ["Hö"]},
        {"name": "Roth Til", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Lang Dimitri", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Kaufmann Alain", "role": "Korporal", "availability": "available", "tags": ["F"]},
        {"name": "Moser Florian", "role": "Korporal", "availability": "available", "tags": ["Hö"]},
        {"name": "Berger Maja", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Widmer Nico", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Vogel Simon", "role": "Korporal", "availability": "available", "tags": []},
        {"name": "Egger Olivier", "role": "Korporal", "availability": "available", "tags": ["F"]},
        # Mannschaft (Firefighters)
        {"name": "Zimmermann Fabian", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Wyss Fabio", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Künzli Klara", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Studer Samuel", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Schwarz Jan", "role": "Mannschaft", "availability": "available", "tags": ["Fw"]},
        {"name": "Hartmann Mischa", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Christen Sandro", "role": "Mannschaft", "availability": "available", "tags": ["Fw"]},
        {"name": "Leuenberger Luca", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Suter Raoul", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Kunz Gabor", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Ammann Manuel", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Burri Alessandro", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Wenger Luzia", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Bühler Rico", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Aebischer Yannick", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Arnold Samuel", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Aebi Lionel", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Bachmann Simon", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Bühlmann Carina", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Buri Marysol", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Gasser Julia", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Hofer Max", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Hess Silvan", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Imhof Sebastiaan", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Iten Alexandre", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Jost Melissa", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Kaiser Sandra", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Käser Koray", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Kessler Paolo", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "König Sina", "role": "Mannschaft", "availability": "available", "tags": []},
        {"name": "Lehmann Bastian", "role": "Mannschaft", "availability": "available", "tags": []},
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

    return vehicles, personnel, materials


async def seed_database() -> None:
    """Seed the database with initial data.

    In demo mode (DEMO_MODE=true), delegates to seed_demo_database() instead.
    """
    from .config import settings as app_settings

    if app_settings.demo_mode:
        from .seed_demo import seed_demo_database

        print("Demo mode detected — using demo seed data")
        await seed_demo_database()
        return

    # Schema is managed by Alembic ONLY — the boot scripts run
    # `alembic upgrade head` before seeding. A create_all here would let a
    # model without a migration slip through and crash the NEXT deploy's
    # migration with DuplicateTable (audit point 14).

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
                role="admin",  # Admin role for dev bypass
                display_name="Development User",
                is_active=True,
            )
            db.add(dev_user)

            # Create admin user with secure password
            password = get_admin_password()
            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

            admin_user = models.User(
                id=uuid4(),
                username="admin",
                password_hash=password_hash,
                role="admin",
                display_name="Administrator",
                is_active=True,
            )
            db.add(admin_user)

            # Create shared editor account (dev/local only). In production,
            # editors come from SSO and the admin account covers break-glass —
            # a shared password login would just be extra attack surface.
            if not is_production_environment():
                editor_password = get_shared_account_password("EDITOR_PASSWORD", dev_default="editor")
                editor_password_hash = bcrypt.hashpw(editor_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

                editor_user = models.User(
                    id=uuid4(),
                    username="editor",
                    password_hash=editor_password_hash,
                    role="editor",
                    display_name="Bearbeiter",
                    is_active=True,
                )
                db.add(editor_user)

            # Create shared read-only viewer account for shared/kiosk PCs
            viewer_password = get_shared_account_password("VIEWER_PASSWORD", dev_default="viewer")
            viewer_password_hash = bcrypt.hashpw(viewer_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

            viewer_user = models.User(
                id=uuid4(),
                username="viewer",
                password_hash=viewer_password_hash,
                role="viewer",
                display_name="Betrachter",
                is_active=True,
            )
            db.add(viewer_user)
            await db.flush()  # Get the ID for foreign key references

            # ============================================
            # 2. SEED DEFAULT SETTINGS
            # ============================================
            print("Creating default settings...")

            # Base settings (same for all deployments)
            default_settings_data = [
                ("polling_interval_ms", "5000"),
                ("training_mode", "false"),
                ("auto_archive_timeout_hours", "24"),
                ("notification_enabled", "false"),
                ("alarm_webhook_secret", secrets.token_urlsafe(32)),
                ("map_mode", "online"),  # online=OSM only, auto=fallback, offline=local tiles (dev only)
            ]

            default_settings_data.extend(
                [
                    ("firestation_name", "Feuerwehr Musterstadt"),
                    ("firestation_latitude", "47.5596"),  # Generic Swiss location
                    ("firestation_longitude", "7.5886"),
                    ("home_city", "Musterstadt, BL"),
                ]
            )

            settings_created = 0
            for key, value in default_settings_data:
                # Check if setting already exists
                result = await db.execute(select(models.Setting).where(models.Setting.key == key))
                existing = result.scalar_one_or_none()

                if not existing:
                    setting = models.Setting(
                        key=key,
                        value=value,
                        updated_by=admin_user.id,
                    )
                    db.add(setting)
                    settings_created += 1

            print(
                f"  - Settings: {settings_created} new, {len(default_settings_data) - settings_created} already exist"
            )

            # Everything below this line is a dev fixture. On a fresh or
            # restored production DB the sample events/incidents would appear
            # as REAL operations on the board (audit point 15), and the fleet,
            # roster and materials would be another station's - see
            # _seed_sample_resources. A production board starts empty.
            vehicles: list = []
            personnel: list = []
            materials: list = []
            if is_production_environment():
                print("Production environment - skipping sample resources and operations.")
            else:
                vehicles, personnel, materials = await _seed_sample_resources(db)
                await _seed_sample_operations(db, admin_user, vehicles, personnel, materials)

            # ============================================
            # COMMIT ALL CHANGES
            # ============================================
            await db.commit()
            print("\n✅ Database seeded successfully!")
            is_production = is_production_environment()
            if is_production:
                print(
                    "  - Created dev-user (for auth bypass) and admin user: admin / [password from ADMIN_SEED_PASSWORD]"
                )
            else:
                print(f"  - Created dev-user (for auth bypass) and admin user: admin / {password}")
                print("  ⚠️  Save this password - it was randomly generated for development")
            if not is_production_environment():
                print("  - Created shared editor account: editor / [EDITOR_PASSWORD, default 'editor']")
            print("  - Created read-only viewer account: viewer / [VIEWER_PASSWORD, default 'viewer']")
            print(f"  - Created {settings_created} default settings")
            if is_production:
                print("  - No vehicles, personnel or materials: import your own (docs/SETUP.md section 3)")
            else:
                print(f"  - Created {len(vehicles)} vehicles")
                print(f"  - Created {len(personnel)} personnel")
                print(f"  - Created {len(materials)} materials")

        except Exception as e:
            print(f"❌ Error seeding database: {e}")
            await db.rollback()
            raise

    # Seed training data (emergency templates and locations)
    print("\n" + "=" * 60)
    print("SEEDING TRAINING DATA")
    print("=" * 60)
    try:
        # Production gets the emergency templates (generic scaffolding) but no
        # training locations: the bundled fallback list is real streets in one
        # specific town, and geocoding at boot is slow and rate-limited.
        is_production = is_production_environment()
        await seed_training_data(skip_geocoding=is_production, seed_locations=not is_production)
        print("✅ Training data seeded successfully!")
    except Exception as e:
        print(f"⚠️  Warning: Training data seeding failed: {e}")
        print("   Continuing anyway - training mode may not work properly.")


if __name__ == "__main__":
    asyncio.run(seed_database())
