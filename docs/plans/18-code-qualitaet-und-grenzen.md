# Plan 18 – Code-Qualität und die Grenze zu KP Front

**Status:** offen. Entstanden aus der Durchsicht vor der Veröffentlichung (2026-07-29). Was
dabei an Qualitäts- und Grenzthemen auffiel und nicht sofort behoben wurde, steht hier.

**Bereits erledigt** (Kontext, nicht mehr Teil dieses Plans):

- Die dreifache Status-Übersetzungstabelle auf eine reduziert — `lib/incident-status.ts`
- `bcrypt` direkt deklariert, `passlib` entfernt — `backend/pyproject.toml`
- Der Draht-Fehler im Druckagenten (`job_type` gegen `kind`) — `protocols/front.py`

---

## 1. Toter Code — Modulebene erledigt, Rest offen

**Am 2026-07-29 durchgeführt.** Ein Durchlauf über alle Import-Spezifizierer fand 41 Dateien
mit 5'058 Zeilen, die kein Import erreicht. Entfernt wurden 11 handgeschriebene Verwaisungen,
26 ungenutzte shadcn-Primitive, zwei bytegleiche Duplikate und 18 Abhängigkeiten — netto
−6'140 Zeilen. kp-fronts Frontend war bereits sauber. Die beiden vermeintlich toten
Python-Module dort (`demo_export`, `reset_roster`) waren **absichtliche Wartungswerkzeuge**;
sie sind jetzt in `CONFIGURATION.md` §9e dokumentiert statt gelöscht.

Der eigentliche Anlass war, dass die zentrale Fehlermeldung des API-Clients stumm war: sieben
Aufrufe an ein Toast-System, dessen Renderer nirgends eingehängt wurde.

**Entschieden (2026-07-29), was davon bleibt:**

- **Das Suchskript wird eingecheckt und von Hand ausgeführt** (`scripts/`), kein CI-Job. Der
  nächste Durchgang kostet damit nichts an Anlauf, und es gibt keine Schwelle, über die
  gestritten werden muss. 5'000 Zeilen sammeln sich nicht schnell wieder an.
- **Eine billige Duplikatsprüfung.** Drei bytegleiche Paare kamen in dieser Durchsicht
  zusammen (`use-toast` ×2, `use-mobile` ×2, `EmptyState` ×2 in kp-front). Das ist kein
  Kopierunfall, sondern die Bauart des shadcn-Generators, der Dateien an zwei üblichen Orten
  ablegt. Alle verfolgten Quelldateien hashen und bei exakten Duplikaten fehlschlagen — wenige
  Zeilen, und es fängt genau diese wiederkehrende Form.
- **Ungenutzte i18n-Schlüssel gehören dazu.** Gemessen: `messages/de.json` hat **2'363
  Schlüssel, 207 (8%) ohne jede wörtliche Entsprechung in `src/`**. Die Messung validiert sich
  selbst — die ersten Kandidaten sind `common.protectedButton.*`,
  `common.connectionStatus.*` und `common.websocketStatus.*`, also genau die Komponenten, die
  oben gelöscht wurden. Das Entfernen von totem Code hat ihre Übersetzungen verwaist.

  **Vorsicht:** die Suche ist eine Heuristik auf wörtliche Treffer. Ein dynamisch
  zusammengesetzter Schlüssel (`t(\`status.${x}\`)`) sieht ungenutzt aus und ist es nicht.
  Die 207 sind eine **Kandidatenliste, keine Löschliste**. Sicher sind die, deren Komponente
  nachweislich nicht mehr existiert.

  Vor plan 06 erledigen: was hier wegfällt, muss niemand übersetzen.

### Was die Suche NICHT sieht

Sie arbeitet auf Modulebene. Eine exportierte Funktion, die niemand aufruft, ein Prop, das
niemand übergibt, ein Zweig, den keine Bedingung erreicht — davon findet sie nichts. Die 85
`no-unused-vars`-Warnungen aus §3 sind der Teilersatz dafür, was die beiden Abschnitte
verbindet: wer §3 auf null bringt, hat einen guten Teil dieser Ebene mit erledigt.

## 2. Telemetrie-Abgleich — erledigt, ein Rest offen

**Am 2026-07-29 behoben.** Der CI-Job `telemetry-drift` checkt kp-front aus und vergleicht die
fünf kopierten Module; er lief beim ersten echten Durchgang grün. Der lokale Hash-Test bleibt
(schnell, ohne Netz), heisst aber `test_vendored_file_matches_the_recorded_hash` und behauptet
im Docstring nur noch, was er kann.

**Offen: `RESERVED_ALARM_SOURCES`** steht in beiden Repos wörtlich doppelt und wird nur von
einem Kommentar zusammengehalten.

