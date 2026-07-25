# GPS-Statusautomatik – Testprotokoll

> **Nicht eingecheckt** – Arbeitsdokument zum Verifizieren von Setup & Funktion.
> Stand: Branch `feat/board-improvements` @ `9f78182`, deployed auf `main`.

Alles ist **opt-in** (Standard: aus). Ohne Konfiguration + Aktivierung passiert nichts.
Einstellungen: **Einstellungen → GPS** (nur Editor/Admin).

Tuning-Standardwerte: Ankunftsradius **200 m**, Magazinradius **100 m**,
bestätigende Messungen **3**, Aktualität **60 s**, Geschwindigkeitsgrenze **5 km/h**.
→ Eine Regel löst frühestens nach **~3 frischen Messungen über ≥60 s** aus (Positions-Poll ~alle 10 s).

---

## ⚠️ Wichtige Vorbedingungen (zuerst prüfen!)

1. **Fahrzeugnamen = Traccar-Gerätenamen.** Die Automatik (und die bestehenden
   Ankunfts-Benachrichtigungen) ordnen ein Fahrzeug seinem Tracker über
   `Fahrzeugname == Traccar-Gerätename` zu (Gross-/Kleinschreibung egal).
   In Traccar heissen die Geräte: **TLF, PIO, MOWA, MAWA, TRAWA**.
   → In kp-rueck müssen die Fahrzeuge **exakt so** heissen (Einstellungen → Fahrzeuge).
   **Test:** Stimmt für jedes der 5 Fahrzeuge ein gleichnamiges Traccar-Gerät? ☐

2. **Tracker sendet frische Positionen.** Die Teltonika-Tracker senden nur bei
   **10–30 V** (Zündung/Bordnetz) – auf USB-Strom **nicht**. Ein abgestelltes,
   stromloses Fahrzeug meldet keine frischen Fixes → die Automatik ignoriert
   veraltete Fixes (Aktualität 60 s) und löst **nicht** aus. Für alle Tests muss
   das Testfahrzeug **eingeschaltet** sein und aktuell reporten.
   **Test:** Zeigt die Karte (kp-rueck oder gps.fwo.li) für das Testfahrzeug eine
   Position mit aktuellem Zeitstempel (< 1 Min)? ☐

3. **Bestehende Ankunfts-Alarme funktionieren?** Wenn die bisherigen
   Geofence-Ankunfts-Benachrichtigungen je funktioniert haben, ist das
   Geräte-Mapping korrekt. Falls nie: zuerst Vorbedingung 1+2 klären. ☐

4. **Traccar-seitige Geofences sind getrennt.** Der Magazin-Geofence + die
   Telegram-Benachrichtigungen in Traccar sind **unabhängig** vom Magazin-Geofence
   in kp-rueck (`gps.station_*`). Beide bei Bedarf separat pflegen.

---

## A. Setup verifizieren

- [ ] **GPS-Sektion da:** Einstellungen → linke Navigation → **GPS** sichtbar (als Editor).
- [ ] Karte zeigt: Hauptschalter **GPS-Statusautomatik**, darunter (wenn an) Ankunft,
      Magazin-Rückkehr, Magazin-Koordinaten + Radius, Ankunftsradius, Feineinstellungen.
- [ ] **Magazin-Koordinaten** eintragen: Breite/Länge des Magazins
      (Google Maps → Rechtsklick aufs Magazin → erste Zeile `lat, lng`), Radius z. B. **100 m**.
- [ ] **Ankunftsradius** prüfen (Standard 200 m).
- [ ] Hauptschalter zunächst **aus** lassen → bestätigen, dass nichts passiert.

---

## B. Regel A – Ankunft (Standard: **mit Rückfrage**)

**Kontrollierter Test ohne Fahrt:** Testfahrzeug eingeschaltet (reportet), aber
stehend. Aktuelle Fahrzeugposition aus der Karte ablesen. Test-Einsatz **an genau
dieser Position** anlegen (Koordinaten = Fahrzeugposition), das Fahrzeug zuweisen,
Einsatz nach **Disponiert** schieben.

1. [ ] Einstellungen → GPS: Hauptschalter **an**, **Ankunft am Einsatzort** **an**,
       „Automatisch ohne Rückfrage" **aus** (Standard).
2. [ ] Test-Einsatz an der Fahrzeugposition, Fahrzeug zugewiesen, Status **Disponiert**.
3. [ ] **~1–2 Min warten** (3 frische Fixes über ≥60 s).
4. [ ] **Erwartung:** Dialog **„Fahrzeug am Einsatzort"** erscheint („… auf Einsatz setzen?").
       Status bleibt vorerst **Disponiert**.
5. [ ] **„Auf Einsatz setzen"** → Einsatz wechselt auf **Einsatz**.
       (Bei konfiguriertem Drucker wird wie bei manuellem Zug ein Anfahrtszettel gedruckt.)
