import { describe, expect, it } from 'vitest'
import { AUFTRAG_SWATCHES, GROUP_PALETTE, REKO_PALETTE, darkenForWhiteText, oklabDistance, whiteTextContrast } from './map-colors'

// The swatches before 08.11.2026 – still stored on routes and templates in real databases.
const OLD_SWATCHES = ['#3b82f6', '#06b6d4', '#84cc16', '#6366f1', '#a16207', '#14b8a6']

describe('darkenForWhiteText', () => {
  it('every swatch and group tone holds white stop numbers at 4.5:1 as it is', () => {
    for (const swatch of [...GROUP_PALETTE, ...REKO_PALETTE]) {
      expect(whiteTextContrast(swatch)).toBeGreaterThanOrEqual(4.5)
      expect(darkenForWhiteText(swatch)).toBe(swatch)
    }
  })

  it('draws a route stored with an old swatch exactly as the new swatch of its hue', () => {
    // The first swatch is petrol for new Aufträge since 17.11.2026; an old blue route keeps the
    // darkened blue it was drawn in, which the group palette still carries.
    expect(OLD_SWATCHES.map(darkenForWhiteText)).toEqual(['#2c72e5', ...AUFTRAG_SWATCHES.slice(1)])
  })

  it('the group palette is the Auftrag family: ten distinct tones, the swatches first', () => {
    expect(new Set(GROUP_PALETTE).size).toBe(10)
    expect(GROUP_PALETTE.slice(0, AUFTRAG_SWATCHES.length)).toEqual([...AUFTRAG_SWATCHES])
  })

  it('brings any light colour to 4.5:1 – no further', () => {
    for (const light of ['#eab308', '#22c55e', '#0ea5e9', '#ffffff', '#fde68a']) {
      const dark = darkenForWhiteText(light)
      expect(whiteTextContrast(dark)).toBeGreaterThanOrEqual(4.5)
      expect(whiteTextContrast(dark)).toBeLessThan(4.7)
    }
  })

  it('leaves an already dark colour and anything that is no hex alone', () => {
    expect(darkenForWhiteText('#1e293b')).toBe('#1e293b')
    expect(darkenForWhiteText('#a16207')).toBe('#a16207')
    expect(darkenForWhiteText('var(--primary)')).toBe('var(--primary)')
  })
})

describe('REKO_PALETTE', () => {
  // Sign-off 19.11.2026: amber-brown and brown (0.08 apart) read as one person on the map.
  it('keeps every two Reko tones at least 0.1 apart in OKLab', () => {
    const pairs = REKO_PALETTE.flatMap((a, i) => REKO_PALETTE.slice(i + 1).map((b) => [a, b, oklabDistance(a, b)] as const))
    expect(pairs.filter(([, , distance]) => distance < 0.1)).toEqual([])
  })
})
