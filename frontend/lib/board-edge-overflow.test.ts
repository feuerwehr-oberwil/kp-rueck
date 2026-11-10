import { describe, expect, it } from 'vitest'
import { computeEdgeOverflow, scrollTargetFor, type BoardScrollGeometry } from './board-edge-overflow'

// The live board at 1920×1080 with both sidebars (UX-DESKTOP-07): a 1408px scroller, 16px
// padding, six 320px columns 12px apart and the 48px Abgeschlossen strip.
const IDS = ['incoming', 'reko', 'reko_done', 'enroute', 'active', 'returning', 'complete']
const columns = IDS.map((id, i) => {
  const left = 16 + i * 332
  return { id, left, right: left + (id === 'complete' ? 48 : 320) }
})
const board = (scrollLeft: number, { clientWidth = 1408, padRight = 16 } = {}): BoardScrollGeometry => ({
  scrollLeft,
  clientWidth,
  scrollWidth: columns[columns.length - 1].right + padRight,
  padLeft: 16,
  padRight,
  columns,
})

describe('computeEdgeOverflow', () => {
  it('at rest a column showing less than 96px is named – the 64px of Im Einsatz count as hidden (D7)', () => {
    // Im Einsatz starts at 1344 of a 1408px view: 64px of it show
    expect(computeEdgeOverflow(board(0))).toEqual({ left: [], right: ['active', 'returning', 'complete'] })
  })

  it('96px in view is a column; 95px is a chip', () => {
    // Im Einsatz starts at 1344
    expect(computeEdgeOverflow(board(1344 + 96 - 1408)).right).toEqual(['returning', 'complete'])
    expect(computeEdgeOverflow(board(1344 + 95 - 1408)).right).toEqual(['active', 'returning', 'complete'])
    // Eingegangen ends at 336
    expect(computeEdgeOverflow(board(336 - 96)).left).toEqual([])
    expect(computeEdgeOverflow(board(336 - 95)).left).toEqual(['incoming'])
  })

  it('the 48px folded strip is a column once it is whole in view, and named while any of it is cut', () => {
    const strip = columns[columns.length - 1]
    expect(computeEdgeOverflow(board(strip.right - 1408)).right).toEqual([])
    expect(computeEdgeOverflow(board(strip.right - 1 - 1408)).right).toEqual(['complete'])
  })

  it('detail open (narrow board, scrolled to Im Einsatz): Reko abgeschlossen shows 262px and is not named', () => {
    const o = computeEdgeOverflow(board(columns[2].left + 58, { clientWidth: 928 }))
    expect(o).toEqual({ left: ['incoming', 'reko'], right: ['returning', 'complete'] })
  })

  it('names nothing when everything fits (sidebars hidden on a wide screen)', () => {
    expect(computeEdgeOverflow(board(0, { clientWidth: 2200 }))).toEqual({ left: [], right: [] })
  })

  it('scrolled fully right, the 4px sliver of Reko is named with Eingegangen', () => {
    const g = board(0)
    expect(computeEdgeOverflow(board(g.scrollWidth - g.clientWidth))).toEqual({ left: ['incoming', 'reko'], right: [] })
  })
})

describe('scrollTargetFor', () => {
  it('brings a clicked column fully into view, with the board padding beside it', () => {
    const target = scrollTargetFor(board(0), 'returning')!
    expect(target + 1408 - columns[5].right).toBe(16)
    // Rückfahrt is no longer named; the strip after it shows 4px of 48 and still is
    expect(computeEdgeOverflow(board(target)).right).toEqual(['complete'])
  })

  it('scrolls to the very end for the last column, so nothing is named on the right', () => {
    const g = board(0)
    expect(scrollTargetFor(g, 'complete')).toBe(g.scrollWidth - g.clientWidth)
  })

  it('scrolls back to the start for the first column', () => {
    expect(scrollTargetFor(board(400), 'incoming')).toBe(0)
  })
})
