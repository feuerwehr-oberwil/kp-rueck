# Alarm-Anbindung (generische Webhook-Schnittstelle)

KP Rück nimmt Alarme aus **jedem** Dispositions- oder Alarmierungssystem entgegen
– nicht nur aus DIVERA 24/7. Ein einzelner HTTP-Aufruf genügt; es braucht kein
SDK, keinen Anbieter-Account und keine Anpassung im Quellcode.

Eingehende Alarme landen im **Eingangspool** (Alarme-Seite), werden – falls für
das aktive Ereignis aktiviert – automatisch als Einsatz angehängt und erscheinen
in Echtzeit auf allen verbundenen Geräten. Einsatzart und Priorität werden aus
Titel/Text abgeleitet (gleiche Logik wie bei DIVERA-Alarmen).

## Endpunkt

```
POST /api/alarms
Content-Type: application/json
```

**Authentifizierung:** gemeinsames Secret, wahlweise als Query-Parameter
(`?secret=...`) oder als Header (`X-Webhook-Secret: ...`). Das Secret wird beim
ersten Start automatisch erzeugt und steht in der Datenbank:

```sql
SELECT value FROM settings WHERE key = 'alarm_webhook_secret';
```

Ohne konfiguriertes oder mit falschem Secret antwortet der Endpunkt mit `403`. Das gilt
seit 2026-07 genauso für den Divera-Adapter (`POST /api/divera/webhook`) — der hat die
Prüfung bei leerem Secret vorher übersprungen und war damit offen. Beide Wege gehen jetzt
durch dieselbe Prüfung.

Am einfachsten gibt man das Secret mit `ALARM_WEBHOOK_SECRET` in der `.env` fest vor —
die Umgebungsvariable gewinnt über den Datenbankwert, und dann muss man es nirgends
auslesen. Die API gibt es nicht heraus: `GET /api/settings/` maskiert es und
`GET /api/settings/alarm_webhook_secret` antwortet mit `403`, weil sonst jeder
angemeldete Benutzer — auch ein reiner Viewer — den Schlüssel mitlesen könnte, mit dem
man Einsätze auf die Lage schreibt. Bleibt der Weg über die Datenbank (oben).

## Payload

| Feld        | Typ            | Pflicht | Beschreibung |
|-------------|----------------|---------|--------------|
| `title`     | string (≤255)  | **ja**  | Alarmtitel, z.B. `"FEUER Dachstockbrand"`. Einsatzart/Priorität werden daraus abgeleitet. |
| `source`    | slug (≤20)     | nein    | Kennung des sendenden Systems, klein geschrieben (`a-z`, `0-9`, `-`, `_`). Standard: `"webhook"`. Reserviert (abgelehnt): `divera`, `operator`, `intake`, `training`, `manual`. |
| `source_id` | string (≤255)  | nein    | Alarm-ID im sendenden System. Wenn gesetzt, werden Wiederholungen derselben `(source, source_id)`-Kombination **dedupliziert** (idempotent – gefahrlos erneut senden). |
| `text`      | string (≤5000) | nein    | Meldungstext / Details. |
| `address`   | string (≤500)  | nein    | Einsatzadresse (Anzeige + Lageblatt). |
| `lat`/`lng` | float          | nein    | Koordinaten (WGS84); nur **beide zusammen** gültig. |
| `number`    | string (≤50)   | nein    | Referenznummer des Senders, z.B. `"E-501"`. |

## Antwort

```json
{
  "status": "ok",
  "created": true,
  "emergency_id": "f82b73b7-…",
  "auto_attached_incident_id": null
}
```

- `created: false` bedeutet: Wiederholung einer bereits bekannten
  `(source, source_id)`-Kombination – der bestehende Pool-Eintrag wurde bestätigt,
  nichts wurde doppelt angelegt.
- `auto_attached_incident_id` ist gesetzt, wenn der Alarm automatisch als
  Einsatz an das aktive Ereignis angehängt wurde (Auto-Anhängen im Ereignis
  aktiviert; Übungs-Ereignisse erhalten nie automatische Alarme).

## Stabilität der Schnittstelle

Worauf sich ein sendendes System verlassen kann:

