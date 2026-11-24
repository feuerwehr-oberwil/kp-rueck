# Frontend conventions

Rules for code under `frontend/`. [`../AGENTS.md`](../AGENTS.md) points here before a frontend
change. Read the section you touch. The visual rules and their reasons are
[`DESIGN.md`](DESIGN.md).

## Next.js and React

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
- **API Integration**: Centralized API client in `lib/api-client.ts`. Collection routes need
  their trailing slash, or a write is lost to a 307: [`BACKEND.md`](BACKEND.md#api-endpoints).
- **State Management**: React Context for global state (`lib/contexts/`, the board in `operations-context.tsx`)
- **UI Components**: shadcn/ui components in `components/ui/`

## Phone layout
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
- **A page level deeper (a step, a detail over a list) is one history entry**
  (`useHistoryLevel` in `lib/hooks/use-history-level.ts`), so the phone's back gesture steps up
  one level instead of leaving the page. Its in-page «Zurück» calls what the hook returns.
  Today: /alarm's review step, the /feld Schadenplatz.

## Overflow
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


## i18n

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

## Words and wall text

- **Words**: **Mannschaft** = the crew of an Einsatz/Auftrag; **Personal** = the roster
  (sidebar, settings, check-in). The verb is **zuweisen** (never zuteilen). Releasing a resource
  is «freigeben». A confirm button names the consequence («Ohne Mannschaft disponieren»,
  «Angekommen melden»), never «Ja, …» (KP Front WORD.7).
- **Wall text (`/display/*`) wraps, it does not truncate** – nobody at a wall can hover a
  tooltip. Addresses, column heads and labels use `WALL_TEXT_WRAP` (`lib/kanban-utils.ts`:
  hyphenate, `break-words` only as last resort, never `break-all`). If a fact still must fit one
  line, move it to its own line instead of ending it in «…».
- **Resource conflicts**: UI warns when assigning already-assigned personnel/vehicles/materials

## Patterns

- **Loading states – one signal, always with words.** A full-screen start (auth probe, Microsoft
  callback) is `components/boot-screen.tsx`: snail + «KP RÜCK» + the station's name + the phase,
  no percentage, and «Neu starten» after 9 s. The station's name shows once this device has
  loaded a board (`lib/station-name.ts`; the login card shows it too). In the app it is the shell
  trail (`components/ui/shell-loader.tsx`): `LoadingStatus` for a stand-alone wait (words
  required, `role="status"`; `surface` = 48px stacked for an empty dialog/panel, `inline` = 20px
  beside the text), `ShellLoader` in the icon slot of a busy button beside its label (a spinner
  is a lint error). Do not add an artificial minimum wait. Under reduced motion
  the trail and the snail stand still, and overlays fade without zoom/slide (`globals.css`, via
  tw-animate's variables). Never use a blanket `transform: none`: it breaks positioning and
  drag-and-drop.
- **The snail is shared with KP Front and edited there.** `frontend/public/firefighter-snail-loader.svg`
  is a byte-identical copy of kp-front's `public/firefighter-snail-loader.svg`, and
  `SHELL_TRAIL_PATH` is its `fs-shell-trail` path. Never edit either here. Set the wrapper’s
  `--accent` to KP Front’s default red for the active theme. The SVG is in `shared/MANIFEST.json`;
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
- **Maps never rise above overlays.** Every map goes through `components/map/base-map.tsx` (a lint
  error elsewhere). Its
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
  hand-rolled minute maths. Every surface uses ONE notation, the magnet board's:
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
