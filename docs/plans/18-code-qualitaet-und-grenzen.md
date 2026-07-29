# Plan 18 – Code-Qualität und die Grenze zu KP Front

**Status:** offen. Entstanden aus der Durchsicht vor der Veröffentlichung (2026-07-29). Was
dabei an Qualitäts- und Grenzthemen auffiel und nicht sofort behoben wurde, steht hier.

**Bereits erledigt** (Kontext, nicht mehr Teil dieses Plans):

- Die dreifache Status-Übersetzungstabelle auf eine reduziert — `lib/incident-status.ts`
- `bcrypt` direkt deklariert, `passlib` entfernt — `backend/pyproject.toml`
- Der Draht-Fehler im Druckagenten (`job_type` gegen `kind`) — `protocols/front.py`

---

## 1. Toter Code: erst suchen, dann entfernen (**als Nächstes**)

Auslöser war ein konkreter Fund, aber die Lehre ist allgemeiner — es lohnt sich, systematisch
zu suchen, statt einzeln zu stolpern.

**Der Fund:** `lib/api-client.ts:7` und `app/divera-pool/page.tsx:34` rufen an sieben Stellen
das alte Radix-`toast()` auf. Dessen Renderer (`components/ui/toaster.tsx`) wird **nirgends
eingehängt** — im Baum steht nur der von sonner
(`components/notifications/notification-toasts.tsx:176`). 63 Dateien nutzen sonner, vier den
alten Weg. Die zentrale Fehlermeldung des API-Clients ist damit stumm. Dazu sind
`hooks/use-toast.ts` und `components/ui/use-toast.ts` bytegleiche Duplikate.

**Was ausserdem schon bekannt ist:**

- ~4'100 Zeilen Frontend, die kein Import je erreicht: grösstenteils ungenutztes
  shadcn-Gerüst (`ui/sidebar.tsx` 726 Zeilen, `ui/chart.tsx` 353, `ui/menubar.tsx` 280 …),
  aber auch handgeschriebenes: `components/auth/protected-button.tsx`,
  `components/kanban/mobile-operation-actions.tsx`, `components/sync/navbar-sync-indicator.tsx`,
  `lib/hooks/use-permissions.ts`, `lib/utils/logger.ts`.
- Die Abhängigkeiten, die nur dieses tote Gerüst tragen: `embla-carousel-react`, `input-otp`,
  `react-day-picker`, `recharts`, `react-resizable-panels`, `vaul`, dazu sieben
  `@radix-ui/react-*`. Plus zwei echte Leichen: `tailwindcss-animate` (globals.css lädt
  `tw-animate-css`) und `autoprefixer` (postcss lädt nur `@tailwindcss/postcss`).
- kp-front: `backend/app/demo_export.py` erreicht kein Import; zwei verschiedene
  `EmptyState`-Komponenten mit unvereinbaren Props; der Endpunkt
  `/incidents/{id}/people` scheint überhaupt keinen Aufrufer im Frontend zu haben (erst
  prüfen, dann Tabelle, Modell, Schema und Router zusammen entfernen).

**Vorgehen:** erst eine Bestandsaufnahme über beide Repos, dann entfernen — und die Frage
beantworten, ob ungenutztes shadcn-Gerüst bleibt (es ist billig und wird vielleicht gebraucht)
oder geht (es ist das Erste, was ein fremder Leser greppt).

## 2. Die kopierte Telemetrie-Prüfung greift nicht (**als Nächstes**)

`backend/tests/test_telemetry_vendored.py` heisst `test_vendored_file_matches_kp_front` und
liest **nichts** aus kp-front. Es vergleicht die lokale Datei mit einer einprogrammierten
Prüfsumme. Wer `scrub.py` in einem Repo ändert und dort die Prüfsumme nachzieht, lässt **beide
Testläufe grün**, während die zwei Bereinigungsroutinen auseinanderlaufen — genau das Szenario,
das der eigene Docstring «die eine Stelle, an der Drift wirklich gefährlich ist» nennt.

