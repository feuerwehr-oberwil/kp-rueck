# KP Rück Dokumentation

Digitaler Ersatz für die Magnettafel im Kommandoposten. Verwalten Sie Einsätze, Personal und Material zentral in Echtzeit.

## Ansichten

### Kanban-Board (`G K`)
Hauptansicht beim Laden der App. Zeigt alle Einsätze in Status-Spalten (Eingegangen → Archiv). Links die Personal-Seitenleiste, rechts Material und Fahrzeuge.

**Die Ansicht bleibt, wie man sie eingestellt hat.** Zugeklappte Seitenleisten, das Seitenpanel und eine weggeklickte Einrichtungs-Checkliste überstehen einen Reload – pro Gerät gemerkt, wie die übrigen Anzeige-Einstellungen.

**«3 Geräte vor Ort» am Kopf der Material-Leiste.** Material, das ein Trupp irgendwo stehen liess, ist auf dem Board sonst unsichtbar – es ist weder frei noch erkennbar im Gebrauch. Die Aufklappliste nennt Gerät, Adresse und seit wann, das Älteste zuoberst; ein Klick öffnet den zugehörigen Einsatz. Sie erscheint nur, wenn wirklich etwas draussen steht.

**«Rapporte» in der Fusszeile.** Zählt die abgeschlossenen Schadenplätze, zu denen noch kein Schadenplatz-Rapport erfasst ist, und öffnet die Liste – **Offen** (das Älteste zuoberst, denn daran erinnert sich am Ende niemand mehr) und **Erfasst**. Ein Klick auf eine Zeile springt zum Einsatz.

### Kartenansicht (`G M`)
Geografische Übersicht aller Einsatzorte. Farbige Marker zeigen Priorität (Grün/Gelb/Rot).

**Klick-Verhalten:**
- **Marker / Listen-Karte (Einfach-Klick)**: Wählt den Einsatz aus und zoomt zum Marker
- **Listen-Karte (Doppelklick)**: Öffnet den vollständigen Detail-Dialog (Modal)

**Kartenlegende:**
- **Priorität (Füllung):** Grün=Niedrig, Gelb=Mittel, Rot=Hoch
- **Status (Rahmen):** Gestrichelt=Offen, Durchgezogen=Aktiv, Gepunktet+Verblasst=Beendet
- **Fahrzeuge (GPS):** Blau=Online, Grau=Offline

