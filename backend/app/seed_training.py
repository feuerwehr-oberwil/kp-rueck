"""Seed training emergency templates and locations."""
import asyncio
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session_maker
from app.models import EmergencyTemplate, TrainingLocation
from uuid import uuid4
import time
import random

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


# Oberwil BL bounding box (approximate area)
# These coordinates define the rectangle that contains Oberwil
OBERWIL_BOUNDS = {
    "min_lat": 47.508,   # Southern boundary
    "max_lat": 47.522,   # Northern boundary
    "min_lon": 7.552,    # Western boundary
    "max_lon": 7.568     # Eastern boundary
}


async def reverse_geocode_random_point(client: httpx.AsyncClient) -> dict | None:
    """
    Generate a random coordinate within Oberwil and find the real address at that location
    using Nominatim reverse geocoding.

    Returns:
        Dict with street, house_number, building_type, latitude, longitude if successful
        None if no valid address found
    """
    # Generate random coordinate within Oberwil bounds
    lat = random.uniform(OBERWIL_BOUNDS["min_lat"], OBERWIL_BOUNDS["max_lat"])
    lon = random.uniform(OBERWIL_BOUNDS["min_lon"], OBERWIL_BOUNDS["max_lon"])

    try:
        # Use Nominatim reverse geocoding to find address at this coordinate
        response = await client.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat,
                "lon": lon,
                "format": "json",
                "addressdetails": 1,
                "zoom": 18,  # Building level
            },
            headers={"User-Agent": "KP-Rueck-Training-System/1.0"},
            timeout=5.0
        )

        if response.status_code == 200:
            data = response.json()
            address = data.get("address", {})

            # Extract address components
            street = address.get("road")
            house_number = address.get("house_number")
            postcode = address.get("postcode")
            city = address.get("city") or address.get("town") or address.get("village")

            # Verify this is actually in Oberwil with a house number
            if (street and house_number and
                postcode == "4104" and
                city and city.lower() == "oberwil"):

                # Use the actual coordinates returned by Nominatim (more accurate)
                actual_lat = float(data["lat"])
                actual_lon = float(data["lon"])

                # Determine building type from OSM data
                building_type = "residential"
                if "amenity" in address or "shop" in address or "office" in address:
                    building_type = "commercial"
                elif any(word in street.lower() for word in ["haupt", "bahn", "schul"]):
                    building_type = "mixed"

                return {
                    "street": street,
                    "house_number": house_number,
                    "building_type": building_type,
                    "latitude": actual_lat,
                    "longitude": actual_lon
                }
    except Exception:
        pass

    return None


async def fetch_real_addresses_reverse_geocode(target_count: int = 50) -> list[tuple[str, str, str, float, float]]:
    """
    Generate real addresses by randomly sampling coordinates within Oberwil
    and using reverse geocoding to find actual addresses.

    This approach guarantees real addresses because we're asking "what address is here"
    rather than "does this address exist".

    Returns:
        List of tuples: (street_name, house_number, building_type, latitude, longitude)
    """
    print(f"\n🗺️  Generating real addresses via reverse geocoding...")
    print(f"   Randomly sampling {target_count} points within Oberwil boundaries")

    addresses = []
    seen = set()
    attempts = 0
    max_attempts = target_count * 10  # Try up to 10x the target to account for duplicates

    async with httpx.AsyncClient() as client:
        while len(addresses) < target_count and attempts < max_attempts:
            attempts += 1

            # Get address at random point
            result = await reverse_geocode_random_point(client)

            if result:
                # Create unique key
                key = f"{result['street']}_{result['house_number']}"

                # Skip if we've already found this address
                if key in seen:
                    continue

                seen.add(key)
                addresses.append((
                    result["street"],
                    result["house_number"],
                    result["building_type"],
                    result["latitude"],
                    result["longitude"]
                ))

                print(f"      ✓ {result['street']} {result['house_number']} ({len(addresses)}/{target_count})")

            # Rate limit: 1 request per second for Nominatim
            await asyncio.sleep(1.1)

        print(f"   ✅ Found {len(addresses)} unique real addresses (took {attempts} attempts)")

        # Shuffle for variety
        random.shuffle(addresses)

        return addresses


async def seed_training_data(skip_geocoding: bool = False):
    """
    Seed emergency templates and training locations.

    Args:
        skip_geocoding: If True, use fallback to Oberwil center instead of reverse geocoding.
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

        # Seed training locations using reverse geocoding
        target_count = 50
        addresses = []

        if skip_geocoding:
            print(f"\n⚠️  Skip geocoding enabled - using fallback to Oberwil center")
            # Fallback: use Oberwil center
            addresses = [("Hauptstrasse", "95", "commercial", 47.5164, 7.5618)]
        else:
            # Use reverse geocoding to find real addresses
            addresses = await fetch_real_addresses_reverse_geocode(target_count)

            if not addresses:
                print(f"\n⚠️  Reverse geocoding failed - using fallback to Oberwil center")
                addresses = [("Hauptstrasse", "95", "commercial", 47.5164, 7.5618)]

        print(f"\n📍 Seeding {len(addresses)} real addresses...")

        for street, house_number, building_type, lat, lon in addresses:
            location = TrainingLocation(
                id=uuid4(),
                street=street,
                house_number=house_number,
                postal_code="4104",
                city="Oberwil",
                building_type=building_type,
                latitude=lat,
                longitude=lon,
                is_active=True
            )
            session.add(location)

        await session.commit()
        print(f"✅ Seeded {len(addresses)} training locations")

        print("\n" + "=" * 60)
        print("SEEDING COMPLETE")
        print("=" * 60)
        print(f"✅ Emergency Templates: {len(EMERGENCY_TEMPLATES)}")
        print(f"✅ Training Locations:  {len(addresses)} (reverse geocoded)")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(seed_training_data())