Heute sind die fünf Dateien identisch (per md5 geprüft). Der Lauf einer Seite sollte die
andere auschecken und die Dateien vergleichen.

Dasselbe gilt schwächer für `RESERVED_ALARM_SOURCES`, das in beiden Repos wörtlich doppelt
steht und nur durch einen Kommentar zusammengehalten wird.

## 3. Linting auf null

`pnpm lint` steht in beiden Repos als **blockierender** Schritt in der CI und kann nicht
fehlschlagen: `"lint": "eslint ."` ohne `--max-warnings`. kp-rueck läuft mit 200 Warnungen
durch, kp-front mit 221.

Das widerspricht der Linie, die kp-rueck sich selbst gibt (`ci.yml:29` — «a check that is
always red teaches people to ignore red»), und ein Leser, der so weit kommt, merkt es.

**Entscheid: nicht einfrieren, sondern abbauen.** Gründliche Durchgänge, bis die Zahl null
ist, dann `--max-warnings=0` und der Schritt blockiert wirklich.

Die Verteilung ist bekannt und macht das machbar:

- kp-rueck (200): 85 `no-unused-vars`, 51 `no-explicit-any`, 44 `exhaustive-deps`,
  17 `no-console`, 2 `no-img-element`, 1 `rules-of-hooks`. Schwerpunkt
  `app/help/page.tsx` (21), `tests/helpers/api.helper.ts` (11), `app/page.tsx` (6).
- kp-front (221): 47 `set-state-in-effect`, 43 `only-export-components`, 39 `refs`,
  37 `no-explicit-any`, 23 `purity`, 13 `exhaustive-deps`. Schwerpunkt `MapView.tsx` (29),
  `Whiteboard.tsx` (21), `IncidentWorkspace.tsx` (20), `useMapCanvasGestures.ts` (17).

Achtung: die React-Compiler-Regeln in kp-front sind in `eslint.config.js:29-34` bewusst auf
«Warnung» gesetzt, mit Verweis auf einen benannten Refactor. Diese Gruppe zuerst entscheiden,
nicht blind wegräumen.

Nebenbei: 14 unbedingte `console.log` in kp-rueck landen in der Konsole jeder Produktion
(`lib/websocket-client.ts` 10, `lib/contexts/auth-context.tsx` 4, letztere erzählen den
Token-Ablauf). `app/backend-api/[...path]/route.ts:17` macht es richtig — hinter
`PROXY_DEBUG`, mit Begründung.

## 4. Der Druckagent: dokumentiert, offen, schnell, verlässlich

Der Agent ist das einzige wirklich geteilte Stück zwischen den beiden Anwendungen, und er wird
wie ein Nebenprodukt behandelt.

**Der harte Teil zuerst:** das Protokoll hat **keine Version**. Kein Feld, keine Konstante,
kein Pfadsegment, kein Header. Verträglichkeit wird abgeleitet, indem gemessen wird, wie
schnell eine 204 zurückkommt (`protocols/front.py:60-63`). Nichts hätte den `job_type`-gegen-
`kind`-Fehler auffallen lassen, und eine Station, die `kp-print-agent:0.3.0` zieht, pinnt eine
kp-rueck-Versionsnummer, die über kp-front-Verträglichkeit nichts aussagt.

**Zu tun:**

- `protocol`-Ganzzahl in der Claim-Antwort, Mindestwert, den der Agent prüft.
- Version des Agenten von `KP_RUECK_TAG` lösen — er läuft schon unter dem neutralen Namen
  `kp-print-agent`, also soll er auch eine neutrale Version tragen.
- Die Wire-Verträge beider Seiten an einer Stelle dokumentieren, nicht in zwei READMEs.
  Wer einen eigenen Agenten schreibt (das ist ausdrücklich vorgesehen), soll eine Quelle haben.