- **Nur additiv.** Neue optionale Felder können dazukommen; bestehende werden innerhalb einer
  Hauptversion nicht entfernt, umbenannt oder verschärft. Unbekannte Felder im Payload werden
  **ignoriert** – zusätzliche Schlüssel zu senden ist also gefahrlos und vorwärtskompatibel.
- **Eine brechende Änderung an diesem Endpunkt ist ein MAJOR-Release**, mit Migrationshinweis
  im [`CHANGELOG.md`](../CHANGELOG.md). Sie passiert nie in einem Patch.
- **Die Idempotenz gehört zum Vertrag**, nicht zur Implementierung: dieselbe
  `(source, source_id)`-Kombination erneut zu senden ist immer sicher.

## Beide anbinden: KP Rück und KP Front

KP Front hat einen Endpunkt mit demselben Namen und derselben Idee – aber die beiden sind
**unabhängige Implementierungen, keine gemeinsame Spezifikation**. Sie sind für verschiedene
Aufgaben gebaut, und ihre Payloads sind auseinandergelaufen. Wer *einen* Sender für beide
schreibt, bleibt in dieser gemeinsamen Teilmenge:

| Feld | Portabel | Hinweis |
| --- | --- | --- |
| `title` | ✅ bei beiden Pflicht | – |
| `source` | ✅ | Höchstens 16 Zeichen und nach `^[a-z0-9][a-z0-9_-]*$` – KP Front ist strenger |
| `source_id` | ✅ **immer mitsenden** | Bei KP Front **Pflicht**, hier optional |
| `text`, `address` | ✅ | – |
| `lat` + `lng` | ✅ | WGS84, nur beide zusammen |
| `number` | nur KP Rück | Wird von KP Front ignoriert |
| `type`, `priority`, `started_at` | nur KP Front | Werden hier ignoriert |

Reservierte `source`-Slugs beider Seiten meiden: `divera`, `manual`, `migrated`, `operator`,
`intake`, `training`.

**Keinen gemeinsamen Parser für die Antwort schreiben.** KP Rück antwortet mit
`{"status": …, "created": …, "emergency_id": …, "auto_attached_incident_id": …}`, KP Front mit
`{"incident_id": …, "created": …}`. Nur `created` bedeutet auf beiden Seiten dasselbe.

## Beispiel

```bash
curl -X POST "https://<backend>/api/alarms" \
  -H "X-Webhook-Secret: <secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "leitstelle",
    "source_id": "A-2026-0815",
    "title": "FEUER Dachstockbrand",
    "text": "Starke Rauchentwicklung, Person im Gebäude vermutet",
    "address": "Hauptstrasse 12, 4410 Liestal",
    "lat": 47.4839,
    "lng": 7.7347
  }'
```

## Verhalten im System

- **Pool:** Alarme erscheinen auf der Alarme-Seite; Nicht-DIVERA-Alarme tragen
  ein Badge mit ihrem `source`-Slug (z.B. `LEITSTELLE`).
- **Auto-Anhängen:** identisch zu DIVERA – der Alarm wird als neuer Einsatz
  (Status «Eingegangen») an das neueste aktive Ereignis mit aktiviertem
  Auto-Anhängen gehängt; sonst bleibt er zum manuellen Anhängen im Pool.
- **Ableitung:** Einsatzart (FEUER→Brandbekämpfung, VU→Strassenrettung, …) und
  Priorität (lebensbedrohliche Stichworte→hoch) aus Titel/Text. Die Stichwortliste ist
  nicht alarmierungssystem-spezifisch: sie steht in `backend/app/data/alarm_keywords.json`
  und wird byte-identisch mit KP Front geteilt (siehe `docs/RUNNING-BOTH.md`).
- **Rate-Limit:** 10 Anfragen/Minute pro IP.

## Abgrenzung zu den Adapter-Endpunkten

| Weg | Endpunkt | Zweck |
|-----|----------|-------|
| Generischer Webhook | `POST /api/alarms` | Jedes System (Leitstelle, Alamos, eigenes Skript, …) |
| DIVERA-Adapter | `POST /api/divera/webhook` | Natives DIVERA-24/7-Payload-Format |
| Telefon/Schalter | `/alarm?token=…` (Intake-Formular) | Manuelle Erfassung ohne Login |

Alle drei Wege führen in denselben Pool und dieselbe Auto-Anhängen-Logik.

## Capability-Registry

