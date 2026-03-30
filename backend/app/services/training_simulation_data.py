"""Random data generators for training simulation, contextual to incident type."""

import random

# Danger profiles per incident type: which dangers are likely and their probability
_DANGER_PROFILES: dict[str, dict[str, float]] = {
    "brandbekaempfung": {
        "fire_danger": 0.95,
        "explosion": 0.3,
        "collapse": 0.4,
        "chemical": 0.15,
        "electrical": 0.5,
    },
    "elementarereignis": {
        "fire_danger": 0.05,
        "explosion": 0.02,
        "collapse": 0.3,
        "chemical": 0.05,
        "electrical": 0.35,
    },
    # Elementarereignis subcategory overrides
    "elementar_water": {
        "fire_danger": 0.02,
        "explosion": 0.02,
        "collapse": 0.1,
        "chemical": 0.05,
        "electrical": 0.5,
    },
    "elementar_tree": {
        "fire_danger": 0.05,
        "explosion": 0.02,
        "collapse": 0.6,
        "chemical": 0.02,
        "electrical": 0.3,
    },
    "elementar_storm": {
        "fire_danger": 0.03,
        "explosion": 0.02,
        "collapse": 0.5,
        "chemical": 0.03,
        "electrical": 0.25,
    },
    "strassenrettung": {
        "fire_danger": 0.2,
        "explosion": 0.15,
        "collapse": 0.4,
        "chemical": 0.1,
        "electrical": 0.15,
    },
    "technische_hilfeleistung": {
        "fire_danger": 0.1,
        "explosion": 0.05,
        "collapse": 0.5,
        "chemical": 0.1,
        "electrical": 0.4,
    },
    "oelwehr": {
        "fire_danger": 0.4,
        "explosion": 0.2,
        "collapse": 0.02,
        "chemical": 0.8,
        "electrical": 0.1,
    },
    "chemiewehr": {
        "fire_danger": 0.3,
        "explosion": 0.5,
        "collapse": 0.05,
        "chemical": 0.95,
        "electrical": 0.15,
    },
    "strahlenwehr": {
        "fire_danger": 0.1,
        "explosion": 0.1,
        "collapse": 0.05,
        "chemical": 0.9,
        "electrical": 0.2,
    },
    "einsatz_bahnanlagen": {
        "fire_danger": 0.15,
        "explosion": 0.1,
        "collapse": 0.2,
        "chemical": 0.1,
        "electrical": 0.8,
    },
    "bma_unechte_alarme": {
        "fire_danger": 0.1,
        "explosion": 0.02,
        "collapse": 0.02,
        "chemical": 0.05,
        "electrical": 0.1,
    },
}

# Effort ranges per incident type: (min_personnel, max_personnel, min_hours, max_hours)
_EFFORT_PROFILES: dict[str, tuple[int, int, float, float]] = {
    "brandbekaempfung": (6, 12, 1.5, 4.0),
    "elementarereignis": (2, 8, 0.5, 2.5),
    "strassenrettung": (4, 10, 0.5, 2.0),
    "technische_hilfeleistung": (3, 8, 0.5, 3.0),
    "oelwehr": (4, 10, 1.0, 3.0),
    "chemiewehr": (6, 14, 2.0, 5.0),
    "strahlenwehr": (6, 14, 2.0, 6.0),
    "einsatz_bahnanlagen": (6, 12, 1.0, 3.0),
    "bma_unechte_alarme": (4, 6, 0.5, 1.0),
    "dienstleistungen": (2, 4, 0.5, 1.5),
    "diverse_einsaetze": (2, 6, 0.5, 2.0),
    "gerettete_menschen": (4, 10, 0.5, 2.0),
    "gerettete_tiere": (2, 6, 0.5, 1.5),
}

