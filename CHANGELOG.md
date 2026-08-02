# Changelog

All notable changes to KP Rück are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**What the version number means for a deployment** – KP Rück is a self-hosted app, not a
library, so the number answers one question: *how much attention does this update need?*

| Bump | What it means for you |
| --- | --- |
| **MAJOR** | Operator action required – a breaking config change, a migration that can't be rolled back, a new mandatory env var, a Postgres major. Read the notes before updating. |
| **MINOR** | New features. Migrations run automatically on boot; `docker compose pull && docker compose up -d` is enough. |
| **PATCH** | Fixes only. Always safe to take. |

All four images (backend, frontend, tileserver, print-agent) are released **together** under one
version – a station runs the set, not a mix. Prod and the demo deploy continuously from `main`,
so every published image has already been carrying live operations at Feuerwehr Oberwil before
it was tagged.

**Why still 0.x?** Because exactly one fire station runs this in production, and a 1.0 claims
more than that. It becomes **1.0 when a second station is running it in the field** – not when
the feature list feels complete. Until then, read 0.x as *"not yet proven anywhere but
Oberwil"*, **not** as *"we may break things without warning"*: the table above holds today and
will keep holding.

`0.1.0` is the initial published release; the running history before it is in the git log.

## [Unreleased]

### Changed
- **The Divera keyword list existed twice in the estate and nothing compared the copies.** The map
  from an alert's Stichwort to an incident category, and the keyword list deciding which alerts are
  high priority, were written independently here and in KP Front – the same 19 title keywords, same
  order, same casing, arrived at twice – and had already begun to drift: this side knew `GASLECK`,
  the other did not. Both now read one checked-in data file, `backend/app/data/divera_keywords.json`,
  vendored byte-for-byte into both products with a checksum pinned on each side, plus a new
  **`divera-keyword-drift`** CI job here that diffs the file against KP Front's default branch.

  That job is the load-bearing half and it is worth being precise about why. The checksum test
  catches an accidental edit *on this side*; it never reads the other repository, so editing both
  copies and updating both hashes leaves everything green. Only the drift job compares the two
  checkouts – exactly the split the telemetry sanitiser already uses, and the reason both are kept.
  A shared package was the obvious alternative and was rejected: `RUNNING-BOTH.md` promises
  self-hosters separate databases, separate images, separate releases, no shared library and no
  runtime coupling. That promise is published. A test that catches drift keeps it; a library that
  removes the duplication would break it.

  **Behaviour is unchanged** – the resulting maps are character-for-character what they were, order
  included. Two things deliberately stayed out of the shared file and are named in it rather than
  quietly unified: the **display labels**, because this app stores keys while KP Front stores German
  strings in the database and the two disagree on a capital letter, and the **matching rule**,
  because this app requires word boundaries on short keywords like `GAS`, `VU` and `LIFT` where KP
  Front matches substrings. Word boundaries stop `GAS` firing on *Gasse* – and also stop it firing
  on *Gasflasche*. Neither behaviour is unambiguously right, it decides which alerts come out high
  priority, and it is not a call to make unilaterally on the alerting path, so it is recorded in the
  shared file as a known divergence.

## [0.4.0] – 2026-08-01

Two threads. A review pass before publishing the repository more widely – the documentation checked
claim by claim against the code, four things promises the code did not keep. And a resiliency sweep
whose findings share one shape: the capability was built, it just did not engage by itself. Several
of the entries below are things that would have failed quietly, during an incident, with nobody
watching.

**Read this one before updating:** the incident status identifiers are now English and the board no
longer translates them (see *Changed*). Any script of yours that reads the API sees new values.

### Fixed
- **Two agents could print the same slip.** The claim was a read-then-write: `SELECT`, status check
  in Python, then assignment. Both agents passed the check, both printed. What prevented it until
  now was the prose rule "never run two agents" – and compose ships a second agent behind a
  `printing` profile, so the rule sat one flag away from being broken. It is now a conditional
  `UPDATE` with the status in the `WHERE` clause: atomic, and the loser gets a 409. This also
  brought the repository's first real concurrency tests; `asyncio.gather` had appeared exactly zero
  times in either suite. Against the old logic the five-agent case reports `[1, 1, 0, 0, 0]` – two
  winners, the same slip twice. The two-agent case stayed green throughout, which is a good
  explanation of why this went undetected for so long.
- **Six settings could not be saved, among them the offline-map switch.** `api/settings.py` checks
  every key against `DEFAULT_SETTINGS`, and `home_city`, `map_mode`, `map_style` and the three
  `firestation_*` values were not in it. The seed writes them, the frontend reads them in seven
  places, the settings page renders inputs for them – and every save answered 404 behind a generic
  "Speichern fehlgeschlagen". Among them `map_mode`: the control that exists for the internet
  outage. A contract break between two lists that five lines of test would have caught; those lines
  now exist, and they read the frontend source rather than a copied list, because a copy drifts
  exactly like the thing it is meant to secure.
- **Safari never saw "Verbindung verloren", and "Gedruckt" was a guess.** Three places where the
  client asserted something it did not know. Network errors were detected by *text*:
  `error.message.includes('fetch')` only matches Chrome's "Failed to fetch", so on Safari every
  offline request fell through to the generic re-throw – around 85 read sites silently changed
  contract depending on the browser. There was also no timeout: a dead-but-open TCP connection never
  rejects on its own, and one hanging GET was enough to wedge the polling loop permanently, leaving
  the board simply standing still. Now 20 s, chosen generously – a command post on a saturated
  uplink is slow but worth waiting for. And "gedruckt" only ever meant the bytes were in the socket:
  a TM-T20III with no paper accepts a short slip into its buffer, the write closes cleanly, the
  agent reports `completed` and the toast turns green with no paper in existence. The most likely
  printer fault is the one that reports success. Until the agent queries real paper status it reads
  "An Drucker gesendet". Thermal path only – kp-front's CUPS side knows real job status and keeps
  its wording.
- **The token displays showed hours-old situations as current.** `/display/status` and
  `/display/map` swallowed every fetch error with a bare `catch {}` and then re-rendered the last
  answer indefinitely. A backend that starts throwing 500s at 02:10 produces a display at 04:00 that
  looks entirely normal. On a screen nobody is standing in front of, that is the most dangerous
  thing this application can do – more dangerous than a crash, which is at least visible. Worse, the
  connection indicator polled an authenticated endpoint, so a token display never had a session, the
  call failed every time, and the icon sat permanently on red: the only warning these screens had
  was crying wolf. Escalation is now staged – quiet under 30 s, a restrained bar after that,
  unmissable from two minutes – and the content stays visible at every stage, because during an
  outage the frozen picture is still the best information in the room.
- **The audit log, photo uploads and the print queue were all unbounded.** The middleware logged
  every successful `/api/` call including GETs, and the board polls roughly every 5 s per client:
  two idle wall displays alone came to something like a gigabyte a year, a storm at ~90 req/s to
  several gigabytes a day, against a retention setting that reads "forever" – and on a station box
  the database shares that disk. Only mutations are logged now; the proof the log exists for is
  intact, what is given up is "who *looked* at what". Photos were read fully into memory *before*
  the size check, and `_validate_file_type` called a complete decode before anyone looked at the
  dimensions, so a legal 1.2 MB PNG declaring 20000×20000 pixels expanded to ~1.6 GB against a 1 GB
  limit. Dimensions are now checked after the header parse and before decoding. And print jobs never
  expired, so after a two-hour printer outage the agent emptied the entire queue at once – slips for
  long-closed incidents competing for paper with the incident still running. Board snapshots expire
  after 15 min, incident slips after 60; test prints never, because somebody is standing at the
  printer and a late arrival is itself the diagnosis. Expired jobs are marked `expired`, not
  deleted: "this was never printed" belongs in the record.
- **100 incidents per Lage was an invisible ceiling.** `GET /api/incidents` capped at 100 and no
  production caller passes a limit – not the board, the detail view, the context or the viewer path.
  At 200 incidents, 100 were arbitrarily invisible with no banner, no number, no hint of any kind; a
  bare array looks identical whether it is complete or truncated. And that is precisely the storm
  scenario this software exists for. The default is now 500 (the *maximum* stays at 500, a tested
  safety bound – the bug was the default everyone gets, not the ceiling nobody touches), and
  `X-Total-Count` reports the total before skip/limit so the board can say "Es werden X von Y
  Einsätzen angezeigt". Making the limit visible matters more than making it higher.
