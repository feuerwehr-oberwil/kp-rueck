# CLAUDE.md

KP Rück is the tactical operations board of a fire-service command post (KP Rück): a digital magnet
board for incidents (Einsätze), personnel, vehicles and materials. The operator runs it from a
desktop; phones view. [`docs/README.md`](docs/README.md) indexes every other doc. If you would answer
a setup, deployment, tiles or architecture question from memory, read it first.

## Commands

```bash
just dev            # dev stack with hot reload (Docker)
just db seed        # seed initial data
just db migrate     # run pending migrations   (just db help: shell, status, history, new "msg")
just dev-stop       # stop the dev stack
just dev-clean      # DELETES the dev database and photos – asks first
just tiles-download # optional offline map tiles; just tiles-status checks them

# Mirror a real deployment into the dev stack (source: any Postgres URL, or 'railway' for the
# linked project). --config = settings/inventory only, no Einsätze. The replaced dev DB is dumped
# to ./backups/ first; the dev logins (admin/kp-dev-password, editor, viewer) are re-seeded.
just dev-sync railway
just dev-sync postgres://user:pass@host:5432/db --config
```

The `dev-` prefix is deliberate. `just up` / `just down` / `just doctor` / `just init` are the
**station operator's** verbs and act on the production stack. `dev-stop` / `dev-clean` are ours.
Their old names were `stop` and `clean`. With those names, an operator who had installed `just`
for the offline-tiles step was one command away from taking their own board down, with a recipe
described as "stop all services".

Without Docker:

```bash
cd backend && uv sync && uv run python -m app.seed   # tables + seed data
cd backend && uv run uvicorn app.main:app --reload   # API on :8000 (Swagger at /docs)
cd backend && uv run ruff check . && uv run ruff format .
cd frontend && pnpm install && pnpm dev              # app on :3000
cd frontend && pnpm lint                             # ratchet per rule on warnings AND eslint-disable comments: eslint-ratchet.json
cd frontend && pnpm build
```

### Tests

```bash
just test                                       # backend + frontend unit + E2E (services running)
just test-ui                                    # E2E in Playwright UI mode
cd backend && uv run pytest
cd frontend && pnpm test                        # Vitest (pnpm test:watch)
cd frontend && pnpm test:e2e                    # Playwright (pnpm test:e2e:ui)
cd frontend && pnpm test:e2e tests/e2e/01-auth/ # one suite; add --headed via `pnpm exec playwright test`
```

- Unit tests: Vitest + React Testing Library + jsdom (config: `vitest.config.ts`, setup: `vitest.setup.ts`). Files: `**/*.{test,spec}.{ts,tsx}` outside `tests/`.
- E2E: Playwright with TypeScript, Page Object Model + Custom Fixtures, Factory pattern + API helpers, in `frontend/tests/`.
- Visual regression: `just visual` – nine frozen screens (`frontend/tests/visual/*.visual.ts`,
  own config `playwright.visual.config.ts`). A production build renders them against
  `app.seed_visual` (the demo storm evening at one fixed instant; the browser clock frozen at the
  same instant, basemap tiles stubbed flat). The run compares them with the PNGs in
  `tests/visual/__screenshots__/`. CI job `visual` is a required check since 2026-10-10.
  Baselines come from CI only (`visual-baselines.yml` → `just visual-accept <run-id>`). A local
  run is a look, not a verdict. **Never accept a baseline to turn the check green.** Accept one
  only for a deliberate visual change, in its own commit with the reason. If a change makes
  something on one of those screens depend on the time or the server clock, pin it in the
  seed/fixture, not with a mask. `docs/VISUAL_TESTS.md`.

## Shape of the system

- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 4, pnpm.
- **Backend**: FastAPI (async) + SQLAlchemy 2.0 async ORM + PostgreSQL 16, uv. `schemas/`,
  `crud/` and `api/` are packages, one module per area.
- **Map**: MapLibre GL; vector tiles from a self-hosted TileServer GL offline, raster OSM online.
- **Sync**: Socket.IO pushes incident, driver and assignment updates from
  `backend/app/websocket_manager.py` (client: `lib/websocket-client.ts`). The client polls every
  ~5 s as a fallback: when the socket is down, and for entities not yet wired to WS events.
