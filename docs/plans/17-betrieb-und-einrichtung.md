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

**Entschieden (2026-07-29):**

- **Gestalt: ein interaktiver `curl | bash`-Installer** — das ist, was jemand nach einem
  Zeitungsartikel tatsächlich ausprobiert. Mit einer **deutlich sichtbaren Angabe, für welche
  Hosts er gilt**: er kann nicht jede Umgebung bedienen, und das gehört an den Anfang der
  Ausgabe und in die Dokumentation, nicht in eine Fussnote. Ausserhalb dieser Liste bleibt
  der dokumentierte Weg von Hand gültig und muss es bleiben.
- **Umfang: bis zum laufenden Board, plus Offline-Kacheln als optionaler Schritt darin.**
  Alles Weitere (Divera, Traccar, Druckagent) kommt danach — aber als **klar ausgewiesener
  nächster Schritt**, nicht als Fussnote. Die Kacheln sind drin, weil sie das Merkmal für
  schlechtes Netz sind und nachträglich am unangenehmsten sind: sie brauchen einen laufenden
  Stack und 5–15 Minuten.
- **Uneinheitliche Variablennamen werden vorerst versteckt.** Der Installer stellt in beiden
  Anwendungen dieselben Fragen und schreibt, was das jeweilige Backend wirklich liest
  (`COOKIE_SECURE` gegen `AUTH_COOKIE_SECURE` und so weiter). Ein Umbenennungsdurchgang kommt
  später und eigenständig — hier wird es im Hintergrund richtig gemacht, statt die Umbenennung
  in die Einrichtung zu schmuggeln.

**Offen:**

- Welche Hosts genau? (Debian/Ubuntu mit Docker Engine ist der offensichtliche Kern; macOS
  mit Docker Desktop / OrbStack ist der zweite Fall, den es real gibt.) Die Liste muss stehen,
  bevor der Installer geschrieben wird — sie ist sein Vertrag.
- Der Installer braucht dieselbe Logik wie ein `just setup` es täte. Sinnvoll ist, sie
  **einmal** zu schreiben und den Installer sie herunterladen und ausführen zu lassen, statt
  zwei Wege zu pflegen, die auseinanderlaufen.
- Wiederholtes Ausführen: eine Wehr fängt im LAN an und bekommt später eine Domain. Heute
  muss sie wissen, welche drei Variablen zu ändern sind. Der Installer sollte das können —
  oder ausdrücklich sagen, dass er es nicht kann.
- kp-fronts bestehendes `init-env.sh` endet mit `docker compose up -d --build`. Das
  widerspricht dem Weg über veröffentlichte Images, den dieselben Dokumente versprechen. Beim
  Zusammenlegen mitnehmen.

**Abhängig davon:** §3 (die TLS-Frage ist dieselbe Abfrage ein zweites Mal — wird `tls
internal` zur Empfehlung, heisst «LAN» nicht mehr «einfaches HTTP», und die Antworten auf
`AUTH_COOKIE_SECURE` ändern sich).

---

## 2. Sicherheitsnetze und Sicherungen, gründlicher gedacht

Die Sicherung existiert jetzt, das Netz darum herum nicht.

**Entschieden (2026-07-29): ausser Haus ist die Anforderung, nicht die Kür.** Alles, was heute
geschrieben wird, landet auf derselben Box, deren Ausfall `AUSFALL_SOP.md` als den eigentlichen
Single Point of Failure benennt. Eine Sicherung auf der Maschine, die gestorben ist, ist keine
Sicherung, sondern eine Kopie. Das formt den Sicherungs-Dienst, statt nachträglich angeschraubt
zu werden: NAS über SMB/NFS oder ein S3-kompatibler Eimer, verschlüsselt abgelegt, und die
Zugangsdaten dafür gehören in dieselbe Überlegung wie die übrigen Geheimnisse (§1).

### Zu tun