- **The backup could be switched off, and `just clean` deleted everything.** Three gaps of the same
  shape. The backup sidecar hangs off the compose profile `backup`, which has to be passed on every
  invocation – but `just stop` runs a plain `down` and the documented update path is a plain
  `docker compose up -d`, so both leave the sidecar uncreated, and a container that does not exist
  cannot report itself `unhealthy`. The one signal that backups are running was missing exactly when
  they were not. `COMPOSE_PROFILES=backup` in the `.env` takes the remembering out of the loop.
  `just clean` dropped the database and photos without asking, in dev and production alike,
  advertised as "removes volumes" which reads like clearing caches; it now requires typing `delete`.
  And nothing told anyone about an outage: `/health` does a real `SELECT 1` and answers 503, and
  Caddy already published it – built, but never mentioned to anybody. `DEPLOYMENT.md` §7 now does.
- **`X-Total-Count` was invisible to JavaScript, and two warnings rendered on top of each other.**
  CORS hides any non-safelisted response header unless it is named in
  `Access-Control-Expose-Headers`, so the truncation banner above could never appear on a
  split-origin deployment – which is exactly what a developer runs locally. Separately the staleness
  banner on `/display/map` was absolutely positioned over the map's own "N Einsätze ohne gültige
  Koordinaten" chip: two warnings rendered into each other, less legible than either alone.
- **The export error appeared in English while the German message sat dead beside it.**
  `err instanceof Error ? err.message : t('page.reportExportFailed')` looks like a fallback but is
  not one – `apiClient` always throws an `Error`, so the second branch never ran, and the operator
  got raw backend text in an otherwise German interface. The German message is now the title and the
  technical cause the description. Same for the audit export.
- **The Einsatzzettel carried the print time rather than its own.** The agent has stamped
  `printed_at` into the footer since the resiliency batch, so a slip that sat behind a dead printer
  cannot claim to be current – but the value was only set for board, test and QR jobs. The
  most-printed document of all, and the one with the longest TTL, fell through to `datetime.now()`
  in the agent: back into the exact error the stamp exists to prevent. `AUSFALL_SOP.md` leans on that
  footer to judge how current the paper picture is.
- **`updated_at` on settings came from two clocks.** Postgres stamped it on INSERT
  (`server_default=func.now()`), the service set it from Python on UPDATE. If the database runs in a
  container or on a managed host, the application clock lags and a changed setting lands *before*
  its own creation. It surfaced as test flake – failing five times out of five in isolation, almost
  never in a full run, because there the gap is wide enough to cover the drift. `onupdate` now
  handles it, using `clock_timestamp()` rather than `now()`: the latter is the transaction start
  time, so a row created and changed in one transaction would have kept its old stamp.
- **The demo banner kept the demo awake, and the proxy added a redirect to every call.** Two
  findings from the Railway cost analysis. The banner polled `/api/demo/status` every 30 seconds
  even in a tab nobody had looked at for hours – on its own enough that the demo backend and its
  database never went to sleep: 739,000 requests in 30 days. It now polls only while the tab is
  visible, and fetches immediately on return so the countdown is never stale. And the proxy appended
  a trailing slash to every path, while only 76 of 346 backend routes are declared with one: for the
  other 270 that cost a guaranteed 307 plus a second request on every single call.
- **An expired simulation drive sometimes disappeared only internally.**
- **The image-size guard no longer reads Pillow's mutable global.** `Image.MAX_IMAGE_PIXELS` is set
  at import and was read back at the two check sites – but any other import can reassign it, `None`
  included, which disables the decompression-bomb guard outright. The checks now compare against an
  own constant; Pillow's copy is kept in step so its own warning fires at the same threshold.
- **The telemetry veto in `PRIVACY.md` did nothing.** The page tells an operator to put
  `KP_TELEMETRY_ENABLED=0` in their compose file and promises it "outranks the settings page, so
  no later click can turn it on". `Settings` has no `env_prefix`, so the field actually bound to
  `TELEMETRY_ENABLED` and the documented `KP_` spelling matched nothing at all. Consent still
  defaults to off in the database, so nothing was ever transmitted — but a station that had
  *enforced* the ban per the documentation had enforced nothing. Both spellings are now accepted
  and `test_telemetry_env_veto.py` pins them.
- **A logout did not survive a restart.** The JWT blocklist was a process-local dict, so every
  revoked token silently became valid again on the next `docker compose up -d`, and a second
  instance never saw the revocation at all. It now lives in the `revoked_tokens` table, ported
  from KP Front where the same defect was fixed first. Migration runs automatically.
- **The print agent read the wrong field for KP Front jobs.** `protocols/front.py` asked for
  `job_type`, which is KP *Rück's* column name; KP Front sends `kind`. Every job therefore
  arrived as a generic `document` and its real kind was lost. Harmless so far only because the
  CUPS output that serves KP Front ignores the field — fixed before that stopped being true.
- **Commands from the README failed on a normal Linux host.** `just dev` — the first command a
  newcomer runs — called `docker-compose` (the v1 binary), which a box installed per Docker's own
  instructions does not have. `just stop` aborted on the production compose file's guards before
  it got round to stopping the dev stack. The offline-tile scripts hardcoded the *development*
  container name, so `just tiles-download` greeted production operators with "run `just dev`
  first" and `just tiles-status` reported a healthy stack as not running. Dependabot watched
  `/print-agent`, a path that has not existed since the agent moved to `tools/`, leaving the one
  component a station actually runs unmonitored.
- **The print agent could not be started from this repository.** `tools/print-agent`
  declared `requires-python = ">=3.9"` — which is real, and load-bearing: the bare-Raspberry-Pi
  CUPS install runs on Bullseye's system Python — while also pinning `pillow>=12.2.0`, which
  dropped 3.9. The two contradict each other, so every resolve failed and `just printer` died
  before it started. The ESC/POS extra now carries a `python_version >= '3.10'` marker: the
  security floor stays, and 3.9 keeps the path that needs no extra at all. `just printer` also
  set no `BACKEND_URL` (the agent refuses to guess one) and no token, so on a good day it
  would have stopped at the fail-closed 403 — both are now wired to the dev defaults, and it
  runs with `--extra escpos`, without which it would have authenticated, claimed a job and
  only *then* failed on the lazy import.
- **The QR slip printed a quarter-width code and a transliterated umlaut.** Found on paper at
  the station, not in a test. The code was fixed at 4 dots per module, justified in a comment
  as keeping a long JWT-bearing URL "within the paper width" — measured on the real printer,
  such a link comes to 49 modules, or 204 of 576 available dots. It was never near the limit,
  just small. The size is now fitted to the content and clamped at both ends, so a bare URL
  cannot eat the roll and absurd content still prints something scannable. The target is a
  judgement made on paper, not the maximum that fits: filling all 576 dots was tried at the
  station and read as a poster rather than as a slip, so it aims at ~50 mm — the measured
  check-in link goes from 204 dots (~26 mm) to 408 (~51 mm). The sizing sits in the stdlib `core` rather
  than in `formatters`, which imports escpos — so CI's bare-Python job can test it. And the
  slip said "Scannen zum Oeffnen" although the codepage is CP437, which has `Ö`, and the same
  file already prints `ÖLWEHR` and `EINSÄTZE`.
- **The dev compose stack could not print either.** Its print-agent had no `AGENT_TOKEN` and
  the backend no `PRINT_AGENT_TOKEN`, which is a 403 by design; and it still passed
  `POLL_INTERVAL`, the dead variable no version of the agent has ever read.
