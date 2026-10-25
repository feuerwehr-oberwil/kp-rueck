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
for running the board. The viewer role is strictly read-only. Sizing decisions follow from this –
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
  **not** the action or selection colour. Warm grays, slate selection, ink main button; status
  colors carry meaning and must be consistent. See «Colour roles» below.
- **App icon**: the sibling of KP Front's (ink tile, white «kp», red «rück», the board glyph).
  Drawn ONLY in `scripts/build-icons.mjs`; it writes `frontend/app/icon.svg` and renders
  `frontend/public/icons/*.png` + `scripts/build-icons.lock.json` – rerun it after any artwork
  change, never edit the outputs (`--check` in `lib/web-manifest.test.ts` fails otherwise). The
  home-screen icon must stay a PNG: iOS ignores an SVG apple-touch-icon.
- **Anti-references**: Avoid playful/consumer aesthetics (Slack, Figma), gamification,
  decorative illustrations, or anything that undermines the seriousness of the operational
  context.

## Colour roles

One colour, one meaning – decided in the 2026-10 UI review.

- **Selection = slate «A2»**, tonal, never a fill: a chosen chip/filter/preset/segment/current
  status = `--sel-wash` + `--sel-foreground` + 1px `--sel-edge` (`<Button variant="selected">`, or
  the `sel-choice` utility on borderless controls); switch/checkbox «an» = `--sel`; ticked row =
  wash + edge + slate ✓ (never emerald); selected Einsatz card = 2px `--sel-line` outline.
  Where-you-are (active tab, open popover/panel trigger) = ink tint `bg-foreground/[0.09]`.
- **Red = priority and danger only.** It never fills an action: the main button is ink
  (`--action`), `destructive` is a red outline. Hoch cards keep their red edge, wash, ring and
  pulse.
- **Amber = «schau hin»** – something needs a look: Mittel (edge, «–»), Am Warten, age ≥60′,
  a double booking / conflict, Abholung, /feld «kein Rapport», the stale banner, a non-blocking
  form advice. Never a plain fact (2026-10-24, VISUAL-03 pick A).
- **Facts are ink.** «EL» is the neutral ink chip of the column count (`bg-foreground/10
  text-foreground`); «n gebunden» is plain `text-muted-foreground` beside the green «n frei»;
  an open-Reko count beside «frei» is muted too.
- **Availability marks, three states** (`RESOURCE_STATE_DOT_CLASSES` in
  `lib/resource-status.ts` – use it, don't hand-roll): frei = green filled dot, gebunden =
  hollow ink ring (`inset-ring`, the dot keeps its size), nicht verfügbar = faint grey.
  The outline badge for gebunden is ink as well. `lib/colour-roles.test.ts` keeps raw amber
  out of the EL badge and the sidebar rows.
- **Green = frei / verfügbar** on the availability dots and badges themselves. Never for
  «selected» – a toggled filter such as «Nur verfügbare» uses the slate selected state like every
  other filter.
- **Status hues are only the status key.** Im Einsatz orange sits one step from amber and Reko
  emerald matches «frei» – both stay column lines and status chips, nothing else picks them up
  (whether they change is still open).
- **Board column header lines are the status key** – they stay coloured; cards don't repeat the
  status as a tint (phone cards are neutral except Hoch).
- **Focus = slate** (`--ring` = `--sel-line`), never red – a red ring reads as an error.

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