- **Roles**: `admin`, `editor` (full CRUD), `viewer` (strictly read-only).
- **Training vs live**: same database, filtered by `training_flag` on incidents.
- Top-level layout: `README.md` «Repository layout». Components, every table, the sync, print and
  alarm flows, the incident lifecycle: `docs/ARCHITECTURE.md`.

### Backend conventions

- `async`/`await` everywhere. Sessions are an injected `AsyncSession`. Settings are Pydantic and
  injected too.
- Put lifecycle code in the `lifespan` context, never in the deprecated startup/shutdown events.
- SQLAlchemy 2.0 mapped-column syntax; full type hints.
- **CRUD and services flush, the request commits** (once, before the response – `commit_request`).
  Send anything that a board or another session reacts to after the commit: `after_commit(db, …)`
  or a background task. Every other explicit commit has a comment beside it that says why. The
  rule lives above `get_db` in `backend/app/database.py`.
- **Row locks in one order**: Aufträge (by id) → Einsätze (by id) → the resource row. The helpers
  and the reasoning are in `backend/app/crud/locking.py`. A new writer that locks must use the
  helpers, or it deadlocks against completion/reorder. New assignments go through
  `ensure_assignable`.

### Frontend (Next.js)

- **Client Components in practice**: **all 23 pages under `app/` are `'use client'`**. This is
  the reality, not an aspiration to fix. The root layout mounts 9 providers (auth, operations,
  event, theme, i18n, …). The board is a live, interactive surface, so there is no meaningful
  server-rendered page here. Do not "restore" server components on a page as a cleanup: it fails
  on the first context hook. Server components are still fine for genuinely static leaf
  components that touch no context.
- **A layout's `children` never sits directly in a host element**: write
  `<main><RouteSlot>{children}</RouteSlot></main>`, not `<main>{children}</main>`
  (`components/route-slot.tsx`). The route slot can still be pending when hydration reaches
  `<main>`. The React in Next 15.5 then throws error #418 and re-renders the whole root
  (18.10.2026; `route-slot.test.ts` goes red on that React).
- **The app runs on the React that Next vendors, not on `package.json`'s.** Next 15.5 renders the
  App Router with its own React (a 19.2 canary). So a React API that Vitest and tsc accept can
  still be missing in the browser. `useEffectEvent` is one: import it from
  `lib/hooks/use-effect-event.ts` (lint stops the import from 'react'). Use it for
  «the latest X without re-running». exhaustive-deps has 0 warnings, and the lint ratchet caps its disables. A
  disable that must stay says why on its line (`-- reason`).
- **API Integration**: Centralized API client in `lib/api-client.ts`
- **State Management**: React Context for global state (`lib/contexts/`, the board in `operations-context.tsx`)
- **UI Components**: shadcn/ui components in `components/ui/`
- **Phone geometry (one source)**: `--kb-inset`, `--vv-top`, `--vv-height`, `--nav-reserve`,
  `--sheet-top` and `html[data-kb]` are measured and published on `<html>` (contract + the iOS
  model in `lib/viewport-insets.ts`). Never hard-code the bottom nav or the keyboard:
  - A phone list under the nav ends with `pb-nav-reserve`.
  - A sheet's foot ends with `pb-sheet-safe`. A modal sheet covers the nav, so it has no nav
    reserve inside it.
  - A bar fixed at the bottom stands on `var(--kb-inset)`.
  - A phone form goes in a bottom `SheetContent` (`SheetBody` scrolls, footer stays). While a
    keyboard is up, the sheet FILLS the visible band exactly (`top: var(--vv-top)`,
    `height: var(--vv-height)`), with the footer on the keys. iOS never shrinks the layout
    viewport, so while the keyboard is up, never bottom-anchor the sheet and never reserve room
    above the keyboard.
  - The sheet opens without focusing a field (no keyboard until a tap). It gets grip +
    swipe-to-dismiss for free. The swipe closes through `onOpenChange`, so a form with unsaved
    input guards that (`useUnsavedChangesWarning`).
  - Fields that are not the operator's own data (Meldung, Einsatzort, Melder, Telefon) carry
    `autoComplete="off"`, or iOS offers «AutoFill Contact».