- **A split-origin deployment on a custom domain lost real-time updates without saying so.**
  The browser worked out where to open its WebSocket from build-time variables and, failing
  those, from the page's own hostname: `X.up.railway.app` → `X-api.up.railway.app`, and
  same-origin for anything else. Same-origin is right behind Caddy and wrong on Railway, where
  the frontend and the backend are two hosts — so a Railway install on a custom domain connected
  to nothing, fell back to polling every five seconds, and reported no error at all. The server
  now hands the browser its runtime `API_URL` — the same variable the `/backend-api` proxy
  already uses — and that outranks every guess, so a domain name no longer decides whether the
  board is live. An `API_URL` the browser cannot reach (`http://backend:8000` on the compose
  stack, `*.railway.internal`) is withheld deliberately, leaving that path exactly as it was.
  `NEXT_PUBLIC_WS_URL` still works and is now an override nobody needs.
- **…and then the browser's own security policy refused the connection anyway.** Aiming the
  socket at the right host only helps if the page is allowed to open it. The
  Content-Security-Policy was assembled in `next.config.mjs`, which Next writes into the image
  during the build, so its `connect-src` could name only what was known on the build machine —
  the app's own origin, `localhost`, `*.railway.app`, and whatever `NEXT_PUBLIC_API_URL` said.
  The published images are built without that variable on purpose, so a station with its backend
  on a custom domain got a correctly aimed socket and a blocked one. The policy is now composed
  per request in `frontend/middleware.ts` from the runtime `API_URL`, and it names both that
  origin and its `wss://` counterpart. Nothing was widened to achieve it — no `connect-src *`,
  no blanket `wss:` — and an address the browser cannot reach is withheld by the same filter the
  WebSocket uses, so the compose stack's `http://backend:8000` never enters the header.
  `NEXT_PUBLIC_WS_URL` now reaches the policy too; it never did before, which is why setting it
  alone could not have fixed this either.

### Added
- **A failed print now reaches the person walking to the printer.** "Druckauftrag gesendet" only
  ever confirmed that a slip had been queued. If the paper was out, the agent marked the job
  `failed` with an `error_message` that lived under Einstellungen → Drucker and nowhere else – so
  the operator read "gesendet", walked over, and found nothing. The agent now reports the outcome
  back and the toast on the board changes to say what actually became of the job, with a printer
  that is simply unreachable reading differently from paper out.
- **The backup is now scheduled, verified and provably restorable.** Until today the only thing
  standing between a station and a lost operational record was somebody remembering to type
  `scripts/backup.sh` — no schedule, no retention beyond a flat 14 files, and no evidence that
  any of those files could be restored. Now: an opt-in compose sidecar
  (`docker compose --profile backup up -d`) takes the Postgres dump **and** the Reko photo volume
  nightly into a host directory, keeping **14 dailies and 8 weeklies** — two series because they
  answer two different questions (undo last night vs. somebody imported the wrong roster five
  weeks ago). Dumps are `-Fc` custom format, so `pg_restore` can list them and pull single tables
  out, and every one is read back with `pg_restore --list` before it counts as taken.
  `scripts/restore.sh` is the other half; it refuses to merge into a database that still has
  tables. A weekly `restore-drill` CI job runs the whole cycle — seed, dump, restore into a
  fresh empty database, diff the row counts and real values, migrate the result forward — so
  "has anyone ever restored one of these?" has a standing answer.
- **The failure modes are loud.** A backup that can silently do nothing is worse than none, so an
  unwritable directory, an unreachable database, a zero-byte or unreadable dump, or a missing
  photo volume each abort with a distinct exit code, a `BACKUP-FAILED` marker, a
  `"status": "failed"` in `last-backup.json`, and a failing container healthcheck —
  `docker compose ps backup` says `unhealthy` when last night did not work. Retention never runs
  after a failure and never deletes the last remaining copy.
- **A snapshot is taken before every migration.** `start.sh` ran `alembic upgrade head` on boot
  with nothing captured first; a failed migration ended the container, `restart: unless-stopped`
  replaced it, and the previous state was already gone. It now dumps first whenever a migration
  is actually pending (newest 5 kept, on a named volume so a container recreation cannot take
  them with it). Deliberately best-effort: if it cannot dump it warns unmistakably and boots
  anyway, because a board that is down is worse than a migration without a snapshot.

### Changed
- **Under the hood: the test suite was repaired, sped up, and the typing gate widened.** A run of
  end-to-end specs had drifted into asserting things that no longer existed – Tailwind class names
  instead of behaviour, a check-in widget that is not in the product, a local suite that could not
  even log in. They now test what the interface actually does. Backend tests moved off a single
  worker (1,881 of them were eight of twelve CI minutes), `app/services` went from 183 mypy errors
  to zero and moved into the blocking gate, and the nightly suite's own configuration was fixed:
  it had been failing on a missing `VIEWER_PASSWORD` and a missing `PRINT_AGENT_TOKEN`, reported
  under a spec name that had in fact already been repaired.
- **The backend image pins the PostgreSQL client to 17.** Debian bookworm's `postgresql-client`
  is version 15, and `pg_dump` 15 refuses outright to dump the 17.x server production runs
  ("aborting because of server version mismatch") — which would have made the new pre-migration
  snapshot fail exactly when it mattered. The client now comes from PGDG, pinned by
  `PG_CLIENT_MAJOR`, one major ahead of the compose database and level with production. The
  backup scripts additionally compare the two versions themselves and stop with the remedy
  spelled out, because the *server* is what a station can upgrade without touching this image.
  Note for self-hosters: `docker-compose.yml` still pins `postgres:16` — a 16 data volume cannot
  be read by a 17 server, so that move stays a deliberate, documented one.
- **The incident status identifiers are English, and the board no longer translates them.**
  The database and API said `eingegangen … abschluss` while the board said `incoming …
  complete`, so a translation table sat between them — and a status renamed in one place and
  not the other would have desynced the board silently, during an Einsatz. They are now one
  vocabulary: `incoming`, `reko`, `reko_done`, `enroute`, `active`, `returning`, `complete`.
  `reko` stays `reko` because a Reko is a running assignment, not a state of readiness.
  **Nothing on screen changes** — the German an operator reads has always come from the
  translation catalogue — with one deliberate exception: the vehicle overview now says
  «Rückfahrt» and «Abgeschlossen» like the board, where it used to say «Einsatz beendet» and
  «Abschluss». The migration translates existing incidents *and* their status history and
  runs automatically on boot; it is reversible. **If you read `/api/incidents` from your own
  script, the `status` values change** — that is the only thing outside this app that notices.
- **`NEXT_PUBLIC_API_URL` is an override again, and nothing more.** It had quietly become
  load-bearing for a second, unrelated job — it was the only way a backend address could enter
  the Content-Security-Policy — so a deployment that had set it could not follow this project's
  own advice to unset it. With the policy built at runtime, both jobs are done by `API_URL`.
  Stations that set the build-time variable keep working exactly as before.
- **A print job now reaches the printer in milliseconds instead of up to a minute.** The
  agent polled: 5 s while an operation was running, but 60 s when idle — and it only became
  brisk *after* it had printed something, so the slowest case was the first slip of an
  operation, the Einsatzzettel at alarm time. `/api/print/jobs/pending/` now accepts `wait`
  and holds the request open until a job is queued, the same long-poll KP Front's claim
  endpoint has always used. Two things improve with it: a job lost to a crashed agent is
  requeued within seconds rather than on the next idle poll, since the reaper runs on every
  pass through the wait; and the fallback pace drops from 60 s to 10 s.
  Nothing has to be updated in step — `wait` defaults to 0, so an old agent sees the old
  behaviour, and a new agent measures how fast an empty answer comes back and paces itself
  against a backend that does not know the parameter.

### Documentation
- **The documentation now says what the code does.** `backend/README.md` documented an
  `/api/operations` resource that does not exist and a module layout two refactors old;
  `ARCHITECTURE.md` had no section for the docker-compose stack that *is* production and told you
  to bake `NEXT_PUBLIC_API_URL` into the frontend image, which the release workflow deliberately
  does not do; `PHOTO_STORAGE.md` claimed Reko photos are public when the endpoint requires
  authentication and audits every view; `DATABASE_SCHEMA.md` listed six indexes as missing that
  all exist, and contained no schema. `RAILWAY.md` carries a legacy banner, `DATABASE_SCHEMA.md`
  and `VERIFICATION.md` are gone, and the required-secrets list finally includes the fifth one
  that compose refuses to start without.