`GET /api/integrations` (angemeldet) zeigt pro Bereich, welcher Anbieter
konfiguriert ist – Alarmeingang, Ausalarmierung, Personal-Sync (DIVERA),
Fahrzeug-GPS (Traccar) – inklusive Fähigkeiten. Das Frontend rendert die
Anbieter-Namen aus dieser Antwort statt sie fest zu verdrahten; die
generische Webhook-Schnittstelle und das Meldeformular sind immer verfügbar
und werden bewusst nicht als «Anbieter» geführt.

`known_providers` listet zusätzlich **jeden Anbieter, den dieser Build kennt**
– auch die, die hier niemand eingerichtet hat. Die vier Bereichsfelder
beantworten *wer ist gerade aktiv*, diese Liste beantwortet *worauf könnte ich
zeigen*; ohne sie ist ein nicht konfigurierter Anbieter gar nicht auffindbar.
`implemented: false` heisst: der Vertrag ist veröffentlicht, die Anbindung ist
**noch nicht gebaut**. Ein auffindbarer Eintrag, der ehrlich sagt, dass er
nichts tut, ist nützlich – eine Registry, die stillschweigend suggeriert, alles
Aufgelistete funktioniere, ist es nicht.

### Publizierter Personenstamm (`roster-snapshot`)

Manche Wehren führen ihre Mannschaft in einem ganz anderen System – einer
Gemeinde-HR, einem kantonalen Register, einem nächtlichen Skript. Für diesen
Fall gibt es einen **veröffentlichten, versionierten Vertrag**: jenes System
legt eine JSON-Datei ab, eine Anwendung liest sie. Jede Station kann auf jede
URL zeigen; im Schema steht kein Herstellername.

- Vertrag: [`roster-snapshot.schema.json`](roster-snapshot.schema.json)
- Abgleichs-Bericht eines Laufs:
  [`roster-snapshot-outcome.schema.json`](roster-snapshot-outcome.schema.json) –
  `matched`/`created`/`updated`/`deactivated`, jede Person, die **nicht**
  zugeordnet werden konnte, mit Grund, und jeder unbekannte Grad-Schlüssel.
  Nicht zuordenbare Personen werden gezählt und gemeldet, **nie stillschweigend
  verworfen**.
- Identitäten reisen als `(provider, external_id)`-Paare und landen in
  `personnel_external_identities` – keine nach einem Hersteller benannte Spalte.
- 🔴 **Keine medizinischen Felder, nie.** Keine Untersuchung, keine
  Tauglichkeit, keine Impfung, und auch keine freie `metadata`-Map, in der so
  etwas unbenannt ankäme. Ein Test hält das, kein Satz in einem Dokument.

⚠️ **Stand: nur Vertrag.** Die beiden Schema-Dateien sind byte-identische
Kopien der KP-Front-Dateien und per Prüfsumme gepinnt
(`backend/tests/test_roster_snapshot_contract.py`); geändert wird der Vertrag
in beiden Repositories in einer Änderung. **Diese Anwendung liest heute keinen
Snapshot** – der Registry-Eintrag steht auf `implemented: false`. Die beiden
Produkte teilen dabei weiterhin keine Bibliothek und rufen einander nicht auf
(siehe [RUNNING-BOTH.md](RUNNING-BOTH.md)); geteilt wird eine Datei, nicht
Laufzeit.

Die Ausalarmierung läuft intern über ein Provider-Protokoll
(`backend/app/services/alerting/`): ein neuer Anbieter (z. B. Alamos) ist ein
Modul, das `send_alarm(...)` implementiert, plus ein Eintrag in der Registry –
kein Umbau am Endpunkt oder an der Personen-Verknüpfung nötig
(`personnel_external_identities` speichert Identitäten pro Anbieter).

Für Drucker gilt dasselbe Muster: siehe [docs/PRINT_AGENT.md](PRINT_AGENT.md).

## Eigenes System anbinden (Adapter-Muster)

Wenn das sendende System keine frei konfigurierbaren Webhooks kann (z.B. nur
E-Mail oder SMS), genügt ein kleiner Vermittler (Cloud-Function, Cronjob,
Raspberry Pi), der die Meldung entgegennimmt, auf das obige JSON abbildet und
an `POST /api/alarms` weiterreicht. Der `source`-Slug macht die Herkunft im
Pool sichtbar; die `source_id` macht die Zustellung idempotent.