- **Dump vor der Migration beim Start.** `backend/start.sh:27` fährt `alembic upgrade head`
  und dann uvicorn. Schlägt eine Migration fehl, endet der Container, `restart:
  unless-stopped` startet ihn erneut, und der vorherige Container ist bereits weg: ein harter
  Ausfall ohne Rückkehrpunkt — und bis §5 existiert, ohne dass irgendetwas es sagt. kp-front
  löst das seit `backend/start.sh:9-33` — `pg_dump`, sobald `alembic current != heads`, die
  neuesten fünf behalten, bewusst bestmöglich-statt-blockierend, damit ein fehlgeschlagener
  Dump warnt und trotzdem startet. `postgresql-client` liegt bereits im Image, `/mnt/data` ist
  beschreibbar. Nahezu wörtliche Übernahme, ~25 Zeilen. **Der beste Sicherheitsgewinn pro Zeile
  auf dieser Liste.**
- **Sicherung als Compose-Dienst** (`profiles: ["backup"]`, kleiner Cron-Container,
  `BACKUP_KEEP`) — mit dem Ziel ausser Haus als Teil des Entwurfs, nicht als Nachtrag.
- **Wiederherstellung vor Releases in der CI prüfen.** Nicht bei jedem Push: ein Job, der an
  einem Tag hängt oder von Hand ausgelöst wird. Seed einspielen, dumpen, Datenbank wegwerfen,
  zurückspielen, Zeilenzahlen vergleichen und prüfen, dass die Migrationen darauf noch laufen.
  Dieselbe Begründung wie beim `telemetry-drift`-Job: ein dokumentiertes Verfahren, das nie
  jemand ausführt, ist eine Vermutung. Ersetzt die halbjährliche Übung (§6.2 in DEPLOYMENT.md)
  **nicht** — die prüft Volumes, Rechte und die echten Fotodateien, also mehr, als eine CI kann.
- **Postgres-Hauptversionswechsel.** Ein 16er Datenvolume liest kein 17er Server.
  `DEPLOYMENT.md` §4 sagt das, ein `scripts/pg-major-upgrade.sh` (Dump → neues Volume →
  Zurückspielen → Prüfen) gibt es nicht. Der Termin steht fest und trifft alle Stationen
  gleichzeitig.
- **Bekannte Grenze dokumentieren:** Datenbank-Dump und Foto-Tarball entstehen Sekunden
  auseinander. Ein Upload dazwischen ergibt eine Zeile ohne Datei. Selten, heilt sich mit der
  nächsten Sicherung, und die Alternative (den Stack nächtlich stilllegen) kostet eine Wehr
  mehr, als sie einbringt — also benennen statt beheben, in `DEPLOYMENT.md` §6.

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

**Entschieden (2026-07-29): DNS-01 als empfohlener Weg, `tls internal` als Rückfallebene.
Einfaches HTTP wird nirgends mehr empfohlen.**

Der Kern des Problems: die vier Funktionen brauchen einen «secure context», also HTTPS, also
ein Zertifikat, dem der Browser traut. Auf einer Box unter 10.0.0.5 geht der übliche Weg nicht
— Let's Encrypt kann sie nicht erreichen. Drei Auswege, und die Unterschiede liegen nicht in
der Technik, sondern darin, wer nachher was auf welchem Gerät tun muss:

| | Kosten für die Wehr | Braucht |
|---|---|---|
| **DNS-01** (empfohlen) | **nichts auf den Geräten** — es funktioniert wie jede Website | eine Domain + DNS-Anbieter mit API; Internet nur zur Erneuerung (~alle 60 Tage), nicht zum Betrieb |
| `tls internal` | auf JEDEM Gerät einmal das CA-Zertifikat installieren **und** vertrauen | nichts — kein Internet, keine Domain |
| einfaches HTTP | die vier Funktionen | nichts |

**Warum DNS-01 vorn steht:** ein öffentlicher DNS-Eintrag (`kp.feuerwehr-oberwil.ch →
10.10.10.5`) auf eine private Adresse ist zulässig und üblich. Let's Encrypt weist den Besitz
der Domain über einen TXT-Eintrag nach, den Caddy per API setzt — die Box muss von aussen nie
erreichbar sein. Ergebnis: ein echtes, öffentlich vertrautes Zertifikat, **ohne einen einzigen
Handgriff auf einem Endgerät**.