- **Phone forms: labels ABOVE their field**, never beside it. `DetailField`, `DetailToggle`,
  `SettingRow` and `LocationInput` stack by themselves below 768px (`useStackedFields` in
  `components/ui/use-stacked-fields.ts`; switches stay label-left / switch-right). Build forms
  from them. Never hand-roll a `w-[120px]` label gutter or a label|control flex row. Desktop
  keeps the side-by-side rows.
- **Phone list screens have ONE action, in a footer** in flow directly above the bottom nav – not
  a button above the list, not floating over cards. The list root pads by `--nav-reserve`. The
  scroller reserves only what the keyboard covers beyond nav + the footer's measured `--list-foot`.
- **Phone filters = the search field + ONE square funnel** – no chip rows on the phone. The
  funnel is a `DropdownMenu` of checkable rows with counts, with «Alle zeigen» first while
  something is ticked. On = `variant="selected"`, with the ticks named in its `aria-label` and in
  a «Gefiltert: …» line. Its width never changes.
- **Nothing overflows sideways – check with `pnpm overflow-scan`** (`frontend/scripts/overflow-scan.mjs`,
  local stacks only: `BASE_URL=http://localhost:3000 SCAN_ADMIN=user:pass pnpm overflow-scan`; narrow
  it with `SCAN_ONLY=help,feld SCAN_WIDTHS=360,393`, iPhone engine with `SCAN_BROWSER=webkit`). It
  visits every route, the Feld flow, the public links and the openable dialogs at
  360/393/768/1280/1920 in light + dark. It writes `overflow-scan/findings.md` with these
  findings: page or list that scrolls sideways, an sr-only/absolute box escaping its scroller,
  text out of its box, text or a placeholder clipped without ellipsis, a control laid over text,
  ellipses nobody can read past.
  - Run it before a UI PR. When you add a route or dialog, add a visit.
  - Fix at the cause: let text wrap (`break-words`, `min-w-0` on the flex child), stack or wrap
    on the phone, use `truncate` only with the full text in `title`. Never use a blanket
    `overflow-x: hidden`.
  - Known traps: a `flex-1` `TabsTrigger` gets an equal share, not its label's width; a scroller
    needs `relative` or its rows' sr-only labels stretch the page; a dialog/sheet header keeps
    2.5rem clear for the ✕ (globals.css); `ScrollArea` lays its content out at the viewport width
    (`[&>div]:!block`); at exactly 768px the board is desktop but the ≤768 44px touch rule applies.
  - `[data-overflow-ok]` exempts a deliberate case. Say why beside it.

### API Endpoints

**The trailing slash on the collection routes is not decorative.** `/api/personnel` (no slash)
answers **307** to `/api/personnel/`. A redirected POST does not carry its body, so a scripted
write silently does nothing and looks like a success. Write the slash:

Incidents: `/api/incidents/` (GET, POST, PUT, DELETE)
Personnel: `/api/personnel/` (GET, POST, PUT)
Vehicles: `/api/vehicles/` (GET, POST, PUT)
Materials: `/api/materials/` (GET, POST, PUT)
Alarm intake: `/api/alarms` (POST) – provider-neutral webhook, any dispatch system; Divera adapter at `/api/divera/webhook`
Integrations: `/api/integrations` (GET) – capability registry (which provider is configured per domain)

Full docs: [`docs/openapi.json`](docs/openapi.json) – the committed contract. To regenerate it, run
`just openapi` (a pytest fails when it drifts). Live Swagger UI while the backend runs:
http://localhost:8000/docs