**Tastatur:** `L` Labels, `I` Linien, `1-5` Fahrzeug anzeigen – siehe [Tastaturkürzel](#tastaturkürzel).

### Seitenpanel (Kanban)
Auf breiten Bildschirmen (>1280px) erscheint rechts ein Seitenpanel. Wechseln Sie zwischen **Details** (Einsatzbearbeitung) und **Karte** (Mini-Übersicht).

**Klick-Verhalten:**
- **Einfach-Klick**: Zeigt Einsatz-Details im Seitenpanel
- **Doppelklick**: Öffnet den vollständigen Detail-Dialog (Modal)

### Ereignisse (`G E`)
Events verwalten, wechseln, archivieren, exportieren.

### Einstellungen (`G S`)
System-Konfiguration: Benutzer, Sync, Drucker, Kartenstil und mehr.

### Hilfe (`G H`)
Diese Dokumentationsseite.

**Echt vs. Training:** Events können als "Training" markiert werden. Badge "Übung" erscheint, Daten werden separat geführt. Echte Events kommen von Divera.

**Audit-Export:** Einstellungen → Import/Export → Event auswählen → Excel-Export. Enthält alle Einsätze, Zuweisungen (inkl. Historie), Statusänderungen und Reko-Berichte. Für Abrechnung und Nachbesprechung. Das Audit-Protokoll wird im Hintergrund automatisch aufgeräumt (Standard-Aufbewahrung 90 Tage, im Demo-Modus 7 Tage), damit die Tabelle nicht unbegrenzt wächst.

**Drucken & Export:** Footer → "Drucken" oder Taste `D` öffnet **ein** Slide-up mit drei Spalten – alles, was auf Papier oder in eine Datei geht, an einer Stelle:
- **Thermodruck** – Board-Snapshot auf den [Thermodrucker](#thermodrucker)
- **Status drucken (A4)** – Druckvorschau mit Optionen: Einsätze nach Status filtern, Karten-Übersicht (zeigt alle Einsatzorte auf einer Karte), Fahrzeugstatus einblenden
- **Export** – Bericht (PDF), Lageblatt (A4) und Audit (XLSX) als Datei auf dieses Gerät

---

## Display-Ansichten (Multi-Monitor)

Für Kommandoposten mit mehreren Bildschirmen gibt es spezielle Anzeige-Seiten unter `/display`. Diese sind rein lesend – keine Bearbeitungsfunktionen.

**Zugriff:** Benutzermenü → Abschnitt "Anzeige" (öffnet in neuem Tab), oder direkt `/display` aufrufen.

### Lagekarte (`/display/map`)
Vollbild-Karte ohne Seitenleiste. Zeigt alle Einsatzorte, GPS-Fahrzeugpositionen und animierte Zuweisungslinien (Fahrzeug → Einsatz). Ideal für einen zentralen Lagebildschirm.

### Board (`/display/board`)
Kanban-Board ohne Bearbeitungsmöglichkeiten. Alle 6 Status-Spalten werden gleichmässig auf die Fensterbreite skaliert.

Es ist **dieselbe Einsatzkarte wie im Kommandoposten**, nur ohne Bedienelemente – gleiche Blöcke, gleiche Reihenfolge, inklusive Reko-Person, Rapport-Zeichen, Mannschaft und Material mit Namen, Melder und offener Abholung. Das Detail zeigt zusätzlich die Funkmeldungen des Trupps.

Die Wand folgt dabei **nicht** der «Ansicht» des Bedieners: *Kompakt* gibt es, damit man an einem Board, an dem man arbeitet, mehr Karten unterbringt – eine Wand soll aus fünf Metern lesbar sein. Die Anzeige-Seite hat keinen Schalter dafür, deshalb zeigt sie immer die volle Karte.

### Status (`/display/status`)
Vier-Spalten-Übersicht: Fahrzeuge, Einsätze (gruppiert nach Status), Personal (gruppiert nach Rolle) und Material (gruppiert nach Standort). Zeigt bei zugewiesenen Ressourcen den Einsatzort an. Skaliert auf grösseren Bildschirmen automatisch hoch.

### Abschnitte einklappen

In den Anzeige-Ansichten lässt sich jeder Abschnitt zuklappen – Board-Spalten, Status-Gruppen, Funktionen beim Personal, Kategorien beim Material. Bei einer grösseren Feuerwehr scrollt man sonst nur.

- **Standard ist offen.** Nichts versteckt sich vor jemandem, der gerade davortritt. Einzige Ausnahme: **ABGESCHLOSSEN** startet weiterhin eingeklappt – das ist erledigte Arbeit.
- **Eine zugeklappte Kopfzeile zeigt weiter Anzahl und Zustand:** die Anzahl Einträge, bei Personal und Material zusätzlich wie viele davon frei sind, und einen roten Punkt, sobald ein Einsatz in diesem Abschnitt überfällig ist. Einklappen ist Verstecken – und um 3 Uhr darf sich nichts Wichtiges verstecken.
- **Der Zustand wird pro Gerät gemerkt**, wie die übrigen Anzeige-Einstellungen. Der Wandschirm, das Tablet auf dem Tisch und der Laptop hinten stehen unterschiedlich weit weg; wie viel zugeklappt ist, gehört zum Bildschirm, nicht zum Einsatz.

### Cross-Window-Sync
Alle Display-Ansichten synchronisieren sich mit dem Editor-Fenster: Wird auf dem Hauptbildschirm ein Einsatz ausgewählt, springt die Display-Karte zum entsprechenden Marker und das Display-Board hebt die Karte hervor – und umgekehrt.

### Kartenstil
Unter Einstellungen → Kartenstil kann zwischen verschiedenen Kartenstilen gewechselt werden: OpenStreetMap (Standard), Topografisch (Esri), Voyager/Hell (CARTO) und Dunkel (CARTO).

---

## Suche

Die Suchleiste (`S` oder `/`) durchsucht alle Einsätze nach Adresse, Typ, Meldungstext und **Auftragsname** – wer nach der Route sucht, findet ihre Stops. Ideal um bei vielen Einsätzen schnell die richtige Karte zu finden.

Auf den Anzeige-Seiten [Board](#board-displayboard) und [Status](#status-displaystatus) liegt dieselbe Suche in der Kopfzeile, mit denselben zwei Tasten – wer vom KP zum Wandschirm geht, muss sich nichts Zweites merken. Sie reagiert nicht, während ein Feld den Cursor hat oder ein Dialog offen ist.

---

## Einsatztypen

| Typ | Beschreibung |
|-----|-------------|
| Brandbekämpfung | Feuer löschen, Brandwache |
| Elementarereignis | Unwetter, Überschwemmung, Sturm |
| Strassenrettung | Verkehrsunfälle, eingeklemmte Personen |
| Technische Hilfeleistung | Türöffnungen, Liftrettung, Wasserschäden |
| Ölwehr | Ölspuren, Betriebsmittelaustritt |
| Chemiewehr | Chemieunfälle, Gefahrgut |
| Strahlenwehr | Radioaktive Stoffe |
| Einsatz Bahnanlagen | Unfälle auf Gleisen/Bahnhöfen |
| BMA / Unechte Alarme | Brandmeldeanlagen, Fehlalarme |
| Dienstleistungen | Bienenschwärme, Katze auf Baum |
| Diverse Einsätze | Alles andere |
| Gerettete Menschen | Personenrettung dokumentieren |
| Gerettete Tiere | Tierrettung dokumentieren |

---

## Einsatzkarten

Jede Karte zeigt: Adresse, Typ, zugewiesene Ressourcen, Priorität und Alter.

### Prioritäten

| Stufe | Badge (Karte) | Marker (Karte) | Shortcut |
|-------|---------------|----------------|----------|
| Niedrig | Grau | Grün | `Shift+1` |
| Mittel | Orange | Gelb | `Shift+2` |
| Hoch | Rot | Rot | `Shift+3` |

### Alters-Indikatoren

Zeigen, wie lange ein Einsatz bereits offen ist:

- **Grün** = Neu (< 15 Min)
- **Gelb** = Aktiv (15-60 Min)
- **Orange** = Länger offen (1-2 Std)
- **Rot** = Lange offen (> 2 Std) - Aufmerksamkeit nötig

### Nachbarhilfe

Bei Einsätzen mit Unterstützung einer Nachbarfeuerwehr kann "Nachbarhilfe" aktiviert werden. Rechtsklick auf Karte → "Nachbarhilfe" oder im Detail-Dialog. Markierte Einsätze zeigen ein Gebäude-Icon.

### Telefon / Walk-in-Abzeichen

Alarme, die über den [Alarm-Link](#alarm-link-telefon-walk-in) erfasst wurden, zeigen oben rechts ein blaues **Telefon-Symbol** (in einer Reihe mit den übrigen Status-Symbolen). Es markiert Meldungen aus ungeprüfter Quelle, die von der Einsatzleitung verifiziert werden sollten.

### Meldung anzeigen

Im Footer gibt es einen "Meldung" Schalter. Aktiviert zeigt er den vollständigen Meldungstext direkt auf jeder Einsatzkarte an - praktisch für schnellen Überblick ohne jeden Einsatz zu öffnen.

### Karten-Icon

Einsätze mit Koordinaten zeigen ein kleines Karten-Icon oben rechts. Klick darauf öffnet die Kartenansicht mit dem Einsatz hervorgehoben.

### Rechtsklick-Menü (Kontextmenü)

Rechtsklick auf eine Einsatzkarte öffnet ein Menü mit folgenden Optionen:

| Aktion | Beschreibung |
|--------|-------------|
| Bearbeiten | Öffnet den Detail-Dialog |
| Reko zuweisen | Offizier für Vorerkundung auswählen |
| Fahrzeug zuweisen | Fahrzeug direkt zuweisen |
| Nachbarhilfe | Markiert Einsatz mit Nachbarfeuerwehr-Beteiligung |
| Auf Karte zeigen | Springt zur Kartenansicht |
| Einsatzzettel drucken | Druckt auf Thermodrucker (nur wenn aktiviert) |

---

## So funktioniert's: Typische Abläufe

### Neuer Einsatz kommt rein

1. `N` drücken oder "Neuer Einsatz" klicken
2. Adresse und Typ eingeben
3. Einsatz erscheint in "Eingegangen"
4. Priorität setzen (`Shift+1/2/3`)
5. Entscheiden: Direkt disponieren oder erst Reko?

### Reko durchführen

1. Einsatz in "Reko" verschieben (ziehen oder `>`)
2. Offizier per Rechtsklick als "Reko" markieren
3. Link kopieren und via WhatsApp senden → Offizier öffnet vor Ort
4. Offizier klickt "Ich bin vor Ort" → Kommandoposten sieht Ankunft mit Zeitstempel
5. Reko-Formular ausfüllen, Fotos hochladen
6. Basierend auf Bericht: Disponieren oder Abschliessen

**Wo das Reko-Ergebnis landet:** Im Einsatz-Detail – auch in den Anzeige-Ansichten unter `/display` – steht unter **Reko-Ergebnis** die Beurteilung, die Gefahren, der Personal- und Zeitbedarf, der Lagetext **und die hochgeladenen Fotos**. Ein Klick auf ein Bild öffnet es in voller Grösse. Die Bilder liegen hinter der Anmeldung; über einen Freigabelink ohne Login sind sie nicht sichtbar.

**Ohne Handy draussen:** Meldet der Offizier über Funk statt über den Link, wird
derselbe Bericht im KP erfasst – siehe
[Alles vom KP aus erfassen](#alles-vom-kp-aus-erfassen-wenn-die-telefone-ausfallen).

**Reko-Status auf Karten:**
- Kein Icon: Keine Reko-Aktivität
- Fernglas (grau): Offizier vor Ort, prüft Lage ("vor Ort HH:MM" neben Name)
- Fernglas (grün mit Hintergrund): Reko-Bericht eingereicht

### Ressourcen zuweisen und losschicken

1. Fahrzeuge zuweisen: `1-5` Tasten
2. Personal und Material auf Einsatzkarte ziehen (Drag & Drop)
3. Einsatz in "Disponiert" verschieben
4. "WhatsApp kopieren" klicken → Einsatzdetails in Gruppenchat senden
5. Optional: "Divera-Alarm" klicken → zugewiesene Personen direkt via Divera-Push alarmieren
6. Bei Rückmeldung, dass vor Ort → in "Einsatz" verschieben

### Divera-Alarmierung

Zusätzlich zu WhatsApp und Drucker können zugewiesene Personen direkt über **Divera 24/7** (Push) alarmiert werden. Der Alarm enthält als **Stichwort** den Einsatztyp (z. B. "KP: Elementarereignis") und als Text die Einsatzdetails (Meldung, Fahrzeuge, Mannschaft, Material); die Adresse wird als Divera-Feld mitgegeben.

- **Wo:** Button **"Divera-Alarm"** im Einsatz-Detail-Dialog und im Disponiert-Dialog.
- **Empfänger:** die dem Einsatz zugewiesene Mannschaft (vorausgewählt) sowie die **Fahrer** der zugewiesenen Fahrzeuge (gelistet, aber nicht vorausgewählt). Vor dem Senden bestätigen.
- **Verknüpfung:** Nur mit Divera **verknüpfte** Personen können alarmiert werden – nicht verknüpfte sind ausgegraut. Verknüpft wird über den Divera-Personen-Sync (Einstellungen → Personal).
- **Aktivieren:** Einstellungen → Alarmierung → "Divera-Ausalarmierung" einschalten (benötigt Divera-Zugangsschlüssel). Dort gibt es auch einen **Testalarm** an eine einzelne Person.
- Wird im **Trainings- und Demo-Modus nicht** ausgelöst; der Pager wird bewusst nicht angesteuert (Push/keine Doppel-Alarmierung).

### Personal Check-In

QR-Code scannen → Person als anwesend markieren. Wer kein Handy dabei hat oder
nicht scannen kann, wird im **Appell** vom KP aus angemeldet – siehe unten.

### Alles vom KP aus erfassen (wenn die Telefone ausfallen)

Jeder Link ohne Anmeldung – Check-In, Reko, Feld, Alarm – ist ein **Eingangskanal,
nicht der Ort, an dem die Daten wohnen**. Alles, was ein Trupp draussen eintippen
kann, kann der KP am Board genauso erfassen. Das ist kein Komfort, sondern der
Normalfall: kein Empfang im Keller, leerer Akku, Handschuhe, oder eine Mannschaft,
die um 02:00 keine App öffnet – dann diktiert der Trupp über Funk, und der KP ist
das einzige Eingabegerät, das das System noch hat.

**Appell (Anwesenheit).** Fuss­zeile → *Check-In* → Zeile **Anwesenheit** →
«Appell öffnen» (auch über die Ereignis-Checkliste erreichbar).

- Eine Zeile pro Person, alphabetisch und **stabil** – die Liste sortiert sich
  beim Abhaken nicht um. Klick auf die Zeile schaltet weiter:
  *nicht anwesend → anwesend → gegangen*.
- «Gegangen» ist eine Aussage, keine Abwesenheit: wer um 20:40 heimgegangen ist,
  ist nicht dasselbe wie jemand, der nie da war. Der Ereignisbericht liest den
  Unterschied.
- Kopfzeile: `{anwesend} anwesend · {gegangen} gegangen · {total} Mannschaft`.
- **«Alle abmelden»** setzt am Ende des Ereignisses alle Anwesenden auf
  «gegangen». Zuteilungen bleiben bestehen, andere Ereignisse werden nicht berührt.
- Wer noch einem Einsatz zugeteilt ist, bekommt beim Abmelden eine Rückfrage –
  danach wird abgemeldet, die Zuteilung bleibt. Das Board ist die Stelle, die sie
  auflösen kann; ein hartes Verbot würde zwingen, zum Abmelden die Ansicht zu wechseln.
- Wer als *nicht verfügbar* geführt ist, erscheint ausgegraut mit Grund.
- **«Person hinzufügen»** im Appell legt die Person an **und meldet sie direkt an**.

> **Nachbarhilfe und Zivilschutz können sich nicht selbst anmelden.** Der Check-In
> zeigt nur den eigenen Bestand, und Sichtbarkeit kommt aus den Zuteilungen. Der
> vorgesehene Weg ist: im Appell (oder in der Seitenleiste) über **«Person
> hinzufügen»** erfassen und anschliessend dem Einsatz zuteilen. Das ist kein
> Fehler und kein fehlendes Feature – es ist der Arbeitsweg.

**Reko-Bericht über Funk.** Im Einsatz-Detail, Block *Reko*:
**«Reko-Bericht erfassen»** – auch bei einem Einsatz, bei dem noch nie jemand
draussen war. Es ist dasselbe Formular wie auf dem Reko-Link, nur mit anderem
Absender. Ein bereits vom Trupp eingereichter Bericht wird mit
**«Reko-Bericht ergänzen»** im selben Datensatz nachgeführt, nicht als zweiter
Bericht daneben. Fotos gibt es hier bewusst nicht: ein Funkspruch bringt keine mit.

**«Reko vor Ort» über Funk.** Im Einsatz-Detail, Block *Funkmeldungen* – dieselbe
Zeile, in der auch «Angekommen», «Einsatz beendet» und «Abholung nötig» stehen.
Die Uhrzeit ist frei setzbar (eine fünf Minuten später notierte Meldung gehört
fünf Minuten zurück) und wieder löschbar (ein missverstandener Funkspruch wird
korrigiert, nicht ergänzt).

**«Telefonisch gemeldet».** Im Dialog *Neuer Einsatz* bei Kontakt/Melder – und
nachträglich im Einsatz-Detail korrigierbar, weil die realistische Reihenfolge
«erst eintippen, dann merken, dass es ein Anruf war» ist. Der Einsatz bekommt
dasselbe blaue [Telefon-Abzeichen](#telefon-walk-in-abzeichen) wie eine Meldung
über den Alarm-Link.

**Woran man sieht, welcher Weg es war.** Gedruckte und exportierte Unterlagen
(Lageblatt, Ereignisbericht-PDF, Einsätze-Export, Thermo-Board-Snapshot) schreiben
**«(Feld)»** neben eine Erfassung vom Feld und **«(Funkmeldung)»** neben eine im KP
erfasste. Ein Bericht, den der Trupp eingereicht und der KP ergänzt hat, zeigt
beide Zeilen. Beim Normalfall – jemand meldet sich selbst an – steht bewusst nichts.

**Grenzen, die man kennen sollte:**

- Der Check-In-Link ist **anonym**: wer den QR-Code hat, kann jede Person anmelden,
  und diese Erfassung trägt keinen Namen. Nur eine Erfassung am Board ist einer
  Person zugeordnet.
- **«Telefonisch gemeldet» ist eine Behauptung, kein Nachweis** – es heisst, dass
  eine Bedienperson es so gesagt hat. Für die Statistik ist das kein Herkunftsbeleg.
- Das Board kennt **drei** Zustände, der Check-In auf dem Handy **zwei**: Wer dort
  «gegangen» ist, erscheint einfach als nicht angemeldet und ist mit einem Tipp
  wieder da. «Ich bin gegangen» tippt niemand – deshalb wird das im KP festgehalten.
- Der Reko-Block sagt nicht mehr, ob die Reko vor Ort ist; diese Information steht
  jetzt genau an einer Stelle, in den *Funkmeldungen*.

### Mehrere Einsätze gleichzeitig

- Mit `↑`/`↓` zwischen Einsätzen wechseln
- Prioritäten helfen beim Überblick (Rot = dringend)
- Alters-Badges zeigen, welche Einsätze lange offen sind
- Seitenpanel für Karte + Details nutzen (auf breiten Bildschirmen)

---

## Einsatz-Workflow

Einsätze durchlaufen 6 Phasen: **Eingegangen** → **Reko** → **Disponiert** → **Einsatz** → **Beendet** → **Archiv**

| Phase | Beschreibung |
|-------|-------------|
| Eingegangen | Neu gemeldet, Details erfassen |
| Reko | Erkundung vor Ort (optional) |
| Disponiert | Ressourcen zugewiesen, unterwegs |
| Einsatz | Aktive Arbeitsphase |
| Beendet | Rückfahrt zur Basis |
| Archiv | Beendet, Personal & Fahrzeuge automatisch freigegeben |

**Verschieben:** Karte in neue Spalte ziehen, oder `>` / `<` Tasten nutzen.

**Reihenfolge innerhalb einer Spalte:** Karten lassen sich innerhalb derselben Spalte per Drag & Drop sortieren. Die manuelle Reihenfolge bleibt erhalten und wird auch nach einem Reload bzw. auf anderen Geräten gleich angezeigt (sie springt nicht mehr in die ursprüngliche Reihenfolge zurück).

**Spalten überspringen:** Erlaubt. Nicht jeder Einsatz braucht Reko.

**Meldung vom Feld «Einsatz beendet»:** Der Hinweis auf der Karte bzw. im Detail schiebt den Einsatz mit einem Klick nach **Beendet / Rückfahrt** – und hört dort auf. Er startet **nicht** den Abschluss (Materialabfrage, Rückfragen): der Trupp fährt gerade heim, das ist genau diese Spalte. Abgeschlossen wird nachher, wie sonst auch. Braucht der Trupp eine Mitfahrgelegenheit, meldet er eine **Abholung** – die erscheint als eigenes Band im Einsatz-Detail, gleich neben der Feld-Meldung.

---

## Aufträge (Mehrstopp-Routen)

Bei einer **Flächenlage** (z. B. Sturm- oder Hochwasserschäden mit vielen kleinen Einsätzen) fährt oft **ein Trupp** mehrere Schadenplätze nacheinander ab. Ein **Auftrag** bündelt dazu mehrere Einsätze zu einer **geordneten Route** für genau diesen Trupp – statt jeden Einsatz einzeln zu disponieren, planst du die ganze Abfahrt als eine Einheit.

Öffnen mit der Taste `A` oder über die **Aufträge**-Leiste am unteren Bildschirmrand.

### Auftrag erstellen & Stops hinzufügen

1. **Neuer Auftrag** in der Aufträge-Leiste (Name + Farbe wählen – die Farbe kennzeichnet die Route auf Board und Karte).
2. **Stops (Einsätze) hinzufügen** – drei Wege:
   - **Einsatz-Auswahl** («+ Stop»): bestehende Einsätze aus einer Liste auswählen. Umschalten auf **Karte** zeigt die Einsätze geografisch – Marker anklicken wählt sie aus.
   - **Karte** (`/map` → Routenplanung): auf einen Einsatz-Marker oder eine freie Stelle klicken.
   - **Drag & Drop**: eine Einsatzkarte direkt auf den Auftrag ziehen.

Ein Einsatz, der bereits in einem anderen Auftrag liegt, wird beim Hinzufügen **verschoben** (ein Einsatz gehört zu höchstens einer Route).

### Route-eigene Ressourcen

Das Grundmodell: **Ein Auftrag ist eine einzige Einheit, die die ganze Route selbstständig abarbeitet** – wir leiten diesen einen Trupp nur von Stop zu Stop.

Daraus folgt:

- Ein Auftrag **besitzt seine Ressourcen selbst**: Fahrzeug, Personal und Material werden **dem Auftrag** zugewiesen und gelten **für alle Stops gemeinsam** – der Trupp fährt sie ja der Reihe nach ab. Die einzelnen Stops tragen **keine eigenen Ressourcen**.
- Ein Einsatz ist **ganz im Auftrag oder gar nicht** – es gibt kein «halb drin». Zusätzliche Ressourcen nur für einen einzelnen Stop (halb-im-Auftrag) werden **nicht** unterstützt. Braucht ein Schadenplatz einen eigenen Trupp mit eigenem Material, gehört er nicht in diesen Auftrag, sondern bleibt ein eigenständiger Einsatz (oder kommt in einen zweiten Auftrag).
- Die Ressourcen werden **automatisch freigegeben, wenn der letzte Stop abgeschlossen** ist.

### Route planen & optimieren

- **Routen-Editor** (in der Aufträge-Leiste): grosse Karte mit nummerierten Stops + Routenlinie neben der geordneten Stop-Liste. Stops per Drag & Drop umsortieren, per Kartenklick neue Stops anhängen.
- **Routenplanung** auf `/map`: dieselbe Planung auf der grossen Vollbild-Karte.
- **Reihenfolge optimieren**: berechnet per Nächster-Nachbar-Heuristik eine kurze Reihenfolge ab einem Startpunkt (**Magazin**, **Fahrzeug-GPS** oder **erster Stop**). Der Vorschlag wird als Vorschau angezeigt – **Übernehmen** oder **Verwerfen**.

### Funkdurchsage für einen Auftrag

Ein Auftrag wird **einmal vergeben, nicht bei jedem Stop neu**. Die App erkennt selbst, welcher Fall vorliegt – es gibt keinen zusätzlichen Knopf, der Disponiert-Dialog bleibt der Auslöser, nur der Text unterscheidet sich:

- **Der erste Stop, der auf «Disponiert» geht, ist die Auftragsvergabe.** Die Durchsage nennt den ganzen Auftrag: Mannschaft, Fahrzeuge und Material zuerst, danach die nummerierte Liste aller Stops.
- **Jeder weitere Stop ist eine Fortsetzung** und wird nur noch kurz angesagt: «Auftrag ‹Sturmholz Oberwil› weiter mit Stop 3: Mühlemattstrasse 12.» Die Mannschaft wird nicht ein zweites Mal vorgelesen.
- **Bekommt die Route zwischendurch Mannschaft, ein Fahrzeug oder Material dazu**, gibt es wieder die volle Durchsage – wer neu dabei ist, hat den Auftrag noch nie gehört.

**Erledigte Stops fallen aus der Liste, behalten aber ihre Nummer.** Ist Stop 1 abgearbeitet, heisst es «2 Stops: 2. …, 3. …». So meint «Stop 3» über die ganze Lebensdauer des Auftrags dieselbe Adresse.

**Besonderes** (Reko-Gefahren, Nachbarhilfe) steht gesammelt am Schluss, jeweils mit der Adresse dazu – nicht verstreut zwischen den Stops.

**Durchsage wiederholen:** Funkverkehr geht verloren. In der Aufträge-Leiste hat jeder Auftrag den Knopf **Durchsage wiederholen** (im aufgeklappten Auftrag neben «Routen-Editor», ausserdem im ⋮-Menü und per Rechtsklick). Er zeigt die zuletzt gemachte Durchsage im selben Wortlaut noch einmal an – ohne einen Stop-Dialog wieder aufmachen zu müssen und ohne sie neu zu zählen.

### Auf der Karte anzeigen

**Aufträge anzeigen** auf `/map` zeichnet alle Routen als farbige Linien mit nummerierten Stops. Dabei wird die Marker-Einfärbung automatisch auf **Färben nach: Auftrag** umgestellt, sodass jeder Einsatz die Farbe seiner Route trägt (Einsätze ohne Auftrag = «Kein Auftrag»).

---

## Ressourcen zuweisen

**Drag & Drop:** Person/Material aus Seitenleiste auf Einsatzkarte ziehen.

**Fahrzeuge:** Einsatz auswählen, dann `1-5` Tasten.

**Per Dialog:** Auf [+] Button bei Ressourcen-Kategorie klicken, Ressource auswählen.

Nur verfügbare Ressourcen (grüner Punkt) können zugewiesen werden.

### Spezialrollen (Rechtsklick auf Person)

| Rolle | Bedeutung |
|-------|-----------|
| **Fahrer** | Fährt ein bestimmtes Fahrzeug (1-5). Ermöglicht Shuttle-Betrieb ohne ständigen Fahrerwechsel. |
| **Reko** | Offizier für Vorerkundung. Prüft vor Ort, ob Einsatz relevant ist, bevor das ganze Team ausrückt. |
| **Magazin** | Feldweibel im Magazin. Koordiniert Retablierung und Reinigung der Ausrüstung. |

Erneuter Rechtsklick entfernt die Zuweisung.

**Fahrer: kommt zurück oder bleibt vor Ort?** Bei jedem zugewiesenen Fahrzeug lässt sich per Klick auf das Fahrer-Badge umschalten, ob der Fahrer nach der Anlieferung **zurückkommt** oder **vor Ort bleibt**. Standard ist **„kommt zurück"** – bei diesen Einsätzen sollen unsere Fahrzeuge nur pendeln (Personal und Material anliefern und danach wieder verfügbar sein), statt am Einsatzort gebunden zu bleiben.

### Sicherheitsabfragen – das Auffangnetz

Damit in hektischen Momenten kein Schritt vergessen geht, blendet das System bei den folgenden Situationen automatisch eine Rückfrage ein. Sie sind als **Fallback** gedacht: der normale Ablauf funktioniert auch ohne sie – aber falls man etwas vergisst, fängt die Abfrage es auf. Der empfohlene (sichere) Knopf ist jeweils hervorgehoben.

| Situation | Abfrage |
|-----------|---------|
| **Fahrzeug ohne Fahrer zuweisen** | Direkt beim Zuweisen erscheint die Fahrer-Auswahl. „Schliessen" lässt das Fahrzeug bewusst ohne Fahrer. |
| **Fahrzeug bereits im Einsatz** (Doppelbuchung) | Ein Fahrzeug ist nur einmal physisch vorhanden – beim erneuten Zuweisen: **Hierher verschieben** (von den anderen Einsätzen entfernen) oder **Mehrfach zuweisen** (Doppelbuchung bewusst behalten). |
| **In die Reko-Spalte ohne Reko-Person** | Wird ein Einsatz nach „Reko" verschoben, ohne dass eine Reko-Person zugewiesen ist, erscheint „Keine Reko-Person zugewiesen": **Reko-Person zuweisen** (sie erhält dann das Reko-Formular) oder „Trotzdem fortfahren". |
| **Disponieren ohne Ressourcen** | Fehlen beim Verschieben nach „Disponiert" **Personal, Fahrzeuge oder Mittel** (Fahrzeuge entfallen bei „zu Fuss"), erscheint „Ressourcen fehlen". Empfohlen ist **Zuweisen** – das öffnet die Zuweisung und führt danach direkt zum Funk-/Alarm-Dialog weiter; „Trotzdem disponieren" fährt bewusst unterbestückt los. |
| **Abgeschlossenen Einsatz als Stop hinzufügen** | Wird ein bereits abgeschlossener Einsatz an einen Auftrag gehängt – per Stop-Auswahl, «An Auftrag verteilen» oder Drag & Drop –, fragt das System nach. Es ist **erlaubt** (Wiederaufnahme, zweiter Besuch derselben Adresse), soll aber nicht unbemerkt passieren. |
| **Abschliessen mit zugewiesenem Material** | Wird ein Einsatz abgeschlossen, während noch Material zugewiesen ist, fragt das System: **Material zurück** (freigeben) oder „Vor Ort gelassen" (zugewiesen lassen, z. B. wenn es vor Ort bleibt). |

Personal und Fahrzeuge werden beim Abschliessen automatisch freigegeben; nur Material wird abgefragt, weil es bewusst vor Ort bleiben kann.

---

## Tastaturkürzel

Drücken Sie `Cmd/Ctrl+K` für die Befehlspalette – sie listet alle Befehle samt
Tastaturkürzel und ist auch über das Benutzermenü ("Befehle & Tastaturkürzel")
erreichbar. Kürzel sind inaktiv, während ein Eingabefeld fokussiert ist.

### Global
| Shortcut | Aktion |
|----------|--------|
| `Cmd/Ctrl+K` | Befehlspalette öffnen/schliessen |
| `G K` | Kanban-Board |
| `G M` | Kartenansicht |
| `G E` | Ereignisse |
| `G S` | Einstellungen |
| `G H` | Hilfe |
| `Esc` | Abbrechen / Eingabefeld verlassen / Dialog schliessen |

### Kanban-Board – Aktionen
| Shortcut | Aktion |
|----------|--------|
| `N` | Neuer Einsatz |
| `A` | Aufträge (Routen) öffnen/schliessen |
| `S` / `/` | Suche fokussieren |
| `D` | Drucken & Export öffnen/schliessen |
| `R` / `F5` | Aktualisieren |
| `F` | Fahrzeugstatus |

### Kanban-Board – Einsatz (Maus über der Karte)
| Shortcut | Aktion |
|----------|--------|
| `E` / `Enter` | Details öffnen |
| `1-5` | Fahrzeug zuweisen/entfernen |
| `Shift+1-3` | Priorität: Niedrig / Mittel / Hoch |
| `0` | Zu Fuss umschalten |
| `>` / `.` | Status vorwärts |
| `<` / `,` | Status zurück |
| `Delete` / `Backspace` | Löschen (mit Bestätigung) |

`Shift+1-3`, `0` und `1-5` funktionieren auch im geöffneten Detail-Dialog.

### Kanban-Board – Ansicht
| Shortcut | Aktion |
|----------|--------|
| `Q` / `[` | Personal-Seitenleiste ein/aus |
| `W` / `]` | Material-Seitenleiste ein/aus |
| `I` / `\` | Seitenpanel ein/aus |
| `K` | Seitenpanel: Karte anzeigen |
| `B` | Benachrichtigungen |
| `P` | Personal suchen |
| `M` | Material suchen |

### Kartenansicht (Lagekarte)
| Shortcut | Aktion |
|----------|--------|
| `L` | Labels (Marker-Beschriftungen) ein/aus |
| `I` | Zuweisungslinien ein/aus |
| `1-5` | Auf das entsprechende Fahrzeug zoomen |
| `E` / `Enter` | Details des ausgewählten Einsatzes öffnen |
| `Z` | Zoom zurücksetzen / Auswahl aufheben |
| `R` / `F5` | Aktualisieren |
| `S` / `/` | Suche fokussieren |
| Doppelklick | Auf Listen-Karte → Details öffnen |

---

## Übungsmodus & Demo

Ereignisse können als **Training** markiert werden (Badge „Übung"). Übungsdaten werden separat geführt und vermischen sich nicht mit echten Einsätzen.

### Übungs-Steuerung

Bei Trainings-Ereignissen erscheint in den Einstellungen die **Übungs-Steuerung** zum Generieren von Übungs-Einsätzen:

| Knopf | Wirkung |
|-------|---------|
| **Normal** | Ein zufälliger Alltags-Einsatz (Wasser, Sturm, Baum) |
| **Kritisch** | Ein zufälliger kritischer Einsatz (Brand, BMA, Personenrettung) |
| **Telefon-Alarm** | Simuliert eine Bürgermeldung über den Alarm-Link – der Einsatz erhält das **Telefon-Abzeichen**, einen erfundenen Melder (Name + Nummer) und eine kurze Kontext-Notiz. Bewusst nur **unkritische** Lagen (Wasser, Baum, Lift o.ä.) – für einen echten Brand ruft man die offizielle Alarmzentrale, nicht den KP |
| **Burst (5×)** | Fünf zufällige Einsätze auf einmal |
| **Gezielter Einsatz** | Bestimmtes Szenario an einer gewählten Adresse oder einem Karten-Pin |

Jede Generierung bestätigt mit einer kurzen Meldung (Toast), welcher Einsatz erzeugt wurde – so ist sofort sichtbar, dass etwas passiert ist, und man klickt nicht versehentlich mehrfach (z. B. auf „Burst") und erzeugt zu viele Einsätze.

### Demo-Sandbox

Im öffentlichen Demo-Modus erhält jeder Editor-Login (`demo-editor`) eine **persönliche Übungslage** (eigene „Demo-Lage"), damit sich gleichzeitige Demo-Besucher nicht dasselbe Board teilen. Das Demo-Banner kennzeichnet eine solche Sandbox und zeigt die verbleibende Zeit bis zum Reset.

---

## Online vs. Offline

### Online (Railway)
- QR-Code Check-In und Reko funktionieren
- Automatische Synchronisation aller Geräte
- Mobile Zugriffe von überall

### Viewer-Link (Nur-Lesen)

Für Personen ohne Login: Footer → "Viewer" generiert einen Link mit 24h Gültigkeit. Zeigt Kanban-Board und Karte ohne Bearbeitungsmöglichkeit – dieselbe Einsatzkarte wie der Kommandoposten. Aktualisiert automatisch alle 5 Sekunden.

**Der Link zeigt neu auch das Reko-Ergebnis**: relevant ja/nein, Gefahren, Aufwandschätzung, Kurzbericht **und die Fotos vom Schadenplatz**. Vorher stand dort nur, *dass* eine Reko stattgefunden hat – was den Link für die Gemeinde oder eine Nachbarwehr wenig wert machte.

> **Wer den Link hat, sieht das.** Bewusst **nicht** enthalten: das Feld «Weitere Bemerkungen» (freier Text, in dem regelmässig Anwohner namentlich vorkommen), **wer** den Bericht erfasst hat, und die Fotos eines noch nicht eingereichten Entwurfs. Fotos aus dem Schadenplatz-Rapport bleiben ebenfalls hinter der Anmeldung. Der Link gilt für **ein** Ereignis: ein weitergegebener Link öffnet nichts aus einem anderen. Entsprechend überlegt weitergeben.

### Alarm-Link (Telefon / Walk-in)

Für Personen, die einen Alarm **erfassen** sollen, ohne Login und ohne Kenntnis des restlichen Systems – z. B. jemand am Telefon oder am Schalter (Walk-in).

**Erstellen:** Toolbar → "Alarm" (Sirenen-Symbol) generiert einen Link bzw. QR-Code, der pro Ereignis **30 Tage** gültig ist. Einmal generieren, beim Telefon-Arbeitsplatz aufhängen oder als Lesezeichen speichern.

**Benutzen:** Wer den Link öffnet, sieht ein schlankes, mobil-optimiertes Formular und kann damit beliebig viele Alarme erfassen – kein Login nötig. Reihenfolge der Felder: zuerst der **Standort** (mit Adresssuche), dann die **Meldung** (was gemeldet wurde – die Adresse steht ja schon oben, also nicht doppelt eingeben), die **Priorität** als drei Schnellauswahl-Tasten (Niedrig / Mittel / Hoch), Einsatzart, weitere Hinweise und Melder/Anrufer.

**Auf dem Board:** So erfasste Alarme landen in der Spalte "Eingegangen" und tragen ein blaues **„Telefon"-Abzeichen** – damit die Einsatzleitung erkennt, dass die Meldung von einer ungeprüften Quelle stammt, und sie prüfen kann. Adresse und Standort werden direkt mitgeschickt.

> Der Link erlaubt nur das **Anlegen** von Alarmen (kein Lesen/Bearbeiten) und ist durch ein striktes Anfragelimit geschützt. Da er 30 Tage gültig ist: nur an vertrauenswürdige Stellen weitergeben.

### Offline (Localhost/Docker)
- Vollständiges Kanban-Board verfügbar
- QR-Codes funktionieren nur im lokalen Netzwerk
- Backup bei Internetausfall
- Wenn möglich via mobilem Hotspot
- Ansonsten Kommunikation nur via Funk und alles manuell in einem anderen Tab eintragen (Check-In, Reko)

### Daten synchronisieren

Die lokale Instanz synchronisiert automatisch mit Railway. Der Sync-Status wird in der Navbar angezeigt (farbiger Punkt).

**Railway → Lokal:** Daten werden automatisch von Railway heruntergeladen.

**Lokal → Railway:** Wenn Railway wieder online ist, erscheint eine Benachrichtigung mit "Jetzt synchronisieren" Button.

Sync-Einstellungen unter Einstellungen → Sync Tab.

### Verbindungsstatus (Benutzermenü)

Im Benutzermenü (oben rechts) zeigt der Bereich "Verbindung" den Status aller Systeme:

| System | Bedeutung |
|--------|-----------|
| **Backend** | API-Server Verbindung |
| **WebSocket** | Echtzeit-Updates (Polling-Fallback wenn offline) |
| **Sync** | Railway ↔ Lokal Synchronisation |
| **Drucker** | Thermodrucker-Status: Deaktiviert / Bereit / Fehler |

Klick auf einen Eintrag öffnet die entsprechenden Einstellungen.

---

## Lokale Installation

Für den Einsatz ohne Internetverbindung kann KP Rück lokal auf einem Kommandoposten-Rechner betrieben werden.

### Voraussetzungen
- Docker Desktop installiert
- Git Repository geklont

### Starten
```bash
just dev        # Startet alle Services
```

Daten werden automatisch von Railway synchronisiert (siehe Sync-Einstellungen).

### Stoppen
```bash
just stop       # Services stoppen
just clean      # Alles zurücksetzen (löscht Daten)
```

Die lokale Instanz läuft unter `http://localhost:3000`.

---

## Thermodrucker

Druckt Einsatzzettel und Board-Snapshots auf einem 58mm ESC/POS Thermodrucker (z. B. Epson TM-T20).

### Aufbau

Ein **Print-Agent** läuft auf einem Raspberry Pi im Kommandoposten-Netzwerk. Er fragt das Backend regelmässig nach neuen Druckaufträgen ab und sendet diese über das lokale Netzwerk an den Drucker. Keine Portfreigaben nötig – nur ausgehende Verbindungen.

### Einrichtung
1. Drucker per Ethernet ans lokale Netzwerk anschliessen
2. Raspberry Pi einrichten (siehe `docs/PRINT_AGENT.md` im Repository)
3. Einstellungen → Drucker → IP-Adresse und Port konfigurieren, Drucker aktivieren

> **Hinweis (Betrieb):** Die Print-Agent-Endpunkte lassen sich mit einem geteilten Token absichern (`PRINT_AGENT_TOKEN`). Wird er auf dem Server gesetzt, muss derselbe Wert auch in der systemd-Unit des Pi hinterlegt werden – sonst erhält der Agent 401-Fehler. Ohne Token sind die Endpunkte offen (nur für reine LAN-Installationen gedacht); in der Produktion wird dann eine Warnung geloggt.

### Druckaufträge

| Auftrag | Auslöser | Inhalt |
|---------|----------|--------|
| **Einsatzzettel** | Automatisch bei Status "Disponiert"/"Einsatz", oder Rechtsklick → "Einsatzzettel drucken" | Adresse, Typ, Priorität, Beschreibung, Fahrzeuge, Personal, Material |
| **Board-Snapshot** | Footer → "Drucken" (oder Taste `D`) → Spalte **Thermodruck** → Optionen wählen → "Drucken" | Ereignis-Übersicht, Einsätze mit Details, Fahrzeugstatus, Personal-Liste |
| **QR-Code-Zettel** | In den Slide-ups Check-In / Reko / Viewer / Alarm → Drucker-Symbol | Titel, Kurzbeschreibung und scannbarer QR-Code des Links – zum Verteilen auf Papier |

### QR-Code-Zettel

Jedes Link-Slide-up (Personal Check-In, Reko Dashboard, Viewer-Link, Alarm-Link) hat neben "Kopieren" und "Öffnen" ein Drucker-Symbol (nur sichtbar, wenn der Drucker aktiviert ist). Damit wird ein kompakter Zettel mit dem QR-Code und einer kurzen Beschreibung gedruckt – praktisch, um jemandem den passenden Link in die Hand zu drücken, ohne ein Gerät teilen zu müssen.

### Board-Snapshot Optionen

Die Spalte **Thermodruck** im Drucken-Slide-up hat dazu drei Schalter:

- **Beendete Einsätze** – auch archivierte Einsätze einbeziehen (Standard: aus)
- **Fahrzeug-Status** – Verfügbarkeit aller Fahrzeuge anzeigen (Standard: ein)
- **Personal-Übersicht** – Liste aller anwesenden Personen mit Zuteilungsstatus (Standard: ein)

### Polling-Verhalten

Um unnötige Abfragen zu vermeiden, verwendet der Agent **adaptives Polling**:

- **Ruhezustand**: Abfrage alle **60 Sekunden**
- **Nach einem Druckauftrag**: Wechsel auf **5 Sekunden** für **15 Minuten**, danach zurück auf 60s

So werden im Normalbetrieb nur ca. 60 Anfragen pro Stunde gesendet, während bei aktiven Einsätzen Folgeaufträge fast sofort verarbeitet werden.