**Warum `tls internal` NICHT vorn steht,** obwohl es autarker ist: auf einem iPad heisst
«vertrauen» Profil laden, und danach auf einem ZWEITEN, nicht auffindbaren Bildschirm
(Allgemein → Info → Zertifikatsvertrauenseinstellungen) den Schalter umlegen. Wer den zweiten
Schritt vergisst, bekommt eine ganzseitige rote Warnung — um 3 Uhr morgens schlimmer als
einfaches HTTP, weil es aussieht, als sei die Anwendung kaputt oder kompromittiert. Und das
wiederholt sich bei jedem neuen Gerät; ein fremdes Handy kommt gar nicht hinein.

Der Preis von DNS-01: die interne Adresse steht öffentlich im DNS. Keine Lücke, aber eine
Information, die man veröffentlicht. Split-Horizon-DNS vermeidet das und kostet Komplexität —
gehört als Randnotiz dazu, nicht als Empfehlung.

**Zu tun:**

- DNS-01 in `deploy/Caddyfile` beider Anwendungen als auskommentierten Block, mit dem
  Caddy-DNS-Plugin, das zum Anbieter passt (das Image braucht dafür einen Build mit `xcaddy` —
  das ist der unangenehme Teil und gehört ehrlich dokumentiert, nicht verschwiegen).
- `tls internal` daneben, samt Verteilung der Wurzel
  (`/data/caddy/pki/authorities/local/root.crt`) und **ausdrücklich** dem zweiten iOS-Schritt.
- Warnkasten in KP Fronts `DEPLOYMENT.md`, der die vier Funktionen beim Namen nennt.
- **Die Anwendung sagt es selbst** (entschieden): eine Prüfung auf `!window.isSecureContext`
  zeigt einen bleibenden Hinweis, der die vier fehlenden Funktionen einzeln aufzählt — nicht
  eine allgemeine Warnung. Wer es wissen muss, hält das Tablet in der Hand, und liest nicht
  Monate vorher DEPLOYMENT.md. Platzierung so, dass sie einer Mannschaft im Einsatz nicht im
  Weg steht.
- Vor dem Schreiben an einer echten Station prüfen. Die Anleitung ist nur so viel wert wie der
  Schritt mit dem Zertifikat — dieselbe Lehre wie beim Druckertest.

---

## 4. Release-Zyklus: die Vorgabe, nicht ein neuer Kanal

**Beim Durchgehen kleiner geworden.** Der Abschnitt war als «brauchen wir einen
`stable`-Kanal?» geschrieben. Die Marken können das längst — `DEPLOYMENT.md` §3:

| `KP_RUECK_TAG` | folgt | für |
|---|---|---|
| `X.Y.Z` | nichts, genau diesem Build | Stationen, die bewusst aktualisieren |
| `X.Y` | Patch-Releases dieser Reihe | **Stationen, die Fehlerkorrekturen wollen, aber keine Features** |
| `latest` | jedem Release | Auswertung, Demo-Instanzen |

Die mittlere Zeile ist genau das, was ein `stable` liefern würde. Der eigentliche Fehler ist
enger: `.env.example` liefert `latest` aus — also das, was die Tabelle eine Zeile darunter als
«für Auswertung und Demo» bezeichnet. Die ausgelieferte Vorgabe widerspricht dem eigenen Rat.

**Entschieden (2026-07-29):**

- **Nur die Vorgabe korrigieren.** `.env.example` liefert die laufende Reihe aus (`0.3`),
  `latest` bleibt als auskommentierte Alternative daneben. Der Installer (§1) setzt sie
  ebenfalls. Kein neuer Kanal, kein neues Versprechen, das von Hand gehalten werden muss —
  und die Wirkung ist dieselbe: eine Wehr bekommt Korrekturen automatisch und überquert keine
  Minor-Version, weil die Box neu gestartet ist.
