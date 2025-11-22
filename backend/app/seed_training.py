"""Seed training emergency templates and locations."""
import asyncio
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session_maker
from app.models import EmergencyTemplate, TrainingLocation
from uuid import uuid4
import time

# Emergency Templates - Storm-focused scenarios
EMERGENCY_TEMPLATES = [
    # NORMAL - Wasserschaden (35%)
    {
        "title_pattern": "Wasserschaden Einfamilienhaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Keller unter Wasser, ca. 20cm Wasserhöhe. Heizung betroffen. Bewohner anwesend."
    },
    {
        "title_pattern": "Überflutung Tiefgarage",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Tiefgarage überflutet durch Starkregen. Mehrere Fahrzeuge betroffen. Wasser steigt weiter."
    },
    {
        "title_pattern": "Wassereinbruch Geschäftshaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser dringt durch Decke. Büroräume betroffen. Elektronik gefährdet."
    },
    {
        "title_pattern": "Keller auspumpen Mehrfamilienhaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grundwasser im Keller, ca. 30cm. Mehrere Wohnungen betroffen. Dringend Pumpen benötigt."
    },
    {
        "title_pattern": "Wasserschaden Erdgeschoss",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Regenwasser durch defekte Dachentwässerung. Wohnräume überflutet."
    },
    {
        "title_pattern": "Heizöl im Keller",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Heizöltank leckt. Öl im Keller, ca. 50 Liter. Kein Gewässer betroffen."
    },
    {
        "title_pattern": "Überschwemmung Industriegebiet",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Starkregen, Kanalisation überlastet. Strasse überflutet, Verkehr behindert."
    },

    # NORMAL - Sturmschaden (25%)
    {
        "title_pattern": "Dachziegel gelöst",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturm hat Dachziegel gelöst. Absturzgefahr auf Gehweg. Sicherung erforderlich."
    },
    {
        "title_pattern": "Fassadenteile lose",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Fassadenelemente durch Sturm beschädigt. Öffentlicher Bereich gefährdet."
    },
    {
        "title_pattern": "Fenster eingeschlagen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden - mehrere Fenster eingeschlagen. Gebäude offen, Wasser dringt ein."
    },
    {
        "title_pattern": "Gerüst beschädigt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baugerüst durch Sturm beschädigt. Einsturzgefahr. Absperrung notwendig."
    },
    {
        "title_pattern": "Werbetafel gefährdet",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grosse Werbetafel droht zu fallen. Sturm. Strasse muss gesperrt werden."
    },
    {
        "title_pattern": "Dach abgedeckt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden - Dachteile fehlen. Regenwasser dringt ein. Notabdeckung erforderlich."
    },

    # NORMAL - Baum (20%)
    {
        "title_pattern": "Baum auf Strasse",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum umgestürzt, blockiert Fahrbahn komplett. Verkehr gestaut."
    },
    {
        "title_pattern": "Ast auf parkiertes Auto",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grosser Ast auf Fahrzeug gefallen. Auto beschädigt. Niemand verletzt."
    },
    {
        "title_pattern": "Baum droht zu fallen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum stark angeschlagen durch Sturm. Kippt Richtung Gebäude. Sicherung dringend."
    },
    {
        "title_pattern": "Äste auf Oberleitung",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum auf Stromleitung. Kurzschlussgefahr. EW bereits informiert."
    },
    {
        "title_pattern": "Baum blockiert Gehweg",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Umgestürzter Baum versperrt Fussgängerweg. Schulweg betroffen."
    },
    {
        "title_pattern": "Wurzelwerk gelockert",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grosse Eiche nach Sturm instabil. Wurzeln aus Boden. Akute Umsturzgefahr."
    },

    # NORMAL - Keller auspumpen (10%)
    {
        "title_pattern": "Keller unter Wasser",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Kellerräume überflutet, 40cm Wasser. Heizung und Waschküche betroffen."
    },
    {
        "title_pattern": "Grundwasser im Keller",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grundwasserspiegel gestiegen. Keller läuft voll. Pumpe ausgefallen."
    },
    {
        "title_pattern": "Abwasser Rückstau",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Kanalisation überlastet. Abwasser drückt in Keller zurück. Geruchsbelästigung."
    },

    # NORMAL - Andere (10%)
    {
        "title_pattern": "Ölspur Hauptstrasse",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Lange Ölspur auf Fahrbahn, ca. 100m. Unfallgefahr. Bindemittel notwendig."
    },
    {
        "title_pattern": "Dachentwässerung verstopft",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Dachrinne überlauft. Wasser läuft an Fassade herunter. Eindringen in Mauerwerk."
    },
    {
        "title_pattern": "Lichtmast beschädigt",
        "incident_type": "strassenrettung",
        "category": "normal",
        "message_pattern": "Strassenlaterne nach Sturm schief. Umzustürzen droht. Strasse sperren."
    },
    {
        "title_pattern": "Überfluteter Parkplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Parkplatz steht unter Wasser. Mehrere Fahrzeuge betroffen. Zufahrt gesperrt."
    },
    {
        "title_pattern": "Kanaldeckel hochgedrückt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Kanaldeckel durch Wasserdruck angehoben. Stolpergefahr. Absperrung erforderlich."
    },

    # CRITICAL - Brand (40% of critical = 4% total)
    {
        "title_pattern": "Wohnungsbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Feuer in Wohnung, 2. OG. Rauchentwicklung stark. Personen evtl. noch im Gebäude."
    },
    {
        "title_pattern": "Fahrzeugbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "PKW brennt auf Parkplatz. Flammen sichtbar. Übergriff auf Nachbarfahrzeuge möglich."
    },
    {
        "title_pattern": "Brand Gartenhaus",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Gartenhütte in Vollbrand. Gasflaschen gelagert. Übergriffsgefahr auf Wohnhaus."
    },
    {
        "title_pattern": "Küchenbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Feuer in Küche, Fettbrand. Starke Rauchentwicklung. Bewohner evakuiert."
    },
    {
        "title_pattern": "Brand Dachstock",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Dachstockbrand Mehrfamilienhaus. Flammen durch Dach. Mehrere Wohnungen betroffen."
    },

    # CRITICAL - BMA (30% of critical = 3% total)
    {
        "title_pattern": "BMA Schulhaus",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Automatische Brandmeldeanlage ausgelöst. Schulhaus. Schüler werden evakuiert."
    },
    {
        "title_pattern": "BMA Altersheim",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brandmeldeanlage Pflegeheim aktiv. Melder 2. Stock Ost. Evakuation läuft."
    },
    {
        "title_pattern": "BMA Gewerbe",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "BMA Industriebetrieb. Rauchmelder Produktionshalle. Ursache unklar."
    },

    # CRITICAL - Personenrettung (20% of critical = 2% total)
    {
        "title_pattern": "Person in Lift",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Person eingeschlossen in Personenlift. 4. OG. Lift steht zwischen Stockwerken."
    },
    {
        "title_pattern": "Verkehrsunfall eingeklemmt",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "VU zwei PKW. Eine Person eingeklemmt. Sanität vor Ort. Rettung erforderlich."
    },
    {
        "title_pattern": "Absturz Baugerüst",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Person von Gerüst gestürzt. Ca. 3m Höhe. Bewusstlos. Sanität alarmiert."
    },

    # CRITICAL - Andere (10% of critical = 1% total)
    {
        "title_pattern": "Gasgeruch",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Starker Gasgeruch in Mehrfamilienhaus. Quelle unbekannt. Bewohner besorgt."
    },
    {
        "title_pattern": "Chemikalienunfall Labor",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Chemikalien ausgelaufen. Schule, Chemiesaal. Dämpfe. Gebäude wird geräumt."
    },
]

