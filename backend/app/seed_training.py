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


async def fetch_real_addresses_from_osm(target_count: int = 50) -> list[tuple[str, str, str, float, float]]:
    """
    Fetch real addresses from OpenStreetMap for Oberwil BL.

    Returns:
        List of tuples: (street_name, house_number, building_type, latitude, longitude)
    """
    print(f"\n🗺️  Fetching real addresses from OpenStreetMap for Oberwil...")

    addresses = []

    async with httpx.AsyncClient() as client:
        try:
            # Search for addresses in Oberwil using Overpass API
            overpass_url = "https://overpass-api.de/api/interpreter"

            # Query for addresses in Oberwil (postal code 4104)
            query = """
            [out:json][timeout:25];
            area["ISO3166-2"="CH-BL"]["name"="Basel-Landschaft"]->.a;
            (
              node["addr:street"]["addr:housenumber"]["addr:postcode"="4104"](area.a);
            );
            out body;
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

                print(f"   Found {len(elements)} addresses in OpenStreetMap")

                # Process and deduplicate addresses
                seen = set()
                for element in elements:
                    tags = element.get("tags", {})
                    street = tags.get("addr:street")
                    housenumber = tags.get("addr:housenumber")
                    lat = element.get("lat")
                    lon = element.get("lon")

                    if street and housenumber and lat and lon:
                        # Create unique key
                        key = f"{street}_{housenumber}"
                        if key not in seen:
                            seen.add(key)

                            # Guess building type based on street name
                            building_type = "residential"
                            if any(word in street.lower() for word in ["schul", "industrie", "gewerbe"]):
                                building_type = "commercial"
                            elif any(word in street.lower() for word in ["haupt", "bahn"]):
                                building_type = "mixed"

                            addresses.append((street, housenumber, building_type, float(lat), float(lon)))

                            if len(addresses) >= target_count:
                                break

                # Shuffle for variety
                random.shuffle(addresses)
                addresses = addresses[:target_count]

                print(f"   ✅ Selected {len(addresses)} diverse addresses")
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

        # Seed training locations from OpenStreetMap
        print(f"\n📍 Fetching real addresses from OpenStreetMap...")

        # Fetch real addresses from OSM
        osm_addresses = await fetch_real_addresses_from_osm(target_count=50)

        if osm_addresses and len(osm_addresses) > 0:
            print(f"   Using {len(osm_addresses)} real addresses from OSM")

            for street, house_number, building_type, lat, lon in osm_addresses:
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
            print(f"✅ Seeded {len(osm_addresses)} training locations with real OSM coordinates")
        else:
            # Fallback: Use Oberwil center if OSM fetch fails
            print(f"   ⚠️  OSM fetch failed, using fallback location (Oberwil center)")

            oberwil_lat = 47.51637699933488
            oberwil_lng = 7.561800450458299

            # Create at least one fallback location
            location = TrainingLocation(
                id=uuid4(),
                street="Hauptstrasse",
                house_number="1",
                postal_code="4104",
                city="Oberwil",
                building_type="mixed",
                latitude=oberwil_lat,
                longitude=oberwil_lng,
                is_active=True
            )
            session.add(location)
            await session.commit()
            print(f"✅ Seeded 1 fallback training location")

        print("\n" + "=" * 60)
        print("SEEDING COMPLETE")
        print("=" * 60)
        print(f"✅ Emergency Templates: {len(EMERGENCY_TEMPLATES)}")
        print(f"✅ Training Locations:  {len(osm_addresses) if osm_addresses else 1} (from OSM)")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(seed_training_data())