- **The thermal printer is 80 mm, not 58 mm.** The code has always formatted for 80 mm paper
  (Font A at 48 characters); four documents said 58 mm, which would have sent somebody to buy the
  wrong printer.
- **Both READMEs described an interoperability that does not exist.** They claimed the two apps
  hand alarms to each other "through the same generic webhook, and nothing more". The payloads
  and auth differ, so KP Front needs a small adapter to feed KP Rück — and KP Rück has no
  outbound webhook to push the other way.
- **Screenshots are current again.** Every image in the repository predated the design-system
  refactor. `site/capture.mjs` now writes the README images from the same page states as the
  landing-page shots, so the two cannot drift apart the way they had (the README images were six
  months older).


## [0.3.0] – 2026-07-28

Two rounds of work. The first is Auftrag and viewer changes, all of it from one afternoon of
testing on the demo by an officer who does not build the thing. The second is a pass over the
interface itself: five audits went through every button, field, colour and border in the
frontend, which turned up a handful of real defects — a helper class that had been erasing the
border of every draggable card, a settings label wired to a field that did not exist, icon
buttons a screen reader could not name — and left the same thing looking the same wherever it
appears. Everything below is running in production at Feuerwehr Oberwil.

### Added
- **An Auftrag is handed out once, not once per stop.** A route with four stops produced four
  radio announcements, each reading out the same crew — so the Einsatzleiter read the same
  Mannschaft aloud four times. The first stop to reach «Disponiert» *is* the Auftragsvergabe and
  now gets the full announcement (crew and vehicles first, then the numbered list of stops, with
  Reko dangers and Nachbarhilfe collected at the end and named with their address). Every later
  stop gets the short continuation: «Auftrag ‹Sturmholz Oberwil› weiter mit Stop 3:
  Mühlemattstrasse 12.»

  If the route picks up crew, a vehicle or material in the meantime, the full announcement is due
  again — whoever just joined has never heard the Auftrag. Completed stops drop out of the list
  but **keep their number**, so «Stop 3» means the same address for the whole life of the
  Auftrag; a list that renumbers itself is a trap over the radio.

  There is deliberately **no new button**: the Disponiert dialog stays the trigger and only the
  text differs, because the app can tell which case it is and the operator should not have to.
  What was last announced is stored **on the Auftrag, server-side** (timestamp plus a digest of
  the crew/vehicles/material) rather than in the browser — two devices, a wall screen and a
  reload mid-Einsatz all have to agree on what has already been said.

  > **No action required.** The migration adding the four `incident_groups` columns runs on boot.
  > Until it has, an announcement simply cannot be recorded, and every stop falls back to the
  > full text — the harmless direction.
- **«Durchsage wiederholen» per Auftrag.** Radio traffic gets lost and asking for a repeat is
  normal. Each Auftrag in the slide-up now repeats its last announcement word for word (card,
  ⋮ menu, right-click) — no reopening a stop dialog for the wording, and the repeat is not
  counted as a new announcement.
- **The Reko photos are visible where the Reko result is read.** Photos uploaded through the Reko
  form only ever existed *inside* the Reko form — the one surface the command post never opens.
  The incident detail (including the `/display` views) shows them under «Reko-Ergebnis», together
  with the Lagetext, which was missing for the same reason. A picture of the damage is the most
  useful part of a Reko report. The images stay behind the login; a share-link view receives no
  filenames at all.
- **Every section of the display views folds away.** Board columns (including the share-link
  board), the incident status groups, the Funktionen under Personal and the categories under
  Material. A larger Feuerwehr otherwise only scrolls.

  Open is the default — nothing hides from someone who has just walked up to the screen — with
  ABGESCHLOSSEN as the one exception, as before. A **folded header keeps its count and its
  state**: a red dot as soon as an incident in that section is past the board's own warning
  threshold, and for Personal and Material how many are still free. Folding is hiding, and at 3am
  nothing important may hide itself. The fold is remembered per device, like the other display
  settings.
- **A closed incident can still be made a stop, but never silently.** Attaching an already
  completed incident to an Auftrag went through without a word, so a route showed a stop nobody
  was going to drive to. There is now a confirmation naming *which* of the selected incidents are
  closed — it warns, it does not forbid, because a Wiederaufnahme or a second visit to the same
  address is a real case and a ban would just produce a duplicate incident. It sits on the action
  rather than the screen, so it covers all three routes in: the stop picker, «An Auftrag
  verteilen» and dragging a card onto a route.
- **«Alle Einsätze einpassen» is a button now.** The map fitted itself to every incident exactly
  once, when it opened, and never again – so an incident arriving outside the viewport, or
  somebody having panned away, left «show me everything» to be rebuilt by hand out of zooming and
  searching. The fitting itself had existed all along; it hung off the panel resize and simply had
  no control. It sits top left under the zoom keys, with generous padding so a marker's label
  doesn't end up against the edge.
- **An Einsatzart's colour follows the hazard instead of a hash.** The colour was derived from the
  key's *name*, which made every colour an accident: «Ölwehr» came out green and collided on the
  same map with the green of a route. There is a table now – Brandbekämpfung red, BMA and Unechte
  Alarme dark red, Elementarereignis blue, Ölwehr orange – so the map reads the way the danger
  does.
- **The app wears the same mark as kp-rueck.ch.** Favicon and home-screen icon were a red square
  with «KP» set in Arial, a placeholder that matched neither the website nor KP Front. They now
  carry the landing page's mark – the magnet board the app is a version of, three columns of
  cards with one of them red because something is running – built from the same coordinates as
  the site rather than drawn a second time, so tab, home screen and landing page cannot drift
  apart. The 16px favicon gets its own reduced cut, because the full mark turns to mud at that
  size.
- **The sidebar shows availability the same way for people and material, and can hide what is
  busy.** The two lists had drifted apart: a person's status icon was amber when in use and green
  when free, while material drew the same icons in flat grey — so material read as if it had no
  state at all. Both now use one shared colour source. Cards no longer signal state by fading or
  tinting themselves either; that took the border with it, which is why some entries looked like
  they had no border while their neighbours did.

  Next to each search field there is now a single icon button that hides everything currently tied
  up. It reads availability exactly as the cards draw it — a Fahrer, a Reko or a Magaziner counts
  as busy even though the system still calls them "available", and consumables stay visible because
  handing some out does not empty the depot. The counter at the bottom keeps counting the full
  roster: it is the overall picture, not the filtered view.

### Fixed
- **An Auftrag wears its own colour everywhere on the map.** Two places disagreed. The route drew
  its line and its numbered stop pins with a private indigo fallback whenever the Auftrag had no
  colour set, while the board chip, the marker colouring and the legend had long resolved that
  same case through `colorAccent` — so two colourless Aufträge were one colour on the line and
  two different ones everywhere else. And while routes are drawn, a stop now also carries its
  route's colour as a *marker*: the numbered pin on top already did, the marker underneath stayed
  the priority fill, which on `/display/map` — routes on by default, colouring on «Priorität» —
  made every stop of every route read as the same static red. It is only a fallback; a
  deliberately chosen «Färben nach» dimension still wins, and the legend now lists the routes by
  name instead of continuing to claim «Priorität».
- **Neighbouring map labels no longer print over each other.** Two incidents a few metres apart
  wrote their addresses on top of one another — worst with the Aufträge layer on, where the
  numbered route pin lands on the same spot. A colliding label now steps down until it is clear;
  nothing is dropped, because at 3am the address you cannot see is the one you were looking for.
  Collisions are computed in screen pixels at the current zoom, so the same two incidents collide
  zoomed out and not zoomed in, and the order is stable so a map always resolves the same way.
  The marker and label under the pointer also come to the front, which the shared tooltip layer
  previously left to DOM order.
- **The stop-picker map keeps its labels inside the frame, and explains its colours.** Labels now
  open towards the middle of the map instead of over the border (which clips), the map fits with
  more padding so no marker sits against the edge, and a legend says what red, a route colour and
  grey mean. Toggling Liste ⇄ Karte still does not resize the dialog.
