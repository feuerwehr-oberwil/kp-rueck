import { describe, expect, it } from 'vitest'
import { materialSplit } from '@/components/display/material-split'

/**
 * The wall status page moves Material's leading groups under the vehicle tiles
 * only when Material does not fit its own column – as few as it takes, never
 * more than the room there holds, and never all of them.
 */
describe('materialSplit', () => {
  // The 1080p demo evening: TLF, PIO, MOWA, TRAWA, MAGAZIN.
  const groups = [165, 285, 285, 165, 445]

  it('moves nothing while Material fits its own column', () => {
    expect(materialSplit({ groupHeights: groups, free: 900, head: 40, own: 1400 })).toBe(0)
  })

  it('moves the fewest leading groups after which the rest fits', () => {
    // TLF alone leaves 1180 for an 970 column; TLF + PIO leaves 895.
    expect(materialSplit({ groupHeights: groups, free: 530, head: 40, own: 970 })).toBe(2)
  })

  it('never moves more than the room under the vehicles holds', () => {
    // Nothing that fits there makes the rest fit: as many as there is room for.
    expect(materialSplit({ groupHeights: groups, free: 250, head: 40, own: 600 })).toBe(1)
    expect(materialSplit({ groupHeights: groups, free: 100, head: 40, own: 600 })).toBe(0)
  })

  it('keeps at least one group in its own column', () => {
    expect(materialSplit({ groupHeights: [100, 100], free: 5000, head: 40, own: 150 })).toBe(1)
  })
})
