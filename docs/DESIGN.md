# Design context

Who KP Rück is for, how it should feel, and the visual decisions that follow from that. The
rules a change must not break are also listed, one line each, in [`../CLAUDE.md`](../CLAUDE.md)
(«UI rules»); this page is the reasoning and the detail behind them. Tokens live in
`frontend/app/globals.css`.

## Users

Firefighting command post operators (KP Rück) managing active incidents in high-stress
environments. They coordinate personnel, vehicles, and materials in real-time from a command post
– **on a desktop with mouse and keyboard**. Speed, clarity, and zero-confusion are critical. This
tool replaces a physical magnet board, so spatial familiarity and at-a-glance readability matter.

**Tablets are KP Front's brief, not this one.** KP Rück's UI is not sized around touch targets; a
phone is used for *viewing* (and, with an editor account, for spawning training incidents), never
for running the board. The one tablet surface here is `/display/bereitschaft`: a shared tablet
at the station on which a waiting crew *reads* what is ready, what waits and who is out – it
writes nothing, and the other `/display` pages are navigable by touch, not laid out for it.
The viewer role is strictly read-only. Sizing decisions follow from this –
see the button size scale in `frontend/components/ui/button.tsx`.

## Brand personality

**Reliable, Clear, Calm.** The interface should feel like a trusted instrument – professional,
dependable, and composed under pressure. It communicates competence without being flashy. Swiss
precision meets emergency readiness.

## Emotional goals

- **Calm confidence** – Users feel in control and assured; reduce stress, not add to it
- **Structured clarity** – Everything has a place; operators should feel organized and never lost
- **Empowered efficiency** – Every interaction should feel productive; minimize friction

## Aesthetic direction

- **Visual tone**: Clean, information-dense, dark-mode-first. Inspired by Linear and Trello –
  minimal chrome, excellent information hierarchy, smooth interactions. Borrows density and
  seriousness from military C2 and dispatch systems but wrapped in modern, approachable UI
  patterns.
- **Typography**: Sora (sans) + Spline Sans Mono – the faces KP Front and kp-rueck.ch use; see
  «Type & corners» below.
