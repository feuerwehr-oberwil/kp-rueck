"""Seed training emergency templates and locations."""

import asyncio
import random
from uuid import uuid4

import httpx

from app.database import async_session_maker
from app.models import EmergencyTemplate, TrainingLocation

# Emergency Templates - Storm and water-focused scenarios
EMERGENCY_TEMPLATES = [
    # ========================================
    # NORMAL - Wasserschaden / Keller auspumpen
    # ========================================
    {
        "title_pattern": "Wasser im Keller Einfamilienhaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller. Ca. 25cm Wasser, Heizung betroffen.",
    },
    {
        "title_pattern": "Überflutung Tiefgarage",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Tiefgarage. Ca. 40cm, mehrere Fahrzeuge drin.",
    },
    {
        "title_pattern": "Wasserschaden Mehrfamilienhaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, MFH. Wasser durch Kellerfenster, Waschküche betroffen.",
    },
    {
        "title_pattern": "Keller auspumpen Gewerbebetrieb",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller, Gewerbebetrieb. Ca. 35cm, Lagerware gefährdet.",
    },
    {
        "title_pattern": "Wassereinbruch nach Rohrbruch",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Rohrbruch, Keller. Haupthahn abgestellt, Wasser steht noch.",
    },
    {
        "title_pattern": "Keller geflutet Reihenhaussiedlung",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Reihenhaussiedlung. Mehrere Keller, ca. 20-30cm.",
    },
    {
        "title_pattern": "Wasserschaden Schule",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Turnhalle UG. Sportgeräte im Wasser.",
    },
    {
        "title_pattern": "Wasser in Liftschacht",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Liftschacht, MFH. Lift ausser Betrieb.",
    },
    {
        "title_pattern": "Überfluteter Parkplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Parkplatz. Abfluss verstopft, Fahrzeuge stehen im Wasser.",
    },
    {
        "title_pattern": "Wasserschaden Arztpraxis",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller Arztpraxis. Medizinische Geräte im Lager.",
    },
    {
        "title_pattern": "Rückstau Kanalisation",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Kanalrückstau, Abwasser im Keller. Geruchsbelästigung.",
    },
    {
        "title_pattern": "Wasser im Keller",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller nach Regen. Ca. 5cm, ein Raum.",
    },
    {
        "title_pattern": "Keller feucht",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller. Ca. 10cm, nur ein Abteil.",
    },
    {
        "title_pattern": "Wasser in Waschküche",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser in Waschküche. Ca. 3cm, Maschine steht im Wasser.",
    },
    {
        "title_pattern": "Keller vollgelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Keller komplett unter Wasser. Ca. 50cm, mehrere Räume.",
    },
    {
        "title_pattern": "Wasserschaden Hobbyraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Hobbyraum UG. Ca. 15cm. Bewohner sehr aufgelöst wegen Modelleisenbahn.",
    },
    {
        "title_pattern": "Wasser im Veloraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Veloraum. Ca. 8cm, 12 E-Bikes im Wasser.",
    },
    {
        "title_pattern": "Pfütze im Keller",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller, kleine Pfütze. Ca. 2cm, Ursache unklar.",
    },
    {
        "title_pattern": "Keller halb voll",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller. Ca. 30cm, Heizraum betroffen.",
    },
    {
        "title_pattern": "Garage unter Wasser",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser in Garage. Ca. 12cm, Auto steht drin.",
    },
    {
        "title_pattern": "Wasser im Lagerraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller, Lagerraum. Ca. 6cm, Kartons betroffen.",
    },
    {
        "title_pattern": "Wasser im Keller Restaurant",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Restaurant-Lager. Ca. 25cm, Lebensmittel gefährdet.",
    },
    {
        "title_pattern": "Überschwemmung Garageneinfahrt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Tiefgarageneinfahrt. Wasser läuft rein, Ablauf verstopft.",
    },
    {
        "title_pattern": "Wasserschaden Kindergarten",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller Kindergarten. Spielsachen und Material betroffen.",
    },
    {
        "title_pattern": "Waschmaschine ausgelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Waschmaschine defekt. Ca. 3cm im Keller. Melder etwas aufgeregt.",
    },
    {
        "title_pattern": "Pool übergelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Gartenpool läuft über, Wasser in Nachbars Keller. Nachbarschaftsstreit.",
    },
    {
        "title_pattern": "Dachentwässerung verstopft",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Dachrinne verstopft, Wasser läuft an Fassade runter.",
    },
    # ========================================
    # NORMAL - Sturmschaden
    # ========================================
    {
        "title_pattern": "Dachziegel gelöst",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Dachziegel lose. Absturzgefahr auf Gehweg.",
    },
    {
        "title_pattern": "Fassadenteile lose",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Fassadenteile lose. Über Gehweg.",
    },
    {
        "title_pattern": "Fenster eingeschlagen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Fenster eingeschlagen. Wasser dringt ein.",
    },
    {
        "title_pattern": "Gerüst beschädigt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Baugerüst instabil. Einsturzgefahr.",
    },
    {
        "title_pattern": "Werbetafel gefährdet",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, grosse Werbetafel droht zu fallen.",
    },
    {
        "title_pattern": "Dach abgedeckt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Dach teilweise abgedeckt. Regen dringt ein.",
    },
    {
        "title_pattern": "Trampolin auf Strasse",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Trampolin auf Fahrbahn. Blockiert eine Spur.",
    },
    {
        "title_pattern": "Sonnenstoren lose",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Storen hängt lose. Schlägt gegen Fenster.",
    },
    # ========================================
    # NORMAL - Baum
    # ========================================
    {
        "title_pattern": "Baum auf Strasse",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum auf Strasse, blockiert Fahrbahn komplett.",
    },
    {
        "title_pattern": "Ast auf parkiertes Auto",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grosser Ast auf parkiertes Auto. Keine Verletzten.",
    },
    {
        "title_pattern": "Baum droht zu fallen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum instabil nach Sturm. Kippt Richtung Gebäude.",
    },
    {
        "title_pattern": "Äste auf Oberleitung",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum auf Stromleitung. EW informiert.",
    },
    {
        "title_pattern": "Baum blockiert Gehweg",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum auf Fussgängerweg, Schulweg betroffen.",
    },
    {
        "title_pattern": "Wurzelwerk gelockert",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grosse Eiche instabil, Wurzeln aus Boden. Umsturzgefahr.",
    },
    {
        "title_pattern": "Ast auf Spielplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Ast auf Spielplatz gefallen. Spielplatz gesperrt.",
    },
    # ========================================
    # NORMAL - Öl / Technisch / Divers
    # ========================================
    {
        "title_pattern": "Heizöl im Keller",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Ölwehr, Heizöltank leckt. Ca. 50 Liter im Keller.",
    },
    {
        "title_pattern": "Ölspur Hauptstrasse",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Ölspur auf Fahrbahn. Ca. 100m lang.",
    },
    {
        "title_pattern": "Ölspur Kreisel",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Ölspur im Kreisel, LKW verliert Hydrauliköl. Ca. 30m.",
    },
    {
        "title_pattern": "Lichtmast beschädigt",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "message_pattern": "Strassenlaterne schief nach Sturm. Droht umzufallen.",
    },
    {
        "title_pattern": "Überfluteter Parkplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Parkplatz unter Wasser. Zufahrt gesperrt.",
    },
    {
        "title_pattern": "Kanaldeckel hochgedrückt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Kanaldeckel angehoben durch Wasserdruck. Stolpergefahr.",
    },
    {
        "title_pattern": "Tiefgaragentor klemmt",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "message_pattern": "Tiefgaragentor blockiert, 6 Fahrzeuge eingeschlossen.",
    },
    {
        "title_pattern": "Bagger reisst Wasserleitung",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "message_pattern": "Baustelle, Bagger hat Wasserleitung erwischt. Wasser spritzt.",
    },
    {
        "title_pattern": "Wespennest am Schulhaus",
        "incident_type": "diverse_einsaetze",
        "category": "normal",
        "message_pattern": "Wespennest beim Eingang Schule. Schädlingsbekämpfer erst morgen verfügbar.",
    },
    {
        "title_pattern": "Katze auf Baum",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Katze auf Baum, seit 2 Tagen. Besitzerin am Verzweifeln.",
    },
    {
        "title_pattern": "Ente in Lichtschacht",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Ente mit 6 Küken im Lichtschacht. Kommen nicht raus.",
    },
    {
        "title_pattern": "Igel im Kellerschacht",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Igel in Kellerschacht. Bewohner füttert ihn seit einer Woche, will ihn jetzt raus haben.",
    },
    {
        "title_pattern": "Schwan auf Strasse",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Schwan blockiert Kreuzung. Polizei hat aufgegeben.",
    },
    # ========================================
    # CRITICAL - Brand
    # ========================================
    {
        "title_pattern": "Wohnungsbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Wohnung 2. OG. Starker Rauch, Personen evtl. noch drin.",
    },
    {
        "title_pattern": "Fahrzeugbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Fahrzeugbrand auf Parkplatz. Flammen sichtbar.",
    },
    {
        "title_pattern": "Brand Gartenhaus",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Gartenhütte in Vollbrand. Gasflaschen drin.",
    },
    {
        "title_pattern": "Küchenbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand klein, Küche Fettbrand. Starker Rauch, Bewohner draussen.",
    },
    {
        "title_pattern": "Brand Dachstock",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Dachstock MFH. Flammen durch Dach sichtbar.",
    },
    {
        "title_pattern": "Brand Tiefgarage",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Rauch aus Tiefgarage, vermutlich Fahrzeugbrand. Starke Verrauchung.",
    },
    {
        "title_pattern": "Brand Abfallcontainer",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand klein, Abfallcontainer unter Vordach. Flammen schlagen hoch.",
    },
    {
        "title_pattern": "Brand Werkstatt",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Schreinerei. Starke Flammen, viel Holz. Keine Personen.",
    },
    {
        "title_pattern": "E-Bike Brand Keller",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, E-Bike-Akku im Veloraum. Rauch im Treppenhaus.",
    },
    # ========================================
    # CRITICAL - BMA
    # ========================================
    {
        "title_pattern": "BMA Schulhaus",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Schulhaus. Evakuation läuft.",
    },
    {
        "title_pattern": "BMA Altersheim",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Pflegeheim. Melder 2. Stock Ost.",
    },
    {
        "title_pattern": "BMA Gewerbe",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Industriebetrieb. Melder Produktionshalle.",
    },
    {
        "title_pattern": "BMA Einkaufszentrum",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Einkaufszentrum. Melder Küche Food Court.",
    },
    {
        "title_pattern": "BMA Hallenbad",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Hallenbad. Melder Technikraum, Chloranlage in der Nähe.",
    },
    {
        "title_pattern": "BMA Wohnheim",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Studentenwohnheim. Melder 3. OG Küche.",
    },
    # ========================================
    # CRITICAL - Personenrettung
    # ========================================
    {
        "title_pattern": "Person in Lift",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Person in Lift eingeschlossen, 4. OG. Steht zwischen Stockwerken.",
    },
    {
        "title_pattern": "Verkehrsunfall eingeklemmt",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "VU, 2 PKW. Eine Person eingeklemmt. Sanität vor Ort.",
    },
    {
        "title_pattern": "Absturz Baugerüst",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Person ab Gerüst gestürzt, ca. 3m. Bewusstlos.",
    },
    {
        "title_pattern": "Kind in Schacht",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Kind in Kanalschacht gefallen. Ansprechbar.",
    },
    {
        "title_pattern": "Auffahrunfall Kreuzung",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "VU, Auffahrunfall 3 Fahrzeuge. Betriebsstoffe laufen aus.",
    },
    # ========================================
    # CRITICAL - Andere
    # ========================================
    {
        "title_pattern": "Gasgeruch",
        "incident_type": "chemiewehr",
        "category": "critical",
        "message_pattern": "Gasgeruch in MFH. Quelle unbekannt, Bewohner draussen.",
    },
    {
        "title_pattern": "Chemikalienunfall Labor",
        "incident_type": "chemiewehr",
        "category": "critical",
        "message_pattern": "Chemie ausgelaufen, Schule Chemiesaal. Dämpfe, Gebäude wird geräumt.",
    },
    {
        "title_pattern": "Chlorgeruch Hallenbad",
        "incident_type": "chemiewehr",
        "category": "critical",
        "message_pattern": "Chlorgeruch Hallenbad. Dosieranlage vermutlich defekt.",
    },
]