# Summaries grouped by incident type category
_SUMMARIES: dict[str, list[str]] = {
    "brandbekaempfung": [
        "Starke Rauchentwicklung. Brandabschnitt im 2. OG identifiziert. Treppenhaus noch begehbar.",
        "Feuer auf ein Zimmer begrenzt. Tür geschlossen. Zugang über Treppenhaus möglich.",
        "Brand weitgehend unter Kontrolle, aber Glutnester im Dachstock noch vorhanden.",
        "Flammen sichtbar am Fenster 3. OG. Treppenhaus begehbar. Innenangriff möglich.",
        "Wohnung komplett verraucht, kein offenes Feuer sichtbar. Vermutlich Schwelbrand in der Wand.",
        "Dachstock betroffen, Feuer breitet sich Richtung Nachbargebäude aus. DLK-Aufstellung möglich.",
        "Brand in Küche, Bewohner bereits evakuiert. Fettbrand mit starker Russbildung. Herd aus.",
        "Rauch aus Briefkasten. Ursache: angezündete Werbung. Bewohner genervt, Situation harmlos.",
        "Nachbar hat auf Balkon grilliert. Fettbrand in Kugelgrill. Selbst gelöscht, aber Fassade verraucht.",
        "Kamin raucht stark, Bewohner dachte es sei normal. Russbrand. Kaminfeger ist unterwegs.",
        "Weihnachtsbeleuchtung hat Vorhang entzündet. Kleiner Brand, bereits gelöscht. Fenster offen, gut gelüftet.",
        "Rauchmelder piepst seit 3 Stunden. Bewohner nicht zu Hause. Nachbarn besorgt. Vermutlich Batterie leer.",
    ],
    "bma_unechte_alarme": [
        "BMA hat angesprochen. Kein Rauch sichtbar, kein Brandgeruch. Vermutlich Täuschungsalarm.",
        "Auslösung durch Baustaub im 2. OG. Handwerker vor Ort. Kein Brand.",
        "Melder in Küche ausgelöst. Angebranntes Essen auf dem Herd. Topf bereits entfernt.",
        "BMA-Auslösung durch Dampf aus Dusche. Melder zu nah am Bad montiert.",
        "Fehlalarm durch Zigarettenrauch im Treppenhaus. Fenster stehen bereits offen.",
        "Rauchmelder ausgelöst wegen Popcorn in Mikrowelle. Alles unter Kontrolle.",
        "BMA löst regelmässig aus bei Nebel. Bekanntes Problem laut Hauswart.",
        "Anlage spinnt nach Stromausfall. Hausverwaltung hat Servicetechniker aufgeboten. Keine Gefahr.",
    ],
    "elementarereignis": [
        "Keller ca. 25cm Wasser. Heizung und Elektrik betroffen. Pumpeinsatz nötig.",
        "Wasser fliesst weiter nach. Sandsäcke liegen bereit, Tauchpumpe fehlt.",
        "Situation stabil, Wasserstand gleichbleibend. Eine Pumpe reicht, kein Mehraufwand.",
        "Mehrere Kellerräume betroffen. Abpumpen nur in Reihenfolge möglich, Zugang eng.",
        "Baum auf Strasse, Fahrbahn komplett blockiert. Ca. 40cm Stammdurchmesser.",
        "Dachziegel lose, einzelne bereits auf Gehweg gefallen. Absturzgefahr.",
        "Zufahrt frei. Einsatzstelle gut zugänglich. Standard-Pumpeinsatz genügt.",
        "Sturmschaden: Fassadenteile hängen lose über Gehweg. Bereich bereits abgesperrt.",
        "Kanalrückstau, Wasser drückt in Keller. Abwasser, entsprechende Schutzausrüstung nötig.",
        "Keller trocken bei Ankunft. Bewohner hat selbst gepumpt. Kontrolle genügt.",
        "5cm Wasser im Keller. Bewohner fragt, ob wir auch gleich den Keller aufräumen können.",
        "Baum auf Gartenzaun gefallen. Keine Gefahr für Personen. Nachbar filmt für Social Media.",
        "Dachrinne verstopft mit Laub. Wasser läuft über Fassade. Leiter und Eimer reichen.",
        "Keller riecht modrig, aber kein stehendes Wasser. Vermutlich alter Wasserschaden. Entwarnung.",
        "Trampolin vom Nachbargarten auf Strasse geweht. Keine Verletzten, aber Verkehrsbehinderung.",
        "Ganze Siedlung meldet Wasser im Keller. Ist der Grundwasserspiegel. Gemeinde bereits informiert.",
        "Waschmaschine ausgelaufen, Keller 3cm Wasser. Bewohner hat in Meldung etwas übertrieben.",
    ],
    "elementar_water": [
        "Keller ca. 25cm Wasser. Heizung und Elektrik betroffen. Pumpeinsatz nötig.",
        "Wasser fliesst weiter nach. Sandsäcke liegen bereit, Tauchpumpe fehlt.",
        "Situation stabil, Wasserstand gleichbleibend. Eine Pumpe reicht, kein Mehraufwand.",
        "Mehrere Kellerräume betroffen. Abpumpen nur in Reihenfolge möglich, Zugang eng.",
        "Zufahrt frei. Einsatzstelle gut zugänglich. Standard-Pumpeinsatz genügt.",
        "Kanalrückstau, Wasser drückt in Keller. Abwasser, entsprechende Schutzausrüstung nötig.",
        "Keller trocken bei Ankunft. Bewohner hat selbst gepumpt. Kontrolle genügt.",
        "5cm Wasser im Keller. Bewohner fragt, ob wir auch gleich den Keller aufräumen können.",
        "Ganze Siedlung meldet Wasser im Keller. Ist der Grundwasserspiegel. Gemeinde bereits informiert.",
        "Waschmaschine ausgelaufen, Keller 3cm Wasser. Bewohner hat in Meldung etwas übertrieben.",
        "Keller riecht modrig, aber kein stehendes Wasser. Vermutlich alter Wasserschaden. Entwarnung.",
        "Dachrinne verstopft mit Laub. Wasser läuft über Fassade. Leiter und Eimer reichen.",
    ],
    "elementar_tree": [
        "Baum auf Strasse, Fahrbahn komplett blockiert. Ca. 40cm Stammdurchmesser.",
        "Baum auf Gartenzaun gefallen. Keine Gefahr für Personen. Nachbar filmt für Social Media.",
        "Grosser Ast auf Gehweg. Fussgänger müssen auf Strasse ausweichen. Absperrung nötig.",
        "Baum auf Telefonleitung gestürzt. Swisscom ist informiert. Leitung hängt tief.",
        "Entwurzelter Baum blockiert Einfahrt. Bewohner kommt nicht raus. Motorsäge nötig.",
        "Ast hängt lose in Baumkrone über Spielplatz. Muss gesichert werden.",
        "Baum auf parkiertes Auto gefallen. Keine Personen betroffen. Versicherung wird Freude haben.",
    ],
    "elementar_storm": [
        "Dachziegel lose, einzelne bereits auf Gehweg gefallen. Absturzgefahr.",
        "Sturmschaden: Fassadenteile hängen lose über Gehweg. Bereich bereits abgesperrt.",
        "Trampolin vom Nachbargarten auf Strasse geweht. Keine Verletzten, aber Verkehrsbehinderung.",
        "Sonnenstoren abgerissen, hängt an Kabel über Gehweg. Bereich absperren.",
        "Baugerüst wackelt stark im Wind. Passanten gefährdet. Sofort sichern.",
        "Werbetafel droht herabzufallen. Bereich bereits weiträumig abgesperrt.",
        "Fensterläden schlagen im Wind. Glas noch ganz, aber Scharniere geben nach.",
        "Dachrinne abgerissen, hängt lose an Fassade. Tropft auf Passanten.",
    ],
    "strassenrettung": [
        "Person eingeklemmt, Fahrerseite deformiert. Hydraulische Rettung erforderlich.",
        "Verletzte Person ansprechbar. Sanität bereits vor Ort. Technische Rettung nötig.",
        "Fahrzeug auf Seite liegend. Stabilisierung nötig vor Personenbefreiung.",
        "Zwei Fahrzeuge beteiligt, keine Einklemmung. Betriebsstoffe laufen aus.",
        "Person in Lift eingeschlossen. Spricht über Gegensprechanlage. Ruhig, keine Panik.",
        "Absturz aus geringer Höhe. Person bei Bewusstsein. Sanität unterwegs.",
        "Katze auf Baum. Besitzerin besteht auf Feuerwehr. Tier sitzt seit gestern oben.",
        "Auffahrunfall, Blechschaden. Keine Verletzten. Kühlflüssigkeit läuft aus.",
        "Kind mit Fuss in Gitter eingeklemmt. Eltern panisch, Kind erstaunlich ruhig.",
        "Person mit Hand in Briefkasten stecken geblieben. Peinlich aber harmlos.",
        "Schlüsseldienst hat aufgegeben, jetzt hat die Polizei uns gerufen. Tür ist massiv.",
    ],
    "oelwehr": [
        "Ölspur ca. 100m Länge auf Hauptstrasse. Kein Gewässer in der Nähe.",
        "Heizölaustritt im Keller. Ca. 50 Liter. Lache breitet sich nicht mehr aus.",
        "Öl auf Fahrbahn nach Unfall. Bach ca. 50m entfernt, Gefahr von Gewässerverunreinigung.",
        "Kleiner Ölaustritt, bereits gestoppt. Betroffene Fläche ca. 3m².",
        "LKW verliert Hydrauliköl auf Kreuzung. Ca. 20m Spur. Rutschgefahr bei Regen.",
        "Ölfilm auf Dorfbach. Quelle: undichte Ölheizung 3 Häuser weiter. Bach fliesst langsam.",
        "Moped tropft Öl auf Parkplatz. Besitzer bestreitet alles. Spur führt direkt zu seinem Töff.",
    ],
    "chemiewehr": [
        "Unbekannte Substanz ausgetreten. Geruch wahrnehmbar. Grossräumig abgesperrt.",
        "Gefahrgutbehälter beschädigt. Kennzeichnung vorhanden: Klasse 8, ätzend.",
        "Chemische Reaktion in Lager. Leichte Rauchentwicklung. Gebäude bereits geräumt.",
        "Kleine Menge ausgelaufene Flüssigkeit. Geruchlos, keine sichtbare Reaktion.",
        "Chlorgeruch im Hallenbad. Dosieranlage defekt. Badegäste bereits draussen.",
        "Spraydose in Abfalleimer explodiert. Leichter Reizgas-Effekt im Raum.",
        "Putzfrau hat Reiniger gemischt die nicht zusammengehören. Chlorgas im Treppenhaus.",
    ],
    "technische_hilfeleistung": [
        "Dach teilweise abgedeckt. Ca. 4m² offen. Blachen liegen auf dem Dachboden bereit.",
        "Kamin umgeknickt, liegt quer auf dem Dach. Absturzgefahr, Bereich darunter frei.",
        "Storen hängt lose an Fassade, schlägt im Wind gegen Fenster. Glas noch ganz.",
        "Baustelle: Bagger hat Wasserleitung getroffen. Wasser spritzt. Haupthahn unbekannt.",
        "Stromausfall im Quartier. Ursache: Marder im Trafo. EW ist informiert.",
        "Tiefgaragentor klemmt, 4 Fahrzeuge eingeschlossen. Motor reagiert nicht.",
    ],
    "gerettete_tiere": [
        "Katze auf Baum seit 2 Tagen. Kommt nicht runter. Ca. 8m Höhe.",
        "Hund in Bachschacht eingeklemmt. Bellt laut, aber unverletzt.",
        "Ente mit Küken in Lichtschacht. Einfacher Einsatz, alle wohlauf.",
        "Pferd in Graben gerutscht. Liegt auf der Seite, ruhig. Besitzer vor Ort.",
        "Schwan auf Strasse will nicht weg. Verkehr stockt. Tierischer Eigensinn.",
        "Igel im Kellerschacht. Bewohner hat ihn eine Woche lang gefüttert, jetzt soll er raus.",
    ],
}

