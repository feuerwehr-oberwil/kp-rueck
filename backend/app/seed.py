"""Database seed script.

Run with: uv run python -m app.seed
"""
import asyncio
from datetime import datetime, timedelta

from sqlalchemy import select

from . import models
from .database import async_session_maker


async def seed_database() -> None:
    """Seed the database with initial data."""
    async with async_session_maker() as db:
        try:
            # Check if data already exists
            result = await db.execute(select(models.Personnel))
            if result.scalars().first():
                print("Database already seeded. Skipping...")
                return

            # Seed Personnel
            personnel_data = [
                {"name": "M. Schmidt", "role": "Fahrer", "status": "assigned"},
                {"name": "A. Müller", "role": "Reko/EL/FU", "status": "available"},
                {"name": "T. Weber", "role": "Mannschaft", "status": "assigned"},
                {"name": "S. Fischer", "role": "Mannschaft", "status": "available"},
                {"name": "K. Wagner", "role": "Fahrer", "status": "assigned"},
                {"name": "L. Becker", "role": "Mannschaft", "status": "available"},
                {"name": "P. Hoffmann", "role": "Reko/EL/FU", "status": "available"},
                {"name": "J. Schulz", "role": "Mannschaft", "status": "available"},
            ]

            for person_data in personnel_data:
                person = models.Personnel(**person_data)
                db.add(person)

            # Seed Materials
            materials_data = [
                {"name": "Wasserpumpe TP 15/8", "category": "Pumpen", "status": "assigned"},
                {"name": "Schlauchpaket B", "category": "Schläuche", "status": "available"},
                {"name": "Schlauchpaket C", "category": "Schläuche", "status": "available"},
                {"name": "Atemschutzgerät", "category": "Atemschutz", "status": "assigned"},
                {"name": "Wärmebildkamera", "category": "Spezialgerät", "status": "available"},
                {"name": "Hydraulisches Rettungsgerät", "category": "Spezialgerät", "status": "assigned"},
                {"name": "Schaummittel 200L", "category": "Löschmittel", "status": "available"},
                {"name": "Stromerzeuger 5kW", "category": "Technik", "status": "available"},
            ]

            for material_data in materials_data:
                material = models.Material(**material_data)
                db.add(material)

            # Seed Operations
            now = datetime.now()
            operations_data = [
                {
                    "location": "Hauptstraße 45",
                    "vehicle": "TLF",
                    "incident_type": "Wohnungsbrand",
                    "dispatch_time": now - timedelta(minutes=12),
                    "crew": ["M. Schmidt", "T. Weber"],
                    "priority": "high",
                    "status": "active",
                    "coordinates": [47.5180, 7.5640],
                    "materials": ["1", "4"],
                    "notes": "",
                    "contact": "",
                },
                {
                    "location": "Industriepark Nord",
                    "vehicle": "Pio",
                    "incident_type": "Technische Hilfe",
                    "dispatch_time": now - timedelta(minutes=5),
                    "crew": ["K. Wagner"],
                    "priority": "medium",
                    "status": "enroute",
                    "coordinates": [47.5145, 7.5595],
                    "materials": ["6"],
                    "notes": "",
                    "contact": "",
                },
                {
                    "location": "Bahnhofstraße 12",
                    "vehicle": None,
                    "incident_type": "Fehlalarm",
                    "dispatch_time": now - timedelta(minutes=45),
                    "crew": [],
                    "priority": "low",
                    "status": "returning",
                    "coordinates": [47.5125, 7.5670],
                    "materials": [],
                    "notes": "",
                    "contact": "",
                },
                {
                    "location": "Waldweg 8",
                    "vehicle": None,
                    "incident_type": "Ölspur",
                    "dispatch_time": now - timedelta(minutes=2),
                    "crew": [],
                    "priority": "low",
                    "status": "ready",
                    "coordinates": [47.5200, 7.5585],
                    "materials": [],
                    "notes": "",
                    "contact": "",
                },
            ]

            for operation_data in operations_data:
                operation = models.Operation(**operation_data)
                db.add(operation)

            await db.commit()
            print("Database seeded successfully!")

        except Exception as e:
            print(f"Error seeding database: {e}")
            await db.rollback()
            raise


if __name__ == "__main__":
    asyncio.run(seed_database())