**Integration seams** (provider-neutral, see `docs/ALARM-INTEGRATIONS.md`):
- Inbound alarms funnel through `services/divera_intake.py` (shared inference/auto-attach). The pool table carries `source`/`source_id` provenance; incidents carry `source`/`source_ref`.
- Outbound alerting (Ausalarmierung) goes through the `AlarmProvider` protocol in `services/alerting/` (Divera = first adapter).
- `services/roster_snapshot_sync.py` reads a published roster file (`STATION_INDEX_SOURCE` → `index.json`, fallback `ROSTER_SNAPSHOT_SOURCE`; `docs/ROSTER-SNAPSHOT.md`). The contracts and the reading rules (`app/roster_snapshot.py`, `app/roster_snapshot_ingest.py`, `app/station_index.py`, `scripts/roster_snapshot_from_csv.py`, `scripts/station_index_build.py`) are byte-identical with kp-front. Edit them THERE first. They are listed in `shared/MANIFEST.json` (see «Files shared with KP Front»).
- Personnel provider identity lives in `personnel_external_identities` – the only place where a person's provider-side id exists. Migration `b7c2e5a1d4f8` dropped the deprecated `personnel.divera_user_id` dual-write. The personnel API exposes only a `divera_linked` boolean.
- Printing: transport-neutral job queue + pull agent (`docs/PRINT_AGENT.md`).

## Environment, deployment, releases

- Variables: `.env.example` (deployment), `backend/.env.example`, `frontend/.env.local.example`.
  Self-hosting is `docs/DEPLOYMENT.md`, Railway is `docs/RAILWAY.md`: two supported paths on the
  same images. Pick by who runs the server. Compose survives an internet outage; Railway means
  nobody has to look after a box.
- **`NEXT_PUBLIC_*` is inlined at BUILD time**, so it is a development convenience only.
  Published images are built without it. On Railway, `NEXT_PUBLIC_API_URL` must stay unset (it
  breaks mobile logins via third-party cookies). At runtime the server-side proxy route reads
  `API_URL`, and the browser falls back to same-origin paths (`/backend-api`, `/tiles`); see
  `frontend/lib/env.ts`. The server hands a runtime `CARTO_API_KEY` to the browser, so CARTO
  raster requests can include their required `?key=` query parameter. It is never baked into the
  image.
- `docker-compose.yml` is the PRODUCTION stack (GHCR images pinned by `KP_RUECK_TAG`, Caddy as
  the single origin: `/socket.io` + `/api` → backend, `/tiles` → tileserver, the rest →
  frontend). `docker-compose.dev.yml` is `just dev`. Compose sets `ENVIRONMENT=production`. That
  turns on mandatory secrets, no auth bypass, and no sample data at all: no sample incidents, and
  no fleet, roster, materials or training locations either (`backend/app/environment.py`,
  `backend/app/seed.py`). Production is not Railway-only.
- Offline tiles: `docs/OFFLINE_MAPS.md`. The region is configuration (`TILES_REGION` /
  `TILES_BOUNDS` / `TILES_AREA` / `TILES_PBF_URL`, default Basel-Landschaft). All three tile
  scripts share `TILES_NAME` (the on-disk filename). Do not rename it on an existing volume.
  There is no tileserver config file: `scripts/init-tileserver.sh` hands over to TileServer GL,
  which auto-detects `/data/*.mbtiles`. The generated data goes to zoom 14 (planetiler's default;
  the script passes no `--maxzoom`). Closer zooms overzoom. The dev stack publishes the tileserver
  on :8080. The production stack publishes no tileserver port (Caddy routes `/tiles`).

**Releases are for other stations, not for us.** A `v*` tag exists so a self-hoster can pull a
known set of images. The number answers *what does this update cost the operator*: PATCH =
fixes, MINOR = features + automatic migrations, MAJOR = operator action required (table at the
top of `CHANGELOG.md`). To cut one:

1. `just changelog` (git-cliff draft).
2. Curate the draft into `[Unreleased]`.
3. `just release X.Y.Z` (bumps all four packages; a pytest fails if they drift).
4. `just release-tag X.Y.Z`.
5. `git push --follow-tags`. This runs the CI gate and publishes the four images plus a GitHub
   Release whose body is the committed CHANGELOG section.

**The frontend image is built WITHOUT `NEXT_PUBLIC_API_URL` on purpose**: a baked-in URL ties
the image to one station. The browser calls `/backend-api` on its own origin, and Next forwards
to the runtime `API_URL`. The same reasoning applies to map tiles (`getTileBaseUrl` → `/tiles`).

