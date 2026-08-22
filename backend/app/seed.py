"""Database seed script.

Run with: uv run python -m app.seed
"""

import asyncio
import os
import secrets
import sys
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

    # The addresses below are REAL Oberwil BL streets with their OpenStreetMap
    # coordinates — the same verified set the training locations come from
    # (`seed_training.FALLBACK_TRAINING_LOCATIONS`).
    #
    # They used to be «Musterstadt» invented streets pinned around 47.56 / 7.59,
    # which is not Oberwil but the far side of the Rhein: every sample incident
    # landed in the wrong village on the map, none of the addresses resolved,
    # and the home-city stripping had nothing to strip — so a dev or staging
    # board looked nothing like the one an operator actually reads. Sample data
    # is what people learn the product on; it has to be somewhere real.
    #
    # Production seeds none of this at all (`is_production_environment`).
    incidents_data = [
        # Water-focused incidents (main focus)
        {
            "title": "Wasser im Keller Einfamilienhaus",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Mühlemattstrasse 18, 4104 Oberwil",
            "location_lat": 47.5098844,
            "location_lng": 7.5546250,
            "status": "active",
            "description": "Keller unter Wasser, ca. 30cm. Heizung und Elektroinstallation betroffen. Bewohner vor Ort.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Überflutung Tiefgarage",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Hauptstrasse 41, 4104 Oberwil",
            "location_lat": 47.5139457,
            "location_lng": 7.5561373,
            "status": "enroute",
            "description": "Tiefgarage steht unter Wasser nach Starkregen. Ca. 50cm Wasserhöhe. 12 Fahrzeuge betroffen.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Wasserschaden Mehrfamilienhaus",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Bottmingerstrasse 75, 4104 Oberwil",
            "location_lat": 47.5157039,
            "location_lng": 7.5588034,
            "status": "incoming",
            "description": "Wasser dringt durch Kellerfenster. Waschküche und Kellerabteile überflutet. 3 Stockwerke betroffen.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Keller auspumpen Gewerbebetrieb",
            "type": "elementarereignis",
            "priority": "high",
            "location_address": "Hohestrasse 120, 4104 Oberwil",
            "location_lat": 47.5209493,
            "location_lng": 7.5539767,
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
            "location_address": "Langegasse 97, 4104 Oberwil",
            "location_lat": 47.5089777,
            "location_lng": 7.5601529,
            "status": "active",
            "description": "Umgestürzter Baum blockiert Fahrbahn. Keine Personen verletzt. Verkehr wird umgeleitet.",
            "created_by": admin_user.id,
            "event_id": operational_event.id,
        },
        {
            "title": "Ölspur Industriegebiet",
            "type": "oelwehr",
            "priority": "low",
            "location_address": "Sägestrasse 9, 4104 Oberwil",
            "location_lat": 47.5115481,
            "location_lng": 7.5570202,
            "status": "complete",
            "description": "Ölspur ca. 80m auf Fahrbahn. Bindemittel aufgebracht. Strasse gereinigt.",
            "created_by": admin_user.id,
            "completed_at": now - timedelta(minutes=35),
            "event_id": operational_event.id,
        },
        {
            "title": "Dachziegel lose nach Sturm",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Binningerstrasse 57, 4104 Oberwil",
            "location_lat": 47.5163022,
            "location_lng": 7.5585081,
            "status": "complete",
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
            "location_address": "Hauptstrasse 36, 4104 Oberwil",
            "location_lat": 47.5140370,
            "location_lng": 7.5550833,
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
            from_status="incoming",
            to_status="enroute",
            user_id=admin_user.id,
            notes="Fahrzeug alarmiert",
        ),
        models.StatusTransition(
            id=uuid4(),
            incident_id=incidents[2].id,
            from_status="enroute",
            to_status="active",
            user_id=admin_user.id,
            notes="Vor Ort eingetroffen",
        ),
        models.StatusTransition(
            id=uuid4(),
            incident_id=incidents[2].id,
            from_status="active",
            to_status="complete",
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
        {"name": "Müller Hans", "role": "Offizier", "status": "available", "tags": ["F"]},
        {"name": "Schneider Peter", "role": "Offizier", "status": "available", "tags": ["F", "Hö"]},
        {"name": "Weber Martin", "role": "Offizier", "status": "available", "tags": ["F", "Fw"]},
        {"name": "Fischer Thomas", "role": "Offizier", "status": "available", "tags": []},
        {"name": "Meyer Stefan", "role": "Offizier", "status": "available", "tags": ["F"]},
        {"name": "Wagner Klaus", "role": "Offizier", "status": "available", "tags": ["F", "Hö"]},
        {"name": "Becker Andreas", "role": "Offizier", "status": "available", "tags": ["F", "Fw"]},
        # Wachtmeister (Sergeants)
        {"name": "Hoffmann Lisa", "role": "Wachtmeister", "status": "available", "tags": ["F"]},
        {"name": "Schmidt Daniel", "role": "Wachtmeister", "status": "available", "tags": ["F"]},
        {"name": "Koch René", "role": "Wachtmeister", "status": "available", "tags": ["F"]},
        {"name": "Baumann Michael", "role": "Wachtmeister", "status": "available", "tags": ["F", "Fw"]},
        {"name": "Keller Marco", "role": "Wachtmeister", "status": "available", "tags": ["F"]},
        {"name": "Brunner Sarah", "role": "Wachtmeister", "status": "available", "tags": ["F", "Hö"]},
        {"name": "Gerber Sandro", "role": "Wachtmeister", "status": "available", "tags": ["F"]},
        {"name": "Frei Dominik", "role": "Wachtmeister", "status": "available", "tags": []},
        {"name": "Huber Stefan", "role": "Wachtmeister", "status": "available", "tags": ["F"]},
        {"name": "Schmid Tizian", "role": "Wachtmeister", "status": "available", "tags": []},
        # Korporal (Corporals)
        {"name": "Steiner Lukas", "role": "Korporal", "status": "available", "tags": []},
        {"name": "Meier Andrea", "role": "Korporal", "status": "available", "tags": ["F"]},
        {"name": "Graf Sven", "role": "Korporal", "status": "available", "tags": ["Hö"]},
        {"name": "Roth Til", "role": "Korporal", "status": "available", "tags": []},
        {"name": "Lang Dimitri", "role": "Korporal", "status": "available", "tags": []},
        {"name": "Kaufmann Alain", "role": "Korporal", "status": "available", "tags": ["F"]},
        {"name": "Moser Florian", "role": "Korporal", "status": "available", "tags": ["Hö"]},
        {"name": "Berger Maja", "role": "Korporal", "status": "available", "tags": []},
        {"name": "Widmer Nico", "role": "Korporal", "status": "available", "tags": []},
        {"name": "Vogel Simon", "role": "Korporal", "status": "available", "tags": []},
        {"name": "Egger Olivier", "role": "Korporal", "status": "available", "tags": ["F"]},
        # Mannschaft (Firefighters)
        {"name": "Zimmermann Fabian", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Wyss Fabio", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Künzli Klara", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Studer Samuel", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Schwarz Jan", "role": "Mannschaft", "status": "available", "tags": ["Fw"]},
        {"name": "Hartmann Mischa", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Christen Sandro", "role": "Mannschaft", "status": "available", "tags": ["Fw"]},
        {"name": "Leuenberger Luca", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Suter Raoul", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Kunz Gabor", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Ammann Manuel", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Burri Alessandro", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Wenger Luzia", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Bühler Rico", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Aebischer Yannick", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Arnold Samuel", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Aebi Lionel", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Bachmann Simon", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Bühlmann Carina", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Buri Marysol", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Gasser Julia", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Hofer Max", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Hess Silvan", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Imhof Sebastiaan", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Iten Alexandre", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Jost Melissa", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Kaiser Sandra", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Käser Koray", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Kessler Paolo", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "König Sina", "role": "Mannschaft", "status": "available", "tags": []},
        {"name": "Lehmann Bastian", "role": "Mannschaft", "status": "available", "tags": []},
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


async def seed_dev_logins() -> None:
    """Upsert the development logins into an EXISTING database.

    The counterpart of `scripts/dev-sync.sh`: a synced database arrives with the
    source deployment's users, and the local stack still wants its own known
    credentials – the auth-bypass user, admin/$ADMIN_SEED_PASSWORD, editor/editor,
    viewer/viewer. Upsert, not insert: a synced «admin» is the station's admin row,
    and replacing its hash locally is exactly the point – the station's password
    must not work (or need to be known) on a laptop.

    Development only. In production this would overwrite the station's real
    credentials with dev defaults, so it refuses outright.
    """
    if is_production_environment():
        raise RuntimeError("--dev-logins would overwrite real credentials; it refuses to run in production")

    import uuid

    def hashed(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    accounts = [
        # (username, password_hash, role, display_name, fixed_id) – dev-user keeps the
        # all-zero UUID the auth bypass looks up; empty hash because bypass never checks it.
        ("dev-user", "", "admin", "Development User", uuid.UUID("00000000-0000-0000-0000-000000000000")),
        ("admin", hashed(get_admin_password()), "admin", "Administrator", None),
        (
            "editor",
            hashed(get_shared_account_password("EDITOR_PASSWORD", dev_default="editor")),
            "editor",
            "Bearbeiter",
            None,
        ),
        (
            "viewer",
            hashed(get_shared_account_password("VIEWER_PASSWORD", dev_default="viewer")),
            "viewer",
            "Betrachter",
            None,
        ),
    ]

    async with async_session_maker() as db:
        for username, password_hash, role, display_name, fixed_id in accounts:
            result = await db.execute(select(models.User).where(models.User.username == username))
            user = result.scalars().first()
            if user:
                user.password_hash = password_hash
                user.role = role
                user.is_active = True
            else:
                db.add(
                    models.User(
                        id=fixed_id or uuid4(),
                        username=username,
                        password_hash=password_hash,
                        role=role,
                        display_name=display_name,
                        is_active=True,
                    )
                )
        await db.commit()
    print("✓ Dev logins ready: dev-user (bypass), admin, editor, viewer")


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
                # "auto", matching DEFAULT_SETTINGS in services/settings.py — the seed writes
                # the row a fresh install actually gets, so leaving "online" here would keep
                # every new station without the offline fallback the help promises. "auto"
                # behaves like "online" until the tiles fail; only then does it differ.
                ("map_mode", "auto"),  # auto=online with offline fallback, online=OSM only, offline=local tiles
                ("incident_time_display", "column"),  # start | column | total (per-device override in the UI)
            ]

            # Station identity. Two different jobs, so two different values.
            #
            # A fresh PRODUCTION install belongs to a station we know nothing
            # about, and the honest value there is one that reads as a
            # placeholder — «Musterstadt» is meant to be replaced in
            # Einstellungen, and docs/SETUP.md says so. Naming Oberwil there
            # would look like a setting somebody had already made.
            #
            # Dev, demo and staging are the opposite case: they exist to be
            # looked at, their sample incidents are real Oberwil addresses, and
            # a home city that matches is what makes the board strip it off
            # those addresses the way a real one does. The coordinates are the
            # village centre, not a claim about anybody's Magazin.
            default_settings_data.extend(
                [
                    ("firestation_name", "Feuerwehr Musterstadt"),
                    ("firestation_latitude", "47.5596"),
                    ("firestation_longitude", "7.5886"),
                    ("home_city", "Musterstadt, BL"),
                ]
                if is_production_environment()
                else [
                    ("firestation_name", "Feuerwehr Oberwil"),
                    ("firestation_latitude", "47.5148"),
                    ("firestation_longitude", "7.5577"),
                    ("home_city", "Oberwil, BL"),
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
    if "--dev-logins" in sys.argv[1:]:
        asyncio.run(seed_dev_logins())
    else:
        asyncio.run(seed_database())