- **Hinweis-Banner: standardmässig AN, mit einem klaren Schalter.** Das Backend fragt
  wöchentlich die GitHub-Releases-API und zeigt in der Oberfläche, dass eine neuere Version
  existiert, verlinkt auf die MAJOR/MINOR/PATCH-Tabelle im CHANGELOG.

  In `PRIVACY.md` gehört das sauber eingeordnet: es ist ein **Abruf, kein Signal**. Es geht an
  api.github.com, es wird nichts über die Installation gesendet, und es ist etwas anderes als
  Telemetrie — deshalb steht es auch nicht unter demselben Schalter. Standardmässig an, weil
  es die einzige Mechanik auf dieser Liste ist, die eine Station erreicht, die längst nicht
  mehr hinschaut; ein Opt-in erreicht genau die nicht, für die es gedacht ist.

**Offen:** wo der Hinweis erscheint. Ein Banner über der Einsatztafel ist falsch — das ist die
Fläche, die im Ernstfall ruhig bleiben muss. Naheliegend ist die Betriebsübersicht aus §5,
zusammen mit «letzte Sicherung» und «freier Plattenplatz»; dieselbe Frage, dieselbe Fläche.

## 5. Betriebsübersicht: läuft mein System?

Nicht «zeig mir Zahlen», sondern **eine saubere, in beiden Anwendungen gleich aussehende Art
zu prüfen, ob das eigene System in Ordnung ist**.

kp-front hat den Anfang (`backend/app/api/system.py`): Version, Commit, Branch,
Datenbank-Lebenszeichen, Zeilenzahlen, Medien- und Plattenplatz, Integrationsflaggen. Und den
richtigen Vertrag im Docstring — *dieser Endpunkt darf NIE 500 liefern*, jeder Abschnitt fällt
einzeln aus, ohne die anderen mitzureissen. kp-rueck hat nichts Vergleichbares.

**Entschieden (2026-07-29):**

- **Benannte Prüfungen, die bestehen oder nicht** — kein Zahlenteppich und keine einzelne
  Ampel. Eine Handvoll Prüfungen, jede mit Zustand, einer Zeile Begründung und dem, was zu tun
  ist. Der Unterschied ist praktisch: ein Zahlenteppich verlangt zu wissen, welche Zahl schlecht
  ist; eine einzelne Ampel verschweigt, warum. Jede Prüfung nennt ihre eigene Schwelle, damit
  über die Schwelle diskutiert werden kann, ohne die Anzeige umzubauen.
- **Admin-authentifiziertes JSON, das auch Überwachung nutzen kann.** `/health/detailed` in
  kp-rueck (Pool-Statistik, WS-Verbindungen, Zustand der Hintergrundaufgaben) wird in
  Produktion mit 404 abgeschaltet — stattdessen hinter eine Admin-Anmeldung. Dieselbe Antwort
  speist die Oberfläche. Eine Wehr mit NAS kann sie mit einem Token abfragen und sich selbst
  benachrichtigen; für alle anderen entsteht keine neue Fläche.
- **Gleiche Gestalt, zwei Implementierungen.** Identische Prüfungsnamen, Formulierungen und
  Anordnung; jede Anwendung rechnet ihre eigenen aus. Kein gemeinsames Paket, keine Kopplung
  über die Konvention hinaus — dieselbe Abwägung wie bei der kopierten Telemetrie, nur ohne
  deren Gefahr, weil hier ein Auseinanderlaufen niemandem Daten preisgibt.

### Kandidaten für die Prüfungen

Gemeinsam: Datenbank erreichbar · freier Plattenplatz · **Alter der letzten Sicherung** ·
**Alter der letzten Kopie ausser Haus** (§2) · läuft die Version, die laufen soll, und **gibt
es eine neuere** (§4) · sind die konfigurierten Integrationen erreichbar · secure context
vorhanden (§3).

Anwendungsspezifisch: kp-rueck Kachelserver, Druckwarteschlange, Hintergrundaufgaben,
WS-Verbindungen — kp-front Offline-Bereitschaft, Sync-Rückstand, Push-Schlüssel.

«Letzte Sicherung: vor 41 Tagen» in Rot ist mehr wert als jede Überwachungslösung, die diese
Stationen nie aufsetzen werden.

**Setzt voraus:** die Sicherung aus §2 (sonst gibt es kein Alter zu zeigen) und den
Versionsstempel, den kp-rueck heute nicht hat — `NEXT_PUBLIC_APP_VERSION` wird in
`release.yml` nicht als Build-Argument übergeben, weshalb jede Fehlermeldung aus dem Frontend
mit `build: 'unknown'` ankommt.