6. [ ] **„Nicht jetzt"** (im Wiederholungstest) → Status bleibt Disponiert, **kein**
       erneutes Aufpoppen jede Minute (One-Shot pro Disponiert-Phase).

> Schneller iterieren: „Bestätigende Messungen" temporär auf **2** und „Aktualität"
> auf **30** stellen – danach wieder auf 3 / 60 zurücksetzen.

---

## C. Regel A – Silent (gefährlicher Opt-in)

1. [ ] GPS: unter Ankunft **„Automatisch ohne Rückfrage" an** → gelbe Warnung erscheint.
2. [ ] Test wie B wiederholen (Einsatz erneut auf Disponiert).
3. [ ] **Erwartung:** **kein** Dialog – Status springt **automatisch** auf **Einsatz**.
4. [ ] **Protokoll prüfen:** Einstellungen → Audit-Protokoll bzw. Excel-Export
       (Einstellungen → GPS… nein: Import/Export → Einsatz-Protokoll) → die
       Statusänderung ist als Akteur **„GPS-Automatik"** vermerkt.
5. [ ] **Reversibel:** Karte zurück auf Disponiert ziehen → Automatik advanced **nicht**
       sofort erneut (One-Shot bleibt, bis das Ziel die Disponiert-Phase verlässt).

---

## D. Regel B – Magazin-Rückkehr (immer **mit Rückfrage**)

**Kontrollierter Test:** Magazin-Koordinaten in den GPS-Einstellungen = aktuelle
Position eines eingeschalteten, im/beim Magazin stehenden Fahrzeugs (oder echtes
Magazin, Fahrzeug dort eingeschaltet). Fahrzeug einem (beliebigen) Einsatz zuweisen.

1. [ ] GPS: Hauptschalter **an**. **Magazin: Freigabe vorschlagen** ist **standardmässig an**
       (nur Rückfrage, daher sicherer Standard) – prüfen, dass der Schalter an ist.
2. [ ] Magazin-Koordinaten gesetzt, Fahrzeug einem Einsatz zugewiesen, Fahrzeug
       reportet frisch aus dem Magazinradius.
3. [ ] **~1–2 Min warten.**
4. [ ] **Erwartung:** Dialog **„Fahrzeug zurück im Magazin – freigeben?"**.
5. [ ] **„… freigeben"** → die Fahrzeugzuweisung wird aufgehoben (Fahrzeug verschwindet
       vom Einsatz). Der Einsatz wird **nicht** geschlossen.
6. [ ] **„Nicht freigeben"** (Wiederholung) → nichts ändert sich, kein Dauer-Popup.

---

## E. Sperren / Negativtests

- [ ] **Übung:** In einem Übungs-Ereignis (training_flag) mit identischem Setup →
      **keine** Prompts, **keine** Statusänderung (Automatik in Übungen inaktiv).
- [ ] **Demo-Modus:** keine Automatik.
- [ ] **Viewer:** Als `viewer` eingeloggt → **keine** GPS-Dialoge (nur Editoren werden
      gefragt; Viewer könnten ohnehin nichts auslösen).
- [ ] **Lückenhaftes GPS:** Testfahrzeug ausschalten (kein frisches Reporting) während
      es „am Einsatzort" wäre → Automatik löst **nicht** aus (veraltete Fixes werden
      ignoriert, Zähler wird zurückgesetzt).

---

## F. Aufräumen

- [ ] Test-Einsätze löschen / archivieren.
- [ ] Feineinstellungen auf Standard zurück (3 / 60 / 5), falls geändert.
- [ ] Entscheiden, welche Regeln produktiv **an** bleiben. Empfehlung: erst nur
      **Magazin-Rückkehr** + **Ankunft mit Rückfrage** live; „Automatisch ohne
      Rückfrage" erst nach mehreren zuverlässigen Schichten.

---

### Schnellreferenz: relevante Settings-Keys (DB `settings`)

| Key | Bedeutung | Standard |
|-----|-----------|----------|
| `gps.automation_enabled` | Hauptschalter | `false` |
| `gps.rule_arrival_enabled` | Ankunft (Regel A) an | `false` |
| `gps.rule_arrival_silent` | Ankunft ohne Rückfrage (gefährlich) | `false` |
| `gps.rule_return_enabled` | Magazin-Rückkehr (Regel B) an | `true` (Standard an – nur Rückfrage) |
| `gps.station_lat` / `gps.station_lng` | Magazin-Koordinaten | leer |
| `gps.station_radius_meters` | Magazinradius | `100` |
| `geofence_radius_meters` | Ankunftsradius | `200` |
| `gps.debounce_count` / `gps.freshness_seconds` / `gps.speed_gate_kmh` | Feintuning | `3` / `60` / `5` |
