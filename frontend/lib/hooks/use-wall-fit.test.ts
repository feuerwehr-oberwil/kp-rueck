import { describe, expect, it } from 'vitest'
import { largestFitting } from './use-wall-fit'

/** The search behind the wall's root size: the largest size on the grid that still fits. */
describe('largestFitting', () => {
  it('finds the largest size that fits, on the step grid', () => {
    expect(largestFitting(14, 20, 0.25, (px) => px <= 16.6)).toBe(16.5)
  })

  it('takes the ceiling when everything fits', () => {
    expect(largestFitting(14, 20, 0.25, () => true)).toBe(20)
  })

  it('stays on the floor when nothing fits – the column scrolls instead', () => {
    expect(largestFitting(14, 20, 0.25, () => false)).toBe(14)
  })
})