## Conventions

- **Files shared with KP Front by copy** – telemetry sanitiser, alarm keyword vocabulary,
  roster-snapshot contract + reader, alarm intake corpus, the snail – are listed in
  `shared/MANIFEST.json` (path per repo, owner, sha256). To change one:
  1. Edit it in the owner (kp-front) first.
  2. Copy it byte for byte.
  3. Run `python3 scripts/check_shared.py --update` in both repos.
  4. Push both PRs on branches with the SAME name. The required CI check
     «Shared files match KP Front» compares against kp-front's branch of that name.
  5. Never re-record a hash on one side to turn it green.

  Step by step: `shared/README.md`.
- **i18n**: German is canonical (`messages/de.json`). `fr`/`it` are deep-partial overlays merged
  over German (`lib/i18n-messages.ts`); missing keys fall back to the German string.
  - The language picker in Settings offers a locale only when its overlay covers **every** German
    leaf (`coversGerman` → `AVAILABLE_LOCALES`) – not "has some translations". One missing key
    hides the language entirely. So **`de.json` and `fr.json` must stay leaf-for-leaf equal**. A
    German key added without the French one silently drops French out of the picker.
  - Today: **`de` + `fr` ship, `it` is still `{}`**. Locale is per-device via the `NEXT_LOCALE`
    cookie.
  - The in-app help is a separate per-language Markdown file
    (`frontend/public/content/help/index.md`, `index.fr.md`), not part of the catalogues.
  - Backend output (API error details, PDFs, exports, thermal print) is German-only for now. The
    exceptions are notifications (`type` + `params`, see «Notification text») and the `/feld`
    errors. The `/feld` errors carry a stable `code` that the client says per locale (`errors.codes.*`,
    `backend/app/utils/error_codes.py`). Raise `CodedHTTPException` and keep the German `detail`.
  - Message text that the frontend builds for the CREW – WhatsApp (`lib/whatsapp-formatter.ts`),
    Divera (`lib/divera-formatter.ts`, the Divera send/message dialogs) – is German by design,
    whatever the device's language: it lands in the crew's group.
  - Everything the operator reads on screen goes through the catalogue, incident types and
    priorities included (`getIncidentTypeLabel`, `incidents.priority.*` – there is no German
    label map in code).
  - **Renaming a key means renaming every call site**: next-intl renders a missing key as its
    path instead of throwing. `lib/i18n-keys-used.test.ts` resolves every literal `t('…')` to its
    `useTranslations` namespace and fails on keys absent from `de.json`. Dynamic `${…}` keys need
    an entry in the label-coverage tests instead.
- **Words**: **Mannschaft** = the crew of an Einsatz/Auftrag; **Personal** = the roster
  (sidebar, settings, check-in). The verb is **zuweisen** (never zuteilen). Releasing a resource
  is «freigeben». A confirm button names the consequence («Ohne Mannschaft disponieren»,
  «Angekommen melden»), never «Ja, …» (KP Front WORD.7).
- **Wall text (`/display/*`) wraps, it does not truncate** – nobody at a wall can hover a
  tooltip. Addresses, column heads and labels use `WALL_TEXT_WRAP` (`lib/kanban-utils.ts`:
  hyphenate, `break-words` only as last resort, never `break-all`). If a fact still must fit one
  line, move it to its own line instead of ending it in «…».
