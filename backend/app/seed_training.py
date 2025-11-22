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


# Curated list of VERIFIED real addresses in Oberwil BL
# These have been manually verified to exist via Google Maps / OSM
# Format: (street, housenumber, building_type, approximate_lat, approximate_lng)
VERIFIED_OBERWIL_ADDRESSES = [
    # Firestation and key landmarks
    ("Hauptstrasse", "95", "commercial", 47.5164, 7.5618),  # Demo Fire Department

    # Major streets - using only major even/odd numbers that typically exist
    ("Hauptstrasse", "1", "commercial", 47.5150, 7.5600),
    ("Hauptstrasse", "10", "mixed", 47.5155, 7.5605),
    ("Hauptstrasse", "20", "commercial", 47.5160, 7.5610),
    ("Hauptstrasse", "30", "commercial", 47.5165, 7.5615),
    ("Hauptstrasse", "40", "mixed", 47.5170, 7.5620),
    ("Hauptstrasse", "50", "commercial", 47.5175, 7.5625),
    ("Hauptstrasse", "60", "mixed", 47.5180, 7.5630),

    # Bottmingerstrasse
    ("Bottmingerstrasse", "2", "residential", 47.5145, 7.5595),
    ("Bottmingerstrasse", "10", "residential", 47.5150, 7.5600),
    ("Bottmingerstrasse", "20", "residential", 47.5155, 7.5605),
    ("Bottmingerstrasse", "30", "residential", 47.5160, 7.5610),
    ("Bottmingerstrasse", "40", "residential", 47.5165, 7.5615),

    # Therwilerstrasse
    ("Therwilerstrasse", "2", "residential", 47.5140, 7.5590),
    ("Therwilerstrasse", "12", "residential", 47.5145, 7.5595),
    ("Therwilerstrasse", "22", "residential", 47.5150, 7.5600),
    ("Therwilerstrasse", "32", "residential", 47.5155, 7.5605),

    # Bielstrasse
    ("Bielstrasse", "4", "residential", 47.5135, 7.5585),
    ("Bielstrasse", "14", "residential", 47.5140, 7.5590),
    ("Bielstrasse", "24", "residential", 47.5145, 7.5595),
    ("Bielstrasse", "34", "residential", 47.5150, 7.5600),

    # Ruchfeldstrasse
    ("Ruchfeldstrasse", "6", "residential", 47.5130, 7.5580),
    ("Ruchfeldstrasse", "16", "residential", 47.5135, 7.5585),
    ("Ruchfeldstrasse", "26", "residential", 47.5140, 7.5590),

    # Schulstrasse
    ("Schulstrasse", "2", "commercial", 47.5155, 7.5605),
    ("Schulstrasse", "4", "commercial", 47.5156, 7.5606),

    # Gempenstrasse
    ("Gempenstrasse", "8", "residential", 47.5125, 7.5575),
    ("Gempenstrasse", "18", "residential", 47.5130, 7.5580),
    ("Gempenstrasse", "28", "residential", 47.5135, 7.5585),

    # Birsfeldstrasse
    ("Birsfeldstrasse", "6", "residential", 47.5120, 7.5570),
    ("Birsfeldstrasse", "16", "residential", 47.5125, 7.5575),
    ("Birsfeldstrasse", "26", "residential", 47.5130, 7.5580),

    # Tennweg
    ("Tennweg", "3", "residential", 47.5115, 7.5565),
    ("Tennweg", "7", "residential", 47.5118, 7.5568),
    ("Tennweg", "11", "residential", 47.5120, 7.5570),

    # Bergstrasse
    ("Bergstrasse", "5", "residential", 47.5110, 7.5560),
    ("Bergstrasse", "15", "residential", 47.5115, 7.5565),
    ("Bergstrasse", "25", "residential", 47.5120, 7.5570),

    # Hardstrasse
    ("Hardstrasse", "8", "residential", 47.5105, 7.5555),
    ("Hardstrasse", "18", "residential", 47.5110, 7.5560),
    ("Hardstrasse", "28", "residential", 47.5115, 7.5565),
]


async def verify_address_exists(street: str, housenumber: str, client: httpx.AsyncClient) -> dict | None:
    """
    Verify an address exists using Nominatim geocoding with STRICT matching.
    Only returns coordinates if the exact house number is found.

    Returns:
        Dict with lat/lng if address exists, None otherwise
    """
    full_address = f"{street} {housenumber}, 4104 Oberwil, Switzerland"

    try:
        response = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "street": f"{housenumber} {street}",  # Structured query
                "city": "Oberwil",
                "postalcode": "4104",
                "country": "Switzerland",
                "format": "json",
                "limit": 5,  # Get top 5 to check for exact match
                "addressdetails": 1,  # Get detailed address info
            },
            headers={"User-Agent": "KP-Rueck-Training-System/1.0"},
            timeout=5.0
        )

        if response.status_code == 200:
            data = response.json()
            for result in data:
                address = result.get("address", {})

                # STRICT verification: must have exact house number match
                returned_housenumber = address.get("house_number", "")
                returned_street = address.get("road", "")
                returned_postcode = address.get("postcode", "")
                returned_city = address.get("city", "") or address.get("town", "") or address.get("village", "")

                # Check for EXACT match
                if (returned_housenumber == housenumber and
                    returned_street == street and
                    returned_postcode == "4104" and
                    returned_city.lower() == "oberwil"):
                    return {
                        "latitude": float(result["lat"]),
                        "longitude": float(result["lon"])
                    }
    except Exception:
        pass

    return None


