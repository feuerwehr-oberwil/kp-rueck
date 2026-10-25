import { describe, expect, it } from 'vitest'
import { computeEdgeOverflow, scrollTargetFor, stackDepth, type BoardScrollGeometry } from './board-edge-overflow'

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
  it('names what is cut off on the right at rest – Im Einsatz, Rückfahrt, Abgeschlossen – and leaves Disponiert alone', () => {
    const o = computeEdgeOverflow(board(0))
    expect(o).toMatchObject({ left: [], right: ['active', 'returning', 'complete'], bandLeft: 0 })
    // the band starts where Im Einsatz starts: none of it shows beside the tabs
    expect(1408 - o.bandRight).toBe(columns[4].left)
  })

  it('a column the tab stack overlaps is not hidden by it (2xl, detail collapsed: pr-8 – the CI baseline)', () => {
    const o = computeEdgeOverflow(board(0, { padRight: 32 }))
    expect(o.right).toEqual(['active', 'returning', 'complete'])
    // the stack reaches 76px in, which is exactly Disponiert's right edge – never past it
    expect(o.bandRight).toBe(stackDepth(32))
    expect(1408 - o.bandRight).toBeGreaterThanOrEqual(columns[3].right)
  })

  it('detail open (narrow board, scrolled to Im Einsatz): the cut Reko abgeschlossen hides under the left band, Im Einsatz stays a column', () => {
    // 928px scroller scrolled so Reko abgeschlossen shows 262 of its 320px and Im Einsatz ends 2px before the edge
    const g = board(columns[2].left + 58, { clientWidth: 928 })
    const o = computeEdgeOverflow(g)
    expect(o.left).toEqual(['incoming', 'reko', 'reko_done'])
    expect(o.right).toEqual(['returning', 'complete'])
    // the left band runs to Reko abgeschlossen's right edge: no card fragment beside the tabs
    expect(g.scrollLeft + o.bandLeft).toBe(columns[2].right)
  })

  it('has no tabs when everything fits (sidebars hidden on a wide screen)', () => {
    expect(computeEdgeOverflow(board(0, { clientWidth: 2200 }))).toEqual({ left: [], right: [], bandLeft: 0, bandRight: 0 })
  })

  it('scrolled right, the left edge names the columns hidden there the same way', () => {
    const g = board(0)
    expect(computeEdgeOverflow(board(g.scrollWidth - g.clientWidth))).toMatchObject({ left: ['incoming', 'reko'], right: [], bandRight: 0 })
  })
})

describe('scrollTargetFor', () => {
  it('brings a clicked column fully into view, clear of the tabs still standing beside it', () => {
    const target = scrollTargetFor(board(0), 'active')!
    const o = computeEdgeOverflow(board(target))
    expect(o.right).toEqual(['returning', 'complete'])
    expect(target + 1408 - o.bandRight).toBeGreaterThan(columns[4].right)
  })

  it('scrolls to the very end for the last column, so no tab is left on the right', () => {
    const g = board(0)
    expect(scrollTargetFor(g, 'complete')).toBe(g.scrollWidth - g.clientWidth)
  })

  it('scrolls back to the start for the first column', () => {
    expect(scrollTargetFor(board(400), 'incoming')).toBe(0)
  })
})
