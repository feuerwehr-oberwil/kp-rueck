import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

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
