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
        "title_variations": ["Keller unter Wasser", "Wasserschaden EFH"],
        "message_variations": [
            "Bewohner meldet 20-30cm Wasser im UG. Heizung und Tank betroffen.",
            "Wasser im Keller, Heizöltank steht teilweise unter Wasser. Strom abgestellt.",
        ],
    },
    {
        "title_pattern": "Überflutung Tiefgarage",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Tiefgarage. Ca. 40cm, mehrere Fahrzeuge drin.",
        "title_variations": ["Tiefgarage geflutet", "Wasser in Tiefgarage"],
        "message_variations": [
            "Tiefgarage steht ca. 40cm unter Wasser. Mehrere Fahrzeuge betroffen, Tor nicht öffenbar.",
            "Liegenschaftsverwaltung meldet Tiefgarage geflutet. Ablauf vermutlich verstopft.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Mehrfamilienhaus",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, MFH. Wasser durch Kellerfenster, Waschküche betroffen.",
        "title_variations": ["Wasser im Keller MFH", "Kellerüberflutung Mehrfamilienhaus"],
        "message_variations": [
            "Hauswart meldet Wasser über Kellerfenster eingedrungen. Waschküche und Trocknungsraum betroffen.",
            "Wasser läuft durch Lichtschacht in UG. Ca. 15cm, Waschküche steht unter Wasser.",
        ],
    },
    {
        "title_pattern": "Keller auspumpen Gewerbebetrieb",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller, Gewerbebetrieb. Ca. 35cm, Lagerware gefährdet.",
        "title_variations": ["Keller Gewerbe geflutet", "Wasser im Firmenkeller"],
        "message_variations": [
            "Geschäftsführer meldet ca. 30cm Wasser im Lagerkeller. Ware auf Paletten gefährdet.",
            "Wassereinbruch Gewerbekeller, ca. 40cm. Kartons und Elektronik betroffen, Strom noch an.",
        ],
    },
    {
        "title_pattern": "Wassereinbruch nach Rohrbruch",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Rohrbruch, Keller. Haupthahn abgestellt, Wasser steht noch.",
        "title_variations": ["Rohrbruch im Keller", "Wasserleitung geplatzt"],
        "message_variations": [
            "Bewohner meldet geplatzte Leitung im UG. Haupthahn zu, ca. 10cm Wasser steht.",
            "Wasserleitung im Keller gebrochen, Sanitär nicht erreichbar. Haupthahn bereits abgestellt.",
        ],
    },
    {
        "title_pattern": "Keller geflutet Reihenhaussiedlung",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Reihenhaussiedlung. Mehrere Keller, ca. 20-30cm.",
        "title_variations": ["Keller Reihenhäuser geflutet", "Hochwasser Siedlung"],
        "message_variations": [
            "Mehrere Anwohner melden Wasser im Keller. Betroffen ca. 4 Häuser, 20-30cm.",
            "Ganze Reihenhauszeile betroffen, ca. 25cm in den Kellern. Strasse steht ebenfalls unter Wasser.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Schule",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Turnhalle UG. Sportgeräte im Wasser.",
        "title_variations": ["Wasser in Turnhalle", "Keller Schulhaus geflutet"],
        "message_variations": [
            "Hauswart meldet Wasser in Turnhalle UG. Ca. 10cm, Matten und Geräte betroffen.",
            "Wassereinbruch Untergeschoss Schule, Geräteraum steht unter Wasser. Ca. 15cm.",
        ],
    },
    {
        "title_pattern": "Wasser in Liftschacht",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Liftschacht, MFH. Lift ausser Betrieb.",
        "title_variations": ["Liftschacht überflutet", "Wasser in Aufzugschacht"],
        "message_variations": [
            "Hauswart meldet Wasser im Liftschacht. Ca. 20cm auf Grube, Lift steht.",
            "Wasser in Aufzugschacht eingedrungen, Lift ausser Betrieb. Liftfirma informiert.",
        ],
    },
    {
        "title_pattern": "Überfluteter Parkplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Parkplatz. Abfluss verstopft, Fahrzeuge stehen im Wasser.",
        "title_variations": ["Parkplatz geflutet", "Wasser auf Parkplatz"],
        "message_variations": [
            "Parkplatz steht ca. 20cm unter Wasser, Ablauf verstopft. Mehrere Fahrzeuge betroffen.",
            "Anwohner melden überfluteten Parkplatz, Wasser steigt. Schacht vermutlich verstopft.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Arztpraxis",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller Arztpraxis. Medizinische Geräte im Lager.",
        "title_variations": ["Wasser Keller Arztpraxis", "Praxiskeller geflutet"],
        "message_variations": [
            "Praxisleitung meldet Wasser im UG. Ca. 12cm, medizinisches Material im Lager gefährdet.",
            "Wassereinbruch Kellerlager Arztpraxis, ca. 15cm. Geräte und Verbrauchsmaterial betroffen.",
        ],
    },
    {
        "title_pattern": "Rückstau Kanalisation",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Kanalrückstau, Abwasser im Keller. Geruchsbelästigung.",
        "title_variations": ["Abwasser im Keller", "Kanalrückstau UG"],
        "message_variations": [
            "Bewohner meldet Rückstau, Abwasser drückt durch Bodenablauf. Ca. 5cm, starker Geruch.",
            "Kanalisation staut zurück, Fäkalwasser im Keller. Ca. 8cm, Bewohner meidet UG.",
        ],
    },
    {
        "title_pattern": "Wasser im Keller",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller nach Regen. Ca. 5cm, ein Raum.",
        "title_variations": ["Wasser im Keller nach Regen", "Leichter Wassereintritt Keller"],
        "message_variations": [
            "Nach Starkregen ca. 5cm Wasser in einem Kellerraum. Steigt langsam.",
            "Bewohner meldet Wasser im UG nach Gewitter. Ein Raum betroffen, ca. 6cm.",
        ],
    },
    {
        "title_pattern": "Keller feucht",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller. Ca. 10cm, nur ein Abteil.",
        "title_variations": ["Feuchter Keller", "Wasser in Kellerabteil"],
        "message_variations": [
            "Bewohner meldet ca. 10cm Wasser in einem Kellerabteil. Ursache unklar.",
            "Wasser in einem Kellerabteil, ca. 8cm. Nachbarabteile trocken.",
        ],
    },
    {
        "title_pattern": "Wasser in Waschküche",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser in Waschküche. Ca. 3cm, Maschine steht im Wasser.",
        "title_variations": ["Waschküche unter Wasser", "Wasser in der Waschküche"],
        "message_variations": [
            "Bewohnerin meldet ca. 3cm Wasser in Waschküche. Waschmaschine steht im Wasser, Strom noch an.",
            "Wasser in gemeinschaftlicher Waschküche, ca. 4cm. Ablauf verstopft.",
        ],
    },
    {
        "title_pattern": "Keller vollgelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Keller komplett unter Wasser. Ca. 50cm, mehrere Räume.",
        "title_variations": ["Keller komplett geflutet", "Ganzer Keller unter Wasser"],
        "message_variations": [
            "Bewohner meldet ca. 50cm Wasser im ganzen Keller. Mehrere Räume, Heizung betroffen.",
            "Keller vollständig geflutet, ca. 55cm. Wasser steigt weiter, Strom im UG abstellen.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Hobbyraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Hobbyraum UG. Ca. 15cm. Bewohner sehr aufgelöst wegen Modelleisenbahn.",
        "title_variations": ["Wasser im Hobbyraum", "Hobbyraum geflutet"],
        "message_variations": [
            "Bewohner meldet ca. 15cm Wasser im Hobbyraum. Modelleisenbahn im Wasser, Melder sehr aufgeregt.",
            "Wasser im Bastelkeller, ca. 12cm. Anrufer bittet dringend, seine Modellanlage zu retten.",
        ],
    },
    {
        "title_pattern": "Wasser im Veloraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Veloraum. Ca. 8cm, 12 E-Bikes im Wasser.",
        "title_variations": ["Veloraum unter Wasser", "Wasser im Veloraum MFH"],
        "message_variations": [
            "Hauswart meldet ca. 8cm Wasser im Veloraum. Rund 10 E-Bikes betroffen, Akkus im Wasser.",
            "Wasser im Fahrradkeller, ca. 10cm. Mehrere E-Bikes stehen im Wasser.",
        ],
    },
    {
        "title_pattern": "Pfütze im Keller",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller, kleine Pfütze. Ca. 2cm, Ursache unklar.",
        "title_variations": ["Kleine Pfütze im Keller", "Wasseraustritt Keller"],
        "message_variations": [
            "Bewohner meldet kleine Pfütze im Keller, ca. 2cm. Ursache nicht ersichtlich.",
            "Etwas Wasser im UG, ca. 3cm in einer Ecke. Herkunft unklar, kein Rohrbruch sichtbar.",
        ],
    },
    {
        "title_pattern": "Keller halb voll",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller. Ca. 30cm, Heizraum betroffen.",
        "title_variations": ["Keller halb voll", "Wasser im Heizraum"],
        "message_variations": [
            "Bewohner meldet ca. 30cm Wasser im Keller. Heizraum betroffen, Brenner aus.",
            "Wasser im UG, ca. 35cm. Heizung steht im Wasser, Strom im Heizraum abstellen.",
        ],
    },
    {
        "title_pattern": "Garage unter Wasser",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser in Garage. Ca. 12cm, Auto steht drin.",
        "title_variations": ["Garage geflutet", "Wasser in Einzelgarage"],
        "message_variations": [
            "Besitzer meldet ca. 12cm Wasser in Garage. PKW steht im Wasser.",
            "Wasser in Garage eingedrungen, ca. 15cm. Auto und Gartengeräte betroffen.",
        ],
    },
    {
        "title_pattern": "Wasser im Lagerraum",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasser im Keller, Lagerraum. Ca. 6cm, Kartons betroffen.",
        "title_variations": ["Wasser im Lagerraum", "Lagerraum feucht"],
        "message_variations": [
            "Bewohner meldet ca. 6cm Wasser im Kellerlager. Kartons stehen im Wasser.",
            "Wasser in Lagerraum UG, ca. 5cm. Gelagerte Ware am Boden betroffen.",
        ],
    },
    {
        "title_pattern": "Wasser im Keller Restaurant",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Restaurant-Lager. Ca. 25cm, Lebensmittel gefährdet.",
        "title_variations": ["Wasser Restaurantkeller", "Restaurant-Lager geflutet"],
        "message_variations": [
            "Wirt meldet ca. 25cm Wasser im Kellerlager. Kühlgut und Vorräte gefährdet.",
            "Wassereinbruch Restaurantkeller, ca. 30cm. Tiefkühler steht im Wasser, Strom im UG aus.",
        ],
    },
    {
        "title_pattern": "Überschwemmung Garageneinfahrt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Tiefgarageneinfahrt. Wasser läuft rein, Ablauf verstopft.",
        "title_variations": ["Wasser Garageneinfahrt", "Tiefgarageneinfahrt überflutet"],
        "message_variations": [
            "Wasser läuft über die Rampe in die Tiefgarage. Ablauf verstopft, ca. 20cm an Einfahrt.",
            "Hausverwaltung meldet Wasser fliesst in TG-Einfahrt. Rinne verstopft, UG gefährdet.",
        ],
    },
    {
        "title_pattern": "Wasserschaden Kindergarten",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Keller Kindergarten. Spielsachen und Material betroffen.",
        "title_variations": ["Wasser Kindergartenkeller", "Kindergarten UG geflutet"],
        "message_variations": [
            "Leiterin meldet ca. 10cm Wasser im Kellerlager. Spielmaterial und Bastelsachen betroffen.",
            "Wassereinbruch Kindergarten UG, ca. 12cm. Materialdepot steht unter Wasser.",
        ],
    },
    {
        "title_pattern": "Waschmaschine ausgelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Wasserschaden, Waschmaschine defekt. Ca. 3cm im Keller. Melder etwas aufgeregt.",
        "title_variations": ["Waschmaschine defekt", "Wasser aus Waschmaschine"],
        "message_variations": [
            "Bewohnerin meldet defekte Waschmaschine, ca. 3cm Wasser im Keller. Melderin sehr aufgeregt.",
            "Waschmaschine ausgelaufen, ca. 4cm im UG. Anrufer hat Gerät bereits vom Strom genommen.",
        ],
    },
    {
        "title_pattern": "Pool übergelaufen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Gartenpool läuft über, Wasser in Nachbars Keller. Nachbarschaftsstreit.",
        "title_variations": ["Pool übergelaufen", "Wasser aus Gartenpool"],
        "message_variations": [
            "Anrufer meldet übergelaufenen Gartenpool, Wasser läuft in Nachbarkeller. Die zwei streiten sich lautstark.",
            "Pool übergelaufen, ca. 8cm Wasser in Nachbars UG. Melder und Nachbar im Wortgefecht.",
        ],
    },
    {
        "title_pattern": "Dachentwässerung verstopft",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Dachrinne verstopft, Wasser läuft an Fassade runter.",
        "title_variations": ["Dachrinne verstopft", "Verstopfte Dachentwässerung"],
        "message_variations": [
            "Anwohner meldet verstopfte Dachrinne, Wasser läuft die Fassade runter. Laub im Ablauf.",
            "Dachentwässerung dicht, Wasser tritt am Fallrohr aus und läuft an Wand. Feuchte dringt ein.",
        ],
    },
    # ========================================
    # NORMAL - Sturmschaden
    # ========================================
    {
        "title_pattern": "Dachziegel gelöst",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Dachziegel lose. Absturzgefahr auf Gehweg.",
        "title_variations": ["Lose Dachziegel", "Dachziegel droht zu fallen"],
        "message_variations": [
            "Anrufer meldet 2-3 lose Ziegel über Eingangsbereich. Wind nimmt zu.",
            "Mehrere Ziegel sichtbar verrutscht, einer bereits auf Gehweg. Bereich absperren.",
        ],
    },
    {
        "title_pattern": "Fassadenteile lose",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Fassadenteile lose. Über Gehweg.",
        "title_variations": ["Lose Fassadenteile", "Fassade droht zu fallen"],
        "message_variations": [
            "Passant meldet lose Fassadenverkleidung über Gehweg. Teile drohen zu fallen, Wind stark.",
            "Sturmschaden, Fassadenplatten haben sich gelöst und hängen über Eingang. Bereich sichern.",
        ],
    },
    {
        "title_pattern": "Fenster eingeschlagen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Fenster eingeschlagen. Wasser dringt ein.",
        "title_variations": ["Fenster eingeschlagen", "Sturm hat Fenster zerstört"],
        "message_variations": [
            "Bewohner meldet vom Sturm eingeschlagenes Fenster, Regen dringt in Wohnung. Notabdeckung nötig.",
            "Sturmschaden, Fensterscheibe zerbrochen im OG. Wasser läuft rein, Fenster provisorisch schliessen.",
        ],
    },
    {
        "title_pattern": "Gerüst beschädigt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Baugerüst instabil. Einsturzgefahr.",
        "title_variations": ["Gerüst instabil", "Baugerüst droht einzustürzen"],
        "message_variations": [
            "Anwohner meldet wackelndes Baugerüst nach Sturm. Teile lose, Einsturzgefahr über Gehweg.",
            "Sturmschaden, Gerüst hat sich gelöst und schwankt stark. Bereich absperren, Baufirma alarmieren.",
        ],
    },
    {
        "title_pattern": "Werbetafel gefährdet",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, grosse Werbetafel droht zu fallen.",
        "title_variations": ["Werbetafel droht zu fallen", "Lose Reklametafel"],
        "message_variations": [
            "Passant meldet grosse Werbetafel, die im Wind schwingt und sich löst. Über Gehweg.",
            "Sturmschaden, Reklametafel an Fassade lose. Droht auf Parkplatz zu stürzen.",
        ],
    },
    {
        "title_pattern": "Dach abgedeckt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Dach teilweise abgedeckt. Regen dringt ein.",
        "title_variations": ["Dach abgedeckt", "Sturm hat Dach abgedeckt"],
        "message_variations": [
            "Bewohner meldet abgedecktes Dach nach Sturm. Ziegel fehlen, Regen dringt in Estrich.",
            "Sturmschaden, Teil der Dachhaut weggerissen. Wasser läuft in oberste Wohnung, Notdach nötig.",
        ],
    },
    {
        "title_pattern": "Trampolin auf Strasse",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Trampolin auf Fahrbahn. Blockiert eine Spur.",
        "title_variations": ["Trampolin auf Strasse", "Gartentrampolin auf Fahrbahn"],
        "message_variations": [
            "Autofahrer meldet Trampolin auf Strasse, vom Wind über Zaun getragen. Blockiert eine Spur.",
            "Sturmschaden, Trampolin liegt auf Fahrbahn. Verkehrsbehinderung, Polizei unterwegs.",
        ],
    },
    {
        "title_pattern": "Sonnenstoren lose",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Sturmschaden, Storen hängt lose. Schlägt gegen Fenster.",
        "title_variations": ["Storen lose", "Sonnenstore hängt lose"],
        "message_variations": [
            "Bewohner meldet lose Sonnenstore, die im Wind gegen die Scheibe schlägt. Droht abzureissen.",
            "Sturmschaden, Storenkasten teils gelöst. Store hängt über Balkon, Absturzgefahr.",
        ],
    },
    # ========================================
    # NORMAL - Baum
    # ========================================
    {
        "title_pattern": "Baum auf Strasse",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum auf Strasse, blockiert Fahrbahn komplett.",
        "title_variations": ["Baum quer auf Fahrbahn", "Umgestürzter Baum blockiert Strasse"],
        "message_variations": [
            "Grosser Baum quer auf Hauptstrasse. Beide Fahrspuren blockiert, Verkehr stockt.",
            "Polizei meldet Baum auf Fahrbahn. Motorsäge nötig, Stamm ca. 50cm.",
        ],
    },
    {
        "title_pattern": "Ast auf parkiertes Auto",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grosser Ast auf parkiertes Auto. Keine Verletzten.",
        "title_variations": ["Ast auf Auto", "Ast auf parkiertes Fahrzeug"],
        "message_variations": [
            "Anwohner meldet grossen Ast auf parkiertem PKW. Keine Personen, Dach eingedellt.",
            "Ast abgebrochen und auf Auto gefallen. Fahrzeug beschädigt, niemand verletzt.",
        ],
    },
    {
        "title_pattern": "Baum droht zu fallen",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum instabil nach Sturm. Kippt Richtung Gebäude.",
        "title_variations": ["Baum droht zu fallen", "Instabiler Baum am Haus"],
        "message_variations": [
            "Bewohner meldet stark geneigten Baum nach Sturm. Kippt Richtung Hausfassade, Wurzeln lose.",
            "Baum instabil, neigt sich bedenklich über Wohnhaus. Umsturzgefahr, Bereich räumen.",
        ],
    },
    {
        "title_pattern": "Äste auf Oberleitung",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum auf Stromleitung. EW informiert.",
        "title_variations": ["Ast auf Stromleitung", "Baum in Oberleitung"],
        "message_variations": [
            "Anwohner meldet Ast in Stromleitung nach Sturm. EW informiert, Bereich nicht betreten.",
            "Baum auf Freileitung gestürzt, Leitung hängt durch. EW alarmiert, Absperrung nötig.",
        ],
    },
    {
        "title_pattern": "Baum blockiert Gehweg",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Baum auf Fussgängerweg, Schulweg betroffen.",
        "title_variations": ["Baum auf Gehweg", "Umgestürzter Baum Schulweg"],
        "message_variations": [
            "Passant meldet umgestürzten Baum auf Fussweg. Schulweg blockiert, Motorsäge nötig.",
            "Baum quer über Gehweg, Durchgang gesperrt. Betrifft Schulweg, rasch räumen.",
        ],
    },
    {
        "title_pattern": "Wurzelwerk gelockert",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Grosse Eiche instabil, Wurzeln aus Boden. Umsturzgefahr.",
        "title_variations": ["Wurzeln gelockert", "Eiche droht umzustürzen"],
        "message_variations": [
            "Anwohner meldet grosse Eiche mit angehobenem Wurzelteller. Boden reisst auf, Umsturzgefahr.",
            "Baum stark geneigt, Wurzeln teils aus Erde. Neigt sich über Weg, Bereich sichern.",
        ],
    },
    {
        "title_pattern": "Ast auf Spielplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Ast auf Spielplatz gefallen. Spielplatz gesperrt.",
        "title_variations": ["Ast auf Spielplatz", "Astbruch Spielplatz"],
        "message_variations": [
            "Anwohnerin meldet grossen Ast auf Spielplatz. Keine Kinder verletzt, Bereich abgesperrt.",
            "Ast abgebrochen und auf Spielgeräte gefallen. Spielplatz gesperrt, Astbruch weiterer Äste möglich.",
        ],
    },
    # ========================================
    # NORMAL - Öl / Technisch / Divers
    # ========================================
    {
        "title_pattern": "Heizöl im Keller",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Ölwehr, Heizöltank leckt. Ca. 50 Liter im Keller.",
        "title_variations": ["Heizöl im Keller", "Öltank leckt"],
        "message_variations": [
            "Bewohner meldet lecken Heizöltank, ca. 50 Liter ausgelaufen. Starker Geruch, Ölbindemittel nötig.",
            "Ölwehr, Tank im UG undicht, ca. 40 Liter im Auffangraum. Keine Ausbreitung in Kanal.",
        ],
    },
    {
        "title_pattern": "Ölspur Hauptstrasse",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Ölspur auf Fahrbahn. Ca. 100m lang.",
        "title_variations": ["Ölspur Strasse", "Ölspur auf Hauptstrasse"],
        "message_variations": [
            "Autofahrer meldet Ölspur auf Hauptstrasse, ca. 100m. Rutschgefahr, Ölbindemittel nötig.",
            "Ölspur über ca. 120m auf Fahrbahn. Verursacher unbekannt, Strasse abstumpfen.",
        ],
    },
    {
        "title_pattern": "Ölspur Kreisel",
        "incident_type": "oelwehr",
        "category": "normal",
        "message_pattern": "Ölspur im Kreisel, LKW verliert Hydrauliköl. Ca. 30m.",
        "title_variations": ["Ölspur Kreisel", "Hydrauliköl im Kreisel"],
        "message_variations": [
            "Polizei meldet Ölspur im Kreisel, LKW verliert Hydrauliköl. Ca. 30m, rutschig.",
            "Ölspur im Kreisel über ca. 40m. Verursacher weitergefahren, Bindemittel und Reinigung nötig.",
        ],
    },
    {
        "title_pattern": "Lichtmast beschädigt",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "message_pattern": "Strassenlaterne schief nach Sturm. Droht umzufallen.",
        "title_variations": ["Lichtmast schief", "Strassenlaterne droht zu fallen"],
        "message_variations": [
            "Passant meldet schiefen Lichtmast nach Sturm. Neigt sich über Gehweg, Umsturzgefahr.",
            "Strassenlaterne stark geneigt, Fundament gelockert. Bereich absperren, EW informieren.",
        ],
    },
    {
        "title_pattern": "Überfluteter Parkplatz",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Hochwasser, Parkplatz unter Wasser. Zufahrt gesperrt.",
        "title_variations": ["Parkplatz überflutet", "Hochwasser Parkplatz"],
        "message_variations": [
            "Anwohner meldet überfluteten Parkplatz, ca. 25cm. Zufahrt gesperrt, Fahrzeuge stehen im Wasser.",
            "Parkplatz unter Wasser nach Starkregen. Ablauf verstopft, ca. 20cm, Zufahrt nicht passierbar.",
        ],
    },
    {
        "title_pattern": "Kanaldeckel hochgedrückt",
        "incident_type": "elementarereignis",
        "category": "normal",
        "message_pattern": "Kanaldeckel angehoben durch Wasserdruck. Stolpergefahr.",
        "title_variations": ["Kanaldeckel hoch", "Angehobener Schachtdeckel"],
        "message_variations": [
            "Passant meldet angehobenen Kanaldeckel, durch Wasserdruck hochgedrückt. Stolpergefahr auf Gehweg.",
            "Schachtdeckel steht schräg, Wasser drückt hoch. Sturzgefahr, Stelle sichern.",
        ],
    },
    {
        "title_pattern": "Tiefgaragentor klemmt",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "message_pattern": "Tiefgaragentor blockiert, 6 Fahrzeuge eingeschlossen.",
        "title_variations": ["TG-Tor klemmt", "Garagentor blockiert"],
        "message_variations": [
            "Bewohner meldet blockiertes Tiefgaragentor, 6 Fahrzeuge eingeschlossen. Motor defekt.",
            "TG-Tor klemmt und lässt sich nicht öffnen. Rund 5 Autos können nicht raus, Notentriegelung nötig.",
        ],
    },
    {
        "title_pattern": "Bagger reisst Wasserleitung",
        "incident_type": "technische_hilfeleistung",
        "category": "normal",
        "message_pattern": "Baustelle, Bagger hat Wasserleitung erwischt. Wasser spritzt.",
        "title_variations": ["Wasserleitung angebaggert", "Leitungsschaden Baustelle"],
        "message_variations": [
            "Baupolier meldet angebaggerte Wasserleitung, Wasser spritzt aus Grube. Ca. 2m hoch, Schieber suchen.",
            "Bagger hat Hauptleitung erwischt, Baugrube läuft voll. Wasser drückt stark, IWB informiert.",
        ],
    },
    {
        "title_pattern": "Wespennest am Schulhaus",
        "incident_type": "diverse_einsaetze",
        "category": "normal",
        "message_pattern": "Wespennest beim Eingang Schule. Schädlingsbekämpfer erst morgen verfügbar.",
        "title_variations": ["Wespennest Schule", "Wespen beim Schuleingang"],
        "message_variations": [
            "Hauswart meldet grosses Wespennest über Schuleingang. Kinder gestochen, Kammerjäger erst morgen frei.",
            "Wespennest an Fassade beim Pausenplatz. Betrieb gestört, Schädlingsbekämpfer nicht verfügbar.",
        ],
    },
    {
        "title_pattern": "Katze auf Baum",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Katze auf Baum, seit 2 Tagen. Besitzerin am Verzweifeln.",
        "title_variations": ["Katze auf Baum", "Katze im Baum gefangen"],
        "message_variations": [
            "Besitzerin meldet Katze seit 2 Tagen auf Baum, ca. 6m hoch. Kommt nicht runter, Frauchen verzweifelt.",
            "Katze in Baumkrone, ca. 5m. Miaut seit gestern, Besitzerin bittet dringend um Hilfe.",
        ],
    },
    {
        "title_pattern": "Ente in Lichtschacht",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Ente mit 6 Küken im Lichtschacht. Kommen nicht raus.",
        "title_variations": ["Enten im Lichtschacht", "Entenfamilie im Schacht"],
        "message_variations": [
            "Anwohnerin meldet Ente mit 6 Küken im Lichtschacht. Kommen nicht raus, Mutter watschelt aufgeregt.",
            "Entenfamilie in Kellerschacht gefallen, ca. 7 Tiere. Sitzen fest, brauchen Ausstiegshilfe.",
        ],
    },
    {
        "title_pattern": "Igel im Kellerschacht",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Igel in Kellerschacht. Bewohner füttert ihn seit einer Woche, will ihn jetzt raus haben.",
        "title_variations": ["Igel im Schacht", "Igel im Kellerschacht"],
        "message_variations": [
            "Bewohner meldet Igel im Lichtschacht seit ca. einer Woche. Hat ihn gefüttert, möchte ihn nun draussen haben.",
            "Igel sitzt im Kellerschacht fest, ca. 1,5m tief. Melder will ihn nicht mehr durchfüttern.",
        ],
    },
    {
        "title_pattern": "Schwan auf Strasse",
        "incident_type": "gerettete_tiere",
        "category": "normal",
        "message_pattern": "Schwan blockiert Kreuzung. Polizei hat aufgegeben.",
        "title_variations": ["Schwan auf Strasse", "Schwan blockiert Kreuzung"],
        "message_variations": [
            "Polizei meldet Schwan mitten auf Kreuzung. Lässt sich nicht vertreiben, Verkehr staut sich.",
            "Schwan blockiert Fahrbahn und faucht jeden an. Polizei bittet um Unterstützung.",
        ],
    },
    # ========================================
    # CRITICAL - Brand
    # ========================================
    {
        "title_pattern": "Wohnungsbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Wohnung 2. OG. Starker Rauch, Personen evtl. noch drin.",
        "title_variations": ["Brand in Wohnung", "Rauch aus Wohnung"],
        "message_variations": [
            "Brand in MFH, Wohnung 3. OG. Starke Rauchentwicklung, Treppenhaus verraucht.",
            "Nachbarn melden Rauch aus Wohnung. Bewohner nicht erreichbar.",
            "Brand in Wohnung gemeldet. Bewohnerin draussen, Hund noch drin.",
        ],
    },
    {
        "title_pattern": "Fahrzeugbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Fahrzeugbrand auf Parkplatz. Flammen sichtbar.",
        "title_variations": ["PKW in Brand", "Auto brennt"],
        "message_variations": [
            "PKW brennt im Motorraum, Fahrer hat Fahrzeug verlassen. Reifen platzen bereits.",
            "Fahrzeugbrand am Strassenrand, schwarzer Rauch sichtbar weithin.",
            "Autobrand auf Quartierparkplatz. Zwei weitere Fahrzeuge bereits angeschlagen.",
        ],
    },
    {
        "title_pattern": "Brand Gartenhaus",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Gartenhütte in Vollbrand. Gasflaschen drin.",
        "title_variations": ["Gartenhütte in Brand", "Vollbrand Gartenhaus"],
        "message_variations": [
            "Gartenhaus in Vollbrand, Gasflasche und Benzinkanister bekannt im Schopf.",
            "Schopf brennt lichterloh, Funkenflug bedroht Nachbargrundstück.",
        ],
    },
    {
        "title_pattern": "Küchenbrand",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand klein, Küche Fettbrand. Starker Rauch, Bewohner draussen.",
        "title_variations": ["Fettbrand Küche", "Brand in Küche"],
        "message_variations": [
            "Fettbrand auf Herd, Bewohnerin hat Wasser draufgeschüttet. Stichflamme bis Decke.",
            "Pfannenbrand, Küche stark verqualmt. Bewohner versucht zu löschen.",
            "Backofen brennt, Bewohner haben Wohnung verlassen. Rauch aus geöffnetem Fenster.",
        ],
    },
    {
        "title_pattern": "Brand Dachstock",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Dachstock MFH. Flammen durch Dach sichtbar.",
        "title_variations": ["Dachstockbrand", "Brand Dachstuhl"],
        "message_variations": [
            "Dachstuhl in Vollbrand, Funkenflug auf Nachbargebäude. DLK-Einsatz angefordert.",
            "Brand im Dachgeschoss MFH, Flammen schlagen aus Dachfenstern.",
        ],
    },
    {
        "title_pattern": "Brand Tiefgarage",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Rauch aus Tiefgarage, vermutlich Fahrzeugbrand. Starke Verrauchung.",
        "title_variations": ["Rauch aus Tiefgarage", "Fahrzeugbrand Tiefgarage"],
        "message_variations": [
            "Starker Rauch aus Tiefgaragenausfahrt. Brandmeldeanlage hat ausgelöst.",
            "Vermutlich brennt PKW im UG. Lüftung läuft, Treppenhaus rauchfrei.",
        ],
    },
    {
        "title_pattern": "Brand Abfallcontainer",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand klein, Abfallcontainer unter Vordach. Flammen schlagen hoch.",
        "title_variations": ["Container brennt", "Mülltonne in Brand"],
        "message_variations": [
            "Abfallcontainer brennt, Vordach bereits angerusst. Übergreifen möglich.",
            "Müllcontainer in Brand neben Hauseingang. Funken Richtung Hecke.",
        ],
    },
    {
        "title_pattern": "Brand Werkstatt",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, Schreinerei. Starke Flammen, viel Holz. Keine Personen.",
        "title_variations": ["Werkstattbrand", "Brand Industriebetrieb"],
        "message_variations": [
            "Brand in Schreinerei, Sägespäne brennen, Sprinkler hat ausgelöst.",
            "Industriehalle, Brand an Lackierstation. Lösungsmittel im Lager.",
        ],
    },
    {
        "title_pattern": "E-Bike Brand Keller",
        "incident_type": "brandbekaempfung",
        "category": "critical",
        "message_pattern": "Brand, E-Bike-Akku im Veloraum. Rauch im Treppenhaus.",
        "title_variations": ["Akkubrand Veloraum", "Brand E-Bike"],
        "message_variations": [
            "E-Bike-Akku in Brand im Veloraum, Stichflammen, Treppenhaus verraucht.",
            "Akkubrand beim Laden, Bewohner hat Stecker gezogen, Akku qualmt weiter.",
        ],
    },
    # ========================================
    # CRITICAL - BMA
    # ========================================
    {
        "title_pattern": "BMA Schulhaus",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Schulhaus. Evakuation läuft.",
        "title_variations": ["BMA Schule", "Brandmeldeanlage Schulhaus"],
        "message_variations": [
            "BMA-Aufschaltung Schulhaus, Hauswart vor Ort, kein Rauch sichtbar.",
            "BMA Schule, Sektor C ausgelöst. Klassen werden gesammelt.",
        ],
    },
    {
        "title_pattern": "BMA Altersheim",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Pflegeheim. Melder 2. Stock Ost.",
        "title_variations": ["BMA Pflegeheim", "Brandmeldeanlage Pflegeheim"],
        "message_variations": [
            "BMA Pflegeheim, Melder Demenzstation. Personal evakuiert bewegliche Bewohner.",
            "BMA-Auslösung Altersheim, Melder Stationsküche. Kein sichtbarer Rauch.",
        ],
    },
    {
        "title_pattern": "BMA Gewerbe",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Industriebetrieb. Melder Produktionshalle.",
        "title_variations": ["BMA Industriebetrieb", "Brandmeldeanlage Gewerbe"],
        "message_variations": [
            "BMA Industriebetrieb, Sektor Lager. Sicherheitsbeauftragter vor Ort.",
            "BMA-Auslösung Produktionshalle, Schweissarbeiten gemeldet.",
        ],
    },
    {
        "title_pattern": "BMA Einkaufszentrum",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Einkaufszentrum. Melder Küche Food Court.",
        "title_variations": ["BMA Shopping", "Brandmeldeanlage Einkaufszentrum"],
        "message_variations": [
            "BMA Einkaufszentrum, Melder Lager Möbelabteilung. Center-Manager unterwegs.",
            "BMA Mall, Sektor 3 ausgelöst. Personal evakuiert Kunden.",
        ],
    },
    {
        "title_pattern": "BMA Hallenbad",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Hallenbad. Melder Technikraum, Chloranlage in der Nähe.",
        "title_variations": ["BMA Hallenbad", "Brandmeldeanlage Hallenbad"],
        "message_variations": [
            "BMA Hallenbad, Melder Saunabereich. Badegäste werden evakuiert.",
            "BMA-Auslösung Hallenbad Technikraum, Chlordosieranlage in der Nähe.",
        ],
    },
    {
        "title_pattern": "BMA Wohnheim",
        "incident_type": "bma_unechte_alarme",
        "category": "critical",
        "message_pattern": "BMA, Studentenwohnheim. Melder 3. OG Küche.",
        "title_variations": ["BMA Studentenwohnheim", "Brandmeldeanlage Wohnheim"],
        "message_variations": [
            "BMA Studentenwohnheim, Etagenküche 3. OG. Studierende strömen ins Freie.",
            "BMA-Auslösung Wohnheim, Melder Gemeinschaftsküche.",
        ],
    },
    # ========================================
    # CRITICAL - Personenrettung
    # ========================================
    {
        "title_pattern": "Person in Lift",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Person in Lift eingeschlossen, 4. OG. Steht zwischen Stockwerken.",
        "title_variations": ["Lift blockiert mit Person", "Person im Aufzug eingeschlossen"],
        "message_variations": [
            "Lift steht zwischen 3. und 4. OG, Person mit Kinderwagen drin. Spricht ruhig.",
            "Personen in Lift eingeschlossen, Stromausfall. Liftnotruf hat ausgelöst.",
        ],
    },
    {
        "title_pattern": "Verkehrsunfall eingeklemmt",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "VU, 2 PKW. Eine Person eingeklemmt. Sanität vor Ort.",
        "title_variations": ["VU mit Eingeklemmtem", "Frontalkollision mit Eingeklemmtem"],
        "message_variations": [
            "Frontalkollision Landstrasse, 1 Person eingeklemmt im Fahrzeug, Sanität versorgt.",
            "VU 2 Fahrzeuge, Fahrerseite stark deformiert. Hydraulisches Gerät nötig.",
        ],
    },
    {
        "title_pattern": "Absturz Baugerüst",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Person ab Gerüst gestürzt, ca. 3m. Bewusstlos.",
        "title_variations": ["Absturz vom Gerüst", "Sturz Baustelle"],
        "message_variations": [
            "Maler vom Gerüst gestürzt, ca. 4m, Sanität reanimiert.",
            "Bauarbeiter abgestürzt, hängt im Geschirr in 6m Höhe.",
        ],
    },
    {
        "title_pattern": "Kind in Schacht",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "Kind in Kanalschacht gefallen. Ansprechbar.",
        "title_variations": ["Kind in Kanalschacht", "Kindrettung Schacht"],
        "message_variations": [
            "Kind in Kanalschacht gefallen, ansprechbar, weint. Eltern panisch.",
            "Junge in offenem Schacht, ca. 2m tief. Ansprechbar, keine Verletzungen sichtbar.",
        ],
    },
    {
        "title_pattern": "Auffahrunfall Kreuzung",
        "incident_type": "strassenrettung",
        "category": "critical",
        "message_pattern": "VU, Auffahrunfall 3 Fahrzeuge. Betriebsstoffe laufen aus.",
        "title_variations": ["VU Auffahrunfall", "Mehrere Fahrzeuge Auffahrunfall"],
        "message_variations": [
            "Auffahrunfall an Ampel, 3 PKW, Kühlflüssigkeit auf Fahrbahn, keine Eingeklemmten.",
            "Massenkarambolage Kreuzung, Sanität vor Ort, Strasse muss gesperrt werden.",
        ],
    },
    # ========================================
    # CRITICAL - Andere
    # ========================================
    {
        "title_pattern": "Gasgeruch",
        "incident_type": "chemiewehr",
        "category": "critical",
        "message_pattern": "Gasgeruch in MFH. Quelle unbekannt, Bewohner draussen.",
        "title_variations": ["Gasgeruch MFH", "Gasalarm Wohnung"],
        "message_variations": [
            "Gasgeruch im Treppenhaus, Quelle unklar. EW informiert, Bewohner draussen.",
            "Bewohnerin meldet starken Gasgeruch in Küche, Ventil bereits zugedreht.",
        ],
    },
    {
        "title_pattern": "Chemikalienunfall Labor",
        "incident_type": "chemiewehr",
        "category": "critical",
        "message_pattern": "Chemie ausgelaufen, Schule Chemiesaal. Dämpfe, Gebäude wird geräumt.",
        "title_variations": ["Chemieunfall Schule", "Laborchemie ausgelaufen"],
        "message_variations": [
            "Chemikalien im Chemiesaal ausgelaufen, Dämpfe sichtbar. Schule wird evakuiert.",
            "Reaktion im Labor, Rauchentwicklung. Lehrperson hat Klasse ins Freie geführt.",
        ],
    },
    {
        "title_pattern": "Chlorgeruch Hallenbad",
        "incident_type": "chemiewehr",
        "category": "critical",
        "message_pattern": "Chlorgeruch Hallenbad. Dosieranlage vermutlich defekt.",
        "title_variations": ["Chlorgas Hallenbad", "Chloralarm Hallenbad"],
        "message_variations": [
            "Starker Chlorgeruch Hallenbad, Bademeister hat Becken geräumt.",
            "Chlorgas-Verdacht Hallenbad Technikraum, Anlage abgeschaltet.",
        ],
    },
]

print(f"Defined {len(EMERGENCY_TEMPLATES)} emergency templates")


# Everything from here to FALLBACK_TRAINING_LOCATIONS is a DEV AND DEMO FIXTURE for
# Oberwil BL, the station this was built at. It is not a template a second station
# is expected to fork: production seeds no training locations at all (see
# seed_training_data's seed_locations argument), and a station adds its own from the
# training surface or drops ad-hoc pins on its own map.


def get_training_area_bounds() -> dict:
    """Bounding box the dev/demo reverse-geocoder draws random points from."""
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
    except Exception:  # noqa: S110 — geocoding a seed address is best-effort; None is handled
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


async def seed_training_data(skip_geocoding: bool = False, seed_locations: bool = True):
    """
    Seed emergency templates and training locations.

    Args:
        skip_geocoding: If True, use the bundled fallback list instead of reverse
                       geocoding. Avoids slow, rate-limited OSM API calls at boot.
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
                session.add(EmergencyTemplate(id=uuid4(), **template_data))
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

        # Training locations: only seed when none exist — reverse geocoding is
        # slow and rate-limited, so it must never re-run on every deploy.
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

            print(f"\n⏭️  Training locations already exist ({location_count} found). Skipping geocoding.")
            return

        # Seed training locations using reverse geocoding
        target_count = 50
        addresses = []

        if skip_geocoding:
            print("\n⚠️  Skip geocoding enabled - using verified Oberwil fallback locations")
            addresses = FALLBACK_TRAINING_LOCATIONS
        else:
            # Use reverse geocoding to find real addresses
            addresses = await fetch_real_addresses_reverse_geocode(target_count)

            if not addresses:
                print("\n⚠️  Reverse geocoding failed - using verified Oberwil fallback locations")
                addresses = FALLBACK_TRAINING_LOCATIONS

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
