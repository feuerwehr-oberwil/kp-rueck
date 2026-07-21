# Provider-neutrale Alarmierung — Testprotokoll A–Z

> **Nicht eingecheckt** — Arbeitsdokument zum Verifizieren der kompletten
> provider-neutralen Umstellung (Stufe 1 + 2): generischer Webhook, neutrales
> Datenmodell, Provider-Protokoll für die Ausalarmierung, Capability-Registry,
> neutrale UI. Doku: `docs/ALARM-INTEGRATIONS.md`, `docs/PRINT_AGENT.md`.

**Wichtig:** Alle Schritte ausser dem klar markierten, optionalen Schritt **H4**
sind rein lokal/eingehend — es wird **kein echter DIVERA-Alarm ausgelöst**.

**Automatisch bereits verifiziert** (muss nicht wiederholt werden):
Backend-Suite **1683 Tests** grün (davon 33 neu: Webhook, Dedupe, Provenance,
Identitäten-Auflösung, Capability-Endpoint), Migrations-Drift-Test grün
(hat während der Entwicklung einen echten Migrations-Fehler gefangen —
inzwischen behoben), Frontend: tsc + eslint + 154 Vitest grün, End-to-End
gegen den Dev-Stack (Webhook → Pool → Dedupe → 403; `/api/integrations`).

---

## ⚠️ Vorbedingungen

1. **Umgebung:** Lokal `BASE=http://localhost:8000` (Migrationen sind auf dem
   Dev-Stack bereits eingespielt: `c3e8f1a6b2d9`, `d4f9a2c7e1b3`,
   `e5b2c9d4a8f1`). Prod: erst nach Push auf `main` (Railway migriert per
   `start.sh` automatisch). ☐
2. **Nur Prod:** Kein echtes aktives Ereignis darf Auto-Anhängen aktiv haben,
   bevor Testalarme gesendet werden. ☐
3. **Secret:**
   ```bash
   SECRET=$(docker exec kprueck-db-dev psql -U kprueck -d kprueck -tAc \
     "SELECT value FROM settings WHERE key='alarm_webhook_secret'")
   ```
   ☐

## A. Generischer Webhook — Grundfunktion

- [ ] **A1:** Alarm senden →
  ```bash
  curl -s -X POST "$BASE/api/alarms" -H "X-Webhook-Secret: $SECRET" \
    -H "Content-Type: application/json" -d '{
      "source": "testsystem", "source_id": "TEST-001",
      "title": "FEUER Testalarm Webhook",
      "text": "Testprotokoll A1", "address": "Teststrasse 1, 4410 Liestal",
      "lat": 47.484, "lng": 7.735}'
  ```
  → `"status":"ok"`, `"created":true`. ☐
- [ ] **A2:** Seite **Alarmeingang** (früher «Divera Notfälle»): Eintrag da,
  Badge **TESTSYSTEM**, Adresse/Text korrekt. ☐
- [ ] **A3:** Bei offener Seite zweiten Alarm senden (`TEST-002`) → Toast
  «Neuer Alarm» + Ton, Liste aktualisiert live. ☐
- [ ] **A4:** Pool-Suche nach `testsystem` findet die Alarme. ☐

## B. Deduplizierung

- [ ] **B1:** A1-curl unverändert wiederholen → `"created":false`, gleiche
  `emergency_id`; Pool zeigt den Alarm nur einmal. ☐
- [ ] **B2:** Gleiche `source_id` mit `"source":"anderes-system"` →
  `"created":true` (Quellen teilen keinen ID-Raum). ☐

## C. Sicherheit / Validierung

- [ ] **C1:** Ohne Secret → **403**; falsches Secret → **403**. ☐
- [ ] **C2:** Secret als `?secret=` Query-Param funktioniert. ☐
- [ ] **C3:** `"source":"divera"` → **422** (reserviert); `"source":"Gross
  Geschrieben"` → **422**; nur `lat` ohne `lng` → **422**; ohne `title` → **422**. ☐

## D. Auto-Anhängen + Provenance

- [ ] **D1:** Test-Ereignis (kein Übungsereignis) mit Auto-Anhängen aktivieren;
  Alarm `{"source":"testsystem","source_id":"TEST-AUTO-1","title":"VU eingeklemmte
  Person Testalarm"}` senden → Antwort mit `auto_attached_incident_id`. ☐
- [ ] **D2:** Board: Einsatz in **Eingegangen**, Typ **Strassenrettung**,
  Priorität **hoch** (abgeleitet). ☐
- [ ] **D3 — Provenance:** `curl -s $BASE/api/incidents/<id>` (oder DB):
  `"source":"testsystem"`, `"source_ref":"TEST-AUTO-1"`. ☐
- [ ] **D4:** Auto-Anhängen nur bei Übungsereignis aktiv → neuer Alarm bleibt
  im Pool (`auto_attached_incident_id: null`). ☐

## E. Manuelles Anhängen

