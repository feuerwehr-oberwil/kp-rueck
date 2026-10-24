import { describe, expect, it } from 'vitest'
import { computeEdgeOverflow, scrollTargetFor, type BoardScrollGeometry } from './board-edge-overflow'

// The live board at 1920×1080 with both sidebars (UX-DESKTOP-07): a 1408px scroller, 16px
// padding, six 320px columns 12px apart and the 48px Abgeschlossen strip.
const IDS = ['incoming', 'reko', 'reko_done', 'enroute', 'active', 'returning', 'complete']
const columns = IDS.map((id, i) => {
  const left = 16 + i * 332
  return { id, left, right: left + (id === 'complete' ? 48 : 320) }
})
const board = (scrollLeft: number, clientWidth = 1408): BoardScrollGeometry => ({
  scrollLeft,
  clientWidth,
  scrollWidth: columns[columns.length - 1].right + 16,
  padLeft: 16,
  padRight: 16,
  columns,
})

describe('computeEdgeOverflow', () => {
  it('names what is cut off on the right at rest – Im Einsatz, Rückfahrt, Abgeschlossen – and leaves Disponiert alone', () => {
    expect(computeEdgeOverflow(board(0))).toEqual({ left: [], right: ['active', 'returning', 'complete'] })
  })

  it('has no tabs when everything fits (sidebars hidden on a wide screen)', () => {
    expect(computeEdgeOverflow(board(0, 2200))).toEqual({ left: [], right: [] })
  })

  it('scrolled right, the left edge names the columns hidden there the same way', () => {
    expect(computeEdgeOverflow(board(324))).toEqual({ left: ['incoming', 'reko'], right: ['returning', 'complete'] })
  })
})

describe('scrollTargetFor', () => {
  it('brings a clicked column fully into view, clear of the tabs still standing beside it', () => {
    const target = scrollTargetFor(board(0), 'active')!
    expect(target).toBe(324)
    expect(computeEdgeOverflow(board(target)).right).toEqual(['returning', 'complete'])
  })

  it('scrolls to the very end for the last column, so no tab is left on the right', () => {
    const g = board(0)
    expect(scrollTargetFor(g, 'complete')).toBe(g.scrollWidth - g.clientWidth)
  })

  it('scrolls back to the start for the first column', () => {
    expect(scrollTargetFor(board(400), 'incoming')).toBe(0)
  })
})
