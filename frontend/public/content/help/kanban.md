# Kanban-Board

Die Hauptansicht für alle laufenden Einsätze.

![Kanban Board](/help/images/kanban-board.png)

Das aktuell ausgewählte Event erscheint oben links mit Tabs zur Navigation.

## Aufbau

Das Board besteht aus 6 Status-Spalten (Eingegangen → Reko → Disponiert → Einsatz → Beendet → Archiv), Einsatzkarten mit allen relevanten Informationen, und zwei Seitenleisten für Personal (links) und Material (rechts).

## Einsatzkarten

Farbcodierung nach Priorität: Grau = Niedrig, Blau = Mittel, Rot = Hoch

Jede Karte zeigt Standort, Einsatztyp, zugewiesene Ressourcen und Zeitstempel.

## Drag & Drop

Einsätze verschieben: Karte in neue Spalte ziehen

Ressourcen zuweisen: Person/Fahrzeug/Material auf Einsatzkarte ziehen

Nur verfügbare Ressourcen (🟢 grüner Punkt) können zugewiesen werden.

## Tastatur-Navigation

**Einsatz auswählen:**
- `↑` / `↓` = Durch Einsätze navigieren
- `E` oder `Enter` = Einsatz bearbeiten

**Schnellaktionen:**
- `>` oder `.` = Status vorwärts
- `<` oder `,` = Status rückwärts
- `1-5` = Fahrzeuge zuweisen
- `Shift+1/2/3` = Priorität ändern

Alle Shortcuts: Drücken Sie `?` oder siehe [Tastaturkürzel](/help/keyboard-shortcuts)

## Suche

Hauptsuche (`/`): Durchsucht Standort, Typ, Beschreibung

Seitenleisten:
- `P` = Personal durchsuchen
- `M` = Material durchsuchen

![Search](/help/images/search-functionality.png)

## Seitenleisten-Steuerung

`[` = Linke Leiste (Personal) ein-/ausblenden
`]` = Rechte Leiste (Material) ein-/ausblenden