- **Resource conflicts**: UI warns when assigning already-assigned personnel/vehicles/materials
- **Loading states – one signal, always with words.** A full-screen start (auth probe, Microsoft
  callback) is `components/boot-screen.tsx`: snail + «KP RÜCK» + the station's name + the phase,
  no percentage, and «Neu starten» after 9 s. The station's name shows once this device has
  loaded a board (`lib/station-name.ts`; the login card shows it too). In the app it is the shell
  trail (`components/ui/shell-loader.tsx`): `LoadingStatus` for a stand-alone wait (words
  required, `role="status"`; `surface` = 48px stacked for an empty dialog/panel, `inline` = 20px
  beside the text), `ShellLoader` in the icon slot of a busy button beside its label. Do not add
  `Loader2`/`animate-spin` spinners. Do not add an artificial minimum wait. Under reduced motion
  the trail and the snail stand still, and overlays fade without zoom/slide (`globals.css`, via
  tw-animate's variables). Never use a blanket `transform: none`: it breaks positioning and
  drag-and-drop.
- **The snail is shared with KP Front and edited there.** `frontend/public/firefighter-snail-loader.svg`
  is a byte-identical copy of kp-front's `public/firefighter-snail-loader.svg`, and
  `SHELL_TRAIL_PATH` is its `fs-shell-trail` path. Never edit either here. Colour it from the
  outside (`--accent` is pointed at `--primary`). The SVG is in `shared/MANIFEST.json`;
  `shell-loader.test.tsx` holds `SHELL_TRAIL_PATH` to it.
- **Toasts – one message surface**: one lane, `components/ui/sonner.tsx`. Sonner runs
  `unstyled`. Its injected CSS is unlayered and beats every Tailwind utility, so tone classes on a
  call site do nothing. Every type gets the same neutral card, with tone only in the glyph.
  `toast.error` is the only tinted card: use it for failures and nothing else. Pass `duration`
  only when you mean it. The lifetime comes from the text length (`lib/toast-lifetime.ts`:
  Front's curve plus two Rück additions – a failure gets the 6 s button floor too, and the
  «Anzeigedauer» setting scales everything). A bare `toast()` bypasses that: use `unmutedToast`
  (also shown on the quiet phone, `/feld` and `/display` surfaces). Every «Rückgängig» is
  `undoToast` (`lib/toast-undo.ts`: unmuted, one shot, and the target of ⌘Z / Ctrl+Z).
  Phone placement reads `--nav-reserve` / `--sheet-top` / `--kb-inset` on `<html>`.
- **Notification text**: toasts and the bell show a notification as line 1 = what is asked,
  line 2 = where · who, source as glyph (`lib/notification-format.ts`). The backend sends
  `type` + `params` (the facts, one shape per type) and a German `message`. One function in
  `backend/app/services/notification_params.py` builds every row and returns both. The client
  renders `params` through `notifications.messages.*` in the device's language. To add or change
  a notification, add or update its builder there (+ its pinned test), and its case + copy (de AND
  fr) + test in `notification-format.ts`. A row without params, an unknown type/variant or a missing fact
  falls back to the German `message` on one line, so nothing is lost. Never parse `message`.
- **«Synchronisiert» means the server confirmed it** (`lib/field-save.ts`, `components/kanban/field-save-status.tsx`)
  – KP Front's word for the same fact; Front's «gespeichert» means «on this device». The detail's
  free-text fields (and the self-saving settings) show «Wird synchronisiert …» / «Synchronisiert – hh:mm» /
  «Nicht synchronisiert» under the field.
  - `updateOperation` (the one funnel) feeds the store. A field is «saved» only when the PATCH
    that carries its NEWEST text has answered.
  - PATCHes run one at a time per incident (`KeyedSerialQueue`, no line-skipping – not even on
    `pagehide`), so the server sees edits in order.
  - Each text goes out with `text_base` (the text this window last saw the server confirm).
    Somebody else's newer text is a 409 `text_conflict`. It shows in amber under the field,
    with «Meinen Text behalten» / «Diese Fassung übernehmen».
  - A failed text stays as a draft in the field. Render the control's `value` from
    `useFieldSave(...).value`, never straight from `operation`, or a reload replaces the draft.
    The draft is sent again only via «Erneut synchronisieren». There is no automatic resend (the
    HTTP client never retries a mutation) and no offline queue.
  - Drafts are scoped to user + Ereignis. A user switch drops them, and a queued write of the
    previous user is not sent.
  - A new free-text incident field goes into `SAVED_TEXT_FIELDS` and the backend's
    `IncidentTextField`.
- **Stale banner**: a connected WebSocket vouches for the board only after a load got through
  AFTER the socket came up (`BoardSyncStatus.liveSince`). «connected»/«connecting» alone never
  hide the warning.
- **Form messages** (`components/ui/form-message.tsx`): say what is wrong with a field UNDER it.
  Red `error` blocks saving: `role="alert"`, the control gets `fieldMessageProps(id, 'error')`
  = `aria-invalid` + `aria-describedby`, and a submit focuses the first blocking field via
  `focusFirstBlockingField`. Amber `advice` is a polite status and never blocks. Use no toast for
  a field problem. Never grey out a submit button without a word. `DetailField` takes `error` /
  `advice` and renders it with the id `formMessageId(htmlFor)`.
- **Questions = `ConfirmDialog`** (`components/ui/confirm-dialog.tsx`): Abbrechen + the main
  answer in the footer row. A third «… stattdessen» answer (`extraAction`) is a full-width line
  of its own ABOVE that row (`AlternativeAnswer`), never a ghost button beside Abbrechen. If a
  gate's Abbrechen is an undo, the gate passes `onCancel` (the caller closes it) instead of
  `onOpenChange`, so a confirm can never count as a cancel.
- **Pick a person = `PersonPickTile`** (`components/kanban/assignment-list-section.tsx`) in a
  `PickerDialog` (`components/ui/picker-dialog.tsx`: dialog on a desk, bottom sheet on a
  phone). The tile has a tick box, `PersonName` and the one rank · where · roles line. Chosen =
  sel wash; the current holder shows «aktuell». A tap ticks, «Übernehmen» applies. When nothing
  is ticked, a line above the list says so. Used in: Driver, Reko zuweisen/übertragen, Reko-Modus
  and the assignment dialog's crew.
- **Empty lists** (`components/ui/empty-state.tsx`): say WHY and offer the one way out:
  - search: `SearchEmptyState` («Keine Treffer für «q»» + «Suche leeren»), under every
    `SearchInput`;
  - filter: name it + «Filter zurücksetzen», which keeps the search and every tick;
  - truly nothing: say what would fill it;
  - everything taken: a line above the spoken-for block, not a replacement.

  Title + one line + at most one action, no big icons. The repeated board columns keep their
  single grey sentence. **A title takes no period** – an `EmptyState` title, a toast's first
  line, any `*Title` key. The line under it is a sentence and takes a period.
- **Maps never rise above overlays.** Every map goes through `components/map/base-map.tsx`. Its
  wrapper is `isolate`, so markers (z up to 1000) and controls (z 2000) only compete inside the
  map. Map chrome laid over a map from outside (chips, legend, fit-all) sits in a wrapper that is
  `isolate` too. Never give map content a z-index meant for the page.
- **MapLibre's worker is a served file**: `scripts/copy-maplibre-worker.mjs` copies it to
  `public/maplibre/` (gitignored) before `dev`/`build`, and `base-map.tsx` calls `setWorkerUrl`.
  Without it, MapLibre 6 under webpack spawns the page as its worker. The basemap still draws,
  but no GeoJSON layer loads and `load` never fires (no fit, pan, routes, lines, trails).
- **Map mode** (`auto` | `online` | `offline`, a database setting chosen in Settings):
  `lib/hooks/use-map-mode.ts` and `getTileBaseUrl()` in `lib/env.ts`. Auto tries online OSM
  first and falls back to the offline tiles on a network error. The map view shows which mode is
  live.
- **Lagekarte labels on a phone** (`lib/map-labels.ts`, ≤767px or coarse pointer): no permanent
  labels below zoom 16 – a tap shows the selected marker's label/card. From 16 on, only labels
  that collide with no other label or dot show. Desktop keeps every label.
- **Search fields**: every «type to narrow this list» is `components/ui/search-input.tsx`. Its
  ✕ is «Suche leeren» and keeps focus. It is ≥44px with 16px text on a phone or coarse pointer,
  whatever `className` says. Focus is the `Input` ring (no own ring). `count` is the optional
  live hit count. Do not hand-build a `relative` + `<Search>` + `<Input>`. Where the chip rows do
  not fit (`useCompactFilters`: ≤639px wide or ≤719px tall), the assignment dialog folds them
  into ONE «Filtern» menu, with the active count on the button and a «Gefiltert: …» line under it.
- **Undo never restores a snapshot blindly.** An undo is a new write that must still be valid
  *now*.
  - The route-optimisation undo sends `expected_ids` with `POST /incident-groups/{id}/stops/reorder`.
    The server compares under the Auftrag row lock → 409 «Auftrag geändert». Every stop
    add/remove/detach takes that lock.
  - The release undo (`lib/hooks/use-release-undo.ts`) re-assigns through the ordinary assign
    functions, after `checkRestore` (`lib/release-undo.ts`) confirms that nobody put the
    resource elsewhere in the meantime.
  - Wrap the operator's *own* releases with `useReleaseUndo`. Internal releases (conflict
    «verschieben», completion) stay raw.
