# Ausfall-SOP — Papier-Fallback für KP Rück

**Eine Seite. Ausgedruckt im KP aufbewahren — zusammen mit dem Magnetboard/Formularvorrat.**

## Grundsatz

KP Rück ist das **primäre** Führungsmittel. Fällt es aus, gilt: **das zuletzt
gedruckte oder heruntergeladene Lageblatt wird zum Board.** Ab diesem Moment ist
Papier führend, bis der Wiederanlauf ausgerufen wird.

## Vorbereitung (einmalig bzw. bei Ereignisstart)

- [ ] Thermodrucker aktiv **und** in den Einstellungen *Papier-Fallback: Board
      automatisch drucken* eingeschaltet (Standard: alle 15 Min, nur bei Änderungen)
- [ ] Alternativ/zusätzlich am Führungs-Gerät: *Lageblatt Auto-Download* im
      Export-Menü aktivieren (lädt alle 15 Min ein aktuelles A4-Lageblatt)
- [ ] Physischer Fallback bereit: Magnetboard **oder** leere Führungsformulare
      (Elementarschaden FWI BL/BS) + Stifte + Klemmbrett im KP
- [ ] Das Lageblatt aus KP Rück hat dieselben Spalten wie das kantonale
      Führungsformular — es kann direkt von Hand weitergeführt werden

## Auslösung (Trigger)

Das Board gilt als ausgefallen, wenn **eine** der Bedingungen zutrifft:

- Board länger als **2 Minuten** nicht erreichbar oder eingefroren — auch von
  einem zweiten Gerät aus (damit ein defektes Tablet nicht zum Fehlalarm führt)
- Stromausfall der KP-Infrastruktur ohne Notstrom-Weiterbetrieb der Geräte

**Wer:** Jede Bedienperson darf den Fallback ausrufen; die Einsatzleitung bestätigt.

## Übergang auf Papier (Ziel: unter 2 Minuten)

1. Ansage im KP: **«Papier führt.»** (laut und eindeutig)
2. Letztes Lageblatt aufs Klemmbrett / Zeilen aufs Magnetboard übertragen
3. Neue Meldungen auf den **leeren Zeilen** des Lageblatts erfassen:
   Zeit, Wo, Was — danach Reko und Auftrag wie gewohnt nachführen
4. Jede Änderung mit **Uhrzeit und Kürzel** — das Blatt ist nachher die
   einzige Quelle für die Nachführung
5. Funkbetrieb läuft unverändert weiter

## Wiederanlauf

1. Board auf **zwei** Geräten prüfen (lädt, Anmeldung funktioniert, Daten aktuell)
2. **Eine** designierte Person überträgt die Papieränderungen chronologisch
   zurück ins System — alle anderen fassen das Board noch nicht an
3. Ansage: **«Board führt wieder.»**
4. Papierblätter aufbewahren — sie sind Teil der Einsatzdokumentation
   (Beilage zum Einsatztagebuch im Einsatzbericht)

## Was fällt wann aus? (Merkhilfe)

| Ausfall | Board | Thermodrucker (Pi, lokal) | Massnahme |
|---|---|---|---|
| Internet im Magazin | ✗ (Backend ist in der Cloud) | ✗ (erreicht Backend nicht) | Papier führt — darum **vorher** drucken/downloaden |
| Railway/Backend-Störung | ✗ | ✗ | Papier führt |
| Einzelnes Tablet defekt | ✓ (anderes Gerät) | ✓ | Gerät wechseln, kein Fallback |
| Stromausfall (mit Notstrom) | ✓ solange Internet steht | ✓ | Beobachten, Lageblatt drucken |

Der Wert des automatischen Druckens/Downloads liegt darin, dass **im Moment des
Ausfalls** ein höchstens 15 Minuten alter Stand auf Papier bzw. lokal auf dem
Gerät liegt.

---

## Failover-Übung (halbjährlich, ~15 Minuten)

1. Übungsereignis mit 5–10 Einsätzen laufen lassen (Übungssteuerung → Automatik)
2. Ohne Vorwarnung: WLAN am Führungs-Tablet trennen («Ausfall»)
3. Stoppuhr: Team führt gemäss dieser SOP auf Papier weiter — **Ziel < 2 Minuten**
   bis zur ersten auf Papier erfassten Änderung
4. 5 Minuten auf Papier arbeiten (mind. 1 neue Meldung, 1 Statuswechsel, 1 Auftrag)
5. WLAN wieder verbinden, Wiederanlauf gemäss SOP durchspielen
6. Debrief: Was fehlte auf dem Lageblatt? Zeiten notiert? Ansagen klar?
   → Erkenntnisse in diese SOP einarbeiten