print(f"Defined {len(EMERGENCY_TEMPLATES)} emergency templates")


def get_training_area_bounds() -> dict:
    """Get the training area bounds.

    CUSTOMIZE: Replace with coordinates for your geographic area.
    Use https://boundingbox.klokantech.com/ to find bounds for your area.
    """
    return {
        "min_lat": 47.508,
        "max_lat": 47.522,
        "min_lon": 7.552,
        "max_lon": 7.568,
    }


def get_training_city_info() -> tuple[str, str]:
    """Get city and postal code for training locations."""
    return ("Demo City", "0000")


# Geographic bounding box for training location generation
# CUSTOMIZE: Replace with coordinates for your geographic area
# Use https://boundingbox.klokantech.com/ to find bounds for your area
TRAINING_AREA_BOUNDS = get_training_area_bounds()


async def reverse_geocode_random_point(client: httpx.AsyncClient) -> dict | None:
    """
    Generate a random coordinate within the training area and find the real address
    at that location using Nominatim reverse geocoding.

    Returns:
        Dict with street, house_number, building_type, latitude, longitude if successful
        None if no valid address found
    """
    # Generate random coordinate within training area bounds
    lat = random.uniform(TRAINING_AREA_BOUNDS["min_lat"], TRAINING_AREA_BOUNDS["max_lat"])
    lon = random.uniform(TRAINING_AREA_BOUNDS["min_lon"], TRAINING_AREA_BOUNDS["max_lon"])

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
            timeout=5.0,
        )

        if response.status_code == 200:
            data = response.json()
            address = data.get("address", {})

            # Extract address components
            street = address.get("road")
            house_number = address.get("house_number")
            postcode = address.get("postcode")
            city = address.get("city") or address.get("town") or address.get("village")

            # Verify we got a valid address with street and house number
            if street and house_number:
                # Use the actual coordinates returned by Nominatim (more accurate)
                actual_lat = float(data["lat"])
                actual_lon = float(data["lon"])

                # Determine building type from OSM data
                building_type = "residential"
                if "amenity" in address or "shop" in address or "office" in address:
                    building_type = "commercial"
                elif any(word in street.lower() for word in ["haupt", "bahn", "schul", "main", "station"]):
                    building_type = "mixed"

                return {
                    "street": street,
                    "house_number": house_number,
                    "building_type": building_type,
                    "latitude": actual_lat,
                    "longitude": actual_lon,
                }
    except Exception:
        pass

    return None


