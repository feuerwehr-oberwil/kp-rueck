"""Seed training emergency templates and locations."""

import asyncio
from typing import NotRequired, TypedDict
from uuid import uuid4

from app.database import async_session_maker
from app.models import EmergencyTemplate, TrainingLocation


class EmergencyTemplateSeed(TypedDict):
    """One dispatch scenario. Everything but `reko_summaries` is synced into
    `emergency_templates`; `reko_summaries` stays in code and is what a simulated
    Reko reports for an incident with one of this template's titles
    (`training_simulation_data.generate_summary`). Each text has one bundled
    as-found illustration (`scripts/generate_reko_images.py`). A water scene names
    no depth and no Massnahme: the simulated Reko adds the dispatch figure and the
    Massnahme around it."""

    title_pattern: str
    incident_type: str
    category: str
    message_pattern: str
    reko_summaries: list[str]
    title_variations: NotRequired[list[str]]
    message_variations: NotRequired[list[str]]


# Emergency Templates - Storm and water-focused scenarios
EMERGENCY_TEMPLATES: list[EmergencyTemplateSeed] = [
    # ========================================
    # NORMAL - Wasserschaden / Keller auspumpen
    # ========================================
    {
        "title_pattern": "Wasser im Keller Einfamilienhaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Wasser steht im ganzen Keller, Heizung und Elektrik betroffen.",
            "Heizraum betroffen, Brenner ausgeschaltet. Öltank steht dicht, kein Ölfilm sichtbar.",
        ],
        "message_pattern": "Wasser im Keller, ca. 25cm.",
        "title_variations": ["Keller unter Wasser", "Wasserschaden EFH"],
        "message_variations": [
            "Keller unter Wasser, ca. 25cm. Heizung betroffen.",
            "Wasser im Keller, Öltank steht im Wasser.",
        ],
    },
    {
        "title_pattern": "Überflutung Tiefgarage",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Unterstes Parkdeck geflutet, mehrere Autos stehen im Wasser. Wasser kommt über die Rampe.",
            "Tiefgarage unter Wasser, Rinne an der Rampe verstopft. Halter wollen ihre Autos holen.",
        ],
        "message_pattern": "Tiefgarage unter Wasser, ca. 40cm.",
        "title_variations": ["Tiefgarage geflutet", "Wasser in Tiefgarage"],
        "message_variations": [
            "Tiefgarage geflutet, ca. 40cm. Autos drin.",
            "Tiefgarage geflutet.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Mehrfamilienhaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Wasser kam durchs Kellerfenster, Lichtschacht voll Laub. Waschküche und zwei Abteile betroffen.",
            "Mehrere Kellerräume betroffen. Abpumpen nur in Reihenfolge möglich, Zugang eng.",
        ],
        "message_pattern": "Wasser im Keller MFH, Waschküche.",
        "title_variations": ["Wasser im Keller MFH", "Kellerüberflutung Mehrfamilienhaus"],
        "message_variations": [
            "Wasser durchs Kellerfenster eingedrungen.",
            "Wasser im UG, ca. 15cm.",
        ],
    },
    {
        "title_pattern": "Keller auspumpen Gewerbebetrieb",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Lagerkeller unter Wasser, Paletten am Boden durchnässt. Betriebsleiter räumt Ware hoch.",
        ],
        "message_pattern": "Wasser im Firmenkeller, ca. 35cm.",
        "title_variations": ["Keller Gewerbe geflutet", "Wasser im Firmenkeller"],
        "message_variations": [
            "Lagerkeller unter Wasser, ca. 30cm.",
            "Wasser im Gewerbekeller, ca. 40cm.",
        ],
    },
    {
        "title_pattern": "Wassereinbruch nach Rohrbruch",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Kaltwasserleitung im Keller geplatzt, Haupthahn zu. Wasser läuft nicht mehr nach.",
            "Leitung an der Kellerdecke geplatzt, Decke tropft noch. Strom im UG vorsorglich aus.",
        ],
        "message_pattern": "Rohrbruch im Keller, Haupthahn zu.",
        "title_variations": ["Rohrbruch im Keller", "Wasserleitung geplatzt"],
        "message_variations": [
            "Leitung im Keller geplatzt, ca. 10cm.",
            "Wasserleitung im Keller gebrochen.",
        ],
    },
    {
        "title_pattern": "Keller geflutet Reihenhaussiedlung",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Mehrere Reihenhauskeller betroffen, Wasser kam über die Strasse in die Lichtschächte. Bewohner tragen Sachen raus.",
        ],
        "message_pattern": "Mehrere Keller unter Wasser, ca. 25cm.",
        "title_variations": ["Keller Reihenhäuser geflutet", "Hochwasser Siedlung"],
        "message_variations": [
            "Wasser in mehreren Kellern, ca. 30cm.",
            "Reihenhäuser, Keller ca. 25cm Wasser.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Schule",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Turnhalle UG unter Wasser, Matten und Boden nass. Hauswart hat die Halle gesperrt.",
            "Geräteraum unter Wasser, Wasser kommt aus dem Bodenablauf. Unterricht verlegt.",
        ],
        "message_pattern": "Wasser in Turnhalle UG.",
        "title_variations": ["Wasser in Turnhalle", "Keller Schulhaus geflutet"],
        "message_variations": [
            "Wasser in Turnhalle UG, ca. 10cm.",
            "Geräteraum Schule unter Wasser, ca. 15cm.",
        ],
    },
    {
        "title_pattern": "Wasser in Liftschacht",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Wasser in der Liftschachtgrube, Lift steht im EG. Liftfirma informiert, Strom zum Lift aus.",
        ],
        "message_pattern": "Wasser im Liftschacht.",
        "title_variations": ["Liftschacht überflutet", "Wasser in Aufzugschacht"],
        "message_variations": [
            "Wasser im Liftschacht, ca. 20cm.",
            "Wasser im Aufzugschacht, Lift steht.",
        ],
    },
    {
        "title_pattern": "Überfluteter Parkplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Parkplatz-Senke unter Wasser, Einlaufschacht mit Laub zugedeckt. Drei Autos stehen im Wasser.",
            "Parkplatz unter Wasser, Zufahrt gesperrt. Wasser fliesst langsam ab, kein Gebäude betroffen.",
        ],
        "message_pattern": "Parkplatz unter Wasser.",
        "title_variations": ["Parkplatz geflutet", "Wasser auf Parkplatz"],
        "message_variations": [
            "Parkplatz unter Wasser, ca. 20cm.",
            "Parkplatz überflutet, Wasser steigt.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Arztpraxis",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Lager der Arztpraxis unter Wasser, Kartons mit Material unten nass. Geräte stehen auf Regalen.",
        ],
        "message_pattern": "Wasser im Keller Arztpraxis.",
        "title_variations": ["Wasser Keller Arztpraxis", "Praxiskeller geflutet"],
        "message_variations": [
            "Wasser im Praxiskeller, ca. 12cm.",
            "Lager Arztpraxis unter Wasser, ca. 15cm.",
        ],
    },
    {
        "title_pattern": "Rückstau Kanalisation",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Kanalrückstau, Wasser drückt in Keller. Abwasser, entsprechende Schutzausrüstung nötig.",
            "Abwasser aus dem Bodenablauf der Waschküche, starker Geruch. Keine Rückstauklappe eingebaut.",
        ],
        "message_pattern": "Abwasser im Keller.",
        "title_variations": ["Abwasser im Keller", "Kanalrückstau UG"],
        "message_variations": [
            "Abwasser aus Bodenablauf, ca. 5cm.",
            "Kanalrückstau im Keller, ca. 8cm.",
        ],
    },
    {
        "title_pattern": "Wasser im Keller",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Wasser in einem Kellerraum nach Regen, kommt durch einen Mauerriss.",
        ],
        "message_pattern": "Wasser im Keller, ca. 5cm.",
        "title_variations": ["Wasser im Keller nach Regen", "Leichter Wassereintritt Keller"],
        "message_variations": [
            "Nach Starkregen ca. 5cm Wasser im Keller.",
            "Wasser in einem Kellerraum, ca. 6cm.",
        ],
    },
    {
        "title_pattern": "Keller feucht",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Nur ein Kellerabteil betroffen, Rest trocken. Sachen stehen auf Holzrost, kaum Schaden.",
        ],
        "message_pattern": "Wasser im Kellerabteil, ca. 10cm.",
        "title_variations": ["Feuchter Keller", "Wasser in Kellerabteil"],
        "message_variations": [
            "Ca. 10cm Wasser in einem Abteil.",
            "Wasser im Kellerabteil, ca. 8cm.",
        ],
    },
    {
        "title_pattern": "Wasser in Waschküche",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Waschküche betroffen, Maschine steht im Wasser. Zulauf gestoppt.",
        ],
        "message_pattern": "Wasser in Waschküche, ca. 3cm.",
        "title_variations": ["Waschküche unter Wasser", "Wasser in der Waschküche"],
        "message_variations": [
            "Waschküche unter Wasser, ca. 3cm.",
            "Wasser in Waschküche, ca. 4cm.",
        ],
    },
    {
        "title_pattern": "Keller vollgelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Ganzer Keller unter Wasser, Kühltruhe und Kartons stehen im Wasser. Mehrere Räume betroffen.",
        ],
        "message_pattern": "Ganzer Keller unter Wasser, ca. 50cm.",
        "title_variations": ["Keller komplett geflutet", "Ganzer Keller unter Wasser"],
        "message_variations": [
            "Keller voll Wasser, ca. 50cm.",
            "Keller geflutet, ca. 55cm. Steigt weiter.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Hobbyraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Hobbyraum unter Wasser, Modelleisenbahn steht auf Tischen und ist trocken. Bewohner räumt Kisten weg.",
        ],
        "message_pattern": "Wasser im Hobbyraum, ca. 15cm.",
        "title_variations": ["Wasser im Hobbyraum", "Hobbyraum geflutet"],
        "message_variations": [
            "Hobbyraum unter Wasser, ca. 15cm. Anrufer sehr aufgeregt.",
            "Wasser im Bastelkeller, ca. 12cm.",
        ],
    },
    {
        "title_pattern": "Wasser im Veloraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Veloraum unter Wasser, Velos und E-Bikes stehen drin. Akkus noch nicht im Wasser.",
        ],
        "message_pattern": "Wasser im Veloraum, ca. 8cm.",
        "title_variations": ["Veloraum unter Wasser", "Wasser im Veloraum MFH"],
        "message_variations": [
            "Veloraum unter Wasser, ca. 8cm. E-Bikes drin.",
            "Wasser im Veloraum, ca. 10cm.",
        ],
    },
    {
        "title_pattern": "Pfütze im Keller",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Wasser am Kellerboden beim Boiler, Herkunft noch unklar.",
        ],
        "message_pattern": "Pfütze im Keller, ca. 2cm.",
        "title_variations": ["Kleine Pfütze im Keller", "Wasseraustritt Keller"],
        "message_variations": [
            "Wenig Wasser im Keller, ca. 2cm.",
            "Wasser im UG, ca. 3cm.",
        ],
    },
    {
        "title_pattern": "Keller halb voll",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Heizraum unter Wasser, Heizung abgestellt. Wasser steht, steigt nicht.",
        ],
        "message_pattern": "Wasser im Keller, ca. 30cm. Heizraum betroffen.",
        "title_variations": ["Keller halb voll", "Wasser im Heizraum"],
        "message_variations": [
            "Ca. 30cm Wasser im Keller.",
            "Heizraum unter Wasser, ca. 35cm.",
        ],
    },
    {
        "title_pattern": "Garage unter Wasser",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Einzelgarage unter Wasser, Auto steht drin. Wasser läuft von der Einfahrt nach.",
        ],
        "message_pattern": "Wasser in Garage, ca. 12cm.",
        "title_variations": ["Garage geflutet", "Wasser in Einzelgarage"],
        "message_variations": [
            "Garage unter Wasser, ca. 12cm. Auto drin.",
            "Wasser in Garage, ca. 15cm.",
        ],
    },
    {
        "title_pattern": "Wasser im Lagerraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Lagerraum betroffen, Kartons unten aufgeweicht. Wasser kommt unter der Tür durch.",
        ],
        "message_pattern": "Wasser im Lagerraum, ca. 6cm.",
        "title_variations": ["Wasser im Lagerraum", "Lagerraum feucht"],
        "message_variations": [
            "Wasser im Kellerlager, ca. 6cm.",
            "Lagerraum UG, ca. 5cm Wasser.",
        ],
    },
    {
        "title_pattern": "Wasser im Keller Restaurant",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Kühllager des Restaurants unter Wasser, Getränkeharasse im Wasser. Wirt hat den Strom im Lager aus.",
        ],
        "message_pattern": "Wasser im Restaurantkeller, ca. 25cm.",
        "title_variations": ["Wasser Restaurantkeller", "Restaurant-Lager geflutet"],
        "message_variations": [
            "Kellerlager Restaurant, ca. 25cm Wasser.",
            "Restaurantkeller geflutet, ca. 30cm.",
        ],
    },
    {
        "title_pattern": "Überschwemmung Garageneinfahrt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Wasser fliesst die Tiefgarageneinfahrt runter, Rinne am Fuss verstopft. Unten steigt es.",
        ],
        "message_pattern": "Wasser läuft in Tiefgarage.",
        "title_variations": ["Wasser Garageneinfahrt", "Tiefgarageneinfahrt überflutet"],
        "message_variations": [
            "Wasser in TG-Einfahrt, ca. 20cm.",
            "Wasser fliesst in Tiefgarage, Rinne verstopft.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Kindergarten",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Keller Kindergarten betroffen, Kisten mit Bastelmaterial nass. Keine Kinder im Gebäude.",
        ],
        "message_pattern": "Wasser im Keller Kindergarten.",
        "title_variations": ["Wasser Kindergartenkeller", "Kindergarten UG geflutet"],
        "message_variations": [
            "Wasser im Kindergartenkeller, ca. 10cm.",
            "Kindergarten UG unter Wasser, ca. 12cm.",
        ],
    },
    {
        "title_pattern": "Waschmaschine ausgelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Waschmaschine ausgelaufen, Zulauf abgestellt. Wasser nur in der Waschküche.",
        ],
        "message_pattern": "Waschmaschine ausgelaufen, ca. 3cm.",
        "title_variations": ["Waschmaschine defekt", "Wasser aus Waschmaschine"],
        "message_variations": [
            "Waschmaschine ausgelaufen, ca. 3cm. Anruferin aufgeregt.",
            "Wasser aus Waschmaschine, ca. 4cm.",
        ],
    },
    {
        "title_pattern": "Pool übergelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Gartenpool läuft über, Wasser fliesst übers Gras in Nachbars Lichtschacht. Nachbarkeller nass.",
        ],
        "message_pattern": "Pool übergelaufen, Wasser in Nachbarkeller.",
        "title_variations": ["Pool übergelaufen", "Wasser aus Gartenpool"],
        "message_variations": [
            "Gartenpool läuft über. Nachbarn streiten.",
            "Pool übergelaufen, ca. 8cm im Nachbarkeller.",
        ],
    },
    {
        "title_pattern": "Dachentwässerung verstopft",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Dachrinne verstopft mit Laub. Wasser läuft über Fassade. Leiter und Eimer reichen.",
            "Fallrohr verstopft, Wasser schiesst oben aus der Rinne. Fassade nass, Keller trocken.",
        ],
        "message_pattern": "Dachrinne verstopft.",
        "title_variations": ["Dachrinne verstopft", "Verstopfte Dachentwässerung"],
        "message_variations": [
            "Dachrinne verstopft, Wasser an Fassade.",
            "Wasser läuft an Fassade runter.",
        ],
    },
    # ========================================
    # NORMAL - Sturmschaden
    # ========================================
    {
        "title_pattern": "Dachziegel gelöst",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Dachziegel lose, einzelne bereits auf Gehweg gefallen. Absturzgefahr.",
            "Mehrere Dachziegel lose, bei jeder Böe fällt einer. Trottoir darunter gefährdet.",
            "Ziegel lose, 3 Stück bereits auf Gehweg gefallen. Bereich darunter abgesperrt.",
        ],
        "message_pattern": "Dachziegel lose.",
        "title_variations": ["Lose Dachziegel", "Dachziegel droht zu fallen"],
        "message_variations": [
            "Lose Ziegel über Eingang.",
            "Ziegel auf Gehweg gefallen.",
        ],
    },
    {
        "title_pattern": "Fassadenteile lose",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Sturmschaden: Fassadenteile hängen lose über Gehweg. Bereich bereits abgesperrt.",
            "Fassadenelement löst sich vom Bürohaus, ca. 2m über Gehweg. Bereich gesperrt.",
        ],
        "message_pattern": "Fassadenteile lose.",
        "title_variations": ["Lose Fassadenteile", "Fassade droht zu fallen"],
        "message_variations": [
            "Fassade lose über Gehweg.",
            "Fassadenplatten hängen über Eingang.",
        ],
    },
    {
        "title_pattern": "Fenster eingeschlagen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Fenster im 1. OG durch Ast eingeschlagen, Regen dringt ins Zimmer. Glassplitter am Boden.",
        ],
        "message_pattern": "Fenster eingeschlagen, Regen dringt ein.",
        "title_variations": ["Fenster eingeschlagen", "Sturm hat Fenster zerstört"],
        "message_variations": [
            "Sturm hat Fenster zerstört.",
            "Scheibe kaputt im OG, Wasser läuft rein.",
        ],
    },
    {
        "title_pattern": "Gerüst beschädigt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Baugerüst wackelt stark im Wind. Passanten gefährdet. Sofort sichern.",
            "Gerüstnetz losgerissen, Gerüst steht schief. Bereich davor leer.",
        ],
        "message_pattern": "Baugerüst instabil.",
        "title_variations": ["Gerüst instabil", "Baugerüst droht einzustürzen"],
        "message_variations": [
            "Gerüst wackelt nach Sturm.",
            "Gerüst schwankt stark.",
        ],
    },
    {
        "title_pattern": "Werbetafel gefährdet",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Werbetafel droht herabzufallen. Bereich bereits weiträumig abgesperrt.",
        ],
        "message_pattern": "Werbetafel droht zu fallen.",
        "title_variations": ["Werbetafel droht zu fallen", "Lose Reklametafel"],
        "message_variations": [
            "Werbetafel lose über Gehweg.",
            "Reklametafel an Fassade lose.",
        ],
    },
    {
        "title_pattern": "Dach abgedeckt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Dach teilweise abgedeckt. Ca. 4m² offen. Blachen liegen auf dem Dachboden bereit.",
        ],
        "message_pattern": "Dach abgedeckt.",
        "title_variations": ["Dach abgedeckt", "Sturm hat Dach abgedeckt"],
        "message_variations": [
            "Ziegel weg, Regen im Estrich.",
            "Dach teilweise abgedeckt, Wasser in Wohnung.",
        ],
    },
    {
        "title_pattern": "Trampolin auf Strasse",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Trampolin vom Nachbargarten auf Strasse geweht, Verkehr behindert. Wegräumen und sichern.",
        ],
        "message_pattern": "Trampolin auf Fahrbahn.",
        "title_variations": ["Trampolin auf Strasse", "Gartentrampolin auf Fahrbahn"],
        "message_variations": [
            "Trampolin auf Strasse.",
            "Trampolin blockiert eine Spur.",
        ],
    },
    {
        "title_pattern": "Sonnenstoren lose",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Storen hängt lose an Fassade, schlägt im Wind gegen Fenster. Glas noch ganz.",
            "Sonnenstoren abgerissen, hängt an Kabel über Gehweg. Bereich absperren.",
            "Storenkasten teilweise gelöst, Store hängt über Balkon. Absturzgefahr auf Sitzplatz.",
        ],
        "message_pattern": "Storen lose.",
        "title_variations": ["Storen lose", "Sonnenstore hängt lose"],
        "message_variations": [
            "Sonnenstore schlägt gegen Scheibe.",
            "Store hängt über Balkon.",
        ],
    },
    # ========================================
    # NORMAL - Baum
    # ========================================
    {
        "title_pattern": "Baum auf Strasse",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Baum auf Strasse, Fahrbahn komplett blockiert. Ca. 40cm Stammdurchmesser.",
        ],
        "message_pattern": "Baum auf Strasse.",
        "title_variations": ["Baum quer auf Fahrbahn", "Umgestürzter Baum blockiert Strasse"],
        "message_variations": [
            "Baum quer über Hauptstrasse.",
            "Baum auf Fahrbahn, Stamm ca. 50cm.",
        ],
    },
    {
        "title_pattern": "Ast auf parkiertes Auto",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Baum auf parkiertes Auto gefallen, keine Personen betroffen. Anheben und zerlegen, Polizei für den Rapport aufgeboten.",
            "Grosser Ast auf der Motorhaube, Windschutzscheibe gesprungen. Niemand im Auto.",
        ],
        "message_pattern": "Ast auf Auto.",
        "title_variations": ["Ast auf Auto", "Ast auf parkiertes Fahrzeug"],
        "message_variations": [
            "Grosser Ast auf parkiertem Auto.",
            "Ast auf Auto gefallen, niemand verletzt.",
        ],
    },
    {
        "title_pattern": "Baum droht zu fallen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Fichte neigt sich Richtung Wohnhaus, Wurzelteller hebt sich. Ca. 5m bis zum Dach.",
        ],
        "message_pattern": "Baum droht auf Haus zu fallen.",
        "title_variations": ["Baum droht zu fallen", "Instabiler Baum am Haus"],
        "message_variations": [
            "Baum neigt sich gegen Haus.",
            "Baum instabil über Wohnhaus.",
        ],
    },
    {
        "title_pattern": "Äste auf Oberleitung",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Baum lehnt an der Stromleitung, Leitung hängt durch. EW schaltet ab.",
            "Baum auf Telefonleitung gestürzt. Swisscom ist informiert. Leitung hängt tief.",
        ],
        "message_pattern": "Baum auf Stromleitung.",
        "title_variations": ["Ast auf Stromleitung", "Baum in Oberleitung"],
        "message_variations": [
            "Ast in Stromleitung.",
            "Baum auf Freileitung, Leitung hängt durch.",
        ],
    },
    {
        "title_pattern": "Baum blockiert Gehweg",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Grosser Ast auf Gehweg, Fussgänger weichen auf die Strasse aus. Absperren, zerkleinern und räumen.",
            "Baum liegt quer über dem Schulweg, Stamm ca. 30cm. Kinder klettern drüber.",
        ],
        "message_pattern": "Baum auf Gehweg.",
        "title_variations": ["Baum auf Gehweg", "Umgestürzter Baum Schulweg"],
        "message_variations": [
            "Baum blockiert Schulweg.",
            "Baum quer über Gehweg.",
        ],
    },
    {
        "title_pattern": "Wurzelwerk gelockert",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Alte Eiche, Erde um den Stamm aufgerissen, Wurzeln sichtbar. Baum schwankt bei Böen.",
        ],
        "message_pattern": "Eiche droht umzustürzen.",
        "title_variations": ["Wurzeln gelockert", "Eiche droht umzustürzen"],
        "message_variations": [
            "Grosse Eiche, Wurzeln heben sich.",
            "Baum stark geneigt über Weg.",
        ],
    },
    {
        "title_pattern": "Ast auf Spielplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Ast auf der Rutschbahn, Spielplatz leer. Bruchstelle hoch in der Krone.",
        ],
        "message_pattern": "Ast auf Spielplatz.",
        "title_variations": ["Ast auf Spielplatz", "Astbruch Spielplatz"],
        "message_variations": [
            "Grosser Ast auf Spielplatz.",
            "Ast auf Spielgeräte gefallen.",
        ],
    },
    # ========================================
    # NORMAL - Öl / Technisch / Divers
    # ========================================
    {
        "title_pattern": "Heizöl im Keller",
        "incident_type": "oelwehr",
        "category": "normal",
        "reko_summaries": [
            "Heizöltank im Keller undicht, Lache unter dem Tank. Geruch im ganzen Haus.",
            "Leck an der Tankleitung, Öl in der Auffangwanne und daneben am Boden.",
        ],
        "message_pattern": "Heizöltank leckt, ca. 50 Liter.",
        "title_variations": ["Heizöl im Keller", "Öltank leckt"],
        "message_variations": [
            "Öl im Keller, ca. 50 Liter.",
            "Tank im UG undicht, ca. 40 Liter.",
        ],
    },
    {
        "title_pattern": "Ölspur Hauptstrasse",
        "incident_type": "oelwehr",
        "category": "normal",
        "reko_summaries": [
            "Ölspur ca. 100m Länge auf Hauptstrasse. Kein Gewässer in der Nähe.",
            "Diesel-Lache am Strassenrand nach Tankunfall. Ca. 5m², Werkstattbetrieb informiert.",
        ],
        "message_pattern": "Ölspur, ca. 100m.",
        "title_variations": ["Ölspur Strasse", "Ölspur auf Hauptstrasse"],
        "message_variations": [
            "Ölspur Hauptstrasse, ca. 100m.",
            "Ölspur auf Fahrbahn, ca. 120m.",
        ],
    },
    {
        "title_pattern": "Ölspur Kreisel",
        "incident_type": "oelwehr",
        "category": "normal",
        "reko_summaries": [
            "Ölspur im Kreisel nach LKW-Manöver, ca. 30m. Rutschgefahr, Verkehr läuft langsam.",
        ],
        "message_pattern": "Ölspur im Kreisel, ca. 30m.",
        "title_variations": ["Ölspur Kreisel", "Hydrauliköl im Kreisel"],
        "message_variations": [
            "LKW verliert Öl im Kreisel.",
            "Ölspur im Kreisel, ca. 40m.",
        ],
    },
    {
        "title_pattern": "Lichtmast beschädigt",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "reko_summaries": [
            "Strassenlaterne steht schräg, Fundament gelockert. Kabel noch dran, Leuchte brennt.",
        ],
        "message_pattern": "Strassenlaterne schief.",
        "title_variations": ["Lichtmast schief", "Strassenlaterne droht zu fallen"],
        "message_variations": [
            "Lichtmast neigt sich über Gehweg.",
            "Laterne droht umzufallen.",
        ],
    },
    {
        "title_pattern": "Überfluteter Parkplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Parkplatz-Senke unter Wasser, Einlaufschacht mit Laub zugedeckt. Drei Autos stehen im Wasser.",
            "Parkplatz unter Wasser, Zufahrt gesperrt. Wasser fliesst langsam ab, kein Gebäude betroffen.",
        ],
        "message_pattern": "Parkplatz unter Wasser.",
        "title_variations": ["Parkplatz überflutet", "Hochwasser Parkplatz"],
        "message_variations": [
            "Parkplatz überflutet, ca. 25cm.",
            "Parkplatz unter Wasser, ca. 20cm.",
        ],
    },
    {
        "title_pattern": "Kanaldeckel hochgedrückt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "reko_summaries": [
            "Kanaldeckel liegt neben dem Schacht, Wasser sprudelt raus. Loch offen auf der Fahrbahn.",
            "Kanaldeckel fehlt auf Quartierstrasse, Loch offen. Werkdienst aufgeboten.",
        ],
        "message_pattern": "Kanaldeckel hochgedrückt.",
        "title_variations": ["Kanaldeckel hoch", "Angehobener Schachtdeckel"],
        "message_variations": [
            "Kanaldeckel angehoben.",
            "Schachtdeckel steht schräg, Wasser drückt hoch.",
        ],
    },
    {
        "title_pattern": "Tiefgaragentor klemmt",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "reko_summaries": [
            "Tiefgaragentor klemmt, mehrere Fahrzeuge eingeschlossen. Motor reagiert nicht.",
        ],
        "message_pattern": "TG-Tor blockiert, 6 Autos drin.",
        "title_variations": ["TG-Tor klemmt", "Garagentor blockiert"],
        "message_variations": [
            "Tiefgaragentor klemmt.",
            "TG-Tor geht nicht auf, ca. 5 Autos drin.",
        ],
    },
    {
        "title_pattern": "Bagger reisst Wasserleitung",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "reko_summaries": [
            "Baustelle: Bagger hat Wasserleitung getroffen. Wasser spritzt. Haupthahn unbekannt.",
            "Wasserrohrbruch unter Strasse, Strassenbelag wölbt sich. Werkdienst ist unterwegs.",
        ],
        "message_pattern": "Bagger hat Wasserleitung erwischt.",
        "title_variations": ["Wasserleitung angebaggert", "Leitungsschaden Baustelle"],
        "message_variations": [
            "Wasserleitung angebaggert, Wasser spritzt.",
            "Hauptleitung angebaggert, Grube läuft voll.",
        ],
    },
    {
        "title_pattern": "Wespennest am Schulhaus",
        "incident_type": "diverse_einsaetze",
        "category": "normal",
        "reko_summaries": [
            "Wespennest am Eingang, Schwarm aktiv. Bereich abgesperrt, Imker informiert.",
            "Wespennest im Rollladenkasten beim Schulhauseingang. Viele Wespen am Eingang, Pause verlegt.",
        ],
        "message_pattern": "Wespennest beim Schuleingang.",
        "title_variations": ["Wespennest Schule", "Wespen beim Schuleingang"],
        "message_variations": [
            "Wespennest Schule, Kinder gestochen.",
            "Wespen beim Pausenplatz.",
        ],
    },
    {
        "title_pattern": "Katze auf Baum",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "reko_summaries": [
            "Katze auf Baum seit 2 Tagen. Kommt nicht runter. Ca. 8m Höhe.",
            "Katze auf Baum, sitzt seit gestern in ca. 6m Höhe. Rettung über Steckleiter möglich.",
        ],
        "message_pattern": "Katze auf Baum, seit 2 Tagen.",
        "title_variations": ["Katze auf Baum", "Katze im Baum gefangen"],
        "message_variations": [
            "Katze auf Baum, ca. 6m.",
            "Katze in Baumkrone, ca. 5m.",
        ],
    },
    {
        "title_pattern": "Ente in Lichtschacht",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "reko_summaries": [
            "Ente mit Küken in Lichtschacht. Einfacher Einsatz, alle wohlauf.",
        ],
        "message_pattern": "Ente mit Küken im Lichtschacht.",
        "title_variations": ["Enten im Lichtschacht", "Entenfamilie im Schacht"],
        "message_variations": [
            "Entenfamilie im Lichtschacht.",
            "Enten im Kellerschacht, ca. 7 Tiere.",
        ],
    },
    {
        "title_pattern": "Igel im Kellerschacht",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "reko_summaries": [
            "Igel im Kellerschacht, unverletzt. Wird herausgehoben und im Garten freigelassen.",
        ],
        "message_pattern": "Igel im Kellerschacht.",
        "title_variations": ["Igel im Schacht", "Igel im Kellerschacht"],
        "message_variations": [
            "Igel im Lichtschacht, seit einer Woche.",
            "Igel sitzt im Schacht fest.",
        ],
    },
    {
        "title_pattern": "Schwan auf Strasse",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "reko_summaries": [
            "Schwan auf Strasse, will nicht weichen. Verkehr stockt. Wird eingefangen und zum Weiher gebracht.",
        ],
        "message_pattern": "Schwan blockiert Kreuzung.",
        "title_variations": ["Schwan auf Strasse", "Schwan blockiert Kreuzung"],
        "message_variations": [
            "Schwan auf Kreuzung, Polizei vor Ort.",
            "Schwan auf Fahrbahn.",
        ],
    },
    # ========================================
    # CRITICAL - Brand
    # ========================================
    {
        "title_pattern": "Wohnungsbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "Starke Rauchentwicklung. Brandabschnitt im 2. OG identifiziert. Treppenhaus noch begehbar.",
            "Feuer auf ein Zimmer begrenzt. Tür geschlossen. Zugang über Treppenhaus möglich.",
            "Flammen sichtbar am Fenster 3. OG. Treppenhaus begehbar. Innenangriff möglich.",
            "Wohnung komplett verraucht, kein offenes Feuer sichtbar. Vermutlich Schwelbrand in der Wand.",
        ],
        "message_pattern": "Brand in Wohnung MFH.",
        "title_variations": ["Brand in Wohnung", "Rauch aus Wohnung"],
        "message_variations": [
            "Rauch aus Wohnung im OG.",
            "Rauch aus Wohnung, Bewohner nicht erreichbar.",
            "Brand in Wohnung, Hund noch drin.",
        ],
    },
    {
        "title_pattern": "Fahrzeugbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "PKW in Vollbrand auf Parkplatz. Reifen platzen bereits. Nachbarfahrzeuge gefährdet.",
            "Motorbrand, Flammen aus Motorraum. Bewohner versuchte zu löschen, Pulverlöscher leer.",
            "Fahrzeugbrand bereits gelöscht durch Passanten. Restglut, leichte Rauchentwicklung.",
        ],
        "message_pattern": "Fahrzeugbrand auf Parkplatz.",
        "title_variations": ["PKW in Brand", "Auto brennt"],
        "message_variations": [
            "Auto brennt, Fahrer draussen.",
            "Auto brennt am Strassenrand.",
            "Autobrand Quartierparkplatz.",
        ],
    },
    {
        "title_pattern": "Brand Gartenhaus",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "Gartenhütte komplett in Flammen, 2 Gasflaschen drin. Sicherheitsabstand eingehalten.",
            "Gartenhaus brennt, Flammen greifen auf die Hecke über. Nachbarhaus ca. 8m entfernt.",
            "Geräteschuppen verraucht, Benzinkanister vom Rasenmäher drin. Feuer noch klein.",
        ],
        "message_pattern": "Gartenhütte brennt, Gasflaschen drin.",
        "title_variations": ["Gartenhütte in Brand", "Vollbrand Gartenhaus"],
        "message_variations": [
            "Gartenhaus in Vollbrand.",
            "Schopf brennt.",
        ],
    },
    {
        "title_pattern": "Küchenbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "Brand in Küche, Bewohner bereits evakuiert. Fettbrand mit starker Russbildung. Herd aus.",
            "Angebranntes Essen auf Herd, Pfanne in Vollbrand. Bewohnerin hat versucht zu löschen mit Wasser. Russ überall.",
        ],
        "message_pattern": "Küchenbrand, Bewohner draussen.",
        "title_variations": ["Fettbrand Küche", "Brand in Küche"],
        "message_variations": [
            "Fettbrand auf Herd.",
            "Pfannenbrand, Küche verraucht.",
        ],
    },
    {
        "title_pattern": "Brand Dachstock",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "Dachstuhl in Vollbrand, Sparren teilweise durchgebrannt. Einsturzgefahr, Aussenangriff über DLK.",
            "Dachstock betroffen, Feuer breitet sich Richtung Nachbargebäude aus. DLK-Aufstellung möglich.",
            "Brand weitgehend unter Kontrolle, aber Glutnester im Dachstock noch vorhanden.",
        ],
        "message_pattern": "Brand Dachstock MFH.",
        "title_variations": ["Dachstockbrand", "Brand Dachstuhl"],
        "message_variations": [
            "Dachstuhl brennt.",
            "Flammen aus Dachfenstern.",
        ],
    },
    {
        "title_pattern": "Brand Tiefgarage",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "Auto in Tiefgarage raucht stark. Belüftung läuft. Personen aus Gebäude evakuiert.",
            "Tiefgarage dicht verraucht, Sicht unter 2m. Brennendes Fahrzeug hinten vermutet.",
        ],
        "message_pattern": "Rauch aus Tiefgarage.",
        "title_variations": ["Rauch aus Tiefgarage", "Fahrzeugbrand Tiefgarage"],
        "message_variations": [
            "Rauch aus TG-Ausfahrt, BMA hat ausgelöst.",
            "Auto brennt in Tiefgarage.",
        ],
    },
    {
        "title_pattern": "Brand Abfallcontainer",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "Abfallcontainer unter Vordach. Flammen schlagen hoch, Vordach bereits angerusst.",
            "Mülltonne brennt, Wind treibt Funken Richtung Hecke. Container vom Gebäude weggezogen.",
            "Sperrgut neben Container in Brand, vermutlich Brandstiftung. Personenrettung nicht nötig.",
        ],
        "message_pattern": "Abfallcontainer brennt.",
        "title_variations": ["Container brennt", "Mülltonne in Brand"],
        "message_variations": [
            "Container brennt unter Vordach.",
            "Müllcontainer brennt beim Eingang.",
        ],
    },
    {
        "title_pattern": "Brand Werkstatt",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "Schreinerei stark verqualmt, Sägespäne brennen am Boden. Niemand mehr im Gebäude.",
            "Holzlager neben der Schreinerei in Vollbrand. Halle selbst noch rauchfrei.",
        ],
        "message_pattern": "Brand Schreinerei.",
        "title_variations": ["Werkstattbrand", "Brand Industriebetrieb"],
        "message_variations": [
            "Schreinerei brennt, hohe Flammen.",
        ],
    },
    {
        "title_pattern": "E-Bike Brand Keller",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "reko_summaries": [
            "E-Bike-Akku zischt und raucht im Veloraum. Treppenhaus stark verraucht.",
            "Akkubrand im Keller. Hohe Temperaturen, Akku noch nicht vollständig durchgebrannt.",
        ],
        "message_pattern": "E-Bike-Akku brennt im Veloraum.",
        "title_variations": ["Akkubrand Veloraum", "Brand E-Bike"],
        "message_variations": [
            "Akkubrand Veloraum, Treppenhaus verraucht.",
            "Akku qualmt beim Laden.",
        ],
    },
    # ========================================
    # CRITICAL - BMA
    # ========================================
    {
        "title_pattern": "BMA Schulhaus",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "reko_summaries": [
            "Schüler haben Deo im WC versprüht. Melder hat ausgelöst, Lehrer hat Klasse bereits evakuiert.",
            "Auslösung durch Werklehrer-Demo: Lötzinn-Rauch. Anlage wieder scharfgestellt.",
            "Schulhausmeister bestätigt: Reinigungspersonal hat Trockner ohne Filter laufen lassen.",
        ],
        "message_pattern": "BMA Schulhaus.",
        "title_variations": ["BMA Schule", "Brandmeldeanlage Schulhaus"],
        "message_variations": [
            "BMA Schulhaus, Hauswart vor Ort.",
            "BMA Schule, Sektor C.",
        ],
    },
    {
        "title_pattern": "BMA Altersheim",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "reko_summaries": [
            "Bewohnerin hat im Bad geraucht, Melder hat ausgelöst. Pflegepersonal hat sie beruhigt, keine Gefahr.",
            "Pflegeheim Ost: Toast verbrannt in Stationsküche. Melder zurückgesetzt, Bewohner blieben in Zimmern.",
            "Falscher Alarm durch defekten Melder. Anlage isoliert den Sektor, Servicetechniker aufgeboten.",
        ],
        "message_pattern": "BMA Pflegeheim, 2. Stock Ost.",
        "title_variations": ["BMA Pflegeheim", "Brandmeldeanlage Pflegeheim"],
        "message_variations": [
            "BMA Pflegeheim, Trakt Ost.",
            "BMA Altersheim.",
        ],
    },
    {
        "title_pattern": "BMA Gewerbe",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "reko_summaries": [
            "Auslösung durch Schweissarbeiten in Produktionshalle. Schweisser hatte keine Freigabe vom Sicherheitsbeauftragten.",
            "Industriebetrieb: Staub aus Absauganlage hat Optikmelder ausgelöst. Filter ist verstopft.",
            "Dampf aus Reinigungsanlage hat Melder ausgelöst. Betrieb läuft, kein Brand.",
        ],
        "message_pattern": "BMA Industriebetrieb.",
        "title_variations": ["BMA Industriebetrieb", "Brandmeldeanlage Gewerbe"],
        "message_variations": [
            "BMA Industriebetrieb, Sektor 4.",
            "BMA Produktionshalle.",
        ],
    },
    {
        "title_pattern": "BMA Einkaufszentrum",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "reko_summaries": [
            "Auslösung durch Kochdampf Food Court. Restaurantleiter hat Anlage falsch konfiguriert.",
            "Einkaufszentrum: Defekter Melder im Lager Möbelabteilung. Bauverein wurde informiert.",
        ],
        "message_pattern": "BMA Einkaufszentrum, Sektor 2.",
        "title_variations": ["BMA Shopping", "Brandmeldeanlage Einkaufszentrum"],
        "message_variations": [
            "BMA Einkaufszentrum, Sektor 5.",
            "BMA Mall, Sektor 3.",
        ],
    },
    {
        "title_pattern": "BMA Hallenbad",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "reko_summaries": [
            "Hallenbad: Chlordosieranlage hat zu hoch dosiert. Bademeister hat Becken bereits geschlossen.",
            "Melder im Technikraum, Luftfeuchte von der Filteranlage. Bademeister vor Ort, kein Rauch.",
        ],
        "message_pattern": "BMA Hallenbad, Technikraum.",
        "title_variations": ["BMA Hallenbad", "Brandmeldeanlage Hallenbad"],
        "message_variations": [
            "BMA Hallenbad.",
            "BMA Hallenbad, Chloranlage in der Nähe.",
        ],
    },
    {
        "title_pattern": "BMA Wohnheim",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "reko_summaries": [
            "Pizza im Ofen vergessen, Etagenküche verraucht. Bewohner stehen draussen.",
            "Verbranntes Essen im Zimmer, Melder ausgelöst. Kein Feuer, bereits gelüftet.",
        ],
        "message_pattern": "BMA Studentenwohnheim, 3. OG.",
        "title_variations": ["BMA Studentenwohnheim", "Brandmeldeanlage Wohnheim"],
        "message_variations": [
            "BMA Wohnheim, 3. OG.",
            "BMA Wohnheim, 2. OG.",
        ],
    },
    # ========================================
    # CRITICAL - Personenrettung
    # ========================================
    {
        "title_pattern": "Person in Lift",
        "incident_type": "strassenrettung",
        "category": "critical",
        "reko_summaries": [
            "Person in Lift eingeschlossen. Spricht über Gegensprechanlage. Ruhig, keine Panik.",
            "Lift zwischen 3. und 4. OG stehen geblieben. Person mit Kinderwagen drin. Ungeduldig.",
        ],
        "message_pattern": "Person im Lift eingeschlossen.",
        "title_variations": ["Lift blockiert mit Person", "Person im Aufzug eingeschlossen"],
        "message_variations": [
            "Lift steckt zwischen 3. und 4. OG.",
            "Person im Lift, Liftnotruf.",
        ],
    },
    {
        "title_pattern": "Verkehrsunfall eingeklemmt",
        "incident_type": "strassenrettung",
        "category": "critical",
        "reko_summaries": [
            "Person eingeklemmt, Fahrerseite deformiert. Hydraulische Rettung erforderlich.",
            "Frontalkollision Landstrasse. Eine Person eingeklemmt, eine ansprechbar im Strassengraben.",
        ],
        "message_pattern": "VU, eine Person eingeklemmt.",
        "title_variations": ["VU mit Eingeklemmtem", "Frontalkollision mit Eingeklemmtem"],
        "message_variations": [
            "Frontalkollision, 1 Person eingeklemmt.",
            "VU 2 PKW, Person eingeklemmt.",
        ],
    },
    {
        "title_pattern": "Absturz Baugerüst",
        "incident_type": "strassenrettung",
        "category": "critical",
        "reko_summaries": [
            "Maler vom Gerüst gestürzt, ca. 4m. Person bewusstlos, Sanität reanimiert.",
        ],
        "message_pattern": "Person ab Gerüst gestürzt, ca. 3m.",
        "title_variations": ["Absturz vom Gerüst", "Sturz Baustelle"],
        "message_variations": [
            "Maler vom Gerüst gestürzt, ca. 4m.",
        ],
    },
    {
        "title_pattern": "Kind in Schacht",
        "incident_type": "strassenrettung",
        "category": "critical",
        "reko_summaries": [
            "Kind in Kanalschacht gefallen, ansprechbar. Schachtweite eng, Schleifkorbtrage nötig.",
        ],
        "message_pattern": "Kind in Kanalschacht gefallen.",
        "title_variations": ["Kind in Kanalschacht", "Kindrettung Schacht"],
        "message_variations": [
            "Kind in Schacht, ansprechbar.",
            "Junge in Schacht, ca. 2m tief.",
        ],
    },
    {
        "title_pattern": "Auffahrunfall Kreuzung",
        "incident_type": "strassenrettung",
        "category": "critical",
        "reko_summaries": [
            "Auffahrunfall, Blechschaden. Keine Verletzten. Kühlflüssigkeit läuft aus.",
            "Drei Autos ineinander, Kühlwasser und Öl auf der Kreuzung. Alle Personen ausgestiegen.",
        ],
        "message_pattern": "Auffahrunfall, 3 Fahrzeuge.",
        "title_variations": ["VU Auffahrunfall", "Mehrere Fahrzeuge Auffahrunfall"],
        "message_variations": [
            "Auffahrunfall an Ampel, 3 PKW.",
            "Auffahrunfall Kreuzung.",
        ],
    },
    # ========================================
    # CRITICAL - Andere
    # ========================================
    {
        "title_pattern": "Gasgeruch",
        "incident_type": "chemiewehr",
        "category": "critical",
        "reko_summaries": [
            "Gasgeruch im Treppenhaus, stärker im Keller. Bewohner draussen, Gasversorger aufgeboten.",
            "Gasgeruch in Wohnung 1. OG, Herd aus, Fenster offen. Geruch nur schwach.",
        ],
        "message_pattern": "Gasgeruch im MFH.",
        "title_variations": ["Gasgeruch MFH", "Gasalarm Wohnung"],
        "message_variations": [
            "Gasgeruch im Treppenhaus.",
            "Starker Gasgeruch in Küche.",
        ],
    },
    {
        "title_pattern": "Chemikalienunfall Labor",
        "incident_type": "chemiewehr",
        "category": "critical",
        "reko_summaries": [
            "Chemiesaal: Flasche Salzsäure am Boden zerbrochen, stechender Geruch. Klasse draussen, Lehrer vor Ort.",
        ],
        "message_pattern": "Chemie ausgelaufen im Chemiesaal.",
        "title_variations": ["Chemieunfall Schule", "Laborchemie ausgelaufen"],
        "message_variations": [
            "Chemikalien ausgelaufen, Schule.",
            "Reaktion im Labor, Rauch.",
        ],
    },
    {
        "title_pattern": "Chlorgeruch Hallenbad",
        "incident_type": "chemiewehr",
        "category": "critical",
        "reko_summaries": [
            "Chlorgeruch im Hallenbad. Dosieranlage defekt. Badegäste bereits draussen.",
        ],
        "message_pattern": "Chlorgeruch Hallenbad.",
        "title_variations": ["Chlorgas Hallenbad", "Chloralarm Hallenbad"],
        "message_variations": [
            "Starker Chlorgeruch im Hallenbad.",
            "Chlorgas-Verdacht Hallenbad.",
        ],
    },
]