- **Durations go through `lib/duration.ts`** (`formatDuration` / `formatAgo` / `formatDurationLong`) – no
  hand-rolled minute maths, no date-fns. Every surface uses ONE notation, the magnet board's:
  `12'`, `1h 23'`, `1d 10h`, «vor 12'», under a minute «gerade eben». That covers card chips,
  the Ereignis clock, notifications (the backend's `duration_de` too) and every «vor …». The full
  value («1 Tag 10 Stunden») goes into the accessible name/tooltip. A catalogue string never puts
  `'` right before `{` or `}` (ICU quoting) – pass the formatted duration in instead. The
  60/120-minute age colours (`ageLevel`) are a Fachentscheidung: formatting changes must not
  touch them.
- **Route optimisation is a Luftlinie suggestion**: label it «Vorschlag nach Luftlinie ·
  Planungshilfe» and show the start point with provenance (`lib/route-start.ts`: settings vs.
  Ersatzstandort, GPS report time/age, fallback to the first stop). One action
  (`components/map/route-optimize.tsx`) serves all three entry points. Do not copy it.

## UI rules

Users, brand, aesthetic, the full colour roles and the reasoning behind every rule below:
[`docs/DESIGN.md`](docs/DESIGN.md). Read it before a design decision.

- **Desktop with mouse and keyboard is the brief.** Dense targets, power-user shortcuts. A phone
  views (an editor can spawn training incidents); tablets are KP Front's. Sizes follow the button
  scale in `frontend/components/ui/button.tsx`.
- **Colour roles – one colour, one meaning** (tokens in `frontend/app/globals.css`; the full map
  in DESIGN.md «Colour roles», held by `lib/colour-roles.test.ts`):
  - selection = KP Front's blue hue, tonal, never a fill (`<Button variant="selected">`,
    `sel-choice`, `--sel*`); focus = the same blue (`--ring`), never red;
  - «this one» (Spotlight, wall highlight, map highlight, a jump) = the `this-one-ring` ink ring;
  - red = priority and danger only, never an action (`destructive` is a red outline);
  - priority = `--prio-high/-medium/-low` (+ the test-pinned `PRIORITY_COLORS` hex mirror);
  - green = frei (`--free`, only via `RESOURCE_STATE_*`) and ✓ bestätigt (`success`, always with
    ✓ or a word); Niedrig is grey;
  - blue as a colour = an Auftrag, drawn in its own swatch (`auftragColor`); no «info» blue; map
    things are `MAP_INK`;
  - Übung = the hatched ink `TrainingBadge` / `TrainingBand`, no hue;
  - status colour only where crews are out: Reko violet, Im Einsatz fuchsia, every other status
    grey (`STATUS_ACCENT`); column header lines are the status key, cards do not repeat it;
  - no raw palette class or colour literal outside the allowed tables, no `hsl(var(--…))`.
- **Main button = ink** (`<Button>` default), one per surface.
- **Type**: Sora (`font-sans`) and Spline Sans Mono (`font-mono`) only.
- **Corners**: `rounded-md`/`-lg`/`-xl` are all 12px; controls under 32px tall use `rounded-sm`
  (8px); pills `rounded-full`.
- **App icon**: drawn only in `scripts/build-icons.mjs`; rerun it, never edit its outputs.
- **Calm**: motion only for a meaningful state change; never colour alone for meaning.
