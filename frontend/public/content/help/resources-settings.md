# Ressourcen & Einstellungen

Verwalten Sie Personal, Fahrzeuge, Material und System-Konfiguration.

---

## Ressourcen-Seite

**Zugriff:** Navigation → "Ressourcen" oder `/resources`

![Resources Page](/help/images/resources-page.png)

### Zweck

Zentrale Verwaltung aller verfügbaren Ressourcen außerhalb des laufenden Betriebs.

**Wann nutzen?**
- Neue Personen/Fahrzeuge/Material hinzufügen
- Bestehende Ressourcen bearbeiten
- Status ändern (verfügbar/nicht verfügbar)
- Ressourcen löschen

### Drei Tabs

#### 1. Personal

**Funktionen:**
- Neue Person hinzufügen (Name, Rolle, Status)
- Rolle ändern (Gruppenführer, Maschinist, Atemschutz, etc.)
- Status setzen (Verfügbar/Nicht verfügbar)
- Person löschen

**Nur Editor:** Kann Änderungen vornehmen
**Viewer:** Kann nur ansehen

#### 2. Fahrzeuge

**Funktionen:**
- Neues Fahrzeug hinzufügen (Name, Typ, Kennzeichen)
- Fahrzeugtyp ändern (TLF, DLK, MTW, etc.)
- Status setzen (Verfügbar/Defekt/Wartung)
- Fahrzeug löschen

**Wichtig:** Fahrzeuge 1-5 können per Tastatur auf Einsätze zugewiesen werden (Taste `1-5`)

#### 3. Material

**Funktionen:**
- Neues Material hinzufügen (Name, Kategorie, Standort)
- Kategorie zuweisen (Geräte, Ausrüstung, Verbrauchsmaterial)
- Standort festlegen
- Material löschen

---

## Einstellungen-Seite

**Zugriff:** Navigation → "Einstellungen" oder `/settings`

![Settings Page](/help/images/settings-page.png)

### Drei Tabs

#### 1. Allgemein

**Heimatort:**
- Vereinfacht Adressanzeige (z.B. "Oberwil" statt ganzer Adresse)
- Nur für Einsätze im Heimatort

**Polling-Intervall:**
- Wie oft Daten aktualisiert werden (Standard: 5000ms = 5s)
- Kürzeres Intervall = mehr Last, schnellere Updates

**Auto-Archivierung:**
- Zeit bis abgeschlossene Einsätze automatisch archiviert werden
- Standard: 24 Stunden

**Benachrichtigungen:**
- System-Benachrichtigungen aktivieren/deaktivieren

#### 2. Benachrichtigungen

**Reko-Benachrichtigungen:**
- Bei neuem Reko-Bericht benachrichtigen
- Browser-Benachrichtigungen (erlauben erforderlich)
- Sound abspielen (optional)

**Einsatz-Benachrichtigungen:**
- Bei neuem Einsatz benachrichtigen
- Bei Statusänderung benachrichtigen

**Konfiguration:**
- Benachrichtigungen pro Einsatztyp
- Lautstärke anpassen
- Test-Benachrichtigung senden

#### 3. Synchronisation

**Nur relevant für Railway (Online):**

**Sync-Status:**
- Zeigt aktuellen Synchronisations-Status
- Letzte Sync-Zeit
- Fehler falls vorhanden

**Manuelle Synchronisation:**
- "Jetzt synchronisieren" Button
- Erzwingt sofortigen Sync
- Nützlich bei Problemen

**Sync-Historie:**
- Zeigt letzten 50 Sync-Vorgänge
- Mit Zeitstempel und Status
- Hilfreich für Debugging

**⚠️ Railway-Hinweis:**
Auf Railway ist Sync deaktiviert (Info-Meldung wird angezeigt). Railway ist bereits die zentrale Datenbank.

**Localhost-Tipp:**
Nutzen Sie Sync-Tab, um Daten zwischen Offline/Online zu übertragen:
1. Offline: Events exportieren (JSON)
2. Online: Import-Funktion nutzen (in Admin-Bereich)

---

## Unterschied: Ressourcen vs. Kanban-Seitenleisten

**Ressourcen-Seite:**
- Ressourcen **verwalten** (hinzufügen, bearbeiten, löschen)
- Alle Ressourcen sichtbar (auch nicht verfügbare)
- Für Admins/Editoren

**Kanban-Seitenleisten:**
- Ressourcen **zuweisen** (per Drag & Drop)
- Nur verfügbare Ressourcen sichtbar
- Für laufenden Betrieb

---

## Berechtigungen

**Editor:**
- ✅ Kann alle Einstellungen ändern
- ✅ Kann Ressourcen verwalten
- ✅ Vollzugriff

**Viewer:**
- ⬜ Kann nur ansehen
- ⬜ Keine Änderungen möglich
- Info-Banner wird angezeigt

---

## Best Practices

### Ressourcen

**Vor dem Einsatz:**
- Ressourcen vorbereiten und hinzufügen
- Status prüfen (alle verfügbar?)
- Fahrzeuge 1-5 für Tastatur-Shortcuts nutzen

**Nach dem Einsatz:**
- Defekte Ressourcen markieren
- Nicht mehr benötigte Ressourcen löschen
- Status zurücksetzen

### Einstellungen

**Polling-Intervall:**
- Erhöhen bei langsamer Verbindung (z.B. 10000ms)
- Verringern für Echtzeit-Feel (z.B. 3000ms)
- Standard 5000ms ist guter Kompromiss

**Benachrichtigungen:**
- Bei Übungen deaktivieren (weniger Ablenkung)
- Bei echten Einsätzen aktivieren (sofortige Info)

---

## Häufige Fragen

**Q: Kann ich Ressourcen im Einsatz löschen?**
A: Nein, erst vom Einsatz entfernen, dann in Ressourcen-Seite löschen.

**Q: Warum sehe ich manche Einstellungen nicht?**
A: Nur Editoren können Einstellungen ändern. Viewer sehen nur Lesezugriff.

**Q: Sync-Tab zeigt "Deaktiviert auf Railway"?**
A: Normal. Railway ist bereits zentrale Datenbank, kein Sync nötig.

**Q: Polling-Intervall ändert sich nicht?**
A: Änderung wird beim nächsten Polling wirksam (bis zu 5s warten).