- **The setup and deployment guides no longer name a version.** They walked a new station through
  `git checkout` of one specific tag and pinned `KP_RUECK_TAG` to one specific number – both go
  stale the moment the next release lands, and a doc naming a tag that is not published yet stops
  the installation dead at the first command. The clone step now resolves the newest tag itself
  (`git tag -l 'v*' --sort=-v:refname | head -n1`), the pinning table talks in `X.Y.Z` / `X.Y` and
  links to the releases page, and the print-agent warning is an instruction that holds on every
  version – **set `PRINT_AGENT_TOKEN`** – instead of a warning against one release number.
- **Verbrauchsmaterial is never double-booked.** Unlimited stock has no count, so the fact that
  the Absperrband is already lying on another incident says nothing about this one – yet the
  assignment dialog flagged it amber and asked «Doppelbelegung?» before it would tick. Both are
  gone for anything marked unlimited: it selects straight away and counts along with the group
  tick, exactly like a free item. Limited material is unchanged – one Tauchpumpe assigned is
  still one Tauchpumpe away, and taking it off another incident still asks first.
- **The status display names every incident a material is on, not the last one.** The lookup kept
  one incident per material, so a consumable running on three showed «→» and one address – a
  precise-looking claim that happened to be wrong. It now collects all of them: one incident still
  reads as its address and jumps there on click, several read as «3 Einsätze» and are deliberately
  not clickable, because there is no single incident to open. Consumables also wear their ∞ in the
  status column now, so a green dot next to «3 Einsätze» reads as the rule it is instead of a bug.
- **Unlimited material is marked as such in the viewer's incident detail.** It was listed
  correctly – it just looked like every other item, in the incident's own materials and in the
  Auftrag roll-up. Both now carry the same ∞ the board and the Materialverwaltung use, on all
  three read-only displays (status, board, map).
- **The demo's contact numbers cannot reach anyone.** The detail dialog turns a contact number
  into a `tel:` link, and one of the four numbers in the demo seed was the real Polizei
  Basel-Landschaft line – one tap away on a public demo. All four are now visible dummy runs
  (`061 111 11 11` and friends). Switzerland reserves no drama range the way the US reserves 555,
  so the number has to show on its face that it is invented.
- **«Durchsage wiederholen» never refuses.** Before the first stop went «Disponiert» the dialog
  said there was nothing yet and showed no text – but the wording already exists, and somebody
  who wants to read it out over the radio has every reason to. It now always shows one: the
  recorded wording once there is one, and otherwise the announcement as it would read right now,
  which for an Auftrag that has never been given out is the full Auftragsdurchsage. It still only
  reads – nothing is recorded either way, so the first real Disponiert is still the Auftragsvergabe.
  The wording says which of the two you are looking at.
- **Closing a toast no longer closes what is underneath it.** Sonner renders its stack outside
  every panel, so dismissing a toast – or using «Alle ausblenden» – counted as a click *outside*
  the open dialog, slide-up, popover or menu, and took it down with it. Losing a half-filled form
  to a stray ✕ is not something anybody forgives at 3am. The guard now sits once in the shared
  primitives instead of being retyped per surface, and it covers the toast's ✕ and action icons,
  which are `<svg>` nodes and slipped through an earlier `HTMLElement` check.
- **A Reko is an order, and the crew doing it is not available.** The header read «7 verfügbar ·
  10 im Einsatz» on 17 people, and five of those seven were out on Reko – green, with the
  binocular glyph right beside them. A Reko is not an assignment and therefore never sets
  `status="assigned"`, but the tile colour and both counters read exactly that field, so every
  Reko-Trupp fell into the leftover bucket. Availability is decided in one place now
  (`personResourceState`) instead of three: tile, live statistics and the display header can no
  longer disagree about who is standing where.
- **A completed incident's clock stops.** The duration in the incident detail always counted up to
  *now*, so an incident that ran 58 minutes read «1h 12'» in the afternoon and «19h 40'» the next
  morning – the one number a Rückblick wants was never legible. It ends at `completed_at`, which
  the backend already stamped but which never reached the frontend, and is now carried through the
  live context, the WebSocket catch-up and the viewer. On the board the number stays what it
  always was, *how long this has stood in THIS status*, and it stops on a completed incident: a
  nag pointing at something left lying has nothing to say about a finished job.
- **The legend only lists what this map can actually contain.** «Fahrzeuge (GPS)» and
  «Zuweisungen» stood there always, including at a Feuerwehr without any GPS – so the legend
  explained blue lorry squares and dashed lines that never appear, and anybody looking for them is
  hunting a defect that does not exist. Both sections now depend on whether a vehicle reports a
  position at all, and the assignment lines additionally on whether they are switched on.
- **`/display/*` without a login and without an access code goes back to the start page.** The
  display surfaces exist for a wall screen behind a login or for a share link behind a code.
  Without either they used to show a single line of text on an otherwise empty surface – and on
  the demo the welcome dialog sat on top of it promising things a pure display cannot do
  («Einsätze erfassen, priorisieren, durch die Einsatzphasen bewegen»). The redirect waits for the
  session check first, so a slow check no longer bounces a legitimate wall screen.
- **A GPS-simulated drive in an exercise is no longer blocked by a real incident.** The safety line
  in the start endpoint refused every simulated drive as soon as *any* non-archived real event had
  an incident that wasn't closed – globally, regardless of vehicle or destination. In practice an
  exercise became undrivable because some old real situation lay around open somewhere. Drives to
  exercise incidents are unconditional now; the destination check («only incidents from exercises
  can be driven to») and the demo-mode lock both stay.
- **The Melder number is dialable in the viewer.** It stood in the incident detail as plain
  typewriter text – not tappable, not selectable, and a visual foreign body next to the rest of
  the block. It is a `tel:` link in the same typeface as everything around it. That turned up
  three separate `tel:` implementations with three different cleanups, two of which only stripped
  spaces – so a note like «(Nachbar)» went straight into the `href` and the link did nothing. One
  cleanup now serves all three. A stop inside an Auftrag also stops listing its resources twice.
- **The Rückmeldung form shows what it claims to show.** The channel rests on the idea that the
  operator reads the payload and *then* presses Senden – that press is the consent. Only there was
  nothing to read: before sending, the form showed a sentence *about* the payload, and the payload
  itself appeared only afterwards in the echo. The block now stands open above the buttons,
  verbatim, the way KP Front does it. The environment is captured once on mount and feeds both
  preview and payload, so the two cannot drift.
- **The Auftrag's stops are a list, one per line.** Joined with commas they ran together into
  something unreadable – «Bahnhofstrasse 31, 3. Lettenweg» is one address with a house number
  until you look twice, and a route is the last place that may be ambiguous. Each open stop now
  has its own line and carries where it stands (Offen / Disponiert / Einsatz), in the colours the
  stop list already uses. That status is for the eye only: it is not spoken and not copied,
  because nobody reads a status code over the radio. «Text kopieren» pastes the same list. The
  quotation marks are gone too – a straight `"` around a block several lines long left a stray
  mark in the middle of it, so the block carries a left rule instead.
- **A stop that was just added to an Auftrag is treated as part of it.** Adding a stop writes the
  *route*; the incident's own group id only arrives with the next refresh. In that window the stop
  looked ungrouped and three things went wrong at once: it was announced as a lone «neuer Einsatz»
  instead of the Auftragsdurchsage, «es fehlt noch etwas» offered to assign to the incident rather
  than to the Auftrag, and the Auftrag's own crew and vehicles were not counted when deciding what
  was missing – so the checklist opened for a route that was fully staffed. Membership is now read
  from the route's own stop list, which is authoritative and never lags.
- **«bleibt vor Ort» / «kehrt zurück» can be set where the vehicle is assigned.** The flag exists
  from the moment a vehicle is assigned, defaults to «zurück», and is read out on the radio,
  printed on the slip and shown on the board – but it could only be set from the incident card. A
  dispatch done through the assignment dialog therefore announced «kehrt zurück» for everything,
  true or not. Each assigned vehicle now carries the toggle there too, on the board and on the map.
  Not for an Auftrag yet: that flag has no endpoint to write through.
- **Draggable cards had no border.** A drag-and-drop helper class quietly overrode the border of
  every draggable card, so in the personnel sidebar an assigned person had a visible frame and a
  free one did not. The border belongs to the card, not to the drag affordance.