print(f"Defined {len(EMERGENCY_TEMPLATES)} emergency templates")

# Training Locations - Streets in Oberwil BL (will be geocoded via OSM)
# Format: street name, house number, building type
TRAINING_LOCATION_SEEDS = [
    # Main streets
    ("Hauptstrasse", "12", "residential"),
    ("Hauptstrasse", "45", "commercial"),
    ("Hauptstrasse", "78", "mixed"),
    ("Hauptstrasse", "123", "residential"),
    ("Hauptstrasse", "156", "commercial"),

    # Residential areas
    ("Bottmingerstrasse", "23", "residential"),
    ("Bottmingerstrasse", "67", "residential"),
    ("Bottmingerstrasse", "102", "residential"),
    ("Therwilerstrasse", "15", "mixed"),
    ("Therwilerstrasse", "89", "residential"),
    ("Therwilerstrasse", "134", "residential"),
    ("Bielstrasse", "34", "residential"),
    ("Bielstrasse", "56", "residential"),
    ("Ruchfeldstrasse", "8", "residential"),
    ("Ruchfeldstrasse", "42", "residential"),
    ("Ruchfeldstrasse", "71", "residential"),

    # Schools and public buildings
    ("Schulstrasse", "1", "commercial"),
    ("Schulstrasse", "5", "commercial"),
    ("Gempenstrasse", "10", "residential"),
    ("Gempenstrasse", "28", "mixed"),
    ("Gempenstrasse", "45", "residential"),

    # Additional residential
    ("Mühlemattweg", "14", "residential"),
    ("Mühlemattweg", "31", "residential"),
    ("Birsfeldstrasse", "7", "residential"),
    ("Birsfeldstrasse", "53", "residential"),
    ("Birsfeldstrasse", "88", "residential"),
    ("Tennweg", "9", "residential"),
    ("Tennweg", "22", "residential"),
    ("Im Hof", "3", "residential"),
    ("Im Hof", "16", "residential"),

    # Industrial/Commercial area
    ("Industriestrasse", "4", "commercial"),
    ("Industriestrasse", "18", "commercial"),
    ("Gewerbeweg", "2", "commercial"),
    ("Gewerbeweg", "11", "commercial"),

    # More residential streets
    ("Rainweg", "6", "residential"),
    ("Rainweg", "25", "residential"),
    ("Bergstrasse", "19", "residential"),
    ("Bergstrasse", "44", "residential"),
    ("Bündtenweg", "13", "residential"),
    ("Bündtenweg", "37", "residential"),
    ("Hardstrasse", "21", "residential"),
    ("Hardstrasse", "48", "residential"),

    # Additional streets for more variety
    ("Mühleweg", "5", "residential"),
    ("Mühleweg", "18", "residential"),
    ("Kirchgasse", "7", "residential"),
    ("Kirchgasse", "24", "mixed"),
    ("Brunnmattweg", "11", "residential"),
    ("Brunnmattweg", "35", "residential"),
]