# Power supply likelihood per type
_POWER_SUPPLY_WEIGHTS: dict[str, dict[str, float]] = {
    "brandbekaempfung": {"unavailable": 0.4, "emergency_needed": 0.3, "available": 0.2, "unknown": 0.1},
    "elementarereignis": {"available": 0.4, "unavailable": 0.25, "emergency_needed": 0.15, "unknown": 0.2},
    "strassenrettung": {"available": 0.5, "unknown": 0.3, "unavailable": 0.1, "emergency_needed": 0.1},
    "chemiewehr": {"unavailable": 0.3, "emergency_needed": 0.3, "available": 0.2, "unknown": 0.2},
    "oelwehr": {"available": 0.5, "unknown": 0.3, "unavailable": 0.1, "emergency_needed": 0.1},
    "bma_unechte_alarme": {"available": 0.7, "unknown": 0.2, "unavailable": 0.05, "emergency_needed": 0.05},
}

# Fallback for types not in the map
_DEFAULT_POWER_SUPPLY_WEIGHTS = {"available": 0.35, "unavailable": 0.25, "emergency_needed": 0.2, "unknown": 0.2}


def _get_elementar_subcategory(title: str) -> str:
    """Categorize an elementarereignis incident by title keywords into a subcategory."""
    lower = title.lower()

    water_keywords = [
        "wasser", "keller", "überflut", "kanal", "rückstau", "pumpen",
        "feucht", "waschmaschine", "pool", "garage unter", "liftschacht",
    ]
    tree_keywords = ["baum", "ast", "wurzel", "äste"]
    storm_keywords = [
        "dach", "fassade", "fenster", "gerüst", "werbetafel",
        "trampolin", "sonnenstoren", "ziegel",
    ]

    for kw in water_keywords:
        if kw in lower:
            return "elementar_water"
    for kw in tree_keywords:
        if kw in lower:
            return "elementar_tree"
    for kw in storm_keywords:
        if kw in lower:
            return "elementar_storm"

    return "elementarereignis"