- **Priority colours had drifted back apart.** The map legend, the printed map legend and the
  wall-display detail modal each hard-coded their own red/yellow/green instead of the shared
  definition, so "low priority" was green in one view and emerald in another. All three read from
  the one source again.
- **Nine icon-only buttons were unusable with a screen reader** — including the user menu and the
  page navigation, which announced only "button". They have names now.
- **Removing a resource chip was a 10-pixel target.** The X on a crew or material chip had no
  clickable area beyond the glyph itself. It now has a real one, and a name.
- **A settings label did nothing when clicked.** It pointed at a field id that was never rendered.
- **Long names in the sidebar are readable again.** Truncated personnel and material names expand
  on hover, as do long Auftrag names in the Aufträge list.

### Changed
- **The frontend dev container may use 4 GB instead of 1.** Next's dev server compiles some 3000
  modules and sat at 99.9% of a 1 GB cap from the moment it started. It never got OOM-killed
  either – node just GC-thrashed at 100% CPU and stopped answering, so the page would not reload
  while `docker ps` still said the container was up. Development only; nothing shipped changes.
- **One visual language across the app.** Five audits went through every button, form field,
  colour, border and spacing value in the frontend. Cards share one corner radius and one clearly
  visible edge instead of three competing ones; dialogs use two heights instead of eight ad-hoc
  ones; a delete action is a red icon everywhere rather than sometimes grey and sometimes
  unmarked; small buttons are one size instead of four hand-written ones. Colour now means one
  thing at a time — amber and green describe the incident and its resources, a separate warning
  colour is the app reporting on itself (connection, sync, stale data).

  Nothing here changes how the board is operated. What it changes is that the same thing looks the
  same wherever it appears, so a status learned on the board still reads correctly on the wall
  display, the map and the phone.

### Removed
- **The training controls no longer alarm through the alarm intake.** The "Alarmeingang" button
  under *Einzelne Einsätze generieren* and the "Alarmweg" selector in the automatic generator are
  gone. Both worked – the simulated alarm landed in the pool with a ÜBUNG badge and could be
  attached to the exercise – but it was never decided **who gets alarmed during an exercise**.
  While that is open, the automatic generator is one step away from texting the whole brigade for
  an exercise three people are running. The training controls still generate straight onto the
  board and through the phone alarm; running exercises are otherwise unchanged. The path comes
  back once "who is taking part" can be set explicitly.

## [0.2.0] – 2026-07-26

### Security
- **Live updates now require a login.** The Socket.IO connection accepted anyone: only the
  admin room was role-gated, so anything able to reach `/socket.io` could join the operations
  room and receive live incident broadcasts — addresses, crew assignments — without
  authenticating. The strict-mode flag existed but shipped off ("Phase 1"). It is now on.

  The CORS origin whitelist was never the control here, which is the part worth internalising:
  CORS is enforced by browsers, and a script that omits `Origin` is not a browser.

  > **No action for a normal deployment.** Nothing legitimate connects anonymously — the app
  > sends its session cookie, the `/display/*` screens require a login, and the public
  > share-link board polls over HTTP rather than using the socket. If some client of yours
  > genuinely cannot log in, set `WS_REQUIRE_AUTH=false`; the board falls back to ~5s polling
  > rather than going blank.
- **Four security-relevant settings are documented for the first time.** A control nobody can
  find is not a control. `SSO_EDITOR_ALLOWLIST` (without it, *every* Entra ID sign-in is a
  viewer — any tenant member can reach the login, so editor is an explicit grant),
  `WS_REQUIRE_AUTH`, `MASTER_TOKEN` (bypasses login entirely for scripted configuration; empty
  by default, and not attributed to a user in the audit trail if you enable it), and the
  `LOGIN_*` throttle knobs the previous release already advertised as tunable. All now in
  [`.env.example`](.env.example), [`SECURITY.md`](SECURITY.md) and
  [`docs/SETUP.md`](docs/SETUP.md).
- **The security scanner was skipping a file.** Bandit is a blocking CI gate, but it ran on
  Python 3.11 against a 3.12 codebase, could not parse `app/crud/base.py`, and silently
  excluded it — noted in output that is easy to scroll past. Pinned to the project's Python; it
  now reports `Files skipped (0)`.
- **The print-agent endpoints are fail-closed.** They used to accept *any* request when
  `PRINT_AGENT_TOKEN` was unset – on the assumption that the agent only ever reaches the backend
  across a trusted LAN. The same image also runs on a public host, where "unset" quietly meant
  anyone could read the printer config, list pending jobs, claim them, and mark them done. The
  four agent endpoints now answer `403` with no token configured, matching how alarm intake has
  always behaved. `.env.example` already described this behaviour; the code now matches it.

  > **Operator action** if you print: set `PRINT_AGENT_TOKEN` on the backend *and* `AGENT_TOKEN`
  > on the agent, then restart both. Printing stops until you do – including on a LAN-only
  > install, where the token was previously optional. Deployments that don't print need nothing.

### Added
- **Offline map tiles work for your region, not just ours.** The tile pipeline was wired to one
  Swiss canton: the download URL, the bounding box and the region label were all literals in
  `scripts/download-tiles.sh`, so a station anywhere else could not follow the documented
  `just tiles-download` at all — it had to fork the script. Four environment variables now drive
  it, and `docs/OFFLINE_MAPS.md` explains how to find your own values:

  ```bash
  TILES_REGION="Oberbayern" \
  TILES_BOUNDS=11.0,47.7,12.3,48.4 \
  TILES_AREA=oberbayern \
  TILES_PBF_URL=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf \
    just tiles-download
  ```

  > **No action required.** The defaults are the previous values, so an existing deployment
  > behaves exactly as before. `TILES_NAME` (the file on the tileserver volume) is deliberately
  > separate and should be left alone on a deployment that already has tiles — renaming it makes
  > the init script write an empty bootstrap file instead of finding them, which looks like a
  > working map with nothing in it.
- **`docs/openapi.json` is committed** — the full API contract (158 routes, request and response
  shapes) readable without booting the stack. Anyone writing an adapter for a dispatch system
  against `POST /api/alarms`, or a print agent against the job queue, previously had to stand up
  Postgres and the backend just to see a payload. `just openapi` regenerates it, and a test fails
  if it drifts from the code.
- **More of the gate that stands behind a published image.** Secret scanning (gitleaks) and
  CodeQL static analysis now run here as they already did for KP Front, and CI runs a small
  Playwright subset on every pull request — logging in, creating an event and an incident, and
  alarm intake — where before it ran no click-through at all. The full suite runs nightly. None
  of this changes the software; it changes how much a release has been checked before it reaches
  you.
- **arm64 images.** All four images build for `linux/arm64` as well as `linux/amd64`, so an ARM
  host (Hetzner CAX, Oracle Ampere, a Raspberry Pi) can run the whole stack – previously only the
  print agent could.
- **Opt-in error reporting, off by default.** When something breaks, a deployment *may* forward a
  sanitised crash report – but only after switching it on in the admin area. Off means a NULL
  setting, which is exactly what every existing installation updates into, and consent is a
  deployment decision rather than a device preference: the fire service is the controller, not
  whoever is holding the tablet.

  What can leave the building is built field by field in `app/telemetry/scrub.py` – nothing is
  passed through or spread, so a field nobody wrote a line for cannot leak. Free text is scrubbed
  as well, because the value is usually *in* the message: paths, e-mails, phone numbers, IPs,
  coordinates, UUIDs, tokens, street names with house numbers, and the full user agent reduced to
  a coarse label so it can't fingerprint. Every payload is logged on your own server before it is
  sent and kept verbatim in `telemetry_outbox`, so you can audit it with a `SELECT` instead of
  taking our word for it. `KP_TELEMETRY_ENABLED=0` overrides every switch in the UI.
  See [`PRIVACY.md`](PRIVACY.md).

  > The scrubber and envelope are byte-identical copies of KP Front's, held in step by a checksum
  > test in both repositories – a rule tightened in one app and not the other would mean one of
  > them quietly forwards what the other removes.
- **[`docs/RUNNING-BOTH.md`](docs/RUNNING-BOTH.md)** for stations running KP Front *and* KP Rück
  on one host: the three places two otherwise-independent stacks collide, the traps around each,
  and a mapping table for the variables the two projects name differently. `.env.example` links
  to it, and the file is kept identical in both repositories.
