# CLAUDE.md

KP Rück: the tactical operations board of a fire-service command post (KP Rück) – a digital magnet
board for incidents (Einsätze), personnel, vehicles and materials. Run from a desktop; phones
view. Every other doc is indexed in [`docs/README.md`](docs/README.md); reach for it before
answering a setup, deployment, tiles or architecture question from memory.

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
**station operator's** verbs and act on the production stack; `dev-stop` / `dev-clean` are ours.
They used to be called `stop` and `clean`, which meant an operator who had installed `just` for
the offline-tiles step could take their own board down with a recipe described as "stop all
services".

Without Docker:

```bash
cd backend && uv sync && uv run python -m app.seed   # tables + seed data
cd backend && uv run uvicorn app.main:app --reload   # API on :8000 (Swagger at /docs)
cd backend && uv run ruff check . && uv run ruff format .
cd frontend && pnpm install && pnpm dev              # app on :3000
cd frontend && pnpm lint                             # per-rule warning ratchet: eslint-ratchet.json
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
- E2E: Playwright with TypeScript, Page Object Model + Custom Fixtures, Factory pattern + API helpers, located in `frontend/tests/`.
- Visual regression: `just visual` – nine frozen screens (`frontend/tests/visual/*.visual.ts`,
  own config `playwright.visual.config.ts`) from a production build against `app.seed_visual`
  (the demo storm evening at one fixed instant; the browser clock frozen at the same instant,
  basemap tiles stubbed flat), compared with the PNGs in `tests/visual/__screenshots__/`. CI
  job `visual` (a required check since 2026-10-10). Baselines come from CI only
  (`visual-baselines.yml` → `just visual-accept <run-id>`); a local run is a look, not a
  verdict. **Never accept a baseline to turn the check green** – only a deliberate visual
  change, in its own commit with the reason. A new time- or server-clock-dependent thing on
  one of those screens needs pinning in the seed/fixture, not a mask. `docs/VISUAL_TESTS.md`.

## Shape of the system

- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 4, pnpm.
- **Backend**: FastAPI (async) + SQLAlchemy 2.0 async ORM + PostgreSQL 16, uv. `schemas/`,
  `crud/` and `api/` are packages, one module per area.
- **Map**: MapLibre GL; vector tiles from a self-hosted TileServer GL offline, raster OSM online.
- **Sync**: Socket.IO pushes from `backend/app/websocket_manager.py`, polling fallback (~5 s).
- **Roles**: `admin`, `editor` (full CRUD), `viewer` (strictly read-only).
- **Training vs live**: same database, filtered by `training_flag` on incidents.
- Top-level layout: `README.md` «Repository layout». Components, every table, the sync, print and
  alarm flows, the incident lifecycle: `docs/ARCHITECTURE.md`.

### Backend conventions

- `async`/`await` everywhere, sessions are an injected `AsyncSession`; settings are Pydantic and
  injected too.
- Lifecycle goes in the `lifespan` context, never the deprecated startup/shutdown events.
- SQLAlchemy 2.0 mapped-column syntax; full type hints.

### Frontend (Next.js)

- **Client Components in practice**: **all 22 pages under `app/` are `'use client'`** – this is
  the reality, not an aspiration to fix. The root layout mounts 10 providers (auth, operations,
  event, theme, i18n, …), and the board is a live, interactive surface: there is no
  meaningful server-rendered page here. Do not "restore" server components on a page as a
  cleanup; it will fail on the first context hook. Server components remain fine for genuinely
  static leaf components that touch no context.
- **A layout's `children` never sits directly in a host element**: `<main><RouteSlot>{children}</RouteSlot></main>`,
  not `<main>{children}</main>` (`components/route-slot.tsx`). The route slot can still be
  pending when hydration reaches `<main>`, and the React in Next 15.5 then throws error #418
  and re-renders the whole root (18.10.2026; `route-slot.test.ts` goes red on that React).
- **API Integration**: Centralized API client in `lib/api-client.ts`
- **State Management**: React Context for global state (`lib/contexts/`, the board in `operations-context.tsx`)
- **UI Components**: shadcn/ui components in `components/ui/`
- **Phone geometry (one source)**: `--kb-inset`, `--vv-top`, `--vv-height`, `--nav-reserve`,
  `--sheet-top` and `html[data-kb]` are measured and published on `<html>` (contract + the iOS
  model in `lib/viewport-insets.ts`). Never hard-code the bottom nav or the keyboard: a phone list
  under the nav ends with `pb-nav-reserve`, a sheet's foot with `pb-sheet-safe` (a modal sheet
  covers the nav — no nav reserve inside it), and a bar fixed at the bottom stands on
  `var(--kb-inset)`. A phone form goes in a bottom `SheetContent` (`SheetBody` scrolls, footer
  stays): while a keyboard is up it FILLS the visible band exactly (`top: var(--vv-top)`,
  `height: var(--vv-height)` — iOS never shrinks the layout viewport, so never bottom-anchor
  and never reserve room above it), footer on the keys; it opens without focusing a field (no
  keyboard until a tap) and gets grip + swipe-to-dismiss for free; the swipe closes through
  `onOpenChange`, so a form with unsaved input guards that (`useUnsavedChangesWarning`). Fields
  that are not the operator's own data (Meldung, Einsatzort, Melder, Telefon) carry
  `autoComplete="off"`, or iOS offers «AutoFill Contact».
- **Phone forms: labels ABOVE their field**, never beside it. `DetailField`, `DetailToggle`,
  `SettingRow` and `LocationInput` stack by themselves below 768px (`useStackedFields` in
  `components/ui/use-stacked-fields.ts`; switches stay label-left / switch-right). Build forms
  from them; never hand-roll a `w-[120px]` label gutter or a label|control flex row. Desktop
  keeps the side-by-side rows.
- **Phone list screens have ONE action, in a footer** in flow directly above the bottom nav (the
  list root pads by `--nav-reserve`; the scroller reserves only what the keyboard covers beyond
  nav + the footer's measured `--list-foot`) – not a button above the list, not floating over cards.
- **Phone filters = the search field + ONE square funnel** (`DropdownMenu` of checkable rows with
  counts, «Alle zeigen» first while something is ticked; on = `variant="selected"`, the ticks named
  in its `aria-label` and in a «Gefiltert: …» line; its width never changes) – no chip rows on the phone.
- **Nothing overflows sideways – check with `pnpm overflow-scan`** (`frontend/scripts/overflow-scan.mjs`,
  local stacks only: `BASE_URL=http://localhost:3000 SCAN_ADMIN=user:pass pnpm overflow-scan`; narrow
  it with `SCAN_ONLY=help,feld SCAN_WIDTHS=360,393`, iPhone engine with `SCAN_BROWSER=webkit`). It
  visits every route, the Feld flow, the public links and the openable dialogs at
  360/393/768/1280/1920 in light + dark and writes `overflow-scan/findings.md`: page or list that
  scrolls sideways, an sr-only/absolute box escaping its scroller, text out of its box, text or a
  placeholder clipped without ellipsis, a control laid over text, ellipses nobody can read past.
  Run it before a UI PR; add a visit when you add a route or dialog. Fix at the cause – let text
  wrap (`break-words`, `min-w-0` on the flex child), stack or wrap on the phone, `truncate` only
  with the full text in `title` – never a blanket `overflow-x: hidden`. Known traps: a `flex-1`
  `TabsTrigger` gets an equal share, not its label's width; a scroller needs `relative` or its
  rows' sr-only labels stretch the page; a dialog/sheet header keeps 2.5rem clear for the ✕
  (globals.css); `ScrollArea` lays its content out at the viewport width (`[&>div]:!block`); at
  exactly 768px the board is desktop but the ≤768 44px touch rule applies. `[data-overflow-ok]`
  exempts a deliberate case – say why beside it.
- **WebSocket + polling sync**: Socket.IO pushes incident, driver, and assignment updates from `backend/app/websocket_manager.py` (client: `lib/websocket-client.ts`); the client polls every ~5s as a fallback when the socket is down or for entities not yet wired to WS events

### API Endpoints

**The trailing slash on the collection routes is not decorative.** `/api/personnel` (no slash)
answers **307** to `/api/personnel/`, and a redirected POST does not carry its body – so a
scripted write silently does nothing and looks like a success. Write the slash:

Incidents: `/api/incidents/` (GET, POST, PUT, DELETE)
Personnel: `/api/personnel/` (GET, POST, PUT)
Vehicles: `/api/vehicles/` (GET, POST, PUT)
Materials: `/api/materials/` (GET, POST, PUT)
Alarm intake: `/api/alarms` (POST) – provider-neutral webhook, any dispatch system; Divera adapter at `/api/divera/webhook`
Integrations: `/api/integrations` (GET) – capability registry (which provider is configured per domain)

Full docs: [`docs/openapi.json`](docs/openapi.json) – the committed contract, regenerated
with `just openapi` (a pytest fails when it drifts). Live Swagger UI while the backend
runs: http://localhost:8000/docs

**Integration seams** (provider-neutral, see `docs/ALARM-INTEGRATIONS.md`):
- Inbound alarms funnel through `services/divera_intake.py` (shared inference/auto-attach); the pool table carries `source`/`source_id` provenance, incidents carry `source`/`source_ref`.
- Outbound alerting (Ausalarmierung) goes through the `AlarmProvider` protocol in `services/alerting/` (Divera = first adapter).
- A published roster file (`STATION_INDEX_SOURCE` → `index.json`, fallback `ROSTER_SNAPSHOT_SOURCE`; `docs/ROSTER-SNAPSHOT.md`) is read by `services/roster_snapshot_sync.py`; the contracts and the reading rules (`app/roster_snapshot.py`, `app/roster_snapshot_ingest.py`, `app/station_index.py`, `scripts/roster_snapshot_from_csv.py`, `scripts/station_index_build.py`) are byte-identical with kp-front and edited THERE first – listed in `shared/MANIFEST.json` (see «Files shared with KP Front»).
- Personnel provider identity lives in `personnel_external_identities` — the only place a person's provider-side id exists (the deprecated `personnel.divera_user_id` dual-write was dropped in migration `b7c2e5a1d4f8`). The personnel API exposes only a `divera_linked` boolean.
- Printing: transport-neutral job queue + pull agent (`docs/PRINT_AGENT.md`).

## Environment, deployment, releases

- Variables: `.env.example` (deployment), `backend/.env.example`, `frontend/.env.local.example`.
  Self-hosting is `docs/DEPLOYMENT.md`, Railway is `docs/RAILWAY.md` – two supported paths on the
  same images; pick by who runs the server (compose survives an internet outage, Railway means
  nobody has to look after a box).
- **`NEXT_PUBLIC_*` is inlined at BUILD time**, so it is a development convenience only –
  published images are built without it, and on Railway `NEXT_PUBLIC_API_URL` must stay unset
  (it breaks mobile logins via third-party cookies). At runtime the server-side proxy route reads
  `API_URL`, and the browser falls back to same-origin paths (`/backend-api`, `/tiles`); see
  `frontend/lib/env.ts`. A runtime `CARTO_API_KEY` is handed to the browser so CARTO raster
  requests can include their required `?key=` query parameter; it is never baked into the image.
- `docker-compose.yml` is the PRODUCTION stack (GHCR images pinned by `KP_RUECK_TAG`, Caddy as
  the single origin: `/socket.io` + `/api` → backend, `/tiles` → tileserver, the rest →
  frontend); `docker-compose.dev.yml` is `just dev`. Compose sets `ENVIRONMENT=production`, which
  turns on mandatory secrets, no auth bypass, and no sample data at all – no sample incidents,
  and no fleet, roster, materials or training locations either (`backend/app/environment.py`,
  `backend/app/seed.py`). Production is not Railway-only.
- Offline tiles: `docs/OFFLINE_MAPS.md`. The region is configuration (`TILES_REGION` /
  `TILES_BOUNDS` / `TILES_AREA` / `TILES_PBF_URL`, default Basel-Landschaft); `TILES_NAME` (the
  on-disk filename) is shared by all three tile scripts – don't rename it on an existing volume.
  There is no tileserver config file: `scripts/init-tileserver.sh` hands over to TileServer GL,
  which auto-detects `/data/*.mbtiles`. The dev stack publishes the tileserver on :8080; the
  production stack publishes no tileserver port (Caddy routes `/tiles`).

**Releases are for other stations, not for us.** A `v*` tag exists so a self-hoster can pull a
known set of images; the number answers *what does this update cost the operator* – PATCH =
fixes, MINOR = features + automatic migrations, MAJOR = operator action required (table at the
top of `CHANGELOG.md`). Cutting one: `just changelog` (git-cliff draft) → curate into
`[Unreleased]` → `just release X.Y.Z` (bumps all four packages; a pytest fails if they drift) →
`just release-tag X.Y.Z` → `git push --follow-tags`, which runs the CI gate and publishes the
four images plus a GitHub Release whose body is the committed CHANGELOG section. **The frontend
image is built WITHOUT `NEXT_PUBLIC_API_URL` on purpose** – baking a URL in would tie the image
to one station; the browser calls `/backend-api` on its own origin and Next forwards to the
runtime `API_URL`. Same reasoning for map tiles (`getTileBaseUrl` → `/tiles`).

## Conventions

- **Files shared with KP Front by copy** – telemetry sanitiser, alarm keyword vocabulary,
  roster-snapshot contract + reader, alarm intake corpus, the snail – are listed in
  `shared/MANIFEST.json` (path per repo, owner, sha256). Edit them in the owner (kp-front) first,
  copy byte for byte, `python3 scripts/check_shared.py --update` in both, and push both PRs on
  branches with the SAME name: the required CI check «Shared files match KP Front» compares
  against kp-front's branch of that name. Never re-record a hash on one side to turn it green.
  Step by step: `shared/README.md`.
- **i18n**: German is canonical (`messages/de.json`); `fr`/`it` are deep-partial overlays
  merged over German (`lib/i18n-messages.ts`) – missing keys fall back to the German string.
  The language picker in Settings offers a locale only when its overlay covers **every** German
  leaf (`coversGerman` → `AVAILABLE_LOCALES`) – not "has some translations": one missing key
  hides the language entirely. So **`de.json` and `fr.json` must stay leaf-for-leaf equal**;
  adding a German key without the French one silently drops French out
  of the picker. Today: **`de` + `fr` ship, `it` is still `{}`**. Locale is per-device via the
  `NEXT_LOCALE` cookie. The in-app help is a separate per-language Markdown file
  (`frontend/public/content/help/index.md`, `index.fr.md`), not part of the catalogues.
  Backend output (API error details, PDFs, exports, thermal print) is German-only for now –
  except notifications (`type` + `params`, see «Notification text») and the `/feld` errors,
  which carry a stable `code` the client says per locale (`errors.codes.*`,
  `backend/app/utils/error_codes.py`; raise `CodedHTTPException`, keep the German `detail`).
  **Renaming a key means renaming every call site**: next-intl renders a missing key as its
  path instead of throwing. `lib/i18n-keys-used.test.ts` resolves every literal `t('…')` to its
  `useTranslations` namespace and fails on keys absent from `de.json`; dynamic `${…}` keys
  need an entry in the label-coverage tests instead.
- **Words**: a resource is **zugewiesen** (verb «zuweisen», noun «Zuweisung»), never «zugeteilt».
  **Mannschaft** is the crew on an Einsatz; **Personal** is the roster (nav, sidebar, settings).
  Releasing a resource is «freigeben».
- **Wall text (`/display/*`) wraps, it doesn't truncate** – nobody at a wall can hover a
  tooltip. Addresses, column heads and labels use `WALL_TEXT_WRAP` (`lib/kanban-utils.ts`:
  hyphenate, `break-words` only as last resort, never `break-all`); a fact that still must fit
  one line moves to its own line rather than ending in «…».
- **Resource conflicts**: UI warns when assigning already-assigned personnel/vehicles/materials
- **Loading states – one signal, always with words.** A full-screen start (auth probe, Microsoft
  callback) is `components/boot-screen.tsx`: snail + «KP RÜCK» + the phase, no percentage, and
  «Neu starten» after 9 s. In the app it is the shell trail (`components/ui/shell-loader.tsx`):
  `LoadingStatus` for a stand-alone wait (words required, `role="status"`; `surface` = 48px
  stacked for an empty dialog/panel, `inline` = 20px beside the text), `ShellLoader` in the icon
  slot of a busy button beside its label. Do not add `Loader2`/`animate-spin` spinners, and no
  artificial minimum wait. Under reduced motion the trail and the snail stand still, and
  overlays fade without zoom/slide (`globals.css`, via tw-animate's variables – never a blanket
  `transform: none`, which would break positioning and drag-and-drop).
- **The snail is shared with KP Front and edited there.** `frontend/public/firefighter-snail-loader.svg`
  is a byte-identical copy of kp-front's `public/firefighter-snail-loader.svg`, and
  `SHELL_TRAIL_PATH` is its `fs-shell-trail` path. Never edit either here; colour it from the
  outside (`--accent` is pointed at `--primary`). The SVG is in `shared/MANIFEST.json`;
  `shell-loader.test.tsx` holds `SHELL_TRAIL_PATH` to it.
- **Toasts – one message surface**: one lane, `components/ui/sonner.tsx` (sonner runs `unstyled`;
  its injected CSS is unlayered and beats every Tailwind utility, so tone classes on a call site do
  nothing). Same neutral card for every type, tone only in the glyph; `toast.error` is the only
  tinted card, so use it for failures and nothing else. Don't pass `duration` unless you mean it:
  the lifetime comes from the text length (`lib/toast-lifetime.ts`, Front's curve; errors and
  toasts with a button get at least 6 s; scaled by the
  «Anzeigedauer» setting). A bare `toast()` bypasses that and must spread `toastLifetime(ms)`.
  Phone placement reads `--nav-reserve` / `--sheet-top` / `--kb-inset` on `<html>`.
- **Notification text**: toasts and the bell show a notification as line 1 = what is asked,
  line 2 = where · who, source as glyph (`lib/notification-format.ts`). The backend sends
  `type` + `params` (the facts, one shape per type) and a German `message`; every row is built by
  one function in `backend/app/services/notification_params.py` that returns both, and the
  client renders `params` through `notifications.messages.*` in the device's language. Adding or
  changing a notification = a builder there (+ its pinned test) and a case + copy (de AND fr) +
  test in `notification-format.ts`. A row without params, an unknown type/variant or a missing
  fact falls back to the German `message` on one line, so nothing is lost. Never parse `message`.
- **«Gespeichert» means the server confirmed it** (`lib/field-save.ts`, `components/kanban/field-save-status.tsx`).
  The detail's free-text fields show «Wird gespeichert …» / «Gespeichert – hh:mm» / «Nicht gespeichert»
  under the field. The store is fed by `updateOperation` (the one funnel) and a field is «saved» only
  when the PATCH carrying its NEWEST text answered; PATCHes run one at a time per incident
  (`KeyedSerialQueue`) so the server sees edits in order. A failed text stays as a draft in the field —
  render the control's `value` from `useFieldSave(...).value`, never straight from `operation`, or a
  reload replaces it — and is sent again only via «Erneut speichern». No automatic resend, no offline
  queue. Drafts are scoped to user + Ereignis; a user switch drops them and a queued write of the
  previous user is not sent. A new free-text incident field goes into `SAVED_TEXT_FIELDS`.
- **Stale banner**: a connected WebSocket only vouches for the board once a load got through AFTER it
  came up (`BoardSyncStatus.liveSince`); «connected»/«connecting» alone never hide the warning.
- **Form messages** (`components/ui/form-message.tsx`): what is wrong with a field is said UNDER
  it. Red `error` blocks saving (`role="alert"`, the control gets `fieldMessageProps(id, 'error')`
  = `aria-invalid` + `aria-describedby`, a submit focuses the first blocking field via
  `focusFirstBlockingField`); amber `advice` is a polite status and never blocks. No toast for a
  field problem, and no submit button greyed out without a word. `DetailField` takes `error` /
  `advice` and renders it with the id `formMessageId(htmlFor)`.
- **Empty lists** (`components/ui/empty-state.tsx`): say WHY and offer the one way out – search
  («Keine Treffer für «q».» + «Suche leeren»), filter (name it + «Filter zurücksetzen», which
  keeps the search and every tick), truly nothing (what would fill it), everything taken (a line
  above the spoken-for block, not a replacement). Title + one line + at most one action, no big
  icons; the repeated board columns keep their single grey sentence.
- **Maps never rise above overlays.** Every map goes through `components/map/base-map.tsx`, whose
  wrapper is `isolate`: markers (z up to 1000) and controls (z 2000) only compete inside the map.
  Map chrome laid over a map from outside (chips, legend, fit-all) sits in a wrapper that is
  `isolate` too. Never give map content a z-index meant for the page.
- **MapLibre's worker is a served file**: `scripts/copy-maplibre-worker.mjs` copies it to
  `public/maplibre/` (gitignored) before `dev`/`build`, and `base-map.tsx` calls `setWorkerUrl`.
  Without it MapLibre 6 under webpack spawns the page as its worker – the basemap still draws,
  but no GeoJSON layer loads and `load` never fires (no fit, pan, routes, lines, trails).
- **Map mode** (`auto` | `online` | `offline`, a database setting chosen in Settings):
  `lib/hooks/use-map-mode.ts` and `getTileBaseUrl()` in `lib/env.ts` – auto tries online OSM first
  and falls back to the offline tiles on a network error; the map view shows which mode is live.
- **Lagekarte labels on a phone** (`lib/map-labels.ts`, ≤767px or coarse pointer): no permanent
  labels below zoom 16 – a tap shows the selected marker's label/card; from 16 on, only labels
  that collide with no other label or dot. Desktop keeps every label.
- **Search fields**: every «type to narrow this list» is `components/ui/search-input.tsx` – its
  ✕ is «Suche leeren» and keeps focus, it is ≥44px with 16px text on a phone or coarse pointer
  whatever `className` says, focus is the `Input` ring (no own ring), `count` is the optional
  live hit count. Not a hand-built `relative` + `<Search>` + `<Input>`. Where the chip rows do
  not fit (`useCompactFilters`: ≤639px wide or ≤719px tall) the assignment dialog folds them into
  ONE «Filtern» menu with the active count on the button and a «Gefiltert: …» line under it.
- **Undo never restores a snapshot blindly.** An undo is a new write that must still be valid
  *now*: the route-optimisation undo sends `expected_ids` with `POST /incident-groups/{id}/stops/reorder`
  (server compares under the Auftrag row lock → 409 «Auftrag geändert»; every stop add/remove/
  detach takes that lock), and the release undo (`lib/hooks/use-release-undo.ts`) re-assigns
  through the ordinary assign functions after `checkRestore` (`lib/release-undo.ts`) confirmed
  nobody put the resource elsewhere meanwhile. Wrap the operator's *own* releases with
  `useReleaseUndo`; internal releases (conflict «verschieben», completion) stay raw.
- **Durations go through `lib/duration.ts`** (`formatDuration` / `formatDurationLong`) – no
  hand-rolled minute maths. From one day on every compact clock reads `1d 10h`; the full value
  («1 Tag 10 Stunden») goes into the accessible name/tooltip. The 60/120-minute age colours
  (`ageLevel`) are a Fachentscheidung – formatting changes must not touch them.
- **Route optimisation is a Luftlinie suggestion**: label it «Vorschlag nach Luftlinie ·
  Planungshilfe» and show the start point with provenance (`lib/route-start.ts`: settings vs.
  Ersatzstandort, GPS report time/age, fallback to the first stop). One action
  (`components/map/route-optimize.tsx`) serves all three entry points – don't copy it.

## UI rules

Users, brand, aesthetic, the full colour roles and the reasoning behind every rule below:
[`docs/DESIGN.md`](docs/DESIGN.md) – read it before a design decision.

- **Desktop with mouse and keyboard is the brief.** Dense targets, power-user shortcuts; a phone
  views (an editor may spawn training incidents), tablets are KP Front's. Sizes follow the button
  scale in `frontend/components/ui/button.tsx`.
- **Colour roles – one colour, one meaning** (tokens in `frontend/app/globals.css`):
  - selection = slate, tonal, never a fill (`<Button variant="selected">`, `sel-choice`, `--sel*`);
  - red = priority and danger only, never an action (`destructive` is a red outline);
  - green = frei / verfügbar on availability dots and badges only;
  - focus = slate (`--ring`), never red;
  - board column header lines are the status key; cards don't repeat the status as a tint.
- **Main button = ink** (`<Button>` default), one per surface.
- **Type**: Sora (`font-sans`) and Spline Sans Mono (`font-mono`) only.
- **Corners**: `rounded-md`/`-lg`/`-xl` are all 12px; controls under 32px tall use `rounded-sm`
  (8px); pills `rounded-full`.
- **App icon**: drawn only in `scripts/build-icons.mjs`; rerun it, never edit its outputs.
- **Calm**: motion only for a meaningful state change; never colour alone for meaning.