def _pick_weighted(weights: dict[str, float]) -> str:
    """Pick a key based on weights (don't need to sum to 1)."""
    items = list(weights.items())
    keys = [k for k, _ in items]
    w = [v for _, v in items]
    return random.choices(keys, weights=w, k=1)[0]


def generate_dangers(incident_type: str | None = None) -> dict:
    """Generate danger flags based on incident type probabilities."""
    profile = _DANGER_PROFILES.get(incident_type or "", _DANGER_PROFILES["elementarereignis"])

    return {
        "fire": False,
        "fire_danger": random.random() < profile.get("fire_danger", 0.1),
        "explosion": random.random() < profile.get("explosion", 0.05),
        "collapse": random.random() < profile.get("collapse", 0.1),
        "chemical": random.random() < profile.get("chemical", 0.05),
        "electrical": random.random() < profile.get("electrical", 0.1),
        "other_notes": None,
    }


def generate_effort(incident_type: str | None = None) -> dict:
    """Generate effort estimation scaled to incident type."""
    min_p, max_p, min_h, max_h = _EFFORT_PROFILES.get(
        incident_type or "", (2, 8, 0.5, 2.0)
    )

    return {
        "personnel_count": random.randint(min_p, max_p),
        "vehicles_needed": [],
        "equipment_needed": [],
        "estimated_duration_hours": round(random.uniform(min_h, max_h), 1),
    }


