import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { RESOURCE_STATE_BADGE_CLASSES, RESOURCE_STATE_DOT_CLASSES } from '@/lib/resource-status'

// --- red is priority and danger, never an accent --------------------------------------
//
// `--primary` is the fire-service red. As `text-primary` it had spread to 47 decorative
// places – dialog-title icons, the «+» of «Neuer Einsatz», the «Anrufen» link, the bell's
// count pill, the `link` Button – where a tired eye reads «danger» for no reason
// (sweep 2026-10, VISUAL-02; DESIGN.md → Colour roles). Header icons are muted, links
// are foreground + underline, counts use the ink chip. Priority and danger have their
// own classes (`lib/priority.ts`, the `destructive` variants), so no file needs
// `text-primary` at all; a deliberate exception goes into ALLOWED with the reason.

const ROOT = resolve(__dirname, '..')
const SOURCE_DIRS = ['app', 'components', 'lib']
const ALLOWED: ReadonlySet<string> = new Set([])

// `text-primary` as a whole class – not `text-primary-foreground`, which is the text ON
// a red fill and fine.
const RED_TEXT = /(?<![\w-])text-primary(?![\w-])/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

describe('colour roles', () => {
  it('uses no text-primary (red as decoration) outside the allowed files', () => {
    const offenders = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((path) => relative(ROOT, path))
      .filter((file) => !ALLOWED.has(file))
      .flatMap((file) =>
        readFileSync(join(ROOT, file), 'utf8')
          .split('\n')
          .flatMap((line, i) => (RED_TEXT.test(line) ? [`${file}:${i + 1}`] : [])),
      )
    expect(offenders).toEqual([])
  })
})

// --- amber is «schau hin», never a fact --------------------------------------------------
//
// Amber means one thing: look here – Mittel, Am Warten, ≥60′, a double booking, the stale
// banner. «EL», «n gebunden» and the gebunden dot are facts; drawn amber they turned a
// storm evening's sidebar (17 of 20 gebunden) into one long warning (sweep 2026-10,
// VISUAL-03, owner pick A). They are ink now: EL = the column-count chip, gebunden = a
// hollow ink ring / muted text. The files below draw only those marks; a conflict in them
// speaks through the `warning` token, never a raw amber step.

const WARM = /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|inset-ring|fill|stroke)(?:-[a-z])?-(?:amber|orange|yellow)-\d/
const FACT_FILES = [
  'components/kanban/leader-badge.tsx',
  'components/kanban/draggable-person.tsx',
  'components/kanban/draggable-material.tsx',
  'components/kanban/material-group-block.tsx',
  'components/board/personnel-sidebar.tsx',
  'components/board/material-sidebar.tsx',
  'components/board/sidebar-parts.tsx',
]

describe('amber is not a fact', () => {
  it('draws gebunden without a warm hue', () => {
    expect(RESOURCE_STATE_DOT_CLASSES.assigned).not.toMatch(WARM)
    expect(RESOURCE_STATE_BADGE_CLASSES.assigned).not.toMatch(WARM)
  })

  it.each(FACT_FILES)('%s paints no raw amber', (file) => {
    const offenders = readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, i) => (WARM.test(line) ? [`${file}:${i + 1}`] : []))
    expect(offenders).toEqual([])
  })
})

// --- the colour map (consistency sweep 17.11.2026, COL; docs/DESIGN.md «Colour roles») ---
//
// One meaning, one token. These rules hold the map in place; a deliberate exception goes
// into the rule's ALLOWED set with the reason beside it.

const ALL_FILES = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((path) => relative(ROOT, path))
const UI_FILES = ALL_FILES.filter((file) => file.startsWith('app/') || file.startsWith('components/'))
const GLOBALS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')

/** The file's text with every comment blanked out (line numbers kept), so a rule judges code. */
function code(file: string): string[] {
  const text = readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  return text.split('\n')
}

/** `file:line` of every code line the rule matches, outside the allowed files. */
function offenders(
  files: readonly string[],
  rule: RegExp | ((line: string) => boolean),
  allowed: ReadonlySet<string> = new Set(),
): string[] {
  const hit = typeof rule === 'function' ? rule : (line: string) => rule.test(line)
  return files
    .filter((file) => !allowed.has(file))
    .flatMap((file) => code(file).flatMap((line, i) => (hit(line) ? [`${file}:${i + 1}`] : [])))
}

// Rule 1 – a meaning is a token, not a palette step. Amber had grown four text shades beside
// `warning` (ENT-17), emerald a second «frei» beside `RESOURCE_STATE_*`, purple a private
// simulation palette (COL-07). Only the status table keeps palette steps: `STATUS_ACCENT`
// (Reko violet, Im Einsatz fuchsia, one grey) is the documented source of the status colours.
const RAW_PALETTE =
  /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke|from|to|via|shadow|inset-ring|decoration|divide|placeholder|caret)(?:-[trblxy])?-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d/