# Everything from here to FALLBACK_TRAINING_LOCATIONS is a DEV AND DEMO FIXTURE for
# Oberwil BL, the station this was built at. It is not a template a second station
# is expected to fork: production seeds no training locations at all (see
# seed_training_data's seed_locations argument), and a station adds its own from the
# training surface or drops ad-hoc pins on its own map.


def get_training_area_bounds() -> dict:
    """Bounding box containing the bundled dev/demo locations."""
    return {
        "min_lat": 47.508,
        "max_lat": 47.522,
        "min_lon": 7.552,
        "max_lon": 7.568,
    }


def get_training_city_info() -> tuple[str, str]:
    """City and postal code stamped on generated dev/demo training locations.

    Matches the bounding box above and the demo Heimatort, so generated addresses
    collapse to just the street in the UI/report.
    """
    return ("Oberwil", "4104")


TRAINING_AREA_BOUNDS = get_training_area_bounds()

# Deterministic dev/demo fallback. These addresses and coordinates are verified
# OpenStreetMap entries inside Oberwil BL; no network access is needed while a
# development or demo deployment starts.
FALLBACK_TRAINING_LOCATIONS = [
    ("Mühlemattstrasse", "18", "commercial", 47.5098844, 7.5546250),
    ("Hauptstrasse", "41", "commercial", 47.5139457, 7.5561373),
    ("Mühlemattstrasse", "8", "commercial", 47.5110623, 7.5552960),
    ("Bottmingerstrasse", "75", "commercial", 47.5157039, 7.5588034),
    ("Hauptstrasse", "15", "commercial", 47.5147822, 7.5579469),
    ("Binningerstrasse", "57", "commercial", 47.5163022, 7.5585081),
    ("Bottmingerstrasse", "62", "commercial", 47.5164573, 7.5610098),
    ("Hauptstrasse", "36", "commercial", 47.5140370, 7.5550833),
    ("Hauptstrasse", "12", "commercial", 47.5148741, 7.5576526),
    ("Sägestrasse", "9", "commercial", 47.5115481, 7.5570202),
    ("Langegasse", "97", "residential", 47.5089777, 7.5601529),
    ("Langegasse", "105", "residential", 47.5090535, 7.5612359),
    ("Hohestrasse", "120", "commercial", 47.5209493, 7.5539767),
]

