"""Random data generators for training simulation, contextual to incident type."""

import random
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

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
# (min_personnel, max_personnel, min_hours, max_hours). Personnel ranges are kept
# small — a Reko estimates the handful needed at the scene, not full callout
# strength — and tightened so the numbers don't swing wildly between reports.
_EFFORT_PROFILES: dict[str, tuple[int, int, float, float]] = {
    "brandbekaempfung": (4, 8, 1.5, 4.0),
    "elementarereignis": (2, 5, 0.5, 2.5),
    # Elementar subcategories: water = heavier/longer (pumping), tree = quick
    # clearing with few hands, storm = moderate height work.
    "elementar_water": (2, 5, 1.0, 4.0),
    "elementar_tree": (2, 4, 0.5, 1.5),
    "elementar_storm": (2, 5, 1.0, 3.0),
    "strassenrettung": (3, 6, 0.5, 2.0),
    "technische_hilfeleistung": (2, 5, 0.5, 3.0),
    "oelwehr": (3, 6, 1.0, 3.0),
    "chemiewehr": (4, 8, 2.0, 5.0),
    "strahlenwehr": (4, 8, 2.0, 6.0),
    "einsatz_bahnanlagen": (4, 7, 1.0, 3.0),
    "bma_unechte_alarme": (2, 4, 0.5, 1.0),
    "dienstleistungen": (1, 3, 0.5, 1.5),
    "diverse_einsaetze": (2, 4, 0.5, 2.0),
    "gerettete_menschen": (3, 6, 0.5, 2.0),
    "gerettete_tiere": (2, 4, 0.5, 1.5),
}

