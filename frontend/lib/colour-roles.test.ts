import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { RESOURCE_STATE_BADGE_CLASSES, RESOURCE_STATE_DOT_CLASSES } from '@/lib/resource-status'

// --- red is priority and danger, never an accent --------------------------------------
//
// `--primary` is the fire-service red. As `text-primary` it had spread to 47 decorative
// places – dialog-title icons, the «+» of «Neuer Einsatz», the «Anrufen» link, the bell's
// count pill, the `link` Button – where a tired eye reads «danger» for no reason
// (sweep 2026-10, VISUAL-02; CLAUDE.md → Colour roles). Header icons are muted, links
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