LEGACY_FALLBACK_COORDINATES = (47.5596, 7.5886)


async def seed_training_data(skip_geocoding: bool = False, seed_locations: bool = True):
    """
    Seed emergency templates and training locations.

    Args:
        skip_geocoding: Legacy compatibility option. Seeding always uses bundled
                       sample locations and never queries an external provider.
                       True also repairs the known legacy fallback location when
                       seeding locations, while preserving custom locations.
        seed_locations: If False, seed only the emergency templates and leave the
                       training locations alone. Production passes False: the
                       fallback list is a set of real streets in one specific town,
                       and pre-loading it into another station's deployment puts
                       addresses on their training board that do not exist in their
                       area. Training mode does not need them — a training incident
                       takes either a seeded TrainingLocation or an ad-hoc map pin
                       (see services/training.py), so a station drops pins on its
                       own map or adds locations as it goes.
    """
    async with async_session_maker() as session:
        print("=" * 60)
        print("SEEDING TRAINING DATA")
        print("=" * 60)

        from sqlalchemy import func, select

        # Sync emergency template text (idempotent, keyed by title_pattern) so
        # edits to EMERGENCY_TEMPLATES — new templates AND added message/title
        # variations — reach existing databases on deploy. The old skip-if-present
        # logic left authored variations dormant forever, so every dispatch read
        # the single message_pattern verbatim.
        result = await session.execute(select(EmergencyTemplate))
        existing = {t.title_pattern: t for t in result.scalars().all()}
        inserted = updated = 0
        for template_data in EMERGENCY_TEMPLATES:
            existing_template = existing.get(template_data["title_pattern"])
            if existing_template is None:
                session.add(
                    EmergencyTemplate(
                        id=uuid4(),
                        title_pattern=template_data["title_pattern"],
                        incident_type=template_data["incident_type"],
                        category=template_data["category"],
                        message_pattern=template_data["message_pattern"],
                        title_variations=template_data.get("title_variations"),
                        message_variations=template_data.get("message_variations"),
                    )
                )
                inserted += 1
            else:
                existing_template.incident_type = template_data["incident_type"]
                existing_template.category = template_data["category"]
                existing_template.message_pattern = template_data["message_pattern"]
                existing_template.message_variations = template_data.get("message_variations")
                existing_template.title_variations = template_data.get("title_variations")
                updated += 1
        await session.commit()
        print(f"✅ Emergency templates synced: {inserted} new, {updated} updated")

        if not seed_locations:
            print("⏭️  Training locations not seeded — add your own, or drop pins on the map.")
            return

        # Training locations: preserve existing station-specific locations.
        location_count = await session.scalar(select(func.count()).select_from(TrainingLocation))
        if location_count and location_count > 0:
            # The original no-geocoding fallback labelled a coordinate in
            # Basel as "Hauptstrasse 1, Oberwil". Replace only that exact known
            # bad seed and preserve every custom/real location.
            if skip_geocoding:
                result = await session.execute(select(TrainingLocation))
                existing_locations = list(result.scalars().all())
                legacy_location = next(
                    (
                        location
                        for location in existing_locations
                        if location.street == "Hauptstrasse"
                        and location.house_number == "1"
                        and abs(float(location.latitude or 0) - LEGACY_FALLBACK_COORDINATES[0]) < 0.000001
                        and abs(float(location.longitude or 0) - LEGACY_FALLBACK_COORDINATES[1]) < 0.000001
                    ),
                    None,
                )
                if legacy_location is not None:
                    city, postal_code = get_training_city_info()
                    existing_keys = {(location.street, location.house_number) for location in existing_locations}
                    for index, (street, house_number, building_type, lat, lon) in enumerate(
                        FALLBACK_TRAINING_LOCATIONS
                    ):
                        if index == 0:
                            location = legacy_location
                        elif (street, house_number) in existing_keys:
                            continue
                        else:
                            location = TrainingLocation(id=uuid4())
                            session.add(location)
                        location.street = street
                        location.house_number = house_number
                        location.postal_code = postal_code
                        location.city = city
                        location.building_type = building_type
                        location.latitude = lat
                        location.longitude = lon
                        location.is_active = True
                    await session.commit()
                    print(f"✅ Replaced legacy fallback with {len(FALLBACK_TRAINING_LOCATIONS)} Oberwil locations")
                    return

            print(f"\n⏭️  Training locations already exist ({location_count} found). Keeping them.")
            return

        # Sample data is deterministic and local. The former optional random
        # reverse-geocoding loop bypassed the installation's provider choice.
        addresses = FALLBACK_TRAINING_LOCATIONS
        print(f"\n📍 Seeding {len(addresses)} bundled sample addresses...")

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
        print(f"✅ Training Locations:  {len(addresses)} (bundled samples)")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(seed_training_data())
