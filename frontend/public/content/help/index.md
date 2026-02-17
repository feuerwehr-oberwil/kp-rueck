# KP Rück Dokumentation

Digitaler Ersatz für die Magnettafel im Kommandoposten. Verwalten Sie Einsätze, Personal und Material zentral in Echtzeit.

## Ansichten

### Kanban-Board (`G K`)
Hauptansicht beim Laden der App. Zeigt alle Einsätze in Status-Spalten (Eingegangen → Archiv). Links die Personal-Seitenleiste, rechts Material und Fahrzeuge.

### Kartenansicht (`G M`)
Geografische Übersicht aller Einsatzorte. Farbige Marker zeigen Priorität (Grün/Gelb/Rot). Klick auf Marker öffnet Einsatzdetails.

**Kartenlegende:**
- **Priorität (Füllung):** Grün=Niedrig, Gelb=Mittel, Rot=Hoch
- **Status (Rahmen):** Gestrichelt=Offen/Neu, Durchgezogen=Aktiv, Gepunktet+Verblasst=Abgeschlossen
- **Fahrzeuge (GPS):** Blau=Online, Grau=Offline

### Seitenpanel (Kanban)
Auf breiten Bildschirmen (>1280px) erscheint rechts ein Seitenpanel. Wechseln Sie zwischen **Details** (Einsatzbearbeitung) und **Karte** (Mini-Übersicht).

**Klick-Verhalten:**
- **Einfach-Klick**: Zeigt Einsatz-Details im Seitenpanel
- **Doppelklick**: Öffnet den vollständigen Detail-Dialog (Modal)

### Ereignisse (`G E`)
Events verwalten, wechseln, archivieren, exportieren.

**Echt vs. Training:** Events können als "Training" markiert werden. Badge "Übung" erscheint, Daten werden separat geführt. Echte Events kommen von Divera.

**Audit-Export:** Einstellungen → Import/Export → Event auswählen → Excel-Export. Enthält alle Einsätze, Zuweisungen (inkl. Historie), Statusänderungen und Reko-Berichte. Für Abrechnung und Nachbesprechung.

**Drucken (PDF):** Footer → "Drucken" öffnet Druckvorschau mit Optionen:
- Einsätze nach Status filtern
- Karten-Übersicht (zeigt alle Einsatzorte auf einer Karte)
- Fahrzeugstatus einblenden

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
5. Bei Rückmeldung, dass vor Ort → in "Einsatz" verschieben

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
| Archiv | Abgeschlossen, Personal & Fahrzeuge automatisch freigegeben |

**Verschieben:** Karte in neue Spalte ziehen, oder `>` / `<` Tasten nutzen.

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

---

## Tastaturkürzel

Drücken Sie `?` oder `Cmd/Ctrl+K` für die Befehlspalette mit allen Befehlen.

### Navigation
| Shortcut | Aktion |
|----------|--------|
| `G K` | Kanban-Board |
| `G M` | Kartenansicht |
| `G E` | Ereignisse |

### Aktionen
| Shortcut | Aktion |
|----------|--------|
| `N` | Neuer Einsatz |
| `S` / `/` | Suche fokussieren |
| `R` | Aktualisieren |
| `F` | Fahrzeugstatus |

### Einsatz bearbeiten (vorher auswählen)
| Shortcut | Aktion |
|----------|--------|
| `E` / `Enter` | Details öffnen |
| `1-5` | Fahrzeug zuweisen/entfernen |
| `Shift+1-3` | Priorität ändern |
| `>` / `.` | Status vorwärts |
| `<` / `,` | Status zurück |
| `Delete` | Löschen |

### Navigation & UI
| Shortcut | Aktion |
|----------|--------|
| `↑` / `↓` | Einsatz auswählen |
| `Tab` | Durch Einsätze durchlaufen |
| `Q` / `[` | Personal-Seitenleiste ein/aus |
| `W` / `]` | Material-Seitenleiste ein/aus |
| `I` / `\` | Detail-Panel ein/aus |
| `D` | Panel: Details anzeigen |
| `K` | Panel: Karte anzeigen |
| `B` | Benachrichtigungen |
| `P` | Personal suchen |
| `M` | Material suchen |

---

## Online vs. Offline

### Online (Railway)
- QR-Code Check-In und Reko funktionieren
- Automatische Synchronisation aller Geräte
- Mobile Zugriffe von überall

### Viewer-Link (Nur-Lesen)

Für Personen ohne Login: Footer → "Viewer" generiert einen Link mit 24h Gültigkeit. Zeigt Kanban-Board und Karte ohne Bearbeitungsmöglichkeit. Aktualisiert automatisch alle 5 Sekunden.

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
2. Raspberry Pi einrichten (siehe `PRINT_AGENT.md` im Repository)
3. Einstellungen → Drucker → IP-Adresse und Port konfigurieren, Drucker aktivieren

### Druckaufträge

| Auftrag | Auslöser | Inhalt |
|---------|----------|--------|
| **Einsatzzettel** | Automatisch bei Status "Disponiert"/"Einsatz", oder Rechtsklick → "Einsatzzettel drucken" | Adresse, Typ, Priorität, Beschreibung, Fahrzeuge, Personal, Material |
| **Board-Snapshot** | "Thermo"-Button im Footer → Optionen wählen → "Drucken" | Ereignis-Übersicht, Einsätze mit Details, Fahrzeugstatus, Personal-Liste |

### Board-Snapshot Optionen

Beim Klick auf "Thermo" öffnet sich ein Auswahldialog:

- **Abgeschlossene Einsätze** — auch archivierte Einsätze einbeziehen (Standard: aus)
- **Fahrzeug-Status** — Verfügbarkeit aller Fahrzeuge anzeigen (Standard: ein)
- **Personal-Übersicht** — Liste aller anwesenden Personen mit Zuteilungsstatus (Standard: ein)

### Polling-Verhalten

Um unnötige Abfragen zu vermeiden, verwendet der Agent **adaptives Polling**:

- **Ruhezustand**: Abfrage alle **60 Sekunden**
- **Nach einem Druckauftrag**: Wechsel auf **5 Sekunden** für **15 Minuten**, danach zurück auf 60s

So werden im Normalbetrieb nur ca. 60 Anfragen pro Stunde gesendet, während bei aktiven Einsätzen Folgeaufträge fast sofort verarbeitet werden.