const RAW_PALETTE_ALLOWED: ReadonlySet<string> = new Set(['lib/kanban-utils.ts'])

// Rule 2 – a colour literal in a component is a meaning nobody can find. Map hex lives in
// lib/map-colors.ts, lib/priority.ts and lib/map-priority.ts; shadows (black, or the arbitrary
// `shadow-[…]` / `drop-shadow-[…]` values) and the white frame every map mark wears are fine.
const COLOUR_LITERAL = /#[0-9a-fA-F]{6}\b|["'`]#[0-9a-fA-F]{3}["'`]|rgba?\((?!\s*0[\s,]+0[\s,]+0\b)(?!\s*255[\s,]+255[\s,]+255\b)/
const COLOUR_LITERAL_ALLOWED: ReadonlySet<string> = new Set([
  // Stands alone when the root layout has crashed: no stylesheet, no tokens.
  'app/global-error.tsx',
  // The Microsoft logo is Microsoft's four colours.
  'app/login/page.tsx',
])

describe('the colour map', () => {
  it('paints no raw palette step outside the status table', () => {
    expect(offenders(ALL_FILES, RAW_PALETTE, RAW_PALETTE_ALLOWED)).toEqual([])
  })

  it('writes no colour literal in a component', () => {
    const SHADOW = /(?:drop-)?shadow-\[[^\]]*\]/g
    const literal = (line: string) => COLOUR_LITERAL.test(line.replace(SHADOW, ''))
    expect(offenders(UI_FILES, literal, COLOUR_LITERAL_ALLOWED)).toEqual([])
  })

  // Rule 3 – a semantic colour as TEXT reads its text tone. `success`, `warning` and `free`
  // are fill tones; at night `text-success` on the fill measured 2.2:1 (COL-01). `@theme`
  // re-points `text-*` alone, as `destructive` always did.
  it.each(['destructive', 'success', 'warning', 'free', 'prio-high', 'prio-medium', 'prio-low'])(
    'text-%s reads a text tone of its own',
    (token) => {
      expect(GLOBALS).toMatch(new RegExp(`--text-color-${token}:\\s*var\\(--${token}-text\\)`))
    },
  )

  // …and blue is not a feedback colour any more: `--info` (and the saturated `--accent`) are
  // retired. Blue as a colour is an Auftrag's; as chrome it is the selection (COL-04, XAPP-06).
  it('has no info or accent token', () => {
    expect(GLOBALS).not.toMatch(/--(?:color-)?(?:info|accent)(?:-foreground)?\s*:/)
    expect(offenders(ALL_FILES, /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|from|via|to|fill|stroke)-info(?![\w-])/)).toEqual([])
  })

  // Rule 4 – red and blue never FILL: no `accent` token, no red primary as a background,
  // edge, ring or shadow. A slider's range, a progress bar, a hover all have their own token.
  it('fills nothing with primary or accent', () => {
    const FILL = /(?<![\w-])(?:[a-z-]+:)*(?:bg|border|ring|shadow|outline)(?:-[trblxy])?-(?:accent|primary)(?![\w-])/
    expect(offenders(ALL_FILES, FILL)).toEqual([])
  })

  // Rule 5 – the tokens are oklch(); `hsl(var(--primary) / .4)` was invalid CSS and the wall's
  // status flash drew nothing at all (COL-05).
  it('wraps no token in hsl()', () => {
    expect(offenders(ALL_FILES, /hsl\(var\(--/)).toEqual([])
    expect(GLOBALS).not.toMatch(/hsl\(var\(--/)
  })

  // Rule 6 – focus is the ring (= the selection line). Red or amber focus only says a FIELD is
  // invalid or under advice, and only these field-state helpers draw it.
  it('draws focus only with the ring, outside the field-state helpers', () => {
    const COLOURED_FOCUS = /focus(?:-visible)?:(?:ring|outline|border)-(?!ring\b|ring\/|sel-|offset|inset|none\b|hidden\b|border\b|transparent\b|\d)[a-z]/
    const FIELD_STATE: ReadonlySet<string> = new Set([
      'components/ui/form-message.tsx',
      'components/kanban/field-save-status.tsx',
      'components/location/location-input.tsx',
    ])
    expect(offenders(ALL_FILES, COLOURED_FOCUS, FIELD_STATE)).toEqual([])
  })

  // Rule 7 – white text belongs on a SOLID red. On a red tint it was 1.5:1: the wall's «screen
  // is stale» alert could not be read in the light theme (COL-02).
  it('puts text-destructive-foreground only on a solid destructive fill', () => {
    const misplaced = (line: string) =>
      /text-destructive-foreground/.test(line) && !/(?<![\w-])bg-destructive(?![\w/-])/.test(line)
    expect(offenders(ALL_FILES, misplaced)).toEqual([])
  })
})
