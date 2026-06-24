# KP Rück Dokumentation

Digitaler Ersatz für die Magnettafel im Kommandoposten. Verwalten Sie Einsätze, Personal und Material zentral in Echtzeit.

## Ansichten

### Kanban-Board (`G K`)
Hauptansicht beim Laden der App. Zeigt alle Einsätze in Status-Spalten (Eingegangen → Archiv). Links die Personal-Seitenleiste, rechts Material und Fahrzeuge.

### Kartenansicht (`G M`)
Geografische Übersicht aller Einsatzorte. Farbige Marker zeigen Priorität (Grün/Gelb/Rot).

**Klick-Verhalten:**
- **Marker / Listen-Karte (Einfach-Klick)**: Wählt den Einsatz aus und zoomt zum Marker
- **Listen-Karte (Doppelklick)**: Öffnet den vollständigen Detail-Dialog (Modal)

**Kartenlegende:**
- **Priorität (Füllung):** Grün=Niedrig, Gelb=Mittel, Rot=Hoch
- **Status (Rahmen):** Gestrichelt=Offen, Durchgezogen=Aktiv, Gepunktet+Verblasst=Beendet
- **Fahrzeuge (GPS):** Blau=Online, Grau=Offline

**Tastatur:** `L` Labels, `I` Linien, `1-5` Fahrzeug anzeigen — siehe [Tastaturkürzel](#tastaturkürzel).

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

**Drucken (PDF):** Footer → "Drucken" öffnet Druckvorschau mit Optionen:
- Einsätze nach Status filtern
- Karten-Übersicht (zeigt alle Einsatzorte auf einer Karte)
- Fahrzeugstatus einblenden

---

## Display-Ansichten (Multi-Monitor)

Für Kommandoposten mit mehreren Bildschirmen gibt es spezielle Anzeige-Seiten unter `/display`. Diese sind rein lesend — keine Bearbeitungsfunktionen.

**Zugriff:** Benutzermenü → Abschnitt "Anzeige" (öffnet in neuem Tab), oder direkt `/display` aufrufen.

### Lagekarte (`/display/map`)
Vollbild-Karte ohne Seitenleiste. Zeigt alle Einsatzorte, GPS-Fahrzeugpositionen und animierte Zuweisungslinien (Fahrzeug → Einsatz). Ideal für einen zentralen Lagebildschirm.

### Board (`/display/board`)
Kanban-Board ohne Bearbeitungsmöglichkeiten. Alle 6 Status-Spalten werden gleichmässig auf die Fensterbreite skaliert.

### Status (`/display/status`)
Vier-Spalten-Übersicht: Fahrzeuge, Einsätze (gruppiert nach Status), Personal (gruppiert nach Rolle) und Material (gruppiert nach Standort). Zeigt bei zugewiesenen Ressourcen den Einsatzort an. Skaliert auf grösseren Bildschirmen automatisch hoch.

### Cross-Window-Sync
Alle Display-Ansichten synchronisieren sich mit dem Editor-Fenster: Wird auf dem Hauptbildschirm ein Einsatz ausgewählt, springt die Display-Karte zum entsprechenden Marker und das Display-Board hebt die Karte hervor — und umgekehrt.

### Kartenstil
Unter Einstellungen → Kartenstil kann zwischen verschiedenen Kartenstilen gewechselt werden: OpenStreetMap (Standard), Topografisch (Esri), Voyager/Hell (CARTO) und Dunkel (CARTO).

---

## Suche

Die Suchleiste (`/`) durchsucht alle Einsätze nach Adresse, Typ und Meldungstext. Ideal um bei vielen Einsätzen schnell die richtige Karte zu finden.

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

Alarme, die über den [Alarm-Link](#alarm-link-telefon--walk-in) erfasst wurden, zeigen oben rechts ein blaues **Telefon-Symbol** (in einer Reihe mit den übrigen Status-Symbolen). Es markiert Meldungen aus ungeprüfter Quelle, die von der Einsatzleitung verifiziert werden sollten.

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
- **Verknüpfung:** Nur mit Divera **verknüpfte** Personen können alarmiert werden — nicht verknüpfte sind ausgegraut. Verknüpft wird über den Personen-Sync (Einstellungen → Divera).
- **Aktivieren:** Einstellungen → Benachrichtigungen → "Divera-Ausalarmierung" einschalten (benötigt Divera-Zugangsschlüssel). Dort gibt es auch einen **Testalarm** an eine einzelne Person.
- Wird im **Trainings- und Demo-Modus nicht** ausgelöst; der Pager wird bewusst nicht angesteuert (Push/keine Doppel-Alarmierung).

### Personal Check-In

QR-Code scannen → Person als anwesend markieren.

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

### Sicherheitsabfragen beim Zuweisen

Um Flüchtigkeitsfehler in hektischen Momenten zu vermeiden, fragt das System in drei Fällen nach:

| Situation | Abfrage |
|-----------|---------|
| **Fahrzeug ohne Fahrer zuweisen** | Direkt beim Zuweisen erscheint die Fahrer-Auswahl. „Schliessen" lässt das Fahrzeug ohne Fahrer. |
| **Fahrzeug bereits im Einsatz** (Doppelbuchung) | Ein Fahrzeug ist nur einmal physisch vorhanden — beim erneuten Zuweisen fragt das System: **Hierher verschieben** (von den anderen Einsätzen entfernen) oder **Mehrfach zuweisen** (Doppelbuchung bewusst behalten). |
| **Disponieren ohne Ressourcen** | Wird ein Einsatz nach „Disponiert" verschoben, ohne dass **Personal, Fahrzeuge oder Mittel** zugewiesen sind (Fahrzeuge entfallen bei „zu Fuss"), erscheint „Ressourcen fehlen" mit der Wahl **Zuweisen** oder **Trotzdem disponieren**. |

---

## Tastaturkürzel

Drücken Sie `Cmd/Ctrl+K` für die Befehlspalette — sie listet alle Befehle samt
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

### Kanban-Board — Aktionen
| Shortcut | Aktion |
|----------|--------|
| `N` | Neuer Einsatz |
| `S` / `/` | Suche fokussieren |
| `R` / `F5` | Aktualisieren |
| `F` | Fahrzeugstatus |

### Kanban-Board — Einsatz (Maus über der Karte)
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

### Kanban-Board — Ansicht
| Shortcut | Aktion |
|----------|--------|
| `Q` / `[` | Personal-Seitenleiste ein/aus |
| `W` / `]` | Material-Seitenleiste ein/aus |
| `I` / `\` | Seitenpanel ein/aus |
| `D` | Seitenpanel: Details anzeigen |
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
| **Telefon-Alarm** | Simuliert eine Bürgermeldung über den Alarm-Link — der Einsatz erhält das **Telefon-Abzeichen**, einen erfundenen Melder (Name + Nummer) und eine kurze Kontext-Notiz. Bewusst nur **unkritische** Lagen (Wasser, Baum, Lift o.ä.) — für einen echten Brand ruft man die offizielle Alarmzentrale, nicht den KP |
| **Burst (5×)** | Fünf zufällige Einsätze auf einmal |
| **Gezielter Einsatz** | Bestimmtes Szenario an einer gewählten Adresse oder einem Karten-Pin |

Jede Generierung bestätigt mit einer kurzen Meldung (Toast), welcher Einsatz erzeugt wurde — so ist sofort sichtbar, dass etwas passiert ist, und man klickt nicht versehentlich mehrfach (z.B. auf „Burst") und erzeugt zu viele Einsätze.

### Demo-Sandbox

Im öffentlichen Demo-Modus erhält jeder Editor-Login (`demo-editor`) eine **persönliche Übungslage** (eigene „Demo-Lage"), damit sich gleichzeitige Demo-Besucher nicht dasselbe Board teilen. Das Demo-Banner kennzeichnet eine solche Sandbox und zeigt die verbleibende Zeit bis zum Reset.

---

## Online vs. Offline

### Online (Railway)
- QR-Code Check-In und Reko funktionieren
- Automatische Synchronisation aller Geräte
- Mobile Zugriffe von überall

### Viewer-Link (Nur-Lesen)

Für Personen ohne Login: Footer → "Viewer" generiert einen Link mit 24h Gültigkeit. Zeigt Kanban-Board und Karte ohne Bearbeitungsmöglichkeit. Aktualisiert automatisch alle 5 Sekunden.

### Alarm-Link (Telefon / Walk-in)

Für Personen, die einen Alarm **erfassen** sollen, ohne Login und ohne Kenntnis des restlichen Systems — z.B. jemand am Telefon oder am Schalter (Walk-in).

**Erstellen:** Toolbar → "Alarm" (Sirenen-Symbol) generiert einen Link bzw. QR-Code, der pro Ereignis **30 Tage** gültig ist. Einmal generieren, beim Telefon-Arbeitsplatz aufhängen oder als Lesezeichen speichern.

**Benutzen:** Wer den Link öffnet, sieht ein schlankes, mobil-optimiertes Formular und kann damit beliebig viele Alarme erfassen — kein Login nötig. Reihenfolge der Felder: zuerst der **Standort** (mit Adresssuche), dann die **Meldung** (was gemeldet wurde — die Adresse steht ja schon oben, also nicht doppelt eingeben), die **Priorität** als drei Schnellauswahl-Tasten (Niedrig / Mittel / Hoch), Einsatzart, weitere Hinweise und Melder/Anrufer.

**Auf dem Board:** So erfasste Alarme landen in der Spalte "Eingegangen" und tragen ein blaues **„Telefon"-Abzeichen** — damit die Einsatzleitung erkennt, dass die Meldung von einer ungeprüften Quelle stammt, und sie prüfen kann. Adresse und Standort werden direkt mitgeschickt.

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

Druckt Einsatzzettel und Board-Snapshots auf einem 58mm ESC/POS Thermodrucker (z.B. Epson TM-T20).

### Aufbau

Ein **Print-Agent** läuft auf einem Raspberry Pi im Kommandoposten-Netzwerk. Er fragt das Backend regelmässig nach neuen Druckaufträgen ab und sendet diese über das lokale Netzwerk an den Drucker. Keine Portfreigaben nötig — nur ausgehende Verbindungen.

### Einrichtung
1. Drucker per Ethernet ans lokale Netzwerk anschliessen
2. Raspberry Pi einrichten (siehe `docs/PRINT_AGENT.md` im Repository)
3. Einstellungen → Drucker → IP-Adresse und Port konfigurieren, Drucker aktivieren

> **Hinweis (Betrieb):** Die Print-Agent-Endpunkte lassen sich mit einem geteilten Token absichern (`PRINT_AGENT_TOKEN`). Wird er auf dem Server gesetzt, muss derselbe Wert auch in der systemd-Unit des Pi hinterlegt werden — sonst erhält der Agent 401-Fehler. Ohne Token sind die Endpunkte offen (nur für reine LAN-Installationen gedacht); in der Produktion wird dann eine Warnung geloggt.

### Druckaufträge

| Auftrag | Auslöser | Inhalt |
|---------|----------|--------|
| **Einsatzzettel** | Automatisch bei Status "Disponiert"/"Einsatz", oder Rechtsklick → "Einsatzzettel drucken" | Adresse, Typ, Priorität, Beschreibung, Fahrzeuge, Personal, Material |
| **Board-Snapshot** | "Thermo"-Button im Footer → Optionen wählen → "Drucken" | Ereignis-Übersicht, Einsätze mit Details, Fahrzeugstatus, Personal-Liste |
| **QR-Code-Zettel** | In den Slide-ups Check-In / Reko / Viewer / Alarm → Drucker-Symbol | Titel, Kurzbeschreibung und scannbarer QR-Code des Links — zum Verteilen auf Papier |

### QR-Code-Zettel

Jedes Link-Slide-up (Personal Check-In, Reko Dashboard, Viewer-Link, Alarm-Link) hat neben "Kopieren" und "Öffnen" ein Drucker-Symbol (nur sichtbar, wenn der Drucker aktiviert ist). Damit wird ein kompakter Zettel mit dem QR-Code und einer kurzen Beschreibung gedruckt — praktisch, um jemandem den passenden Link in die Hand zu drücken, ohne ein Gerät teilen zu müssen.

### Board-Snapshot Optionen

Beim Klick auf "Thermo" öffnet sich ein Auswahldialog:

- **Beendete Einsätze** — auch archivierte Einsätze einbeziehen (Standard: aus)
- **Fahrzeug-Status** — Verfügbarkeit aller Fahrzeuge anzeigen (Standard: ein)
- **Personal-Übersicht** — Liste aller anwesenden Personen mit Zuteilungsstatus (Standard: ein)

### Polling-Verhalten

Um unnötige Abfragen zu vermeiden, verwendet der Agent **adaptives Polling**:

- **Ruhezustand**: Abfrage alle **60 Sekunden**
- **Nach einem Druckauftrag**: Wechsel auf **5 Sekunden** für **15 Minuten**, danach zurück auf 60s

So werden im Normalbetrieb nur ca. 60 Anfragen pro Stunde gesendet, während bei aktiven Einsätzen Folgeaufträge fast sofort verarbeitet werden.