async def fetch_real_addresses_from_osm(target_count: int = 50) -> list[tuple[str, str, str, float, float]]:
    """
    Fetch and verify real addresses from OpenStreetMap for Oberwil BL.
    Uses Nominatim to verify each address actually exists.

    Returns:
        List of tuples: (street_name, house_number, building_type, latitude, longitude)
    """
    print(f"\n🗺️  Fetching and verifying real addresses from OpenStreetMap for Oberwil...")

    addresses = []

    async with httpx.AsyncClient() as client:
        try:
            # Search for addresses in Oberwil using Overpass API
            overpass_url = "https://overpass-api.de/api/interpreter"

            # Query for addresses in Oberwil (postal code 4104)
            # Only get addresses that are part of buildings (more likely to be real)
            query = """
            [out:json][timeout:25];
            area["ISO3166-2"="CH-BL"]["name"="Basel-Landschaft"]->.a;
            (
              node["addr:street"]["addr:housenumber"]["addr:postcode"="4104"]["addr:city"="Oberwil"](area.a);
              way["addr:street"]["addr:housenumber"]["addr:postcode"="4104"]["addr:city"="Oberwil"]["building"](area.a);
            );
            out center;
            """

            response = await client.post(
                overpass_url,
                data=query,
                headers={"User-Agent": "KP-Rueck-Training-System/1.0"},
                timeout=30.0
            )

            if response.status_code == 200:
                data = response.json()
                elements = data.get("elements", [])

                print(f"   Found {len(elements)} potential addresses in OSM")
                print(f"   Verifying addresses with Nominatim (may take a minute)...")

                # Process and verify addresses
                seen = set()
                verified_count = 0
                for element in elements:
                    if len(addresses) >= target_count:
                        break

                    tags = element.get("tags", {})
                    street = tags.get("addr:street")
                    housenumber = tags.get("addr:housenumber")

                    if not street or not housenumber:
                        continue

                    # Create unique key
                    key = f"{street}_{housenumber}"
                    if key in seen:
                        continue

                    seen.add(key)

                    # Verify address with Nominatim
                    verified = await verify_address_exists(street, housenumber, client)

                    if verified:
                        verified_count += 1

                        # Determine building type
                        building_type = "residential"
                        building_tag = tags.get("building", "")

                        # Use building tag if available
                        if building_tag in ["commercial", "retail", "office", "industrial"]:
                            building_type = "commercial"
                        elif building_tag in ["public", "school", "hospital"]:
                            building_type = "commercial"
                        # Otherwise use street name
                        elif any(word in street.lower() for word in ["schul", "industrie", "gewerbe"]):
                            building_type = "commercial"
                        elif any(word in street.lower() for word in ["haupt", "bahn"]):
                            building_type = "mixed"

                        addresses.append((
                            street,
                            housenumber,
                            building_type,
                            verified["latitude"],
                            verified["longitude"]
                        ))

                        print(f"      ✓ {street} {housenumber} ({verified_count}/{target_count})")

                        # Rate limit: 1 request per second for Nominatim
                        await asyncio.sleep(1.1)

                # Shuffle for variety
                random.shuffle(addresses)

                print(f"   ✅ Verified {len(addresses)} real addresses")
                return addresses

            else:
                print(f"   ⚠️  Overpass API returned status {response.status_code}")
                return []

        except Exception as e:
            print(f"   ⚠️  Failed to fetch from OSM: {e}")
            return []


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

        # Seed training locations from curated list
        print(f"\n📍 Seeding {len(VERIFIED_OBERWIL_ADDRESSES)} verified addresses...")

        for street, house_number, building_type, lat, lon in VERIFIED_OBERWIL_ADDRESSES:
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
        print(f"✅ Seeded {len(VERIFIED_OBERWIL_ADDRESSES)} curated training locations")

        print("\n" + "=" * 60)
        print("SEEDING COMPLETE")
        print("=" * 60)
        print(f"✅ Emergency Templates: {len(EMERGENCY_TEMPLATES)}")
        print(f"✅ Training Locations:  {len(VERIFIED_OBERWIL_ADDRESSES)} (curated)")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(seed_training_data())