def generate_power_supply(incident_type: str | None = None) -> str:
    """Generate power supply status weighted by incident type."""
    weights = _POWER_SUPPLY_WEIGHTS.get(incident_type or "", _DEFAULT_POWER_SUPPLY_WEIGHTS)
    return _pick_weighted(weights)


def generate_summary(incident_type: str | None = None, title: str | None = None) -> str:
    """Generate a contextual German summary based on incident type and title."""
    pool_key = incident_type or "elementarereignis"

    # Types without their own pool fall back
    if pool_key in ("einsatz_bahnanlagen",):
        pool_key = "strassenrettung"
    elif pool_key in ("strahlenwehr",):
        pool_key = "chemiewehr"
    elif pool_key in ("dienstleistungen", "diverse_einsaetze", "gerettete_menschen"):
        pool_key = "elementarereignis"

    # For elementarereignis, use subcategory based on title keywords
    if pool_key == "elementarereignis" and title:
        pool_key = _get_elementar_subcategory(title)

    summaries = _SUMMARIES.get(pool_key, _SUMMARIES["elementarereignis"])
    return random.choice(summaries)


def generate_reko_report_data(incident_type: str | None = None, title: str | None = None) -> dict:
    """Generate a complete reko report payload with contextual random data."""
    # BMA false alarms have a high chance of being non-relevant
    if incident_type == "bma_unechte_alarme":
        is_relevant = random.random() > 0.6  # only 40% relevant
    else:
        is_relevant = random.random() > 0.1  # 90% relevant

    # For elementarereignis, resolve subcategory for danger profiles
    danger_type = incident_type
    if incident_type == "elementarereignis" and title:
        danger_type = _get_elementar_subcategory(title)

    return {
        "is_relevant": is_relevant,
        "dangers_json": generate_dangers(danger_type),
        "effort_json": generate_effort(incident_type),
        "power_supply": generate_power_supply(incident_type),
        "summary_text": generate_summary(incident_type, title),
        "additional_notes": None,
        "is_draft": False,
    }
