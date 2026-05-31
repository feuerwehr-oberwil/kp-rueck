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
        "Brand weitgehend unter Kontrolle. Restglut wird abgelöscht.",
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
    ],
    "bma_gewerbe": [
        "Auslösung durch Schweissarbeiten in Produktionshalle. Schweisser hatte keine Freigabe vom Sicherheitsbeauftragten.",
        "Industriebetrieb: Staub aus Absauganlage hat Optikmelder ausgelöst. Filter ist verstopft.",
        "Produktionshalle: Gabelstapler-Abgase haben CO-Melder ausgelöst. Tor wurde geöffnet, Halle gelüftet.",
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
        # Generic fallbacks.
        "Verletzte Person ansprechbar. Sanität bereits vor Ort. Technische Rettung nötig.",
        "Person mit Hand in Briefkasten stecken geblieben. Peinlich aber harmlos.",
        "Schlüsseldienst hat aufgegeben, jetzt hat die Polizei uns gerufen. Tür ist massiv.",
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
    ],
    "oelwehr": [
        # Generic oelwehr fallbacks.
        "Kleiner Ölaustritt, bereits gestoppt. Betroffene Fläche ca. 3m².",
        "Moped tropft Öl auf Parkplatz. Besitzer bestreitet alles. Spur führt direkt zu seinem Töff.",
    ],
    "oel_keller": [
        "Heizölaustritt im Keller. Ca. 50 Liter. Lache breitet sich nicht mehr aus.",
        "Heizöltank undicht, Auffangwanne fast voll. Tankraum mit Ölbindemittel abgedeckt.",
        "Geruch im Keller, vermutlich kleine Leckage an Tankleitung. Ca. 5 Liter ausgetreten.",
        "Heizöl im Tankraum, ca. 80 Liter. Bewohner hat Sand gestreut. Geruch im ganzen Haus.",
    ],
    "oel_strasse": [
        "Ölspur ca. 100m Länge auf Hauptstrasse. Kein Gewässer in der Nähe.",
        "LKW verliert Hydrauliköl auf Kreuzung. Ca. 20m Spur. Rutschgefahr bei Regen.",
        "Ölspur im Kreisel nach LKW-Manöver. Bereits mit Ölbindemittel abgestreut, Verkehr läuft langsam.",
        "Diesel-Lache am Strassenrand nach Tankunfall. Ca. 5m², Werkstattbetrieb informiert.",
    ],
    "oel_gewaesser": [
        "Öl auf Fahrbahn nach Unfall. Bach ca. 50m entfernt, Gefahr von Gewässerverunreinigung.",
        "Ölfilm auf Dorfbach. Quelle: undichte Ölheizung 3 Häuser weiter. Bach fliesst langsam.",
        "Schimmernde Spur auf Fluss, ca. 30m. Ölsperre wird ausgelegt, Kantonschemiker unterwegs.",
        "Diesel im Regenwasserschacht. Mündung in Bach. Sperre an Mündung gesetzt.",
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
    ],
    "tech_dach": [
        "Dach teilweise abgedeckt. Ca. 4m² offen. Blachen liegen auf dem Dachboden bereit.",
        "Kamin umgeknickt, liegt quer auf dem Dach. Absturzgefahr, Bereich darunter frei.",
        "Ziegel lose, 3 Stück bereits auf Gehweg gefallen. Bereich darunter abgesperrt.",
    ],
    "tech_storen_fassade": [
        "Storen hängt lose an Fassade, schlägt im Wind gegen Fenster. Glas noch ganz.",
        "Fassadenelement löst sich vom Bürohaus, ca. 2m über Gehweg. Bereich gesperrt.",
        "Sonnenstoren abgerissen, hängt am Kabel. Pendelt über Eingangsbereich.",
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
    "strassenrettung": {"available": 0.5, "unknown": 0.3, "unavailable": 0.1, "emergency_needed": 0.1},
    "chemiewehr": {"unavailable": 0.3, "emergency_needed": 0.3, "available": 0.2, "unknown": 0.2},
    "oelwehr": {"available": 0.5, "unknown": 0.3, "unavailable": 0.1, "emergency_needed": 0.1},
    "bma_unechte_alarme": {"available": 0.7, "unknown": 0.2, "unavailable": 0.05, "emergency_needed": 0.05},
}

