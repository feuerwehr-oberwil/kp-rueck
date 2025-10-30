# Karten- und Combined-Ansicht

Geografische Übersicht aller Einsatzorte mit optionaler Kanban-Integration.

## Kartenansicht

**Zugriff:** `G` + `M` oder Navigation → "Karte"

![Map View](/help/images/map-view.png)

### Einsatzmarker

Farbige Kreismarker zeigen alle Einsatzorte auf der Karte.

**Farbe nach Priorität:**
- 🟢 Grün = Niedrig
- 🟡 Gelb = Mittel
- 🔴 Rot = Hoch

### Navigation

**Zoom:**
- Mausrad scrollen
- `+` / `-` Buttons
- Doppelklick

**Verschieben:**
- Klicken & Ziehen
- Pfeiltasten

**Marker klicken:**
- Zeigt Popup mit Details
- Button "Details anzeigen" → öffnet Einsatz

### Basiskarte

OpenStreetMap mit Schweizer Karten. Geladene Bereiche werden automatisch gecacht.

---

## Combined View

**Zugriff:** Navigation → "Combined"

![Combined View](/help/images/combined-view.png)

### Funktionsweise

Split-Screen mit beiden Ansichten gleichzeitig:
- **Links:** Kanban-Board (alle 6 Spalten)
- **Rechts:** Kartenansicht

### Vorteile

1. **Synchronisiert:** Änderungen im Kanban → sofort auf Karte sichtbar
2. **Hover-Highlight:** Karte über Einsatz → Kanban-Karte pulsiert
3. **Geografischer Kontext:** Einsatzverteilung auf Blick

### Anpassbare Aufteilung

- **Teiler:** Vertikale Linie zwischen den Ansichten ziehen
- **Position speichern:** Ihre Einstellung bleibt erhalten
- Standard: 60% Kanban / 40% Karte

### Workflow-Empfehlung

**Einsatzzentrale (Desktop):**
1. Combined View öffnen
2. Links: Einsätze verwalten (Drag & Drop)
3. Rechts: Geografische Übersicht behalten

**Mobile/Tablet:**
- Einzelne Ansichten nutzen (Kanban oder Karte)
- Combined View für Tablets im Querformat

---

## Häufige Fragen

**Q: Warum wird ein Einsatz nicht auf der Karte angezeigt?**
A: Adresse fehlt oder Geocoding fehlgeschlagen. Prüfen Sie, ob vollständige Adresse erfasst wurde.

**Q: Kann ich die Karte drucken?**
A: Ja, Browser-Druckfunktion nutzen. Vollbild-Modus (`F11`) für besseres Ergebnis.

**Q: Funktioniert die Karte offline (Localhost)?**
A: Teilweise. Bereits geladene Bereiche sind gecacht, neue Bereiche benötigen Internet.

**Q: Kann ich zwischen Ansichten mit Tastatur wechseln?**
A: Ja! `G` + `K` = Kanban, `G` + `M` = Map, dann manuell zu Combined navigieren.