- `SUPPORT.md` sagt in keinem der beiden Repos, wo ein **Agenten**-Fehler zu melden ist. Er
  bedient beide und liegt in einem.
- Die Verlässlichkeit selbst: was passiert bei Papierende, bei abgezogenem Netzstecker des
  Druckers, bei einem Auftrag, der den Agenten abstürzen lässt? Heute beantwortet das der
  90-Sekunden-Reaper und `Restart=always`; ob das reicht, ist ungeprüft.

## 5. Kleinere Grenzthemen

- **kp-rueck meldet Abstürze an `ingest.kp-front.ch`** — ein Host, der nach dem anderen
  Produkt heisst, dessen Ingest-Stack nur in kp-fronts Repo liegt. Funktioniert, liest sich
  aber wie eine Abhängigkeit vom Geschwisterprojekt. Ein neutraler Name beim nächsten Anfassen.
- **`VITE_KP_RUECK_URL` in kp-front** zeigt auf kp-fronts **eigenes** Backend, in allen sieben
  Verwendungen; mehrere Kommentare dementieren den Namen ausdrücklich. In Produktion ist die
  Variable ausserdem tot (kein `ARG` im Dockerfile, sie wird immer zu `''`). Umbenennen auf
  `VITE_BACKEND_URL` ändert an keinem Deployment etwas.
- **`Personnel.availability` gegen `Vehicle.status`/`Material.status`.** Dasselbe
  Zwei-Werte-Feld, bei Personal anders benannt. Umbenennen kostet eine Migration und einen
  openapi-Durchgang; das Frontend bildet es ohnehin schon ab.
- **Zwei JWT-Bibliotheken.** `python-jose` UND `pyjwt` sind deklariert und beide im Einsatz;
  der Hauptpfad der Anmeldung läuft über jose, das faktisch nicht mehr gepflegt wird. Der Pin
  liegt hinter den CVE-Korrekturen von 2024, es ist also keine offene Lücke — aber zwei
  JWT-Stapel in einer Auth-Fläche ist das, was ein sicherheitsbewusster Leser sofort anmerkt.
- **Ein Glossar fehlt.** «Checkliste» heisst in kp-rueck ein zustandsbehafteter Aufgabenzettel
  und in kp-front eine schreibgeschützte Dokumentensammlung. `audit_log` (kp-rueck) und
  `journal_entries` (kp-front) sind nicht dasselbe: kp-rücks Einsatztagebuch wird beim
  PDF-Export **synthetisiert**, kp-fronts Verlauf ist eine echte Tabelle von Hand getippter
  Einträge. Wer Export-Code zwischen den Repos vereinheitlicht, verliert kp-fronts Zeilen
  still. Das gehört aufgeschrieben, bevor es jemand tut.

## 6. Grosse Umbenennung, bewusst zurückgestellt

Das Frontend von kp-rueck nennt einen Einsatz `Operation`. Datenbank, Modell, API-Pfad und die
deutsche Oberfläche sagen übereinstimmend `incidents`/`Incident`/`Einsatz`; nur die
TypeScript-Schicht weicht ab (`lib/contexts/operations-context.tsx`, 2'108 Zeilen, von ~90
Dateien importiert).

Die Gefahr daran war nie der Name, sondern die dreifache Übersetzungstabelle — und die ist
weg. Damit ist die Umbenennung optional geworden: gross, ohne Vertragsänderung, und sie kann
warten, bis sie ohnehin jemand anfasst.

**Die interessantere Variante:** die API auf englische Bezeichner umstellen
(`eingegangen` → `incoming`), dann fällt `lib/incident-status.ts` ersatzlos weg und der
Grundsatz «Code englisch, Oberfläche über i18n» gilt durchgehend. Kostet eine Migration, eine
Vertragsänderung und einen openapi-Durchgang.