**Entschieden: in denselben Job aufnehmen.** Er checkt kp-front ohnehin aus, der Vergleich
einer weiteren Konstante kostet wenige Zeilen. Ein Auseinanderlaufen ergäbe eine Alarmquelle,
die die eine Anwendung annimmt und die andere zurückweist — für eine Station sichtbar, für
beide Testläufe unsichtbar.

Beim Umsetzen beachten: die Listen sind identisch, die **Randbedingungen nicht** (`source` ist
in kp-rueck bis 20, in kp-front bis 16 Zeichen). Verglichen wird also die Liste, nicht das
Schema drumherum.

## 3. Linting auf null — zwei verschiedene Projekte

`pnpm lint` steht in beiden Repos als **blockierender** Schritt in der CI und kann nicht
fehlschlagen: `"lint": "eslint ."` ohne `--max-warnings`. Das widerspricht der Linie, die
kp-rueck sich selbst gibt (`ci.yml:29` — «a check that is always red teaches people to ignore
red»), und ein Leser, der so weit kommt, merkt es.

**Entschieden: nicht einfrieren, sondern abbauen.** Aber es sind zwei verschiedene Aufgaben,
und das war in der ersten Fassung dieses Plans verdeckt.

### kp-rueck: 192, fast alles mechanisch → in einem Durchgang auf null

(Waren 200; die Aufräumaktion aus §1 nahm 8 mit.)

85 `no-unused-vars`, 51 `no-explicit-any`, 17 `no-console`, 44 `exhaustive-deps`, dazu
2 `no-img-element` und 1 `rules-of-hooks`. Schwerpunkte: `app/help/page.tsx` (21),
`tests/helpers/api.helper.ts` (11), `app/page.tsx` (6).

Das lässt sich in einer konzentrierten Sitzung abarbeiten. Danach `--max-warnings=0`, und der
Schritt bedeutet endlich etwas.

Die 17 `no-console` sind dabei kein Stilthema: 14 unbedingte `console.log` landen in der
Konsole jeder Produktion (`lib/websocket-client.ts` 10, `lib/contexts/auth-context.tsx` 4 —
letztere erzählen den Token-Ablauf mit). `app/backend-api/[...path]/route.ts:17` macht es
richtig, hinter `PROXY_DEBUG` und mit Begründung; das ist die Vorlage.

### kp-front: 221, aber die Zahl ist irreführend → erst trennen

Rund die Hälfte sind React-Compiler-Regeln — 47 `set-state-in-effect`, 39 `refs`,
23 `purity`, 3 `preserve-manual-memoization` —, die `eslint.config.js:29-34` **bewusst** auf
«Warnung» gesetzt hat, mit Verweis auf einen benannten Komponenten-Refactor. Das ist keine
Lint-Schuld im selben Sinn, sondern eine getroffene Entscheidung mit Notiz.

**Also zuerst die Zahl aufteilen:**

- ~112 React-Compiler-Warnungen → gehören zum zurückgestellten Refactor und werden **mit ihm**
  verfolgt, nicht mit dem Lint-Ziel. Schwerpunkte `MapView.tsx` (29), `Whiteboard.tsx` (21),
  `IncidentWorkspace.tsx` (20), `useMapCanvasGestures.ts` (17) — dieselben vier
  Gott-Komponenten, die auch sonst auffallen.
- der Rest (37 `no-explicit-any` — davon 34 an der untypisierten maplibre-Grenze —,
  13 `exhaustive-deps`, 4 `no-unused-vars`, 1 unbenutzte Direktive) bekommt denselben
  Durchgang wie kp-rueck.

Zwei ehrliche Zahlen statt einer irreführenden. `--max-warnings` kann dann auf die Summe der
verbliebenen React-Compiler-Warnungen gesetzt werden, statt auf eine Zahl, die beides mischt.

## 4. Der Druckagent: dokumentiert, offen, schnell, verlässlich

Der Agent ist das einzige wirklich geteilte Stück zwischen den beiden Anwendungen und wird wie
ein Nebenprodukt behandelt.

### Der Fund, der beim Durchgehen dazukam: ein Fehldruck erreicht niemanden

`components/kanban/draggable-operation.tsx:164` meldet nach dem Auslösen
`toast.success('printJobSent')` — bestätigt also, dass der Auftrag **eingereiht** wurde, nicht
dass er gedruckt hat. Die Bedienerin liest «gesendet» und geht zum Drucker. Ist das Papier
leer, setzt der Agent den Auftrag auf `failed` mit `error_message` — und **nichts sagt es ihr**.
Dieser Zustand ist nur unter Einstellungen → Drucker sichtbar.

Das Datenmodell kann es also längst (`status`, `error_message`, der 90-Sekunden-Reaper); es
kommt nur nicht bei der Person an, die vor dem Drucker steht.

