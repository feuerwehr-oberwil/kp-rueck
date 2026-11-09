import { describe, expect, it } from 'vitest'
import { AUFTRAG_SWATCHES, darkenForWhiteText, whiteTextContrast } from './map-colors'

// The swatches before 08.11.2026 – still stored on routes and templates in real databases.
const OLD_SWATCHES = ['#3b82f6', '#06b6d4', '#84cc16', '#6366f1', '#a16207', '#14b8a6']

describe('darkenForWhiteText', () => {
  it('every swatch holds white stop numbers at 4.5:1 as it is', () => {
    for (const swatch of AUFTRAG_SWATCHES) {
      expect(whiteTextContrast(swatch)).toBeGreaterThanOrEqual(4.5)
      expect(darkenForWhiteText(swatch)).toBe(swatch)
    }
  })

  it('draws a route stored with an old swatch exactly as the new swatch of its hue', () => {
    expect(OLD_SWATCHES.map(darkenForWhiteText)).toEqual([...AUFTRAG_SWATCHES])
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