- **Color**: Red is the fire-service identity (logo) and the priority/danger signal – it is
  **not** the action or selection colour. Warm grays, a tonal blue selection (KP Front's hue), ink
  main button; status colors carry meaning and must be consistent. See «Colour roles» below.
- **App icon**: the sibling of KP Front's (ink tile, white «kp», red «rück», the board glyph).
  Drawn ONLY in `scripts/build-icons.mjs`; it writes `frontend/app/icon.svg` and renders
  `frontend/public/icons/*.png` + `scripts/build-icons.lock.json` – rerun it after any artwork
  change, never edit the outputs (`--check` in `lib/web-manifest.test.ts` fails otherwise). The
  home-screen icon must stay a PNG: iOS ignores an SVG apple-touch-icon.
- **Anti-references**: Avoid playful/consumer aesthetics (Slack, Figma), gamification,
  decorative illustrations, or anything that undermines the seriousness of the operational
  context.

## Colour roles

One colour, one meaning – decided in the 2026-10 UI review, completed in the consistency sweep of
17.11.2026 (findings COL-01…14, picks XAPP-06 B, COL-04 A, COL-05 A, COL-07 A, COL-11 A, ENT-04 A,
ENT-05 B, ENT-09 + 09b A, ENT-11 A, ENT-16 A). `frontend/lib/colour-roles.test.ts` holds the map
below; a deliberate exception goes into the rule's allow-list with its reason.

### The colour map

| meaning | token / source | notes |
|---|---|---|
| fact, text, neutral glyph | `foreground`, `muted-foreground`; ink chip `bg-foreground/10 text-foreground` | «Facts are ink» |
| hover / press / active menu row | `hover:bg-muted`, active row `bg-foreground/10`, `--press` | never a hue |
| selected / on / ticked / drop target | `--sel`, `--sel-wash`, `--sel-edge`, `--sel-foreground`, `--sel-line` | tonal blue, never a filled chip |
| focus | `--ring` (= `--sel-line`) | red/amber only via the field-state helpers |
| «this one» – landed, highlighted | `this-one-ring` (globals.css) | two beats of ink, then gone |
| Hoch / Mittel / Niedrig | `--prio-high` / `--prio-medium` / `--prio-low` (`border-l-prio-*`, `text-prio-*`, `bg-prio-*`); hex mirror `PRIORITY_COLORS` | one value per priority, test-pinned |
| danger / error | `destructive`, text `text-destructive` | |
| «schau hin» | `warning` fill / edge, `text-warning` (= `warning-foreground`) | |
| frei / verfügbar | `--free`, read only through `RESOURCE_STATE_*` / `RESOURCE_FREE_TEXT_CLASS` | |
| ✓ bestätigt | `success`, `text-success` | always with ✓ or a word |
| status with crews out | `STATUS_ACCENT` (lib/kanban-utils.ts) | the one table that keeps palette steps |
| Auftrag | its swatch: `auftragColor` / `colorAccent`, `AUFTRAG_SWATCHES`, `GROUP_PALETTE` | never a generic blue |
| a thing on the map (place, vehicle label, trail, line, glyph, frame) | `MAP_INK` | no hue |
| none / no value | `MAP_NONE` (`COLOR_NONE`) | one grey |
| Übung | `training-hatch` / `training-hatch-band` | hatched ink, no hue |
| paper | `paper_palette.py`, mirrored as `--color-paper-*` for the print view | cool slate family |
| exempt | Einsatzart map colours, MeteoSwiss levels, radar ramp, Microsoft logo, app icon, `theme-color` / manifest, `global-error.tsx` | listed in the test with the reason |

Every semantic colour that is also written as TEXT has a text tone (`--destructive-text`,
`--success-text`, `--warning-text`, `--free-text`, `--prio-*-text`), wired through
`--text-color-*` in `@theme`: `text-success` reads the text tone, `bg-success` / `border-success`
the fill. At night the fill tones measured ~2:1 as words.

### The roles

- **Selection = KP Front's blue hue (#1f6feb; night #5aa0ff), tonal, never a fill** (XAPP-06 B):
  a chosen chip/filter/preset/segment/current status = `--sel-wash` + `--sel-foreground` + 1px
  `--sel-edge` (`<Button variant="selected">`, or the `sel-choice` utility on borderless controls);
  switch/checkbox «an», a slider's range = `--sel` / `--sel-line`; ticked row = wash + edge + ✓
  (never emerald); selected Einsatz card = 2px `--sel-line` outline; a drop target = `sel-line`
  ring + wash; a selected map pin = a `--sel-line` ring, its fill unchanged (ENT-04 A). Front
  fills it on the tablet; Rück's desktop keeps the quiet wash – one hue for «chosen» in both apps.
  Where-you-are (active tab, open popover/panel trigger, the keyboard row in a menu) = ink tint
  `bg-foreground/[0.09]`–`/10`.
- **Focus = the selection blue** (`--ring` = `--sel-line`), never red – a red ring reads as an
  error. Red or amber focus only on a field that is invalid or under advice (`form-message`,
  `field-save-status`, an invalid `LocationInput`).
- **«This one» = the two-beat ink ring** (COL-05 A, KP Front's `ui-flash-ring`): the board's
  «Hier steht sie» Spotlight card, the wall card the other window means, the wall's
  status-change flash, the highlighted Lagekarte pin, the /feld jump, the settings search
  landing. An outline, so the Hoch pulse cannot eat it; the priority edge stays. Search hits
  inside a text (Hilfe, Einstellungen) are `<mark class="bg-sel-wash">`.
- **Red = priority and danger only.** It never fills an action: the main button is ink
  (`--action`, also on the stand-alone `global-error` page), `destructive` is a red outline; no
  red slider, progress bar or map line. Hoch cards keep their red edge, wash, ring and pulse.
- **Priority is one colour per level** (COL-03): Hoch = the danger red, Mittel one amber
  (#d97706 – ≥ 3:1 as an edge on the light card and the dark one), Niedrig a light slate mark.
  Edge, glyph, picker chevron, dot, map pin and print map all read the `--prio-*` tokens or their
  test-pinned hex mirror `PRIORITY_COLORS`. On the Hoch pin the glyph is white.
- **Amber = «schau hin»** – something needs a look: Mittel (edge, «–»), Am Warten, age ≥60′,
  a double booking / conflict, Abholung, /feld «kein Rapport» and «Entwurf», the stale banner,
  an offline notice («not a fault, but look»), a non-blocking form advice. Never a plain fact
  and never «Übung» any more (2026-10-24, VISUAL-03 pick A; ENT-09).
- **Facts are ink.** «EL» is the neutral ink chip of the column count (`bg-foreground/10
  text-foreground`); «n gebunden» is plain `text-muted-foreground` beside the green «n frei»;
  an open-Reko count beside «frei» is muted too; the /feld source tags («Als Fahrer», «Reko»,
  «Magazin») are the muted chip; a material's «Standort», the wall's «Nur lesen» chip likewise.
  Card, dialog and menu icons are muted (training screens included, COL-07) – red stays only on
  «kritisch / eskalieren».
- **Availability marks, three states** (`RESOURCE_STATE_DOT_CLASSES` in
  `lib/resource-status.ts` – use it, don't hand-roll): frei = green filled dot, gebunden =
  hollow ink ring (`inset-ring`, the dot keeps its size), nicht verfügbar = faint grey.
  The outline badge for gebunden is ink as well. A written «n frei» is `RESOURCE_FREE_TEXT_CLASS`.
- **Green has two roles, told apart by shape** (ENT-11 A): **frei / verfügbar** – the dot and
  badge above, via `--free` only; and **✓ bestätigt** – «Synchronisiert», Rapport erfasst,
  Import abgeschlossen, Reko vor Ort, a sent Meldung – always with a ✓ or the word, only via the
  `success` token. On the Lagekarte a small green dot on a vehicle label says «sendet» (COL-04 A).
  Green is never «selected» (a toggled filter such as «Nur verfügbare» uses the selected state
  like every other filter), never Niedrig, never a status, never a «+».
- **Status colour only where crews are out** (`STATUS_ACCENT` in `lib/kanban-utils.ts`,
  2026-10-25, VISUAL-03 pick E): Reko = violet, Im Einsatz = fuchsia; Eingegangen, Reko
  abgeschlossen, Disponiert, Rückfahrt and Abgeschlossen share one neutral grey. No status uses
  red, amber, green or the selection blue. The grey statuses are told apart by position, the
  word and the route-stop icon.
- **Board column header lines are the status key** – the two coloured ones and the grey ones;
  cards don't repeat the status as a tint (phone cards are neutral except Hoch).
- **Blue as a colour = an Auftrag, nothing else** (COL-04 A). An Auftrag is drawn in its OWN
  swatch wherever it is known – the map, the board, the /feld stop numbers and «via Auftrag», the
  wall's Auftrag section head (a swatch beside the name, never the text colour). The swatches
  (`AUFTRAG_SWATCHES`: petrol, cyan, lime, indigo, brown, teal) avoid red, amber, green, violet,
  fuchsia and – since the selection took KP Front's blue – the saturated blue: the first swatch
  is petrol for new Aufträge; stored colours stay. «Färben nach Reko / Fahrzeug» hashes into the
  same family widened to ten (`GROUP_PALETTE`, ENT-05 B). There is no generic «info» blue: an
  inbound message is a muted glyph, an offline notice amber, a ✓ green, upload progress the
  neutral `Progress`.
- **On the map, things are ink** (`MAP_INK`): the firestation and Magazin marks, a reporting
  vehicle's label (with the green «sendet» dot; without signal: the hollow grey dashed pill), its
  GPS trail (thin, dashed), the vehicle → Einsatz ant trail (dashed, ENT-16 A), the priority
  glyph, the status frame, the location picker's pin. «Nothing here» is the one `MAP_NONE` grey.
- **The one map exception: Einsatzart colours** (`INCIDENT_TYPE_MARKER_COLORS`, COL-11 A). They
  follow the hazard and were agreed with the Kommandant (27.07.2026) before these roles, so Brand
  is red like Hoch, Strassenrettung green like frei, Dienstleistungen violet like Reko,
  Strahlenwehr fuchsia like Im Einsatz. Allowed because they are map-only, opt-in («Färben nach →
  Einsatzart») and always drawn with their legend.
- **Übung = KP Front's ÜBUNG tag** (ENT-09): hatched (4px ink stripes on an 8px period), a 1.5px
  dim-ink ring, ink text, no hue – `TrainingBadge`, beside every Ereignis name (board header and
  switcher, wall, Karte, phone, /feld, /alarm, Alarmeingang, Ereignisse); `TrainingBadge square`
  is the «Ü» tag where the word does not fit (a select row). The window's top band is the same
  hatching in ink, 5px (ENT-09b A), and the map's «GPS-Simulation läuft» pill wears it too
  (COL-07 A): one sign for «nicht echt».
- **Paper** is one cool slate family (`backend/app/services/paper_palette.py`, shared in spirit
  with KP Front's Einsatzrapport): the report, its footer, the Lageblatt and the browser print
  view (`--color-paper-*`). The ÜBUNG marker on paper keeps the report's amber for now.

## Type & corners

- **Sora** (sans) and **Spline Sans Mono** (mono), self-hosted via `next/font/local` from
  `frontend/app/fonts/` (SIL OFL, licences beside the files). Use `font-sans` / `font-mono`; don't
  add a third face.
- **Corners**: `--radius` 12px – `rounded-md`/`-lg`/`-xl` are all 12px. Controls under 32px tall
  (badges, kbd, h-5…h-7 chips) use `rounded-sm` (8px). Pills stay `rounded-full`.
- **Main button = ink** (`<Button>` default, one per surface); night = light ink `#c3cddc` with
  dark text.

## Design principles

1. **Clarity over decoration** – Every pixel should serve a purpose. Prioritize legibility,
   hierarchy, and scannability. No ornamental elements.
2. **Calm under pressure** – The UI must remain composed during high-stress moments. Avoid visual
   noise, unnecessary motion, or attention-competing elements. Reserve animation for meaningful
   state changes.
3. **Density with order** – Pack information tightly but with clear structure. Use consistent
   spacing, alignment, and grouping so operators can scan fast without feeling overwhelmed.
4. **Instant comprehension** – Status, priority, and assignments must be understood at a glance.
   Use color, position, and iconography systematically – never rely on color alone.
5. **Keyboard-fast, mouse-precise** – The board is operated from a desktop: power-user shortcuts,
   dense targets, no touch compromises. The phone layout is read-only enough that it can stay
   generous without holding the desktop back.
