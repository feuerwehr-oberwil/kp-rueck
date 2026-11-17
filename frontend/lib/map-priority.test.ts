import { describe, expect, it } from 'vitest'
import { markerGlyphInk, priorityGlyphPath } from './map-priority'
import { INCIDENT_TYPE_MARKER_COLORS, MAP_INK, PRIORITY_MARKER_COLORS } from './map-colors'

describe('markerGlyphInk', () => {
  it('draws the glyph in ink on the Mittel and Niedrig fills, white on the Hoch red', () => {
    // Hoch is the danger red itself since COL-03 (17.11.2026) – dark enough to want white.
    expect(markerGlyphInk(PRIORITY_MARKER_COLORS.medium)).toBe(MAP_INK)
    expect(markerGlyphInk(PRIORITY_MARKER_COLORS.low)).toBe(MAP_INK)
    expect(markerGlyphInk(PRIORITY_MARKER_COLORS.high)).toBe('#ffffff')
  })

  it('switches to white on a dark «Färben nach» fill', () => {
    expect(markerGlyphInk(INCIDENT_TYPE_MARKER_COLORS.bma_unechte_alarme)).toBe('#ffffff')
  })
})

describe('priorityGlyphPath', () => {
  it('points up for Hoch, lies flat for Mittel, points down otherwise', () => {
    expect(priorityGlyphPath('high', 12, 12)).toBe('M8 14L12 10L16 14')
    expect(priorityGlyphPath('medium', 12, 12)).toBe('M8 12L16 12')
    expect(priorityGlyphPath('low', 12, 12)).toBe('M8 10L12 14L16 10')
    expect(priorityGlyphPath(null, 12, 12)).toBe(priorityGlyphPath('low', 12, 12))
  })
})