- **One print agent for both systems.** A station running both used to need two agents on the
  same box — two services, two secrets, two install methods, two log streams — to reach the same
  printer room. The agent now lives at [`tools/print-agent/`](tools/print-agent/) and speaks
  **both** protocols: KP Rück's (structured JSON → ESC/POS thermal) and KP Front's (opaque PDF →
  CUPS/A4 laser). Give it a `backends` list and run one service.

  Neither backend changed and neither wire protocol changed. The core is stdlib-only, so the
  bare-Pi install with no venv keeps working; `python-escpos`/`pillow` are now an optional extra
  needed only for the thermal output.

  > **No action required.** The environment variables the previous agent used are read exactly
  > as before, so an existing `--profile printing` deployment keeps working untouched. The image
  > is published under the neutral name `ghcr.io/feuerwehr-oberwil/kp-print-agent`; the old
  > `kp-rueck-print-agent` name is **also** published this release, so nothing breaks on update.
  > Migrating from two agents to one: **stop the old ones first** — two agents polling one queue
  > both claim jobs, and each job then prints once, from whichever asked first.

### Changed
- **The audit log is no longer deleted after 90 days.** `AUDIT_RETENTION_DAYS` now defaults to
  `0`, meaning keep everything. It defaulted to 90 and a background job swept silently, which
  sat badly next to this project's own claim of "defensible records" and an "append-only audit
  log": a deployment older than three months had already lost the trail for its earliest
  operations, and nothing anywhere said so. With retention off the sweeper does not start at
  all. A public demo still caps at 7 days.

  > **Check this if you have been running 0.1.x.** Anything older than 90 days is already gone
  > — worth knowing *before* somebody asks you for it. And if you were relying on the sweep to
  > bound table growth, set `AUDIT_RETENTION_DAYS=90` back explicitly. `docs/SETUP.md` §6 has
  > the reasoning.
- **Node 24 instead of Node 20.** The frontend image was built on a runtime that reached
  end-of-life on 2026-04-30, so any Node vulnerability disclosed after that date was one nobody
  would ever patch for it. Node 24 is supported to 2028-04-30. Dependabot now watches base
  images too — that gap existed because npm, pip and GitHub Actions were watched and the one
  dependency a station actually *runs* was not.
- **A fresh production deployment now starts with an empty board.** It used to be seeded with a
  fictional station: five vehicles (Omega 1–5), 57 firefighters, a full material catalogue, and
  thirteen training locations on real streets in one specific Swiss municipality. Sample
  *incidents* were already withheld from production; the resources they referred to were not. So
  the first act of setting KP Rück up for your own station was deleting somebody else's data off
  the board — and a restored backup put it back. Accounts and settings are still seeded; the
  station's own resources come in through the Excel import (`docs/SETUP.md` §3).

  > **No action for an existing deployment** — seeding only runs on a database with no users, so
  > yours has long since skipped it and your data is untouched. This changes what a *new* install
  > and a *restore into a fresh stack* look like. Note the restore drill in `docs/SETUP.md` §6
  > now starts from a genuinely empty board, which is the point.
  >
  > A `just dev` machine still comes up with the sample board. It is a development fixture, and
  > it is no longer something a real deployment inherits.
- **Address search biases towards your station, not towards Basel-Landschaft.** It matched the
  `home_city` setting against a hardcoded list of sixteen municipalities and fell back to a fixed
  Basel-region box for anything unrecognised — so every station outside that list had its address
  lookups quietly weighted towards a region it is nowhere near. The bias now comes from the
  `firestation_latitude` / `firestation_longitude` settings you already configure, and with no
  coordinates set the search stays unweighted rather than pointing somewhere wrong. Nominatim's
  country restriction is still Switzerland by default and can be overridden with a
  `geocoder_country_codes` setting, so a deployment across the border is a setting rather than a
  patch.

  > **Worth checking** if your address search has felt off: set the station's coordinates in the
  > settings surface.
- **`PUBLIC_URL` is now `CORS_ORIGINS`.** The variable was always passed to the backend as
  `CORS_ORIGINS`; the old name collided with KP Front's `PUBLIC_URL`, which means something else
  there (the base for absolute links in outbound webhooks). Copying one `.env` into the other
  therefore broke CORS with no error message anywhere. The new name is what the backend actually
  reads.

  > **No action required.** `PUBLIC_URL` is still accepted as a deprecated fallback; rename it
  > when you next touch the file.

### Fixed
- **`docs/SETUP.md` no longer teaches a configuration that does not exist.** The page a new
  station reads first still used `PUBLIC_URL` (renamed `CORS_ORIGINS` in this release), still
  said the alarm webhook secret could only be read out of the database, and still told you to
  check out and pin `v0.1.0` — the release whose print-agent endpoints accept any request when no
  token is set. It also promised a resource import without mentioning that the board now starts
  empty, so "empty" would have read as "broken".
- **The `training_locations` table no longer defaults new rows into one municipality.**
  `postal_code` defaulted to `4104` and `city` to `Oberwil` at the database level. Every writer
  already supplies both, so the defaults could only ever fire as a wrong answer. Existing rows
  are untouched.
- **Two stacks on one host no longer fight over port 443.** Caddy had it hard-coded, and KP
  Front's Caddy wants it too – so the second stack simply failed to start. The HTTPS host port is
  now `HTTPS_PORT`, matching the existing `HTTP_PORT`. Note it must be moved even when an outer
  reverse proxy never touches it, because this stack's Caddy publishes unconditionally: unlike KP
  Front's, it is deliberately *not* behind a compose profile, since nothing else here publishes a
  port at all. It is also not a way to run a second automatic-HTTPS setup – certificate issuance
  needs port 80 or 443 reachable from outside.
- **Assigning to a missing incident no longer 500s, and a missing resource no longer creates an
  orphan.** `POST /api/incidents/{id}/assign` with an incident id that no longer exists died on a
  foreign-key violation — a 500 for what is plainly a stale id. Worse, the *resource* was never
  checked at all: assigning a personnel id that does not exist returned 200 and stored the
  assignment anyway, leaving a row pointing at nothing and no error to explain it. Both are now
  404, matching the neighbouring endpoints.
- **The alarm webhook secret can be set from `.env`.** It could previously only be read back out
  of the database after first boot
  (`SELECT value FROM settings WHERE key = 'alarm_webhook_secret';`) – the one setup step that
  could not be scripted. `ALARM_WEBHOOK_SECRET` now wins over the stored value, so a deployment
  can be provisioned entirely from the file. Left blank, the previous behaviour is unchanged.
- **The generic alarm intake reserves the same `source` slugs as KP Front.** Both now reject the
  union of the two lists, so a station feeding one dispatch system into both apps can't pick a
  name that one accepts and the other rejects — a trap that only surfaced on the second
  integration.
- Dependency updates across the frontend, and the GitHub Actions used by CI.
- **The app can no longer get stuck in a state only a browser reset would clear.** A sweep for
  crashes and dead ends turned up several, all of which needed something no screen offered:
  - A corrupt value in browser storage crashed the app on **every** load. The read happened in a
    provider above every error boundary, so it produced an untranslated "Application error" with
    no way out – and because the bad value was saved, reloading (or restarting the browser)
    reproduced it. There is now a last-resort error screen with a **"Lokale Daten zurücksetzen"**
    action, and all storage reads validate what they find instead of trusting it.
  - On an installation served over plain **HTTP from a LAN address**, creating an Auftrag or
    assigning a resource to one silently did nothing: the browser only provides the id generator
    the code used over HTTPS or on localhost. The dialog's create button then stayed dead until
    the page was reloaded.
  - Visiting **Check-in** or the **Reko-Dashboard** and navigating back killed live updates for
    the rest of the session. Those pages closed a connection the whole app shares. Data kept
    flowing via background polling, so nothing looked wrong.
  - When the live connection gave up for good, the "Verbindung verloren" banner only reported it.
    It now has a **"Neu verbinden"** button; previously the sole cure was a page reload.