# Summaries grouped by incident type category.
# Many types carry sub-pools (e.g. brand_wohnung, oel_keller) so the Reko
# summary actually matches the dispatch instead of randomly picking a
# wildly different scene from the same broad type. The top-level type pool
# is kept as a fallback when no sub-category keyword fires.
_SUMMARIES: dict[str, list[str]] = {
    "brandbekaempfung": [
        # Generic brand summaries — used when no subcategory keyword matches.
        "Starke Rauchentwicklung. Brandabschnitt identifiziert, Zugang gesichert.",
        "Feuer auf einen Raum begrenzt. Tür geschlossen, Innenangriff möglich.",
        "Kein offenes Feuer mehr sichtbar, einzelne Glutnester. Nachlöschen wird nötig.",
        "Rauchmelder piepst seit 3 Stunden. Bewohner nicht zu Hause. Nachbarn besorgt. Vermutlich Batterie leer.",
    ],
    "brand_wohnung": [
        "Starke Rauchentwicklung. Brandabschnitt im 2. OG identifiziert. Treppenhaus noch begehbar.",
        "Feuer auf ein Zimmer begrenzt. Tür geschlossen. Zugang über Treppenhaus möglich.",
        "Flammen sichtbar am Fenster 3. OG. Treppenhaus begehbar. Innenangriff möglich.",
        "Wohnung komplett verraucht, kein offenes Feuer sichtbar. Vermutlich Schwelbrand in der Wand.",
        "Weihnachtsbeleuchtung hat Vorhang entzündet. Kleiner Brand, bereits gelöscht. Fenster offen, gut gelüftet.",
        "Bewohnerin hat Kerze unbeaufsichtigt gelassen. Vorhang in Brand. Selbst gelöscht, Wohnung verraucht.",
    ],
    "brand_kueche": [
        "Brand in Küche, Bewohner bereits evakuiert. Fettbrand mit starker Russbildung. Herd aus.",
        "Nachbar hat auf Balkon grilliert. Fettbrand in Kugelgrill. Selbst gelöscht, aber Fassade verraucht.",
        "Angebranntes Essen auf Herd, Pfanne in Vollbrand. Bewohnerin hat versucht zu löschen mit Wasser. Russ überall.",
        "Backofen-Pyrolyse vergessen, Küche stark verqualmt. Kein offenes Feuer, Lüftung läuft.",
    ],
    "brand_dachstock": [
        "Brand weitgehend unter Kontrolle, aber Glutnester im Dachstock noch vorhanden.",
        "Dachstock betroffen, Feuer breitet sich Richtung Nachbargebäude aus. DLK-Aufstellung möglich.",
        "Kamin raucht stark, Bewohner dachte es sei normal. Russbrand. Kaminfeger ist unterwegs.",
        "Dachstuhl in Vollbrand, Sparren teilweise durchgebrannt. Einsturzgefahr, Aussenangriff über DLK.",
    ],
    "brand_fahrzeug": [
        "PKW in Vollbrand auf Parkplatz. Reifen platzen bereits. Nachbarfahrzeuge gefährdet.",
        "Motorbrand, Flammen aus Motorraum. Bewohner versuchte zu löschen, Pulverlöscher leer.",
        "Auto in Tiefgarage raucht stark. Belüftung läuft. Personen aus Gebäude evakuiert.",
        "Fahrzeugbrand bereits gelöscht durch Passanten. Restglut, leichte Rauchentwicklung.",
        "LKW-Auflieger qualmt, vermutlich Bremsen heissgelaufen. Fahrer hat Zugmaschine abgekoppelt.",
    ],
    "brand_ebike": [
        "E-Bike-Akku zischt und raucht im Veloraum. Treppenhaus stark verraucht.",
        "Akkubrand im Keller. Hohe Temperaturen, Akku noch nicht vollständig durchgebrannt.",
        "Pedelec qualmt seit Anschluss ans Ladegerät. Bewohner hat Stecker gezogen.",
        "Lithium-Akku einer E-Bike-Werkstatt in Brand. Spezielle Kühlung über Tauchwanne nötig.",
    ],
    "brand_abfall": [
        "Rauch aus Briefkasten. Ursache: angezündete Werbung. Bewohner genervt, Situation harmlos.",
        "Abfallcontainer unter Vordach. Flammen schlagen hoch, Vordach bereits angerusst.",
        "Mülltonne brennt, Wind treibt Funken Richtung Hecke. Container vom Gebäude weggezogen.",
        "Sperrgut neben Container in Brand, vermutlich Brandstiftung. Personenrettung nicht nötig.",
    ],
    "brand_werkstatt": [
        "Schreinerei stark verqualmt, Sägespäne brennen am Boden. Niemand mehr im Gebäude.",
        "Brand in Industriehalle, Sprinkler hat ausgelöst. Wasser läuft, Rauch im OG.",
        "Gartenhütte komplett in Flammen, 2 Gasflaschen drin. Sicherheitsabstand eingehalten.",
        "Lagerhalle mit Kartonagen, Brand auf 50m² begrenzt. Innenangriff über Tor 3.",
    ],
    "bma_unechte_alarme": [
        # Generic BMA fallbacks.
        "BMA hat angesprochen. Kein Rauch sichtbar, kein Brandgeruch. Vermutlich Täuschungsalarm.",
        "Auslösung durch Baustaub im 2. OG. Handwerker vor Ort. Kein Brand.",
        "Fehlalarm durch Zigarettenrauch im Treppenhaus. Fenster stehen bereits offen.",
        "BMA löst regelmässig aus bei Nebel. Bekanntes Problem laut Hauswart.",
        "Anlage spinnt nach Stromausfall. Hausverwaltung hat Servicetechniker aufgeboten. Keine Gefahr.",
    ],
    "bma_schule": [
        "Schüler haben Deo im WC versprüht. Melder hat ausgelöst, Lehrer hat Klasse bereits evakuiert.",
        "Auslösung durch Werklehrer-Demo: Lötzinn-Rauch. Anlage wieder scharfgestellt.",
        "Kindergarten: Lebkuchen im Ofen vergessen. Küchenmelder hat ausgelöst, alle Kinder im Freien.",
        "Schulhausmeister bestätigt: Reinigungspersonal hat Trockner ohne Filter laufen lassen.",
    ],
    "bma_pflegeheim": [
        "Bewohnerin hat im Bad geraucht, Melder hat ausgelöst. Pflegepersonal hat sie beruhigt, keine Gefahr.",
        "Pflegeheim Ost: Toast verbrannt in Stationsküche. Melder zurückgesetzt, Bewohner blieben in Zimmern.",
        "Falscher Alarm durch defekten Melder. Anlage isoliert den Sektor, Servicetechniker aufgeboten.",
        "Bewohner hat Rufknopf mit Melder verwechselt. Pflege bestätigt Fehlalarm.",
        "Verbranntes Essen im Zimmer, Melder ausgelöst. Kein Feuer, bereits gelüftet.",
    ],
    "bma_gewerbe": [
        "Auslösung durch Schweissarbeiten in Produktionshalle. Schweisser hatte keine Freigabe vom Sicherheitsbeauftragten.",
        "Industriebetrieb: Staub aus Absauganlage hat Optikmelder ausgelöst. Filter ist verstopft.",
        "Produktionshalle: Gabelstapler-Abgase haben CO-Melder ausgelöst. Tor wurde geöffnet, Halle gelüftet.",
        "Dampf aus Reinigungsanlage hat Melder ausgelöst. Betrieb läuft, kein Brand.",
        "Fehlalarm nach BMA-Wartung, Techniker war nicht abgemeldet.",
    ],
    "bma_oeffentlich": [
        "Auslösung durch Kochdampf Food Court. Restaurantleiter hat Anlage falsch konfiguriert.",
        "Hallenbad: Chlordosieranlage hat zu hoch dosiert. Bademeister hat Becken bereits geschlossen.",
        "Einkaufszentrum: Defekter Melder im Lager Möbelabteilung. Bauverein wurde informiert.",
        "Rauchmelder ausgelöst wegen Popcorn in Mikrowelle. Alles unter Kontrolle.",
        "Melder in Küche ausgelöst. Angebranntes Essen auf dem Herd. Topf bereits entfernt.",
        "BMA-Auslösung durch Dampf aus Dusche. Melder zu nah am Bad montiert.",
    ],
    "elementarereignis": [
        "Keller ca. 25cm Wasser. Heizung und Elektrik betroffen. Pumpeinsatz nötig.",
        "Wasser fliesst weiter nach, steigt langsam. Tauchpumpe nötig.",
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
        "Wasser fliesst weiter nach, steigt langsam. Tauchpumpe nötig.",
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
        "Mehrere Dachziegel lose, bei jeder Böe fällt einer. Trottoir darunter gefährdet.",
        "Gartentrampolin gegen Hausfassade gedrückt, blockiert Hauseingang. Keine Verletzten.",
        "Grosser Sonnenschirm auf Strasse geweht, Verkehr behindert. Halterung gebrochen.",
        "Blechverkleidung am Flachdach hochgebogen, klappert laut. Droht sich zu lösen.",
        "Bauabschrankung umgeweht, liegt auf Veloweg. Absturzteile lose, Sichtbehinderung.",
        "Storenkasten teilweise gelöst, Store hängt über Balkon. Absturzgefahr auf Sitzplatz.",
    ],
    "strassenrettung": [
        # Generic fallbacks.
        "Verletzte Person ansprechbar. Sanität bereits vor Ort. Technische Rettung nötig.",
        "Person mit Hand in Briefkasten stecken geblieben. Peinlich aber harmlos.",
        "Schlüsseldienst hat aufgegeben, jetzt hat die Polizei uns gerufen. Tür ist massiv.",
        "Ring am Finger klemmt, Schwellung. Person ruhig, Ringtrenner genügt.",
        "Arbeiter mit Arm in Maschine eingeklemmt. Sanität vor Ort, Maschine gesichert.",
        "Person unter umgekipptem Lagerregal eingeklemmt. Ansprechbar, Hebekissen nötig.",
    ],
    "personenrettung_vu": [
        "Person eingeklemmt, Fahrerseite deformiert. Hydraulische Rettung erforderlich.",
        "Fahrzeug auf Seite liegend. Stabilisierung nötig vor Personenbefreiung.",
        "Zwei Fahrzeuge beteiligt, keine Einklemmung. Betriebsstoffe laufen aus.",
        "Auffahrunfall, Blechschaden. Keine Verletzten. Kühlflüssigkeit läuft aus.",
        "Frontalkollision Landstrasse. Eine Person eingeklemmt, eine ansprechbar im Strassengraben.",
        "Motorrad gegen Leitplanke. Fahrer wird gerade von Sanität versorgt, Maschine raucht leicht.",
    ],
    "personenrettung_lift": [
        "Person in Lift eingeschlossen. Spricht über Gegensprechanlage. Ruhig, keine Panik.",
        "Lift zwischen 3. und 4. OG stehen geblieben. Person mit Kinderwagen drin. Ungeduldig.",
        "Lift im UG, Tür öffnet nicht. Bewohner spricht durch Spalt, alles ok.",
        "Aufzug Pflegeheim — Bewohnerin und Pflegerin eingeschlossen. Liftmonteur unterwegs.",
    ],
    "personenrettung_absturz": [
        "Absturz aus geringer Höhe. Person bei Bewusstsein. Sanität unterwegs.",
        "Maler vom Gerüst gestürzt, ca. 4m. Person bewusstlos, Sanität reanimiert.",
        "Kind in Kanalschacht gefallen, ansprechbar. Schachtweite eng, Schleifkorbtrage nötig.",
        "Person in Baumkrone bei Baumschnitt-Arbeiten verletzt. Hängt im Geschirr, ansprechbar.",
    ],
    "personenrettung_tier": [
        "Katze auf Baum. Besitzerin besteht auf Feuerwehr. Tier sitzt seit gestern oben.",
        "Kind mit Fuss in Gitter eingeklemmt. Eltern panisch, Kind erstaunlich ruhig.",
        "Hund auf zugefrorenem Weiher eingebrochen, hält sich an Eiskante. Besitzer ausser sich.",
        "Kuh in Güllegrube gestürzt. Landwirt vor Ort, Kran und Bergegeschirr nötig.",
        "Katze seit drei Tagen im Kaminschacht, miaut. Kaminfeger unterstützt.",
    ],
    "oelwehr": [
        # Generic oelwehr fallbacks.
        "Kleiner Ölaustritt, bereits gestoppt. Betroffene Fläche ca. 3m².",
        "Moped tropft Öl auf Parkplatz. Besitzer bestreitet alles. Spur führt direkt zu seinem Töff.",
        "Diesel tropft aus abgestelltem Lieferwagen. Kleine Lache unter dem Fahrzeug.",
        "Hydraulikschlauch an Baumaschine geplatzt, ca. 2m² Ölfleck. Maschine steht.",
        "Ölaustritt an Trafostation, Betreiber alarmiert. EW ist unterwegs.",
    ],
    "oel_keller": [
        "Heizölaustritt im Keller. Ca. 50 Liter. Lache breitet sich nicht mehr aus.",
        "Heizöltank undicht, Auffangwanne fast voll. Bindemittel und Umpumpen nötig.",
        "Geruch im Keller, vermutlich kleine Leckage an Tankleitung. Ca. 5 Liter ausgetreten.",
        "Heizöl im Tankraum, ca. 80 Liter. Bewohner hat Sand gestreut. Geruch im ganzen Haus.",
    ],
    "oel_strasse": [
        "Ölspur ca. 100m Länge auf Hauptstrasse. Kein Gewässer in der Nähe.",
        "LKW verliert Hydrauliköl auf Kreuzung. Ca. 20m Spur. Rutschgefahr bei Regen.",
        "Ölspur im Kreisel nach LKW-Manöver, ca. 30m. Rutschgefahr, Verkehr läuft langsam.",
        "Diesel-Lache am Strassenrand nach Tankunfall. Ca. 5m², Werkstattbetrieb informiert.",
    ],
    "oel_gewaesser": [
        "Öl auf Fahrbahn nach Unfall. Bach ca. 50m entfernt, Gefahr von Gewässerverunreinigung.",
        "Ölfilm auf Dorfbach. Quelle: undichte Ölheizung 3 Häuser weiter. Bach fliesst langsam.",
        "Schimmernde Spur auf Fluss, ca. 30m. Ölsperre nötig, Kantonschemiker unterwegs.",
        "Diesel im Regenwasserschacht. Mündung in Bach. Sperre an Mündung nötig.",
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
        # Generic fallbacks.
        "Lage stabilisiert, weitere Massnahmen mit EW/Werkdienst koordiniert.",
        "Situation harmlos, kein dringender Eingriff nötig. Werkdienst übernimmt.",
        "Umgestürzter Bauzaun auf Trottoir, Passanten müssen ausweichen. Bauführer informiert.",
        "Loses Blech an Baustellenverkleidung schlägt im Wind. Droht sich zu lösen.",
        "Kanaldeckel fehlt auf Quartierstrasse, Loch offen. Werkdienst aufgeboten.",
    ],
    "tech_dach": [
        "Dach teilweise abgedeckt. Ca. 4m² offen. Blachen liegen auf dem Dachboden bereit.",
        "Kamin umgeknickt, liegt quer auf dem Dach. Absturzgefahr, Bereich darunter frei.",
        "Ziegel lose, 3 Stück bereits auf Gehweg gefallen. Bereich darunter abgesperrt.",
        "Firstziegel gelöst, droht auf Innenhof zu fallen. Bereich gesperrt, Steiger nötig.",
        "Antenne auf Dach umgeknickt, hängt über Traufe. Absturzgefahr.",
    ],
    "tech_storen_fassade": [
        "Storen hängt lose an Fassade, schlägt im Wind gegen Fenster. Glas noch ganz.",
        "Fassadenelement löst sich vom Bürohaus, ca. 2m über Gehweg. Bereich gesperrt.",
        "Sonnenstoren abgerissen, hängt am Kabel. Pendelt über Eingangsbereich.",
        "Rollladen aus Schiene gesprungen, blockiert Fluchtweg. Sicherung nötig.",
        "Werbebanner halb abgerissen, weht auf Trottoir. Absturzgefahr für Passanten.",
    ],
    "tech_versorgung": [
        "Baustelle: Bagger hat Wasserleitung getroffen. Wasser spritzt. Haupthahn unbekannt.",
        "Stromausfall im Quartier. Ursache: Marder im Trafo. EW ist informiert.",
        "Gasleitung beschädigt durch Erdarbeiten. Gasriecher mässig, EW sperrt Leitung ab.",
        "Wasserrohrbruch unter Strasse, Strassenbelag wölbt sich. Werkdienst ist unterwegs.",
    ],
    "tech_tor_lift": [
        "Tiefgaragentor klemmt, 4 Fahrzeuge eingeschlossen. Motor reagiert nicht.",
        "Garagentor halb offen, Mechanik blockiert. Bewohner kommt nicht in den Keller.",
        "Schranke Parkhaus blockiert nach Stromausfall. 6 Autos im Stau.",
        "Personenlift zwischen zwei Stockwerken blockiert, niemand drin. Liftfirma unterwegs.",
        "Rolltor Anlieferung klemmt halboffen, Betrieb blockiert. Motor stromlos.",
    ],
    "diverse_einsaetze": [
        "Wespennest am Eingang, Schwarm aktiv. Bereich abgesperrt, Imker informiert.",
        "Hornissennest unter Dachvorsprung. Keine akute Gefahr, kommunaler Schädlingsbekämpfer unterwegs.",
        "Bienenschwarm an Hauswand. Lokaler Imker übernimmt, kein FW-Einsatz nötig.",
        "Verdächtiges Paket im Eingangsbereich. Polizei vor Ort, Bereich gesperrt.",
        "Türöffnung für Sanität: Bewohner reagiert nicht, Polizei hat aufgeboten. Schlüssel beim Nachbarn.",
        "Gerüche aus Nachbarwohnung seit Tagen, Polizei bittet um Türöffnung. Bewohner nicht erreichbar.",
    ],
    "div_wespen": [
        "Wespennest am Eingang, Schwarm aktiv. Bereich abgesperrt, Imker informiert.",
        "Hornissennest unter Dachvorsprung. Keine akute Gefahr, Schädlingsbekämpfer unterwegs.",
        "Bienenschwarm an Hauswand. Lokaler Imker übernimmt, kein FW-Einsatz nötig.",
        "Wespennest hinter Fensterladen, Bewohnerin reagiert allergisch. Schädlingsbekämpfer unterwegs, Zugang gesichert.",
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
    # Water near electrics → power often cut; downed-tree rarely affects supply;
    # storm can knock out power.
    "elementar_water": {"unavailable": 0.4, "emergency_needed": 0.2, "available": 0.2, "unknown": 0.2},
    "elementar_tree": {"available": 0.5, "unknown": 0.25, "unavailable": 0.15, "emergency_needed": 0.1},
    "elementar_storm": {"available": 0.35, "unavailable": 0.3, "emergency_needed": 0.2, "unknown": 0.15},
    "strassenrettung": {"available": 0.5, "unknown": 0.3, "unavailable": 0.1, "emergency_needed": 0.1},
    "chemiewehr": {"unavailable": 0.3, "emergency_needed": 0.3, "available": 0.2, "unknown": 0.2},
    "oelwehr": {"available": 0.5, "unknown": 0.3, "unavailable": 0.1, "emergency_needed": 0.1},
    "bma_unechte_alarme": {"available": 0.7, "unknown": 0.2, "unavailable": 0.05, "emergency_needed": 0.05},
}

# Fallback for types not in the map
_DEFAULT_POWER_SUPPLY_WEIGHTS = {"available": 0.35, "unavailable": 0.25, "emergency_needed": 0.2, "unknown": 0.2}


# Keyword pools for the elementarereignis subcategories. Storm words include
# roof/facade damage; tree words the fallen-tree family; water the flooding
# family. "dach"/"ziegel"/"abgedeckt" are storm even when a "Wasser"/"Regen"
# word also appears, because classification is title-first + score-based below.
_ELEMENTAR_KEYWORDS: dict[str, list[str]] = {
    "elementar_water": [
        "wasser",
        "keller",
        "überflut",
        "überschwemm",
        "schwemm",
        "kanal",
        "rückstau",
        "pumpen",
        "feucht",
        "waschmaschine",
        "waschküche",
        "pool",
        "garage",
        "liftschacht",
        "hochwasser",
        "rohrbruch",
        "abfluss",
        "grundwasser",
    ],
    "elementar_tree": ["baum", "ast", "äste", "wurzel", "eiche", "tanne", "geäst"],
    "elementar_storm": [
        "dach",
        "ziegel",
        "abgedeckt",
        "fassade",
        "fenster",
        "gerüst",
        "werbetafel",
        "trampolin",
        "store",
        "markise",
        "sturm",
        "wind",
        "fensterladen",
        "vordach",
    ],
}


def _score_elementar(text: str) -> tuple[str | None, int]:
    """Best-matching elementar subcategory for a single text + its hit count.
    Score-based (dominant subject wins) rather than first-match, so an incidental
    cross-category word can't hijack the classification."""
    scores = {sub: sum(1 for kw in kws if kw in text) for sub, kws in _ELEMENTAR_KEYWORDS.items()}
    best = max(scores, key=lambda s: scores[s])
    return (best, scores[best]) if scores[best] > 0 else (None, 0)


def _get_elementar_subcategory(title: str | None, description: str | None = None) -> str:
    """Categorize an elementarereignis incident into water / tree / storm.

    The TITLE is the scenario anchor and is classified first — a storm incident
    ("Dach abgedeckt") must not be dragged to water by an incidental word in its
    (randomly varied) dispatch description. Only when the title is neutral does
    the description decide; if neither matches, the mixed elementar pool is used.
    """
    for text in (title, description):
        if not text:
            continue
        sub, hits = _score_elementar(text.lower())
        if sub and hits > 0:
            return sub
    return "elementarereignis"


# Keyword maps per top-level type. Order matters: first match wins, so put
# more specific keywords first if there's overlap.
_TYPE_SUBCATEGORY_KEYWORDS: dict[str, list[tuple[str, list[str]]]] = {
    "brandbekaempfung": [
        ("brand_kueche", ["küche", "kueche", "fettbrand", "herd", "backofen", "pfanne", "grill"]),
        ("brand_fahrzeug", ["fahrzeug", "pkw", "lkw", "auto", "motorrad", "tiefgarage", "töff", "toeff"]),
        ("brand_ebike", ["e-bike", "ebike", "akku", "veloraum", "pedelec", "lithium"]),
        # "dach" alone would match "Vordach" / "Vordächli" — keep keywords specific
        ("brand_dachstock", ["dachstock", "dachstuhl", "kamin"]),
        (
            "brand_werkstatt",
            ["werkstatt", "schreinerei", "industrie", "gewerbe", "gartenhütte", "gartenhuette", "lagerhalle", "halle"],
        ),
        ("brand_abfall", ["abfall", "container", "müll", "muell", "briefkasten", "sperrgut"]),
        ("brand_wohnung", ["wohnung", "wohnungs", "schlafzimmer", "kerze", "vorhang", "schwelbrand"]),
    ],
    "bma_unechte_alarme": [
        ("bma_schule", ["schul", "schulhaus", "kindergarten", "klassen"]),
        ("bma_pflegeheim", ["pflege", "alters", "altersheim", "wohnheim", "spital", "spitex"]),
        ("bma_gewerbe", ["industrie", "gewerbe", "produktions", "fabrik", "halle"]),
        ("bma_oeffentlich", ["einkaufszentrum", "hallenbad", "restaurant", "food", "shopping"]),
    ],
    "strassenrettung": [
        ("personenrettung_lift", ["lift", "aufzug"]),
        (
            "personenrettung_vu",
            [
                "vu",
                "verkehrsunfall",
                "auffahr",
                "kollision",
                "frontalkollision",
                "blechschaden",
                "pkw",
                "fahrzeug",
                "motorrad",
                "töff",
            ],
        ),
        (
            "personenrettung_absturz",
            ["absturz", "gerüst", "geruest", "sturz", "gestürzt", "gestuerzt", "schacht", "fall"],
        ),
        ("personenrettung_tier", ["katze", "hund", "tier"]),
    ],
    "oelwehr": [
        ("oel_keller", ["keller", "heizöl", "heizoel", "tank", "tankraum"]),
        ("oel_gewaesser", ["bach", "fluss", "gewässer", "gewaesser", "see", "kanal", "regenwasser"]),
        ("oel_strasse", ["strasse", "fahrbahn", "kreisel", "kreuzung", "spur", "parkplatz"]),
    ],
    "technische_hilfeleistung": [
        ("tech_dach", ["dach", "ziegel", "kamin"]),
        ("tech_storen_fassade", ["storen", "sonnen", "fassade", "fensterladen"]),
        ("tech_versorgung", ["wasserleitung", "bagger", "stromausfall", "trafo", "gas", "rohrbruch", "ew"]),
        ("tech_tor_lift", ["tor", "lift", "garagentor", "schranke"]),
    ],
    "diverse_einsaetze": [
        ("div_wespen", ["wespe", "hornisse", "biene", "schwarm", "imker"]),
    ],
}


def _resolve_summary_pool(
    incident_type: str | None,
    title: str | None,
    description: str | None,
) -> str:
    """Pick the most specific _SUMMARIES key for a (type, title, description) triple.

    Falls back to the top-level type pool if no subcategory keyword matches,
    and to elementarereignis if the type itself has no pool at all.
    """
    type_key = (incident_type or "elementarereignis").lower()

    # Types without their own pool fall back to a sibling type
    if type_key == "einsatz_bahnanlagen":
        type_key = "strassenrettung"
    elif type_key == "strahlenwehr":
        type_key = "chemiewehr"
    elif type_key in ("dienstleistungen", "gerettete_menschen"):
        type_key = "elementarereignis"

    # elementarereignis has its own (richer) subcategory resolver
    if type_key == "elementarereignis":
        sub = _get_elementar_subcategory(title, description)
        return sub if sub in _SUMMARIES else type_key

    # Other types use the keyword map — TITLE first (the scenario anchor), then
    # the description, so a varied dispatch line can't pick the wrong pool.
    for source in (title, description):
        if not source:
            continue
        low = source.lower()
        for sub, kws in _TYPE_SUBCATEGORY_KEYWORDS.get(type_key, []):
            if sub in _SUMMARIES and any(kw in low for kw in kws):
                return sub

    # No subcategory hit — fall back to top-level type pool, then elementar
    if type_key in _SUMMARIES:
        return type_key
    return "elementarereignis"


def _pick_weighted(weights: dict[str, float]) -> str:
    """Pick a key based on weights (don't need to sum to 1)."""
    items = list(weights.items())
    keys = [k for k, _ in items]
    w = [v for _, v in items]
    return random.choices(keys, weights=w, k=1)[0]


# Global dampening on danger probabilities so simulated Reko reports don't read
# as a wall of hazards — most scenes have one danger at most, many have none.
_DANGER_PROBABILITY_SCALE = 0.6


def generate_dangers(incident_type: str | None = None) -> dict[str, Any]:
    """Generate danger flags based on incident type probabilities."""
    profile = _DANGER_PROFILES.get(incident_type or "", _DANGER_PROFILES["elementarereignis"])

    def hits(key: str, default: float) -> bool:
        return random.random() < profile.get(key, default) * _DANGER_PROBABILITY_SCALE

    return {
        "fire": False,
        "fire_danger": hits("fire_danger", 0.1),
        "explosion": hits("explosion", 0.05),
        "collapse": hits("collapse", 0.1),
        "chemical": hits("chemical", 0.05),
        "electrical": hits("electrical", 0.1),
        "other_notes": None,
    }


def generate_effort(incident_type: str | None = None) -> dict[str, Any]:
    """Generate effort estimation scaled to incident type."""
    min_p, max_p, min_h, max_h = _EFFORT_PROFILES.get(incident_type or "", (2, 6, 0.5, 2.0))

    return {
        "personnel_count": random.randint(min_p, max_p),
        "vehicles_needed": [],
        "equipment_needed": [],
        # Whole hours only — fractional estimates (1.3 h) read as false precision
        # on a command-post board. Floor at 1 so nothing shows "0 Stunden".
        "estimated_duration_hours": max(1, round(random.uniform(min_h, max_h))),
    }


def generate_power_supply(incident_type: str | None = None) -> str:
    """Generate power supply status weighted by incident type."""
    weights = _POWER_SUPPLY_WEIGHTS.get(incident_type or "", _DEFAULT_POWER_SUPPLY_WEIGHTS)
    return _pick_weighted(weights)


def generate_summary(
    incident_type: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> str:
    """Generate a contextual German summary based on type + title + dispatch description."""
    pool_key = _resolve_summary_pool(incident_type, title, description)
    summaries = _SUMMARIES.get(pool_key, _SUMMARIES["elementarereignis"])
    return random.choice(summaries)


# Humans estimate in round numbers — a Reko says "ca. 20cm", never "21cm". Each
# quantity snaps to a ladder of plausible round values instead of an arbitrary
# jitter, so varied figures still read like real eyeball estimates.
_NICE_CM = [3, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100]
_NICE_LITER = [5, 10, 20, 30, 50, 80, 100, 150, 200]
_NICE_M = [3, 5, 10, 20, 30, 50, 80, 100, 150, 200]


def _nice_near(n: int, ladder: list[int]) -> int:
    """A round value from `ladder` near `n` — picks randomly among the plausible
    band around `n` so the figure varies but stays a number a person would say."""
    lo, hi = n * 0.5, n * 1.9
    candidates = [v for v in ladder if lo <= v <= hi]
    return random.choice(candidates) if candidates else min(ladder, key=lambda v: abs(v - n))


def vary_dispatch_numbers(text: str) -> str:
    """Vary the concrete quantities in a dispatch message (water depth in cm,
    volumes in Liter, lengths/diameters in m) so a template that says "Ca. 25cm"
    doesn't read identically on every spawn — snapping to round estimate values.
    Non-numeric text is untouched."""
    if not text:
        return text

    def _range_cm(m: re.Match[str]) -> str:
        a = _nice_near(int(m.group(1)), _NICE_CM)
        b = _nice_near(int(m.group(2)), _NICE_CM)
        if b <= a:
            higher = [v for v in _NICE_CM if v > a]
            b = higher[0] if higher else a
        return f"{a}-{b}{m.group(3)}"

    # Ranges first ("20-30cm") so the single-cm pass doesn't touch their halves.
    text = re.sub(r"(\d+)\s?-\s?(\d+)\s?(cm)", _range_cm, text)
    text = re.sub(r"(?<![\d-])(\d+)\s?cm", lambda m: f"{_nice_near(int(m.group(1)), _NICE_CM)}cm", text)
    text = re.sub(r"(\d+)\s?Liter", lambda m: f"{_nice_near(int(m.group(1)), _NICE_LITER)} Liter", text)
    text = re.sub(r"(?<![\d-])(\d+)\s?m\b", lambda m: f"{_nice_near(int(m.group(1)), _NICE_M)}m", text)
    return text


# Summary keywords that ASSERT a danger — when the reko text says it, the flag
# must be on, so the badges never contradict the prose. fire_danger is gated to
# brand types by the caller (a "kein Brand" false alarm shouldn't light it up).
_DANGER_ASSERT_KW: dict[str, list[str]] = {
    "collapse": [
        "einsturz",
        "sparren",
        "durchgebrannt",
        "wackelt",
        "instabil",
        "umgeknickt",
        "gibt nach",
        "absturz",
        "droht herab",
    ],
    "explosion": ["explos", "gasflasche", "spraydose", "gasleitung", "gasriecher"],
    "chemical": ["chlor", "chemi", "reizgas", "ätzend", "aetzend", "gefahrgut", "säure", "reiniger", "gefahrstoff"],
    "electrical": ["strom", "elektr", "trafo", "steckdose", "leitung"],
    "fire_danger": ["vollbrand", "flammen", "glutnest", "brennt", "in flammen"],
}
# Summary keywords that mean "nothing going on" — force all dangers off.
_HARMLESS_KW = [
    "täuschungsalarm",
    "fehlalarm",
    "harmlos",
    "entwarnung",
    "keine gefahr",
    "kein brand",
    "kein fw-einsatz",
    "alles unter kontrolle",
    "nichts vorgefunden",
    "kein einsatz",
]
# Effort cues: shrink to the profile floor / grow to the ceiling so the numbers
# agree with the prose ("kleines Aufgebot" shouldn't sit next to 8 Pers.).
_SMALL_EFFORT_KW = [
    "kontrolle genügt",
    "eine pumpe reicht",
    "kleines aufgebot",
    "kein mehraufwand",
    "selbst gelöscht",
    "bereits gelöscht",
    "genügt",
]
_LARGE_EFFORT_KW = [
    "verstärkung",
    "zusätzliches material",
    "zusätzliche pumpe",
    "mehrere pumpen",
    "dlk",
    "aussenangriff",
    "nachforder",
    "läuft nach",
    "grossaufgebot",
]


def _reconcile_with_summary(
    summary: str,
    resolved_type: str | None,
    dangers: dict[str, Any],
    effort: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Make the structured danger/effort fields agree with the summary prose."""
    lower = summary.lower()

    if any(k in lower for k in _HARMLESS_KW):
        for k in ("fire", "fire_danger", "explosion", "collapse", "chemical", "electrical"):
            dangers[k] = False
    else:
        for flag, kws in _DANGER_ASSERT_KW.items():
            if flag == "fire_danger" and not (resolved_type or "").startswith("brand"):
                continue
            if any(kw in lower for kw in kws):
                dangers[flag] = True

    min_p, max_p, _, _ = _EFFORT_PROFILES.get(resolved_type or "", (2, 6, 0.5, 2.0))
    if any(k in lower for k in _SMALL_EFFORT_KW):
        effort["personnel_count"] = min_p
        effort["estimated_duration_hours"] = 1
    elif any(k in lower for k in _LARGE_EFFORT_KW):
        effort["personnel_count"] = max(effort["personnel_count"], max_p)

    return dangers, effort


def _extract_qty(description: str | None, unit_pattern: str) -> int | None:
    """First integer preceding `unit_pattern` in the dispatch text (e.g. cm, Liter)."""
    if not description:
        return None
    m = re.search(rf"(\d+)\s?{unit_pattern}", description)
    return int(m.group(1)) if m else None


def _linked_summary(reported: int, unit: str, ladder: list[int], verb_small: str, verb_large: str, confirm: str) -> str:
    """A reko that confirms or corrects the figure the dispatch reported — the
    single most realistic reko behaviour (citizens over- and under-report). The
    corrected figure snaps to a round estimate value, same as the dispatch."""
    outcome = random.choices(["confirm", "less", "more"], weights=[50, 32, 18], k=1)[0]
    if outcome == "confirm":
        return f"Lage wie gemeldet, rund {reported}{unit}. {confirm}"
    if outcome == "less":
        actual = _nice_near(round(reported * 0.35), ladder)
        if actual >= reported:
            actual = next((v for v in reversed(ladder) if v < reported), reported)
        return f"Gemeldet {reported}{unit}, vor Ort nur ~{actual}{unit}. {verb_small}"
    actual = _nice_near(round(reported * 1.7), ladder)
    if actual <= reported:
        actual = next((v for v in ladder if v > reported), reported)
    return f"Gemeldet {reported}{unit}, tatsächlich mehr — ~{actual}{unit}. {verb_large}"


def _dispatch_linked_summary(resolved_type: str | None, description: str | None) -> str | None:
    """A dispatch-referencing summary for quantifiable scenes (water depth, oil
    volume), or None to fall back to the pooled summaries."""
    if resolved_type == "elementar_water":
        cm = _extract_qty(description, "cm")
        if cm:
            return _linked_summary(
                cm,
                "cm",
                _NICE_CM,
                "Bewohner hat übertrieben, Kontrolle genügt.",
                "Mehrere Pumpen nötig, Wasser läuft nach.",
                "Heizung/Elektrik betroffen, Pumpeinsatz nötig.",
            )
    if resolved_type in ("oelwehr", "oel_keller"):
        liters = _extract_qty(description, "Liter")
        if liters:
            return _linked_summary(
                liters,
                " Liter",
                _NICE_LITER,
                "Kleinmenge, Bindemittel genügt.",
                "Grössere Menge, Fachberater Chemie und Entsorgung nötig.",
                "Öllache bestätigt, Bindemittel und Entsorgung nötig.",
            )
    return None


def generate_reko_report_data(
    incident_type: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Generate a complete reko report payload with contextual random data.

    Beyond picking type-matched values, this keeps the report internally
    coherent: the summary prose and the danger/effort badges are reconciled so
    they never contradict, and quantifiable scenes get a summary that confirms
    or corrects the figure the dispatch actually reported.
    """
    # BMA false alarms have a high chance of being non-relevant; diverse
    # einsaetze (wespen, türöffnungen, etc.) also lean "no FW action needed".
    if incident_type == "bma_unechte_alarme":
        is_relevant = random.random() > 0.6  # 40% relevant
    elif incident_type == "diverse_einsaetze":
        is_relevant = random.random() > 0.4  # 60% relevant
    else:
        is_relevant = random.random() > 0.1  # 90% relevant

    # For elementarereignis, resolve the subcategory (water/tree/storm) so danger,
    # effort and power-supply profiles all match the actual scene. Non-elementar
    # types keep their incident_type, so their profiles are unchanged.
    resolved_type = incident_type
    if incident_type == "elementarereignis":
        resolved_type = _get_elementar_subcategory(title, description)

    # Prefer a dispatch-linked summary (confirms/corrects the reported figure);
    # otherwise fall back to the contextual pool.
    summary = _dispatch_linked_summary(resolved_type, description) or generate_summary(
        incident_type, title, description
    )

    dangers = generate_dangers(resolved_type)
    effort = generate_effort(resolved_type)
    dangers, effort = _reconcile_with_summary(summary, resolved_type, dangers, effort)

    return {
        "is_relevant": is_relevant,
        "dangers_json": dangers,
        "effort_json": effort,
        "power_supply": generate_power_supply(resolved_type),
        "summary_text": summary,
        "additional_notes": None,
        "is_draft": False,
    }


# Caller (Melder) pools for simulated phone/walk-in alarms. Citizens phone in
# the non-critical stuff (water, fallen tree, stuck lift, wasp nest); for a real
# fire they call the official dispatch, so the intake path stays non-critical.
_INTAKE_CALLER_FIRST_NAMES = [
    "Maria",
    "Peter",
    "Anna",
    "Thomas",
    "Ursula",
    "Daniel",
    "Brigitte",
    "Markus",
    "Ruth",
    "Stefan",
    "Esther",
    "Andreas",
    "Claudia",
    "Martin",
    "Sandra",
    "Beat",
    "Nadia",
    "Reto",
    "Heidi",
    "Patrick",
]
_INTAKE_CALLER_LAST_NAMES = [
    "Keller",
    "Meier",
    "Müller",
    "Schmid",
    "Huber",
    "Steiner",
    "Brunner",
    "Frei",
    "Gerber",
    "Widmer",
    "Baumann",
    "Graf",
    "Wyss",
    "Roth",
    "Suter",
    "Kuhn",
    "Bachmann",
    "Hofer",
    "Lüthi",
    "Marti",
]
# Non-critical, citizen-perspective context lines appended to the description.
_INTAKE_CALLER_CONTEXTS = [
    "Melder hat telefonisch gemeldet und wartet vor Ort.",
    "Anruferin beobachtet die Lage vom Nachbarhaus aus.",
    "Passant hat die Situation gemeldet und ist weitergegangen.",
    "Melder bittet um Rückruf für die genaue Ortsangabe.",
    "Anwohnerin hat den Vorfall vom Balkon aus bemerkt.",
    "Anrufer wirkt etwas aufgeregt, Lage aber stabil.",
    "Meldung kam über die Geschäftsstelle herein, Melder ist erreichbar.",
    "Melder steht beim Hauseingang und winkt die Einsatzkräfte ein.",
]


def generate_intake_caller() -> dict[str, Any]:
    """Fake caller (Melder) for a simulated phone/walk-in training alarm.

    Returns a ``contact`` string (name + Swiss mobile number) and a short
    non-critical ``context`` line, so Telefon training alarms read like a real
    citizen report instead of a bare template.
    """
    first = random.choice(_INTAKE_CALLER_FIRST_NAMES)
    last = random.choice(_INTAKE_CALLER_LAST_NAMES)
    number = f"07{random.choice('6789')} {random.randint(100, 999)} {random.randint(10, 99)} {random.randint(10, 99)}"
    return {
        "contact": f"{first} {last}, {number}",
        "context": random.choice(_INTAKE_CALLER_CONTEXTS),
    }


# Escalation injects ("Lage verschärft sich") — a field report that the scene
# got worse, per incident type. Written as radio-style Lagemeldungen so the
# operator has to react (priority is bumped to high by the endpoint).
_ESCALATIONS: dict[str, list[str]] = {
    "brandbekaempfung": [
        "Feuer greift auf das Nachbargebäude über, starke Rauchentwicklung.",
        "Durchzündung im Dachstock, Vollbrand droht.",
        "Starker Funkenflug Richtung Nachbarliegenschaft, Wind dreht.",
        "Person wird noch im Gebäude vermutet, Atemschutztrupp im Innenangriff.",
    ],
    "elementarereignis": [
        "Wasser steigt weiter, jetzt auch Zugang zum Heizungsraum betroffen.",
        "Weitere Keller in der Nachbarschaft laufen voll, Lage weitet sich aus.",
        "Zweiter Baum droht auf die Fahrleitung zu stürzen.",
        "Hangrutsch droht, Strasse muss grossräumig gesperrt werden.",
    ],
    "oelwehr": [
        "Ölfilm erreicht den Bachlauf, Ausbreitung flussabwärts.",
        "Leck grösser als gemeldet, Tank läuft weiter aus.",
    ],
    "strassenrettung": [
        "Zweites Fahrzeug beteiligt, weitere eingeklemmte Person.",
        "Betriebsstoffe laufen aus, Brandgefahr an der Unfallstelle.",
    ],
    "technische_hilfeleistung": [
        "Konstruktion instabiler als gedacht, Einsturzgefahr.",
        "Weitere Gebäudeteile betroffen, Absperrung muss erweitert werden.",
    ],
    "chemiewehr": [
        "Geruchsbelästigung nimmt zu, Anwohner klagen über Reizungen.",
        "Behälter undicht, Stoff noch nicht identifiziert.",
    ],
    "bma_unechte_alarme": [
        "Doch Rauchentwicklung im Untergeschoss festgestellt — kein Fehlalarm.",
    ],
    "_default": [
        "Lage vor Ort deutlich schlimmer als gemeldet, weitere Kräfte nötig.",
        "Situation verschärft sich, Schadenausmass grösser als angenommen.",
    ],
}

# Reinforcement requests ("Feld fordert Verstärkung") — what the crew on scene
# asks the command post for. The operator decides what to actually send.
_REINFORCEMENTS: dict[str, list[str]] = {
    "brandbekaempfung": [
        "zusätzlichen Atemschutztrupp",
        "TLF mit Wasser zur Ablösung",
        "DLK für den Aussenangriff",
    ],
    "elementarereignis": [
        "zusätzliche Pumpe und Schläuche",
        "2 AdF mit Nasssauger",
        "Sandsäcke und Transporthilfe",
        "Motorsäge und Sicherungsmaterial",
    ],
    "oelwehr": [
        "zusätzliches Öl-Bindemittel",
        "Ölsperre für den Bachlauf",
    ],
    "strassenrettung": [
        "2 AdF für den Verkehrsdienst",
        "zusätzliches Sicherungsmaterial",
    ],
    "_default": [
        "2 zusätzliche AdF",
        "zusätzliches Material ab Magazin",
        "Ablösung für die eingesetzte Gruppe",
        "Beleuchtungsmaterial für die Nacht",
    ],
}


def generate_escalation(incident_type: str | None) -> str:
    """A worsening-situation Lagemeldung matching the incident type."""
    pool = _ESCALATIONS.get(incident_type or "", []) + _ESCALATIONS["_default"]
    return random.choice(pool)


def generate_reinforcement_request(incident_type: str | None) -> str:
    """What the field crew asks for — type-matched, with generic fallbacks."""
    pool = _REINFORCEMENTS.get(incident_type or "", []) + _REINFORCEMENTS["_default"]
    return random.choice(pool)


# ============================================
# Schadenplatz-Rapport simulation (plan 25, §16 / §16.1)
# ============================================
#
# The numbers live in ONE named table, `RAPPORT_SIM_PROFILE`, and never as
# literals inside the generator: a trainer's "das ist zu sauber" has to be a
# one-line change. The profile is deliberately **patchy** — the KP has to chase
# the missing rapports, and chasing them is the skill being trained.


@dataclass(frozen=True)
class RapportSimProfile:
    """How complete a simulated Schadenplatz-Rapport is (plan 25 §16.1).

    Every rate is the probability that the field bothered to fill that part in.
    The two "korrigiert" rates are low on purpose: often enough that the
    `korrigiert` marker shows up in an exercise, rare enough that it stays a
    signal rather than noise.
    """

    # 1–2 sentences from a phrase bank, keyed on the scenario.
    kurzbericht_filled: float = 1.00
    # Per material unit.
    material_used: float = 0.80
    # Units that match the scenario (pumps on a Wasserschaden, saws on a
    # Sturmschaden) were almost certainly used.
    material_used_matching: float = 0.95
    # "Die Crew hat nicht geantwortet" — the third answer, which every output
    # has to be able to render.
    material_unanswered: float = 0.10
    extra_material_note: float = 0.15
    # Many storm jobs are public ground with nobody present.
    owner_block: float = 0.60
    handed_over_to: float = 0.25
    personnel_count_corrected: float = 0.10
    # Per vehicle: the crew unticking one the board thought was there.
    vehicle_absent: float = 0.10
    times_adjusted: float = 0.10
    # Decision 22 briefs the Einsatzleiter without enforcing them, so the EL
    # files most of the rapports but by no means all of them.
    filed_by_leader: float = 0.70
    # The bulk inject: 80 % of the completed incidents without a rapport,
    # **rounded down**, so a gap always remains. Those gaps are why the
    # Restliste exists, and finding them is the exercise.
    bulk_coverage: float = 0.80
    # "Abholung nötig" after "Einsatz beendet" (decision 24), preselected by the
    # situation: a crew that walked there or whose vehicle drove on is usually
    # stranded, everyone else usually is not.
    pickup_when_stranded: float = 0.70
    pickup_otherwise: float = 0.15


RAPPORT_SIM_PROFILE = RapportSimProfile()

# The KFZ-Block is filled **only when a vehicle is actually involved** — which
# is a property of the Einsatz, not of the crew's diligence. Every IncidentType
# not named here is 0 %: a Kennzeichen on a Wasserschaden im Keller is noise in
# the billing export, not realism.
RAPPORT_KFZ_RATES: dict[str, float] = {
    "strassenrettung": 0.80,
    "technische_hilfeleistung": 0.15,
}

# "Vor Ort verblieben" depends on what the thing **is**: a pump keeps running in
# a cellar overnight, a chainsaw goes home in the vehicle. `Material.type` is a
# station-configurable free string (models.py, default "Sonstiges"), so this is
# keyword matching on type AND name with a documented fallback — never an enum.
RAPPORT_MATERIAL_BUCKET_RATES: dict[str, float] = {
    "stays": 0.60,
    "goes_home": 0.05,
    "trailer": 0.25,
    # A consumable that was used is gone; it can never be "left on site"
    # (decision 26). Enforced in `crud/feld.py` as well — this only keeps the
    # simulator from generating the impossible state in the first place.
    "consumable": 0.00,
    "unknown": 0.15,
}

# Checked in this order, so "Anhänger" wins over anything a trailer's name might
# also contain and the specific buckets win over the fallback.
RAPPORT_MATERIAL_BUCKET_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("trailer", ("anhänger",)),
    (
        "stays",
        (
            "pumpe",
            "tauchpumpe",
            "sauger",
            "wassersauger",
            "trocknung",
            "entfeuchter",
            "generator",
            "blache",
            "plane",
            "absperrung",
        ),
    ),
    (
        "goes_home",
        (
            "säge",
            "motorsäge",
            "rettsäge",
            "werkzeug",
            "elektrowerkzeug",
            "leiter",
            "beleuchtung",
            "schlauch",
        ),
    ),
)

# Which units the scenario makes near-certain to have been used. Generator-
# internal flavour only (see `derive_scenario`): the scenario is never stored,
# never returned and never labelled anywhere.
_SCENARIO_MATERIAL_KEYWORDS: dict[str, tuple[str, ...]] = {
    "wasserschaden": ("pumpe", "sauger", "schlauch", "trocknung", "entfeuchter"),
    "sturmschaden": ("säge", "leiter", "blache", "plane", "absperrung"),
    "schneebruch": ("säge", "leiter", "schaufel"),
}

# Title/description keywords that say what kind of job this was. Generator-
# internal only: they pick the Kurzbericht phrasing and the material keywords, so
# a simulated Wasserschaden mentions pumps and ticks the pump.
_SCENARIO_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("schneebruch", ("schnee", "schneebruch", "schneelast", "lawine")),
    ("sturmschaden", ("sturm", "baum", "ast", "dach", "ziegel", "abgedeckt", "windbruch", "böe")),
    ("wasserschaden", ("wasser", "keller", "überflut", "unterführung", "tiefgarage", "dole", "regen", "bach")),
)

# Weighted fallback when neither the title nor the description says anything.
_SCENARIO_WEIGHTS: dict[str, float] = {
    "wasserschaden": 0.50,
    "sturmschaden": 0.35,
    "schneebruch": 0.05,
    "anderes": 0.10,
}

# 1–2 sentences, keyed on the scenario. Lage, Tätigkeit, Geräte in one box —
# exactly what the form's hint asks for.
_RAPPORT_KURZBERICHTE: dict[str, list[str]] = {
    "wasserschaden": [
        "Keller ca. 30 cm unter Wasser. Mit Tauchpumpe ausgepumpt und mit Sauger nachgetrocknet.",
        "Wasser über Lichtschacht eingedrungen. Ausgepumpt, Lichtschacht mit Blache abgedeckt.",
        "Waschküche und Heizungsraum betroffen. Ausgepumpt, Elektroverteilung durch EW freigeschaltet.",
        "Tiefgarage teilweise unter Wasser. Zwei Pumpen im Einsatz, Rampe mit Sandsäcken gesichert.",
        "Wenig Wasser im Keller, Situation kontrolliert. Kein weiterer Einsatz nötig.",
    ],
    "sturmschaden": [
        "Baum auf Fahrbahn. Mit Motorsäge zerlegt und Fahrbahn geräumt.",
        "Dach teilweise abgedeckt. Notabdeckung mit Blache erstellt, Ziegel vom Gehweg entfernt.",
        "Ast über Leitung hängend. Bereich abgesperrt, Werkdienst avisiert.",
        "Bauabschrankung umgestürzt. Wieder aufgestellt und gesichert.",
    ],
    "schneebruch": [
        "Ast unter Schneelast gebrochen. Abgetragen und Bereich geräumt.",
        "Vordach unter Schneelast eingedrückt. Schnee abgetragen, Bereich abgesperrt.",
    ],
    "anderes": [
        "Lage vor Ort kontrolliert, kleinere Aufräumarbeiten ausgeführt.",
        "Einsatzstelle gesichert und dem Eigentümer übergeben.",
    ],
}

# The second sentence a fifth of the rapports get — the small operational
# detail that makes an exercise rapport read like a real one.
_RAPPORT_KURZBERICHT_TAILS: list[str] = [
    "Einsatzstelle sauber verlassen.",
    "Eigentümer war vor Ort und wurde instruiert.",
    "Restarbeiten durch den Werkdienst.",
    "Kontrolle am Morgen empfohlen.",
]

# Obviously fake. Owner data is the first citizen PII in kp-rueck (§9), and a
# training run must never look like it holds a real person's address.
_RAPPORT_OWNER_NAMES: list[str] = [
    "Muster Hans",
    "Muster Anna",
    "Mustermann Peter",
    "Musterfrau Regula",
    "Muster Beat",
    "Mustermann Elsbeth",
]
_RAPPORT_OWNER_STREETS: list[str] = [
    "Musterstrasse 1",
    "Musterweg 12",
    "Musterplatz 4",
    "Musterstrasse 27a",
]
_RAPPORT_OWNER_CITIES: list[str] = ["4104 Oberwil", "4102 Binningen", "4103 Bottmingen"]
_RAPPORT_VEHICLE_MODELS: list[str] = ["VW Golf", "Skoda Octavia", "Fiat Ducato", "Toyota Yaris", "Ford Transit"]

_RAPPORT_HANDOVER: list[str] = [
    "Eigentümer Muster Hans",
    "Hauswart vor Ort",
    "Werkdienst Gemeinde",
    "Polizei Basel-Landschaft",
]

_RAPPORT_EXTRA_MATERIAL: list[str] = [
    "2 Schaufeln vom Werkhof ausgeliehen",
    "Nassauger vom Betrieb vor Ort mitbenutzt",
    "Sandsäcke von der Gemeinde",
    "Zusätzlicher Schlauch ab Trawa",
]

# "Meldung vom Feld" — the generic channel (decision 20). Overlaps the specific
# "Feld fordert Verstärkung" inject on purpose; this one is what a crew types or
# taps as a chip.
_FIELD_MESSAGES: dict[str, list[str]] = {
    "elementarereignis": [
        "Keller leergepumpt, wir räumen zusammen",
        "Wasser steigt wieder, brauchen zweite Pumpe",
        "Zufahrt überflutet, kommen nur zu Fuss durch",
    ],
    "brandbekaempfung": [
        "Brand gelöscht, Nachschau läuft",
        "Brandwache nötig, wer löst uns ab?",
    ],
    "oelwehr": [
        "Ölsperre steht, Bindemittel geht zur Neige",
    ],
    "_default": [
        "Sind vor Ort, Lage im Griff",
        "Brauchen noch ca. 30 Minuten",
        "Eigentümer ist eingetroffen",
        "Einsatzstelle übergeben, wir rücken ein",
    ],
}


def classify_material_bucket(material_type: str | None, name: str | None, consumable: bool) -> str:
    """Which "vor Ort verblieben" bucket a unit falls into (§16.1).

    Keyword matching on **type and name together**, because `Material.type` is a
    station-configurable free string that defaults to "Sonstiges" — an enum here
    would be wrong at every station but ours. Anything unmatched is "unknown"
    and gets the documented fallback rate.
    """
    if consumable:
        return "consumable"
    haystack = f"{material_type or ''} {name or ''}".lower()
    for bucket, keywords in RAPPORT_MATERIAL_BUCKET_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return bucket
    return "unknown"


def derive_scenario(title: str | None, description: str | None, rng: random.Random) -> str:
    """Which kind of job this is — **generator-internal flavour only**.

    It picks the Kurzbericht phrase bank and the material keywords, so a
    simulated Wasserschaden talks about pumping and ticks the pump. It is never
    stored, never returned in a payload and never rendered as a label: there is
    no Schadensart field any more, and this must not grow back into one.

    Keywords where the incident says so (Wasser / Sturm / Baum / Schnee),
    weighted random otherwise.
    """
    haystack = f"{title or ''} {description or ''}".lower()
    for scenario, keywords in _SCENARIO_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return scenario
    roll = rng.random()
    cumulative = 0.0
    for scenario, weight in _SCENARIO_WEIGHTS.items():
        cumulative += weight
        if roll < cumulative:
            return scenario
    return "anderes"


def generate_field_message(incident_type: str | None, chips: list[str], rng: random.Random) -> str:
    """A chip or a typed sentence — the generic "Meldung vom Feld" channel.

    The chips come from the station's `feld.message_chips` setting rather than
    from i18n (decision 20), so an exercise exercises the station's own wording.
    """
    if chips and rng.random() < 0.6:
        return rng.choice(chips)
    pool = _FIELD_MESSAGES.get(incident_type or "", []) + _FIELD_MESSAGES["_default"]
    return rng.choice(pool)


def generate_rapport_data(
    *,
    incident_type: str | None,
    title: str | None,
    description: str | None,
    materials: Sequence[Mapping[str, Any]],
    vehicles: Sequence[Mapping[str, Any]],
    board_personnel_count: int,
    default_work_started_at: datetime | None,
    default_work_ended_at: datetime | None,
    rng: random.Random,
    profile: RapportSimProfile = RAPPORT_SIM_PROFILE,
) -> dict[str, Any]:
    """A plausible Schadenplatz-Rapport, as the `RapportUpdate` payload (§16.1).

    Only the keys the simulated crew actually filled in are returned: the upsert
    writes exactly the fields present in the payload, so an omitted key leaves
    the derived default in place — which is precisely what "die Crew hat das
    Feld nicht angefasst" means. The times and the head count are therefore sent
    **only when the crew changed them by hand**, which is what makes the
    `korrigiert` marker mean something in the export.

    ``rng`` is injected rather than taken from the module, so a test can seed it
    and assert the rules instead of a distribution.

    ``materials`` carries one mapping per assigned unit with ``assignment_id``,
    ``name``, ``type`` and ``consumable`` — the board's units, released ones
    included, exactly as the checklist gets them. ``vehicles`` is the same for
    the vehicle checklist, which needs nothing but the ``assignment_id``.
    """
    data: dict[str, Any] = {"is_draft": False}

    # Generator-internal only — never written to the payload (see `derive_scenario`).
    scenario = derive_scenario(title, description, rng)

    if rng.random() < profile.kurzbericht_filled:
        text = rng.choice(_RAPPORT_KURZBERICHTE.get(scenario, _RAPPORT_KURZBERICHTE["anderes"]))
        if rng.random() < 0.2:
            text = f"{text} {rng.choice(_RAPPORT_KURZBERICHT_TAILS)}"
        data["kurzbericht"] = text

    # The material checklist — the single largest piece of manual KP work this
    # plan removes, so a training run has to produce a realistic one.
    ticks: list[dict[str, Any]] = []
    matching_keywords = _SCENARIO_MATERIAL_KEYWORDS.get(scenario, ())
    for unit in materials:
        consumable = bool(unit.get("consumable"))
        haystack = f"{unit.get('type') or ''} {unit.get('name') or ''}".lower()
        used: bool | None
        left_on_site = False
        if rng.random() < profile.material_unanswered:
            used = None
        else:
            matches = any(keyword in haystack for keyword in matching_keywords)
            rate = profile.material_used_matching if matches else profile.material_used
            used = rng.random() < rate
            if used:
                bucket = classify_material_bucket(unit.get("type"), unit.get("name"), consumable)
                left_on_site = rng.random() < RAPPORT_MATERIAL_BUCKET_RATES[bucket]
        ticks.append(
            {
                "assignment_id": unit["assignment_id"],
                "used": used,
                # A consumable that was used is gone — it can never be left on
                # site (decision 26), whatever the bucket rate would say.
                "left_on_site": False if consumable else left_on_site,
            }
        )
    if ticks:
        data["materials"] = ticks

    if rng.random() < profile.extra_material_note:
        data["extra_material_note"] = rng.choice(_RAPPORT_EXTRA_MATERIAL)

    if rng.random() < profile.handed_over_to:
        data["handed_over_to"] = rng.choice(_RAPPORT_HANDOVER)

    if rng.random() < profile.owner_block:
        data["owner_name"] = rng.choice(_RAPPORT_OWNER_NAMES)
        data["owner_street"] = rng.choice(_RAPPORT_OWNER_STREETS)
        data["owner_city"] = rng.choice(_RAPPORT_OWNER_CITIES)

    # The KFZ block is a property of the Einsatz, not of the crew: it is filled
    # only when a vehicle was actually involved, and every IncidentType outside
    # the table is 0 %. It is rolled independently of the owner block — a crew
    # that noted a plate but not the driver's address is the normal case.
    if rng.random() < RAPPORT_KFZ_RATES.get(incident_type or "", 0.0):
        data["vehicle_plate"] = f"BL {rng.randint(10000, 999999)}"
        data["vehicle_model"] = rng.choice(_RAPPORT_VEHICLE_MODELS)

    if rng.random() < profile.times_adjusted:
        if default_work_started_at is not None:
            data["work_started_at"] = default_work_started_at - timedelta(minutes=rng.randint(10, 20))
        if default_work_ended_at is not None:
            data["work_ended_at"] = default_work_ended_at + timedelta(minutes=rng.randint(10, 20))

    if rng.random() < profile.personnel_count_corrected:
        data["personnel_count"] = max(0, board_personnel_count + rng.choice([-1, 1]))

    # The vehicle checklist arrives prefilled ticked, so the simulated crew only
    # ever has something to say by UNTICKING one — which is exactly the rare
    # correction the KP has to notice.
    if vehicles:
        data["vehicles"] = [
            {"assignment_id": unit["assignment_id"], "present": rng.random() >= profile.vehicle_absent}
            for unit in vehicles
        ]

    return data