async def fetch_real_addresses_reverse_geocode(target_count: int = 50) -> list[tuple[str, str, str, float, float]]:
    """
    Generate real addresses by randomly sampling coordinates within the training area
    and using reverse geocoding to find actual addresses.

    This approach guarantees real addresses because we're asking "what address is here"
    rather than "does this address exist".

    Returns:
        List of tuples: (street_name, house_number, building_type, latitude, longitude)
    """
    print("\n🗺️  Generating real addresses via reverse geocoding...")
    print(f"   Randomly sampling {target_count} points within training area boundaries")

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
                addresses.append(
                    (
                        result["street"],
                        result["house_number"],
                        result["building_type"],
                        result["latitude"],
                        result["longitude"],
                    )
                )

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
        from sqlalchemy import func, select

        template_count = await session.scalar(select(func.count()).select_from(EmergencyTemplate))

        if template_count > 0:
            print(f"\n⏭️  Emergency templates already exist ({template_count} found). Skipping seed.")
            return

        # Seed emergency templates
        print(f"\n📝 Seeding {len(EMERGENCY_TEMPLATES)} emergency templates...")
        for template_data in EMERGENCY_TEMPLATES:
            template = EmergencyTemplate(id=uuid4(), **template_data)
            session.add(template)

        await session.commit()
        print(f"✅ Seeded {len(EMERGENCY_TEMPLATES)} emergency templates")

        # Seed training locations using reverse geocoding
        target_count = 50
        addresses = []

        if skip_geocoding:
            print("\n⚠️  Skip geocoding enabled - using demo fallback location")
            # Fallback: use generic demo location (configure for your area)
            addresses = [("Hauptstrasse", "1", "commercial", 47.5596, 7.5886)]
        else:
            # Use reverse geocoding to find real addresses
            addresses = await fetch_real_addresses_reverse_geocode(target_count)

            if not addresses:
                print("\n⚠️  Reverse geocoding failed - using demo fallback location")
                addresses = [("Hauptstrasse", "1", "commercial", 47.5596, 7.5886)]

        print(f"\n📍 Seeding {len(addresses)} real addresses...")

        city, postal_code = get_training_city_info()
        for street, house_number, building_type, lat, lon in addresses:
            location = TrainingLocation(
                id=uuid4(),
                street=street,
                house_number=house_number,
                postal_code=postal_code,
                city=city,
                building_type=building_type,
                latitude=lat,
                longitude=lon,
                is_active=True,
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