# Fallback for types not in the map
_DEFAULT_POWER_SUPPLY_WEIGHTS = {"available": 0.35, "unavailable": 0.25, "emergency_needed": 0.2, "unknown": 0.2}


def _get_elementar_subcategory(text: str) -> str:
    """Categorize an elementarereignis incident by keywords into a subcategory.

    `text` should be the lowercased concatenation of title + description so
    the resolver can pick up cues from both ("Wasser im Keller" title +
    "Hochwasser, MFH" description both point to water).
    """
    water_keywords = [
        "wasser", "keller", "überflut", "kanal", "rückstau", "pumpen",
        "feucht", "waschmaschine", "pool", "garage unter", "liftschacht",
        "hochwasser", "rohrbruch", "abfluss", "kanalrückstau",
    ]
    tree_keywords = ["baum", "ast", "wurzel", "äste", "eiche", "tanne"]
    storm_keywords = [
        "dach", "fassade", "fenster", "gerüst", "werbetafel",
        "trampolin", "sonnenstoren", "ziegel", "sturm",
    ]

    for kw in water_keywords:
        if kw in text:
            return "elementar_water"
    for kw in tree_keywords:
        if kw in text:
            return "elementar_tree"
    for kw in storm_keywords:
        if kw in text:
            return "elementar_storm"

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
        ("brand_werkstatt", ["werkstatt", "schreinerei", "industrie", "gewerbe", "gartenhütte", "gartenhuette", "lagerhalle", "halle"]),
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
        ("personenrettung_vu", ["vu", "verkehrsunfall", "auffahr", "kollision", "frontalkollision", "blechschaden", "pkw", "fahrzeug", "motorrad", "töff"]),
        ("personenrettung_absturz", ["absturz", "gerüst", "geruest", "sturz", "gestürzt", "gestuerzt", "schacht", "fall"]),
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
    text = " ".join(filter(None, [title, description])).lower()

    # Types without their own pool fall back to a sibling type
    if type_key == "einsatz_bahnanlagen":
        type_key = "strassenrettung"
    elif type_key == "strahlenwehr":
        type_key = "chemiewehr"
    elif type_key in ("dienstleistungen", "gerettete_menschen"):
        type_key = "elementarereignis"

    # elementarereignis has its own (richer) subcategory resolver
    if type_key == "elementarereignis":
        sub = _get_elementar_subcategory(text)
        return sub if sub in _SUMMARIES else type_key

    # All other types use the keyword map
    for sub, kws in _TYPE_SUBCATEGORY_KEYWORDS.get(type_key, []):
        if any(kw in text for kw in kws):
            if sub in _SUMMARIES:
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


def generate_summary(
    incident_type: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> str:
    """Generate a contextual German summary based on type + title + dispatch description."""
    pool_key = _resolve_summary_pool(incident_type, title, description)
    summaries = _SUMMARIES.get(pool_key, _SUMMARIES["elementarereignis"])
    return random.choice(summaries)


def generate_reko_report_data(
    incident_type: str | None = None,
    title: str | None = None,
    description: str | None = None,
) -> dict:
    """Generate a complete reko report payload with contextual random data."""
    # BMA false alarms have a high chance of being non-relevant; diverse
    # einsaetze (wespen, türöffnungen, etc.) also lean "no FW action needed".
    if incident_type == "bma_unechte_alarme":
        is_relevant = random.random() > 0.6  # 40% relevant
    elif incident_type == "diverse_einsaetze":
        is_relevant = random.random() > 0.4  # 60% relevant
    else:
        is_relevant = random.random() > 0.1  # 90% relevant

    # For elementarereignis, resolve subcategory for danger profiles (which
    # still live at the elementar_water/_tree/_storm level)
    danger_type = incident_type
    if incident_type == "elementarereignis":
        text = " ".join(filter(None, [title, description])).lower()
        danger_type = _get_elementar_subcategory(text)

    return {
        "is_relevant": is_relevant,
        "dangers_json": generate_dangers(danger_type),
        "effort_json": generate_effort(incident_type),
        "power_supply": generate_power_supply(incident_type),
        "summary_text": generate_summary(incident_type, title, description),
        "additional_notes": None,
        "is_draft": False,
    }