async def geocode_address(street: str, house_number: str, city: str = "Oberwil", postal_code: str = "4104") -> dict | None:
    """
    Geocode an address using OpenStreetMap Nominatim API.

    Returns:
        Dict with lat/lng or None if geocoding fails
    """
    full_address = f"{street} {house_number}, {postal_code} {city}, Switzerland"

    async with httpx.AsyncClient() as client:
        try:
            # Use Nominatim API (respect usage policy: max 1 req/sec)
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": full_address,
                    "format": "json",
                    "limit": 1,
                    "countrycodes": "ch",
                },
                headers={
                    "User-Agent": "KP-Rueck-Training-System/1.0"  # Required by OSM
                },
                timeout=10.0
            )

            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    result = data[0]
                    return {
                        "latitude": float(result["lat"]),
                        "longitude": float(result["lon"]),
                        "display_name": result.get("display_name", full_address)
                    }
        except Exception as e:
            print(f"⚠️  Geocoding failed for {full_address}: {e}")
            return None

    return None


async def seed_training_data(skip_geocoding: bool = False):
    """
    Seed emergency templates and training locations.

    Args:
        skip_geocoding: If True, skip geocoding and use approximate Oberwil center coordinates.
                       Useful for production deployments to avoid slow OSM API calls.
    """
    async with async_session_maker() as session:
        print("=" * 60)
        print("SEEDING TRAINING DATA")
        print("=" * 60)

        # Check if templates already exist
        from sqlalchemy import select, func
        template_count = await session.scalar(select(func.count()).select_from(EmergencyTemplate))

        if template_count > 0:
            print(f"\n⏭️  Emergency templates already exist ({template_count} found). Skipping seed.")
            return

        # Seed emergency templates
        print(f"\n📝 Seeding {len(EMERGENCY_TEMPLATES)} emergency templates...")
        for template_data in EMERGENCY_TEMPLATES:
            template = EmergencyTemplate(
                id=uuid4(),
                **template_data
            )
            session.add(template)

        await session.commit()
        print(f"✅ Seeded {len(EMERGENCY_TEMPLATES)} emergency templates")

        # Seed training locations
        if skip_geocoding:
            print(f"\n📍 Seeding {len(TRAINING_LOCATION_SEEDS)} training locations (without geocoding)...")
            print("   Using approximate Oberwil center coordinates for all locations.")

            # Use Oberwil center coordinates as fallback
            oberwil_lat = 47.51637699933488
            oberwil_lng = 7.561800450458299

            for street, house_number, building_type in TRAINING_LOCATION_SEEDS:
                location = TrainingLocation(
                    id=uuid4(),
                    street=street,
                    house_number=house_number,
                    postal_code="4104",
                    city="Oberwil",
                    building_type=building_type,
                    latitude=oberwil_lat,
                    longitude=oberwil_lng,
                    is_active=True
                )
                session.add(location)

            await session.commit()
            print(f"✅ Seeded {len(TRAINING_LOCATION_SEEDS)} training locations with default coordinates")
        else:
            print(f"\n📍 Seeding and geocoding {len(TRAINING_LOCATION_SEEDS)} training locations...")
            print("   (This may take a while - respecting OSM rate limit of 1 req/sec)")

            successful = 0
            failed = 0

            for i, (street, house_number, building_type) in enumerate(TRAINING_LOCATION_SEEDS, 1):
                print(f"\n   [{i}/{len(TRAINING_LOCATION_SEEDS)}] Geocoding {street} {house_number}...", end=" ")

                # Geocode via OpenStreetMap
                geo_result = await geocode_address(street, house_number)

                if geo_result:
                    location = TrainingLocation(
                        id=uuid4(),
                        street=street,
                        house_number=house_number,
                        postal_code="4104",
                        city="Oberwil",
                        building_type=building_type,
                        latitude=geo_result["latitude"],
                        longitude=geo_result["longitude"],
                        is_active=True
                    )
                    session.add(location)
                    successful += 1
                    print(f"✅ ({geo_result['latitude']:.6f}, {geo_result['longitude']:.6f})")
                else:
                    # Add without coordinates if geocoding fails
                    location = TrainingLocation(
                        id=uuid4(),
                        street=street,
                        house_number=house_number,
                        postal_code="4104",
                        city="Oberwil",
                        building_type=building_type,
                        latitude=None,
                        longitude=None,
                        is_active=True
                    )
                    session.add(location)
                    failed += 1
                    print("⚠️  No coordinates (added anyway)")

                # Respect OSM rate limit: 1 request per second
                if i < len(TRAINING_LOCATION_SEEDS):
                    await asyncio.sleep(1.1)

            await session.commit()
            print(f"✅ Training Locations:  {successful} geocoded, {failed} without coordinates")

        print("\n" + "=" * 60)
        print("SEEDING COMPLETE")
        print("=" * 60)
        print(f"✅ Emergency Templates: {len(EMERGENCY_TEMPLATES)}")
        print(f"✅ Training Locations:  {len(TRAINING_LOCATION_SEEDS)}")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(seed_training_data())
