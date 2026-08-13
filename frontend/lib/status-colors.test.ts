import { describe, expect, it } from 'vitest'
import { columns, STATUS_ACCENT, stopStatusBorderClass, stopStatusTextClass } from '@/lib/kanban-utils'
import { PRIORITY_CARD_CLASSES, PRIORITY_EDGE_CLASSES, PRIORITY_ICON_CLASSES } from '@/lib/priority'

/**
 * Two of these screens hang on the same wall. What is pinned here is not a
 * palette but the two rules that keep them readable side by side:
 *
 *  1. one status has ONE colour, on every surface that draws it;
 *  2. status and priority never speak the same colour.
 *
 * Both were broken before: `returning` was emerald on the route-stop rows and
 * sky on the board and the wall, and `active` was amber — which is `warning`,
 * i.e. medium priority and «Am Warten».
 */

/** Tailwind hue token out of a class like `bg-sky-100/80` or `border-l-zinc-500`. */
function hues(classNames: string): string[] {
  return [...classNames.matchAll(/-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/g)]
    .map((m) => m[1])
}

/** The greys are interchangeable by design — `complete` is gray in light mode
 *  and zinc in dark. Everything else has to be itself. */
const NEUTRALS = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone'])
const family = (hue: string) => (NEUTRALS.has(hue) ? 'neutral' : hue)

describe('a status has one colour on every surface', () => {
  it.each(Object.entries(STATUS_ACCENT))('%s draws surface, edge, text and dot in one hue', (_status, accent) => {
    const families = new Set(
      [accent.surface, accent.border, accent.text, accent.dot].flatMap(hues).map(family),
    )
    expect([...families]).toHaveLength(1)
  })

  it('the board columns and the route-stop rows read the same table', () => {
    for (const column of columns) {
      expect(column.color).toBe(STATUS_ACCENT[column.id].surface)
    }
    // The stop rows collapse seven statuses onto five, but each of the five has
    // to carry the colour of the column it mirrors.
    for (const status of ['incoming', 'enroute', 'active', 'returning', 'complete'] as const) {
      expect(stopStatusBorderClass(status)).toBe(STATUS_ACCENT[status].border)
      expect(stopStatusTextClass(status)).toBe(STATUS_ACCENT[status].text)
    }
  })

  it('no two statuses share a hue, so a column is identifiable by colour alone', () => {
    const seen = new Map<string, string>()
    for (const [status, accent] of Object.entries(STATUS_ACCENT)) {
      const hue = family(hues(accent.dot)[0])
      // `incoming` and `complete` are both deliberately neutral — nothing yet,
      // and nothing any more. Every other status is unique.
      if (hue === 'neutral') continue
      expect(seen.get(hue), `${status} and ${seen.get(hue)} are both ${hue}`).toBeUndefined()
      seen.set(hue, status)
    }
  })
})

describe('status and priority never speak the same colour', () => {
  it('priority owns destructive and warning, and no status may borrow them', () => {
    const priorityTokens = Object.values({ ...PRIORITY_EDGE_CLASSES, ...PRIORITY_CARD_CLASSES, ...PRIORITY_ICON_CLASSES }).join(' ')
    expect(priorityTokens).toMatch(/destructive/)
    expect(priorityTokens).toMatch(/warning/)

    for (const [status, accent] of Object.entries(STATUS_ACCENT)) {
      const all = [accent.surface, accent.border, accent.text, accent.dot].join(' ')
      expect(all, `${status} must not use a priority colour`).not.toMatch(/destructive|warning/)
      // Red and amber are the palette steps behind those two tokens.
      expect(hues(all), `${status} must not use a priority hue`).not.toContain('red')
      expect(hues(all), `${status} must not use a priority hue`).not.toContain('amber')
    }
  })
})
