# Plan 17 – Betrieb, Einrichtung und Release-Zyklus

**Status:** offen. Entstanden aus der Durchsicht vor der Veröffentlichung (2026-07-29), bei der
die Dokumentation Aussage für Aussage gegen den Code geprüft wurde. Was dabei an
Betriebsthemen auffiel und nicht sofort behoben wurde, steht hier — mit dem Grund, warum es
auffiel, damit später niemand die Begründung neu erfinden muss.

**Bereits erledigt** (nicht mehr Teil dieses Plans, hier nur als Kontext):

- Sicherung + Wiederherstellung + Übung — `scripts/backup.sh`, `just backup`,
  `DEPLOYMENT.md` §6.1/§6.2
- Speichergrenzen aus gemessenen Werten — `docker-compose.yml`
- Ausfalltabelle nach Aufstellung getrennt — `AUSFALL_SOP.md`

Die Reihenfolge unten ist grob nach Nutzen sortiert, nicht nach Aufwand.

---

## 1. Einrichtung: eine Oberfläche statt fünf Handgriffe

**Der eigentliche Auftrag**, nicht bloss ein Skript. Zusammengelegt aus zwei Beobachtungen,
die dasselbe Problem von zwei Seiten zeigen:

- kp-front erzeugt seine drei Geheimnisse (`scripts/init-env.sh`), kp-rueck lässt fünf von
  Hand tippen. Genau dort passiert es, dass jemand ein Passwort wiederverwendet oder ein
  Leerzeichen mitkopiert.
- Von «Debian-Box mit Docker» bis «Board läuft» sind es ~13 Schritte, davon drei
  Konfigurationsentscheide (`DOMAIN` / `CORS_ORIGINS` / `AUTH_COOKIE_SECURE`), die
  `SETUP.md` §7 selbst als die drei häufigsten Stolperstellen benennt — sie hängen
  voneinander ab und werden trotzdem einzeln erfragt.

**Ziel:** ein durchgängiger, gleich aussehender Weg durch die Einrichtung — für beide
Anwendungen, mit denselben Fragen in derselben Sprache. Nicht zwei Skripte, die sich ähneln.

**Zu klären, bevor gebaut wird:**

- Ein interaktives Skript (`just setup`), ein `curl | bash`-Installer, oder eine
  Weboberfläche beim ersten Start? Der Installer ist das, was ein Leser eines Zeitungsartikels
  tatsächlich ausprobiert; er ist zugleich dauerhafte Wartungslast und muss gegen einen
  frischen Host geprüft werden, sonst ist er schlimmer als eine Anleitung.
- Wie viel darf das Skript entscheiden und wie viel muss es fragen? LAN-gegen-Domain bestimmt
  drei Variablen; das ist eine Frage, nicht drei.
- Gemeinsam für beide Repos oder je eines mit gleicher Gestalt? (Siehe Plan 18, dieselbe
  Frage stellt sich beim Druckagenten.)

**Abhängig davon:** A3 unten (die TLS-Frage ist Teil derselben Abfrage).

---

## 2. Sicherheitsnetze und Sicherungen, gründlicher gedacht

Die Sicherung existiert jetzt, das Netz darum herum nicht.

- **Dump vor der Migration beim Start.** `backend/start.sh:27` fährt `alembic upgrade head`
  und dann uvicorn. Schlägt eine Migration fehl, endet der Container, `restart:
  unless-stopped` startet ihn erneut, und der vorherige Container ist bereits weg: ein harter
  Ausfall ohne Rückkehrpunkt. kp-front löst das seit `backend/start.sh:9-33` — `pg_dump`,
  sobald `alembic current != heads`, die neuesten fünf behalten, bewusst
  bestmöglich-statt-blockierend, damit ein fehlgeschlagener Dump warnt und trotzdem startet.
  `postgresql-client` liegt bereits im Image, `/mnt/data` ist beschreibbar. Nahezu
  wörtliche Übernahme.
- **Sicherung als Compose-Dienst** (`profiles: ["backup"]`, kleiner Cron-Container auf ein
  Host-Verzeichnis, `BACKUP_KEEP`). Sicherungen, die es standardmässig gibt, statt weil
  jemand an die crontab gedacht hat.
- **Postgres-Hauptversionswechsel.** Ein 16er Datenvolume liest kein 17er Server.
  `DEPLOYMENT.md` §4 sagt das, ein `scripts/pg-major-upgrade.sh` (Dump → neues Volume →
  Zurückspielen → Prüfen) gibt es nicht. Der Termin steht fest und trifft alle Stationen
  gleichzeitig.
- **Offene Frage:** Wohin sichern? Alles bisherige schreibt auf dieselbe Box, deren Ausfall
  laut `AUSFALL_SOP.md` der eigentliche Single Point of Failure ist. Ein Ziel ausser Haus
  (NAS, S3-kompatibel, verschlüsselt) ist der nächste ehrliche Schritt.

---

## 3. TLS im LAN — mehr als Kosmetik bei KP Front

Der dokumentierte LAN-Weg ist reines HTTP. Für KP Rück ist das ein Kompromiss (mit dem
`AUTH_COOKIE_SECURE=false`-Fallstrick, der bereits dokumentiert ist). Für **KP Front** ist es
ein Funktionsverlust, den niemandem gesagt wird: die Anwendung ist eine PWA, und

