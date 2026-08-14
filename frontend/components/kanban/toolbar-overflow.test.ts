import { describe, expect, it } from 'vitest'
import { computeVisibleCount } from './toolbar-overflow'

// The footer's whole promise is "nothing is unreachable at any width". That
// reduces to this arithmetic: the DOM only supplies the three numbers. The cases
// below are the ones that were actually wrong before the overflow menu existed —
// a row that did not fit, and a row that fitted but paid for a button it did not
// need.
const GAP = 2

describe('computeVisibleCount', () => {
  it('shows everything — and no «Mehr» button — when the row fits', () => {
    // 5 × 80 + 4 gaps = 408; anything wider than that takes them all.
    expect(computeVisibleCount([80, 80, 80, 80, 80], 90, 500, GAP)).toBe(5)
  })

  it('still shows everything when it fits to the last pixel', () => {
    expect(computeVisibleCount([80, 80, 80, 80, 80], 90, 409, GAP)).toBe(5)
  })

  it('pays for the «Mehr» button once the row stops fitting', () => {
    // 407 is one pixel short of the row, so the button has to be afforded:
    // 90 + gap leaves 315, i.e. three 80px items (3 × 82 = 246, a fourth = 328).
    expect(computeVisibleCount([80, 80, 80, 80, 80], 90, 407, GAP)).toBe(3)
  })

  it('cuts from the END, so the order the operator learned never changes', () => {
    // A prefix length, never a selection: the three narrow items would all fit
    // in the space the first one takes, and are still the ones that give way.
    expect(computeVisibleCount([200, 50, 50, 50], 90, 300, GAP)).toBe(1)
  })

  it('puts everything in the panel when not even one item fits beside it', () => {
    expect(computeVisibleCount([200, 200], 90, 150, GAP)).toBe(0)
  })

  it('handles an empty toolbar without reserving anything', () => {
    expect(computeVisibleCount([], 90, 500, GAP)).toBe(0)
  })
})