- [ ] **E1:** Unzugewiesenen Testalarm im Pool anhängen → Einsatz auf dem
  Board; via API: `source`/`source_ref` vom Alarm übernommen. ☐

## F. Neutrale UI

- [ ] **F1:** Seitentitel **«Alarmeingang»**, mobiler Nav-Eintrag
  **«Alarmeingang»** (statt «Divera Notfälle»). ☐
- [ ] **F2:** Einstellungen → Alarmierung: Karte heisst **«Ausalarmierung»**
  mit Badge **DIVERA 24/7** (vom Capability-Endpoint geliefert). ☐
- [ ] **F3:** Einsatzkarte/Detail: Button heisst **«Aufgebot»** bzw.
  **«Aufgebot senden»** (Disponieren-Dialog), nicht mehr «Divera-Alarm». ☐
- [ ] **F4:** DIVERA-Alarme im Pool: **kein** Quellen-Badge (Normalfall);
  ÜBUNG-Badge unverändert. ☐

## G. Einstellungen-Umbenennung (alerting.*)

- [ ] **G1:** Vorher gesetzte Werte (Toggle, angepasste Vorlagen) sind nach der
  Migration **erhalten** (Einstellungen-Karte zeigt den alten Zustand). ☐
- [ ] **G2:** Toggle umschalten + Vorlage ändern → speichert; DB-Check:
  ```bash
  docker exec kprueck-db-dev psql -U kprueck -d kprueck \
    -c "SELECT key FROM settings WHERE key LIKE 'alerting.%' OR key LIKE 'divera.alarm%'"
  ```
  → nur `alerting.*`-Schlüssel, keine `divera.alarm_*` mehr. ☐

## H. Ausalarmierung über das Provider-Protokoll

- [ ] **H1 — Gating:** Ausalarmierung in den Einstellungen **deaktivieren** →
  «Aufgebot senden» im Disponieren-Dialog verschwindet bzw. Senden liefert 403. ☐
- [ ] **H2 — Übungs-Simulation (kein externer Call):** In einem
  **Übungs**ereignis einen Einsatz disponieren → «Aufgebot senden» → Ergebnis
  «Übung: Alarm simuliert». Empfängerliste zeigt verknüpfte/nicht verknüpfte
  Personen korrekt. ☐
- [ ] **H3 — Identitäten:** Nach einem Member-Sync (oder manuellem Insert):
  ```bash
  docker exec kprueck-db-dev psql -U kprueck -d kprueck \
    -c "SELECT provider, count(*) FROM personnel_external_identities GROUP BY provider"
  ```
  → `divera`-Zeilen vorhanden; Empfänger-Auflösung nutzt diese Tabelle
  (Personen ohne Legacy-`divera_user_id`, aber mit Identitäts-Zeile, sind
  alarmierbar — automatisiert getestet). ☐
- [ ] **H4 — OPTIONAL, echter Versand (erst wenn gewollt!):** Im echten
  Ereignis mit aktivierter Ausalarmierung ein Aufgebot an **eine** Testperson
  senden → Push kommt an, `foreign_id` = `kprueck-<incident-id>`. **Löst einen
  echten DIVERA-Alarm aus — bewusst entscheiden.** ☐

## I. Capability-Registry

- [ ] **I1:** `curl -s $BASE/api/integrations | jq` → `alarms`/`alerting`/
  `personnel` = `divera` konfiguriert, `vehicles` = `traccar` (falls Traccar-Env
  gesetzt), `builtin_alarm_paths` enthält `generic-webhook` + `manual-intake`. ☐

## J. DIVERA-Regression

- [ ] **J1:** Simulierter DIVERA-Webhook:
  ```bash
  curl -s -X POST "$BASE/api/divera/webhook?secret=$SECRET" \
    -H "Content-Type: application/json" \
    -d '{"id": 999000111, "title": "BMA Testgebäude"}'
  ```
  → ok; erneut senden → «Duplicate emergency ignored». ☐
- [ ] **J2:** Übungsgenerator erzeugt simulierte Alarme mit ÜBUNG-Badge wie
  bisher; Anhängen nur an Übungen. ☐
- [ ] **J3:** DIVERA-Verbindungsstatus/Polling-Anzeige unverändert;
  Member-Sync-Vorschau funktioniert. ☐
- [ ] **J4:** Drucksystem unverändert (Einsatzzettel/Board-Druck) — von dieser
  Umstellung nicht berührt; bei Gelegenheit ein Testdruck. ☐

## K. Aufräumen

- [ ] Testalarme archivieren, Test-Einsätze löschen, Testereignis archivieren,
  Auto-Anhängen-Flags zurücksetzen. ☐

---

**Bei Abweichungen:** `docker logs kprueck-backend-dev --tail 50` (prod: Railway
Logs) — der Webhook loggt Ablehnungen («Generic alarm rejected») und Annahmen
(«New alarm received via generic webhook»); die Ausalarmierung loggt den
Provider-Slug.