- Service Worker (`vite.config.ts:37`, Offline-Zwischenspeicher),
- Web Push (`src/lib/push.ts`, Alarme bei geschlossener App),
- Geolokalisierung (`src/lib/useGeoPosition.ts`),
- `getUserMedia` für Sprachnotizen (`src/lib/useVoiceMemo.ts`)

sind **allesamt nur im secure context** verfügbar. Eine Wehr, die `docs/DEPLOYMENT.md` §3a
folgt, verliert alle vier — auf der Anwendung, deren ganzer Zweck schlechtes Netz ist. Kein
Dokument warnt davor.

**Zu tun:** auskommentierter `tls internal`-Block in beiden Caddyfiles, ein Abschnitt zum
Verteilen der lokalen Wurzel (`/data/caddy/pki/authorities/local/root.crt`) auf die Geräte
der Wehr, und ein ausdrücklicher Warnkasten in KP Fronts DEPLOYMENT.md, der die vier
Funktionen benennt. Vor dem Schreiben in einem echten LAN prüfen — die Anleitung ist nur so
viel wert wie der Schritt mit dem Zertifikat.

---

## 4. Release-Zyklus: `latest` gegen `stable`

Beide `.env.example` liefern `*_TAG=latest` aus. Eine Station kann damit eine Minor-Version
überqueren, weil die Box neu gestartet ist.

Ein blosses Anpinnen wäre verfrüht — dafür ist zu wenig draussen. Die Frage gehört in einen
eigenen Durchgang über den Release-Zyklus:

- Zwei bewegliche Marken (`latest` und `stable`)? Wer entscheidet, wann `stable` nachzieht?
- Was heisst «stable» bei einer Anwendung, die zuerst in Oberwil produktiv läuft und dort
  kontinuierlich von `main` deployt?
- Verhältnis zur MAJOR/MINOR/PATCH-Tabelle in `CHANGELOG.md`, die bereits verspricht, was ein
  Sprung kostet.
- **Hinweis-Banner** (Backend fragt die GitHub-Releases-API wöchentlich, abschaltbar, es
  wird nichts gesendet; die Oberfläche zeigt, dass eine neuere Version existiert, verlinkt auf
  die CHANGELOG-Tabelle). Stationen pinnen einen Tag und aktualisieren dann nie — nichts
  anderes auf dieser Liste ändert daran etwas. Aber: ein ausgehender Aufruf steht in Spannung
  zur Datenschutzhaltung, auch abschaltbar. Gehört in dieselbe Entscheidung.

---

## 5. Betriebsübersicht für Administratoren

**Erweitert:** nicht nur Zahlen anzeigen, sondern eine einheitliche, saubere Art, zu prüfen,
**ob die eigenen Systeme in Ordnung sind** — für beide Anwendungen gleich aussehend.

kp-front hat einen Anfang (`backend/app/api/system.py`), kp-rueck nichts Vergleichbares.

Kandidaten für den Inhalt: laufende Version, freier Plattenplatz, **Alter der letzten
Sicherung**, Datenbankgrösse, Grösse des Foto-Volumes, WebSocket-Verbindungen, Zustand der
Hintergrundaufgaben, erreichbare Integrationen (Divera, Traccar, Druckagent, Kachelserver).

«Letzte Sicherung: vor 41 Tagen» in Rot ist mehr wert als jede Überwachungslösung, die diese
Stationen nie aufsetzen werden.

Nebenbei zu klären: `/health/detailed` liefert genau solche Werte und ist in Produktion mit
404 abgeschaltet (`backend/app/api/health.py:70`). Hinter eine Admin-Anmeldung statt
abschalten wäre die halbe Miete.

**Setzt voraus:** die Sicherung aus Abschnitt 2, sonst gibt es kein «Alter der letzten
Sicherung» zu zeigen.

---

## 6. Zweiter Schirm: der letzte bekannte Stand bleibt stehen

Fällt die Box aus, ist laut SOP Papier die Rückfallebene. Zwischen «alles da» und «Papier»
liegt ein Schritt, den es geben könnte: ein Betrachtergerät zeigt den zuletzt bekannten Stand
weiter, statt in einen Fehler zu laufen.

**Ausdrücklich Teil des Auftrags:** heute liefert das Gerät bei ausgefallenem Server einen
500er beziehungsweise gar nichts. Es braucht also zusätzliches Zwischenspeichern im Browser,
damit überhaupt etwas stehenbleibt — das ist der eigentliche Aufwand, nicht die Anzeige.

Verkleinert die Lücke im AUSFALL_SOP von «Papier» auf «Papier, plus der letzte Stand ist noch
sichtbar». Sicherheitsrelevant, und der am ehesten verteidigbare grosse Posten, sobald
Abschnitt 2 steht.

---

## Was hier bewusst NICHT steht

- **Waagerechte Skalierung.** 10–50 Personen, eine Postgres, WebSocket-Push mit
  Abfrage-Rückfall. Ein Raspberry Pi 4 trägt das. Was zuerst knapp wird, ist **Plattenplatz**
  (Kacheln + Fotos + WAL, ohne Warnung), danach der Speicher des Kachelservers — nicht der
  Durchsatz. Jede Stunde für Skalierung ist eine Stunde weniger für Abschnitt 2. «Eine Box,
  kein Cluster, und das ist die richtige Architektur» ist eine Aussage, die man offensiv
  vertreten kann.