**Entschieden: dem Auftrag folgen und das Ergebnis melden.** Die «gesendet»-Meldung bleibt und
wird ersetzt, sobald der Auftrag `completed` oder `failed` erreicht — der WebSocket trägt
bereits andere Aktualisierungen, das ist derselbe Weg. «Papier leer» erfährt man dann in dem
Moment, in dem es zählt, statt es später als Lücke zu bemerken.

### Protokollversion

Das Protokoll hat **keine Version**. Kein Feld, keine Konstante, kein Pfadsegment, kein Header.
Verträglichkeit wird abgeleitet, indem gemessen wird, wie schnell eine 204 zurückkommt
(`protocols/front.py:60-63`). Nichts hätte den `job_type`-gegen-`kind`-Fehler auffallen lassen.

Zu tun: `protocol`-Ganzzahl in der Claim-Antwort, Mindestwert, den der Agent prüft.

### Wo der Agent lebt — entschieden: bleibt, bekommt aber eine eigene Version

Der Schmerz, den andere Stationen wirklich spüren, ist nicht der **Ort**, sondern die
**Version**. Niemand klont den Quelltext; man betreibt `ghcr.io/feuerwehr-oberwil/kp-print-agent`,
und der Name ist bereits neutral. Verwirrend ist, dass `kp-print-agent:0.3.0` nach kp-rueck
0.3.0 aussieht und über kp-front nichts aussagt. Ein Umzug behebt das nicht; eine eigene
Versionsnummer schon, und das ist die viel kleinere Änderung.

Gegen ein eigenes Repository spricht ausserdem, dass Protokolländerungen dadurch **schwerer**
würden — drei Repos statt zwei —, und dass kp-ruecks CI-Job `print-agent` wegfiele, der den
Agenten heute im selben Lauf gegen einen Stub des echten Draht-Vertrags prüft. Für ~1'000
Zeilen und einen Betreuer ist ein drittes CI- und Release-Verfahren ein schlechtes Geschäft.

**Auslöser zum Neubewerten** (nicht «irgendwann mal»): wenn tatsächlich jemand Drittes einen
Agenten gegen das Protokoll schreibt, oder wenn das Versionieren zeigt, dass beide Anwendungen
oft gleichzeitig geändert werden müssen. Beides wäre Beleg, dass die Kopplung real ist statt
theoretisch. Ohne Beleg ist das dritte Repo spekulativer Aufwand.

### Verlässlichkeit: drei Fälle, je ein Test

**Entschieden.** Angegeben und geprüft werden:

1. **Papier leer** — der Auftrag muss `failed` mit brauchbarer Meldung erreichen, nicht
   stillschweigend als erledigt gelten.
2. **Drucker nicht erreichbar** (Netzstecker, DHCP hat die Adresse neu vergeben) — heute die
   realistischste Störung, und der Grund, warum `10.10.10.230` eine Reservierung bekommen soll.
3. **Ein Auftrag, der den Agenten zum Absturz bringt** — er darf nicht in einer Schleife
   denselben Auftrag erneut ziehen und immer wieder sterben.

Heute beantworten das der 90-Sekunden-Reaper und `Restart=always`, und **geprüft ist es nie**.
Getestet wird gegen den Stub, so wie der Draht-Vertrag schon getestet wird; was sich nicht
ehrlich simulieren lässt (Papier leer), wird an der Station im Rahmen einer Übung geprüft.

### Dokumentation

- Die Draht-Verträge beider Seiten an **einer** Stelle, nicht in zwei READMEs. Wer einen
  eigenen Agenten schreibt — das ist ausdrücklich vorgesehen — braucht eine Quelle.
- `SUPPORT.md` sagt in **keinem** der beiden Repos, wo ein **Agenten**-Fehler zu melden ist.
  Er bedient beide und liegt in einem. Zwei Sätze.

## 5. Kleinere Grenzthemen

**Entschieden (2026-07-29):**

- **`Personnel.availability` → `status`.** Geprüft und bestätigt: die drei Felder sind
  dasselbe Konzept mit demselben Wertebereich. `Vehicle.status`, `Material.status` und
  `Personnel.availability` bedeuten alle «im Dienst / nicht im Dienst» — die *Zuteilung* läuft
  bei allen dreien über `incident_assignments` und fasst das Basisfeld nicht an
  (`crud/assignments.py:90`). Personal ist also grundlos das einzige mit einem anderen Namen.
  Kostet eine Migration, `schemas/personnel.py` und einen openapi-Durchgang; das Frontend
  bildet das Feld ohnehin schon ab (`personnel-context.tsx:51`), also ändern sich dort keine
  Aufrufstellen.

  Beim Umsetzen mitnehmen: derselbe Cast castet heute nach `PersonStatus`
  (`"available" | "assigned"`) — ein anderer Wertebereich. Solange `unavailable` die Tafel
  nie erreicht (siehe §1 in plan 17), ist das folgenlos, aber es gehört beim Anfassen
  geradegezogen statt mitgeschleppt.

