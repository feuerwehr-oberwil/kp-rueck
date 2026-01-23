# KP Rück Dokumentation

Digitaler Ersatz für die Magnettafel im Kommandoposten. Verwalten Sie Einsätze, Personal und Material zentral in Echtzeit.

## Ansichten

### Kanban-Board (`G K`)
Hauptansicht beim Laden der App. Zeigt alle Einsätze in Status-Spalten (Eingegangen → Archiv). Links die Personal-Seitenleiste, rechts Material und Fahrzeuge.

### Kartenansicht (`G M`)
Geografische Übersicht aller Einsatzorte. Farbige Marker zeigen Priorität (Grau/Gelb/Rot). Klick auf Marker öffnet Einsatzdetails.

### Seitenpanel (Kanban)
Auf breiten Bildschirmen (>1280px) erscheint rechts ein Seitenpanel. Wechseln Sie zwischen **Details** (Einsatzbearbeitung) und **Karte** (Mini-Übersicht). Einfach-Klick auf Einsatzkarte zeigt Details im Panel, Doppelklick öffnet Modal.

### Ereignisse (`G E`)
Events verwalten, wechseln, archivieren, exportieren.

**Echt vs. Training:** Events können als "Training" markiert werden. Badge "Übung" erscheint, Daten werden separat geführt. Echte Events kommen von Divera.

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

| Stufe | Farbe | Shortcut |
|-------|-------|----------|
| Niedrig | Grau | `Shift+1` |
| Mittel | Gelb | `Shift+2` |
| Hoch | Rot | `Shift+3` |

### Alters-Indikatoren

Zeigen, wie lange ein Einsatz bereits offen ist:

- **Grün** = Neu (< 15 Min)
- **Gelb** = Aktiv (15-60 Min)
- **Orange** = Länger offen (1-2 Std)
- **Rot** = Lange offen (> 2 Std) - Aufmerksamkeit nötig

### Meldung anzeigen

Im Footer gibt es einen "Meldung" Schalter. Aktiviert zeigt er den vollständigen Meldungstext direkt auf jeder Einsatzkarte an - praktisch für schnellen Überblick ohne jeden Einsatz zu öffnen.

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
4. Reko-Formular ausfüllen, Fotos hochladen
5. Basierend auf Bericht: Disponieren oder Abschliessen

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
| `/` | Suche fokussieren |
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
| `[` | Personal-Seitenleiste ein/aus |
| `]` | Material-Seitenleiste ein/aus |
| `B` | Benachrichtigungen |
| `P` | Personal suchen |
| `M` | Material suchen |

---

## Online vs. Offline

### Online (Railway)
- QR-Code Check-In und Reko funktionieren
- Automatische Synchronisation aller Geräte
- Mobile Zugriffe von überall

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