- **Wall displays recover on their own.** An error on an unattended `/display/*` screen used to
  leave a dead page with a button nobody was there to press. Displays now reload themselves after
  15s, then 30s, then 60s – backing off so a broken deploy can't turn every screen in the station
  into a retry loop against the backend. Applies to crashes in the page and in the app shell.
- **A shared command-post IP no longer locks out the crew.** Login was capped at 3 attempts per
  minute per IP and counted *successful* logins, so a few operators signing in together from
  behind the same NAT locked everyone out with nothing to do but wait. Brute-force protection is
  now per-username and counts only *failures* (5 → 5 minute lockout, cleared by a correct
  password), which is stricter against an attacker while honest operators can't exhaust each
  other's budget. Tunable via `LOGIN_RATE_LIMIT_PER_IP`, `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_FAILED_LOCKOUT_SECONDS` and `LOGIN_FAILED_WINDOW_SECONDS`.
- Development stack: the host and the backend container no longer share one `.venv`. Running
  `uv run` (or `just db migrate`) on the host used to recreate the virtualenv under the
  container's feet, flooding the reloader until the backend stopped responding and had to be
  restarted by hand.

## [0.1.0] – 2026-07-25

The first tagged release, and the first with **published container images**: self-hosting is a
`docker compose up -d` against `ghcr.io/feuerwehr-oberwil/kp-rueck-*` – no build toolchain on the
server. Everything below has been running in production; this is the point where it becomes
something another station can pin.

### Added
- **Published images on GHCR**, one per service and all released under the same version:
  `kp-rueck-backend`, `kp-rueck-frontend`, `kp-rueck-tileserver` and `kp-rueck-print-agent`
  (the print agent also for arm64, so it runs on a Raspberry Pi at the command post). CI builds,
  boots and smoke-tests the whole stack before a tag publishes. `docker-compose.yml` is now a
  **production** stack that pulls those images and puts the frontend and backend behind one
  origin; the hot-reload development stack stays in `docker-compose.dev.yml`. See
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- Aufträge (multi-stop group routing): batch several incidents into an ordered **route** for one
  squad to work through during a Flächenlage (storm/mass-incident wave). An Auftrag is a lightweight
  container over real incidents (`incident_groups` table + `incidents.group_id`/`group_position`),
  so each stop keeps its own status/reko/print/GPS. Build routes in the **Aufträge** footer sheet
  (inline create, drag cards in, derived `offen/läuft/erledigt` checklist, `+ Stop`) or the
  **Routen-Editor** modal / `/map` **Routenplanung** mode (click-to-add, drag-reorder, client-side
  nearest-neighbor optimize). Assign a squad once and **"auf alle Stops übernehmen"** – with a
  **`Squad` vs `Nur Fahrzeug` (Pendeldienst)** mode so a shuttle shares only the vehicle while crew
  stays per-incident. Routes draw as colored numbered polylines on the map, and GPS arrival
  auto-advance gains a nearest-single-match guard so clustered stops don't double-fire.
- Provider-neutral alarm intake: a generic `POST /api/alarms` webhook accepts alarms from **any**
  dispatch or alarm system – shared-secret auth, `(source, source_id)` idempotency, auto-attach
  to the active event, and fail-closed when no secret is configured. The native Divera adapter
  (`POST /api/divera/webhook`) and the token-gated phone/walk-in intake form feed the same pool.
  See [`docs/ALARM-INTEGRATIONS.md`](docs/ALARM-INTEGRATIONS.md).
- Integration capability registry: `GET /api/integrations` reports which provider is configured
  per area (alarm in, Ausalarmierung, personnel sync, vehicle GPS). The frontend renders provider
  names from this response instead of hard-coding them, and the generic webhook and intake form
  are always available.
- Provider-neutral outbound alerting (Ausalarmierung): a pluggable `send_alarm(...)` seam
  (`backend/app/services/alerting/`) with a `personnel_external_identities` table keying each
  person's identity per provider – a new provider is a module plus a registry entry.
- German i18n layer: `next-intl` infrastructure (cookie locale, `frontend/messages/de.json`
  catalog, outside-React helper) with UI, toast, and API-error strings extracted from hardcoded
  German – the groundwork for additional locales.
- GPS-driven status automation: silent-arrival (Rule A) and confirm-release (Rule B) rules move
  incidents by vehicle position (`backend/app/services/gps_automation.py`), running in training
  events too. Dwell is decoupled from fix freshness so parked trackers can still trigger.
- After-action PDF report and unified export: Einsatztagebuch, Reaktionszeiten, and Lageblatt
  chapters via `services/pdf_report_service.py`, exposed on the events page and user menu.
- Undo incident deletion: `POST /api/incidents/{id}/restore` with a "Rückgängig" toast.
- Persisted Kanban card order: `Incident.position` + `/incidents/reorder`, eliminating the
  drag snap-back flicker and making within-column reordering real.
- Ausfallsicherheit (paper fallback): a printable Lageblatt PDF, automatic thermal board
  snapshots, an outage SOP ([`docs/AUSFALL_SOP.md`](docs/AUSFALL_SOP.md)), and a startup
  checklist task.
- Reliability hardening for the public demo: audit-log retention sweep
  (`background/audit_cleanup.py`), a global exception handler with request IDs
  (`middleware/request_id.py`), endpoint hardening (admin-gated demo reset, `PRINT_AGENT_TOKEN`,
  WebSocket room auth), and per-session demo sandbox events (`POST /api/demo/sandbox`).
- Training mode depth: auto-generated incidents wired live, Divera intake drills, escalation
  injects, adjustable sim tempo, one-tap Rückfahrt, and simulated GPS drives from the
  Übungssteuerung – all isolated by the `training_flag`.
- QR walk-in print jobs and a generic `qr_code` job type for the thermal print agent.

### Changed
- The board sync path was reworked for robustness: serialized reorders, drag-aware reloads, WS
  recovery, single-commit status operations, and stale-reload discarding – debounced edits are no
  longer lost on tab close, and newer local changes are never clobbered by a late reload.
- Alembic is the single source of schema truth: `create_all` was dropped from boot, so the schema
  only ever changes through a migration.
- Onboarding resolved without a welcome card: shortcut discoverability is the ⌘K command palette
  (also `?`); the 409 conflict copy was softened to "Von anderer Person geändert".
- Blocking photo and Excel work moved off the event loop; driver reassignment and vehicle moves
  are now atomic.

### Fixed
- **Self-hosting outside Railway now actually works.** KP Rück had only ever been deployed to
  Railway, and that was baked into paths that looked platform-neutral. Found by building the
  images and booting the stack end to end:
  - The API proxy forced every redirect target to `https://` (a Railway-edge workaround), so
    against a plain-HTTP backend it attempted TLS on a cleartext port – and since the proxy
    appends a trailing slash, FastAPI's redirect made that the common path: `/backend-api/*`
    returned 502 for everything.
  - The live board never connected: the WebSocket URL applied Railway's
    `X.up.railway.app → X-api.up.railway.app` convention to *any* hostname with three or more
    labels, pointing at a host that doesn't exist. It now uses the deployment's own origin
    (and keeps `ws://` on a plain-HTTP LAN instead of forcing `wss://`).
  - Login was impossible on a trusted-LAN install: `Secure` cookies were forced on in
    production, and browsers drop those over plain HTTP, so signing in failed with no visible
    error. `AUTH_COOKIE_SECURE=false` is now a deliberate opt-out; unset still means secure.
  - Offline map tiles were requested from a hard-coded `localhost:8080`, which no browser on a
    deployment can reach; they now come from `/tiles` on the same origin.
  - The photo volume is mounted where the image actually prepares it, and the frontend health
    probe uses `127.0.0.1` instead of `localhost`, which resolves to IPv6 first while Next
    binds IPv4 only.
- The Divera webhook auto-attach never fails the ACK, and the member sync now counts created
  personnel correctly.
- `/incidents/sync-version` is no longer shadowed by the `/{incident_id}` route.
- A submitted Reko report can no longer silently revert to draft; users are informed whenever an
  action fails instead of a silent revert.
- Lost print jobs are requeued instead of being dropped forever.
- The shared editor account is no longer seeded in production.

_For the full running history before the first release, see the git log._

[Unreleased]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/feuerwehr-oberwil/kp-rueck/releases/tag/v0.1.0