- **Auf `pyjwt` zusammenführen.** `python-jose` liegt auf dem Hauptpfad der Anmeldung
  (`auth/security.py`, `auth/dependencies.py`, `api/auth.py`) und wird faktisch nicht mehr
  gepflegt; `pyjwt` ist ohnehin deklariert und leistet echte Arbeit (`services/tokens.py`,
  `services/microsoft_auth.py`). Der Pin liegt hinter den CVE-Korrekturen von 2024, es ist
  also keine offene Lücke — aber zwei JWT-Stapel in einer Auth-Fläche ist das, was ein
  sicherheitsbewusster Leser als Erstes anmerkt. Die Encode/Decode-Fläche ist klein, der
  Wechsel mechanisch.

**Unverändert, klein:**

- **kp-rueck meldet Abstürze an `ingest.kp-front.ch`** — ein Host, der nach dem anderen Produkt
  heisst, dessen Ingest-Stack nur in kp-fronts Repo liegt. Funktioniert; liest sich wie eine
  Abhängigkeit vom Geschwisterprojekt. Neutraler Name beim nächsten Anfassen.
- **`VITE_KP_RUECK_URL` in kp-front** zeigt in allen sieben Verwendungen auf kp-fronts
  **eigenes** Backend; mehrere Kommentare dementieren den Namen ausdrücklich. In Produktion ist
  die Variable ausserdem tot (kein `ARG` im Dockerfile, sie wird immer zu `''`). Umbenennen auf
  `VITE_BACKEND_URL` ändert an keinem Deployment etwas.
- **Ein Glossar fehlt**, und diese Lücke kostet jemanden einen Tag, wenn sie zubeisst:
  «Checkliste» heisst in kp-rueck ein zustandsbehafteter Aufgabenzettel und in kp-front eine
  schreibgeschützte Dokumentensammlung. `audit_log` (kp-rueck) und `journal_entries`
  (kp-front) sind **nicht** dasselbe: kp-rücks Einsatztagebuch wird beim PDF-Export
  **synthetisiert** und existiert als Tabelle gar nicht, kp-fronts Verlauf ist eine echte
  Tabelle von Hand getippter Einträge. Wer Export-Code zwischen den Repos vereinheitlicht,
  verliert kp-fronts Zeilen still.

## 6. Die Umbenennung — jetzt richtig herum

Das Frontend von kp-rueck nennt einen Einsatz `Operation`. Datenbank, Modell, API-Pfad und die
deutsche Oberfläche sagen übereinstimmend `incidents`/`Incident`/`Einsatz`; nur die
TypeScript-Schicht weicht ab.

Die Gefahr daran war nie der Name, sondern die dreifache Übersetzungstabelle — **die ist seit
dem 2026-07-29 weg** (`lib/incident-status.ts`). Damit ist die reine Frontend-Umbenennung
kosmetisch geworden.

**Entschieden: nicht das Frontend umbenennen, sondern die API auf englische Bezeichner
umstellen.** Das ist die Variante, die etwas einbringt statt nur Zeilen zu verschieben:

- `incidents.status` führt heute `eingegangen | reko | reko_done | disponiert | einsatz |
  einsatz_beendet | abschluss`. Englisch wären es `incoming | ready | reko_done | dispatched |
  active | returning | complete` — wobei `reko` und `reko_done` bleiben, weil Reko
  Fachvokabular ist wie Atemschutz, kein deutsches Wort für etwas Englisches.
- Danach fällt `lib/incident-status.ts` **ersatzlos** weg, und der Grundsatz «Code englisch,
  Oberfläche über i18n» gilt durchgehend statt nur zur Hälfte.
- Die Oberfläche ändert sich dabei nicht um ein Zeichen: die sichtbaren Bezeichnungen kommen
  aus `de.json` und sind vom Bezeichner unabhängig.

Kosten: eine Migration (mit Übersetzung der Bestandsdaten), eine Vertragsänderung, ein
openapi-Durchgang, und `STATUS_LABELS` / `STATUS_TO_GROUP` in `lib/types/incidents.ts` ziehen
mit. Dazu die offene Merkwürdigkeit aus dem Bridge-Kommentar: `reko → ready`. Eine Reko ist
ein laufender Auftrag, keine Bereitschaft — beim Umstellen ist der Moment, das geradezuziehen,
statt die Fehlübersetzung in die neue Welt mitzunehmen.

**Reihenfolge:** nach plan 06 (i18n) wäre falsch — die Bezeichner sind unabhängig von den
Übersetzungen, und je später, desto mehr Aufrufstellen. Aber auch nicht vor §3 (Linting), weil
eine grosse Umbenennung in einem Repo mit 192 Warnungen jede Prüfung unlesbar macht.