**Offen:** wo der Hinweis auf eine neuere Version erscheint (§4) — die Betriebsübersicht ist
der naheliegende Ort, aber sie ist eine Seite, die niemand aufsucht. Vielleicht braucht es
einen dezenten Weg dorthin, ohne dass er der Einsatztafel im Weg steht.

## 6. Wenn der Server weg ist: es sagen, und einmal noch drucken

**Beim Durchgehen umgedreht.** Der Abschnitt hiess «zweiter Schirm» und wollte den letzten
bekannten Stand weiter anzeigen. Das ist nicht, was gebraucht wird.

**Entschieden (2026-07-29): Papier reicht.** KP Rück bekommt keinen Service Worker und keine
Offline-Fähigkeit. Es bekommt zwei Dinge:

1. **Einen klaren Hinweis, dass der Server weg ist.** Das ist der Auslöser aus
   `AUSFALL_SOP.md` — «Board länger als 2 Minuten nicht erreichbar» —, und je verlässlicher er
   sichtbar wird, desto schneller führt Papier.
2. **Einmal noch drucken, solange es geht.** Wenn der Reiter noch offen ist und der Zustand
   noch im Speicher liegt, muss die Bedienerin daraus ein Lageblatt bekommen — den Stand von
   *jetzt*, nicht den bis zu 15 Minuten alten der automatischen Ablage.

Für KP Front bleibt es beim PWA mit echter Offline-Fähigkeit. Das ist die Anwendung, die
unterwegs ist und für die Offline der Normalfall ist, nicht der Ausfall.

**Warum das besser ist als die ursprüngliche Idee.** Der SOP funktioniert, weil der Auslöser
eindeutig ist. Ein Schirm, der weiterhin ein plausibles Board zeigt, **untergräbt genau das**:
jemand liest ein eingefrorenes Bild weiter, statt umzuschalten. Ein Hinweis plus ein Ausdruck
verstärkt den Ablauf, statt mit ihm zu konkurrieren — und der Ausdruck landet dort, wo der
Ablauf ohnehin hinführt: auf Papier.

**Der Aufwand ist kleiner als gedacht.** `components/print/print-view.tsx` rendert bereits
vollständig aus dem Client-Zustand — `operations`, `personnel` und die übrigen kommen als
Props, nichts wird nachgeladen —, das Druck-CSS steht in `globals.css`, und
`print-options-modal.tsx` erreicht es. Der Weg existiert also. Zu tun bleibt:

- Prüfen, ob dieser Weg **wirklich ohne Backend durchläuft**: hängt das Öffnen des Modals an
  einem Abruf, an einer Berechtigungsprüfung, an Übersetzungen, die noch geholt werden? Was
  daran hängt, muss fallen.
- Der Ausfall-Hinweis: **klar, aber ruhig** (entschieden). Ein bleibender Hinweis und ein
  sichtbares «Stand von HH:MM», sonst unverändertes Aussehen. Kein Alarmrot über der
  Einsatztafel — die Fläche muss unter Druck ruhig bleiben, und der SOP verlangt ohnehin, dass
  ein Mensch die Ansage macht.
- Im Hinweis der Weg zum Ausdruck, damit man ihn im Moment des Ausfalls nicht suchen muss.
- `AUSFALL_SOP.md` ergänzen: «Server weg → Hinweis erscheint → einmal drucken → Papier führt»
  als die drei Schritte, die aufeinander folgen.

## Was hier bewusst NICHT steht

- **Waagerechte Skalierung.** 10–50 Personen, eine Postgres, WebSocket-Push mit
  Abfrage-Rückfall. Ein Raspberry Pi 4 trägt das. Was zuerst knapp wird, ist **Plattenplatz**
  (Kacheln + Fotos + WAL, ohne Warnung), danach der Speicher des Kachelservers — nicht der
  Durchsatz. Jede Stunde für Skalierung ist eine Stunde weniger für Abschnitt 2. «Eine Box,
  kein Cluster, und das ist die richtige Architektur» ist eine Aussage, die man offensiv
  vertreten kann.
