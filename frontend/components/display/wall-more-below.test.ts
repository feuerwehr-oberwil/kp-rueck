import { describe, expect, it } from 'vitest'
import { countHiddenBelow } from '@/components/display/wall-more-below'

describe('countHiddenBelow', () => {
  it('counts every unkeyed item that ends below the visible end', () => {
    expect(countHiddenBelow([{ bottom: 90 }, { bottom: 100.4 }, { bottom: 120 }, { bottom: 200 }], 100)).toBe(2)
  })

  it('counts an Einsatz listed twice once, and not while one of its rows is in view', () => {
    const rows = [
      // Auftrag stops: a in view, b below
      { bottom: 50, key: 'a' },
      { bottom: 150, key: 'b' },
      // the status sections, all below: a, b, c
      { bottom: 300, key: 'a' },
      { bottom: 350, key: 'b' },
      { bottom: 400, key: 'c' },
    ]
    expect(countHiddenBelow(rows, 100)).toBe(2)
  })
})
