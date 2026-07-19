# Alarm-Anbindung (generische Webhook-Schnittstelle)

KP Rück nimmt Alarme aus **jedem** Dispositions- oder Alarmierungssystem entgegen
— nicht nur aus DIVERA 24/7. Ein einzelner HTTP-Aufruf genügt; es braucht kein
SDK, keinen Anbieter-Account und keine Anpassung im Quellcode.

Eingehende Alarme landen im **Eingangspool** (Alarme-Seite), werden — falls für
das aktive Ereignis aktiviert — automatisch als Einsatz angehängt und erscheinen
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

Ohne konfiguriertes oder mit falschem Secret antwortet der Endpunkt mit `403`.

## Payload

| Feld        | Typ            | Pflicht | Beschreibung |
|-------------|----------------|---------|--------------|
| `title`     | string (≤255)  | **ja**  | Alarmtitel, z.B. `"FEUER Dachstockbrand"`. Einsatzart/Priorität werden daraus abgeleitet. |
| `source`    | slug (≤20)     | nein    | Kennung des sendenden Systems, klein geschrieben (`a-z`, `0-9`, `-`, `_`). Standard: `"webhook"`. Reserviert (abgelehnt): `divera`, `operator`, `intake`, `training`, `manual`. |
| `source_id` | string (≤255)  | nein    | Alarm-ID im sendenden System. Wenn gesetzt, werden Wiederholungen derselben `(source, source_id)`-Kombination **dedupliziert** (idempotent — gefahrlos erneut senden). |
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
  `(source, source_id)`-Kombination — der bestehende Pool-Eintrag wurde bestätigt,
  nichts wurde doppelt angelegt.
- `auto_attached_incident_id` ist gesetzt, wenn der Alarm automatisch als
  Einsatz an das aktive Ereignis angehängt wurde (Auto-Anhängen im Ereignis
  aktiviert; Übungs-Ereignisse erhalten nie automatische Alarme).

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
- **Auto-Anhängen:** identisch zu DIVERA — der Alarm wird als neuer Einsatz
  (Status «Eingegangen») an das neueste aktive Ereignis mit aktiviertem
  Auto-Anhängen gehängt; sonst bleibt er zum manuellen Anhängen im Pool.
- **Ableitung:** Einsatzart (FEUER→Brandbekämpfung, VU→Strassenrettung, …) und
  Priorität (lebensbedrohliche Stichworte→hoch) aus Titel/Text.
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
konfiguriert ist — Alarmeingang, Ausalarmierung, Personal-Sync (DIVERA),
Fahrzeug-GPS (Traccar) — inklusive Fähigkeiten. Das Frontend rendert die
Anbieter-Namen aus dieser Antwort statt sie fest zu verdrahten; die
generische Webhook-Schnittstelle und das Meldeformular sind immer verfügbar
und werden bewusst nicht als «Anbieter» geführt.

Die Ausalarmierung läuft intern über ein Provider-Protokoll
(`backend/app/services/alerting/`): ein neuer Anbieter (z. B. Alamos) ist ein
Modul, das `send_alarm(...)` implementiert, plus ein Eintrag in der Registry —
kein Umbau am Endpunkt oder an der Personen-Verknüpfung nötig
(`personnel_external_identities` speichert Identitäten pro Anbieter).

Für Drucker gilt dasselbe Muster: siehe [docs/PRINT_AGENT.md](PRINT_AGENT.md).

## Eigenes System anbinden (Adapter-Muster)

Wenn das sendende System keine frei konfigurierbaren Webhooks kann (z.B. nur
E-Mail oder SMS), genügt ein kleiner Vermittler (Cloud-Function, Cronjob,
Raspberry Pi), der die Meldung entgegennimmt, auf das obige JSON abbildet und
an `POST /api/alarms` weiterreicht. Der `source`-Slug macht die Herkunft im
Pool sichtbar; die `source_id` macht die Zustellung idempotent.
