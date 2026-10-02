import { describe, expect, it } from 'vitest'
import { estimateLabelWidth, labelMode, pickVisibleLabels, PHONE_LABEL_MIN_ZOOM, type LabelCandidate } from './map-labels'

const GEOMETRY = { labelOffsetX: 20, labelHeight: 28, dotSize: 24 }

function candidate(id: string, x: number, y: number, extra: Partial<LabelCandidate> = {}): LabelCandidate {
  return { id, x, y, dy: 0, width: 100, priority: 'medium', ...extra }
}

describe('labelMode', () => {
  it('draws every label on desktop, whatever the zoom', () => {
    expect(labelMode({ showLabels: true, compact: false, zoom: 10 })).toBe('all')
    expect(labelMode({ showLabels: true, compact: false, zoom: 18 })).toBe('all')
  })

  it('draws no permanent labels on a phone at the default zoom', () => {
    expect(labelMode({ showLabels: true, compact: true, zoom: 14 })).toBe('none')
    expect(labelMode({ showLabels: true, compact: true, zoom: PHONE_LABEL_MIN_ZOOM - 0.01 })).toBe('none')
  })

  it('brings collision-checked labels back on a phone from street level', () => {
    expect(labelMode({ showLabels: true, compact: true, zoom: PHONE_LABEL_MIN_ZOOM })).toBe('fit')
    expect(labelMode({ showLabels: true, compact: true, zoom: 18 })).toBe('fit')
  })

  it('«Beschriftungen» off means off on every device', () => {
    expect(labelMode({ showLabels: false, compact: false, zoom: 18 })).toBe('none')
    expect(labelMode({ showLabels: false, compact: true, zoom: 18 })).toBe('none')
  })
})

describe('pickVisibleLabels', () => {
  it('keeps labels that do not touch each other', () => {
    const visible = pickVisibleLabels([candidate('a', 0, 0), candidate('b', 0, 100), candidate('c', 300, 0)], GEOMETRY)
    expect([...visible].sort()).toEqual(['a', 'b', 'c'])
  })

  it('drops the second of two overlapping labels', () => {
    const visible = pickVisibleLabels([candidate('a', 0, 0), candidate('b', 0, 15)], GEOMETRY)
    expect(visible.has('a')).toBe(true)
    expect(visible.has('b')).toBe(false)
  })

  it('gives a contested spot to the higher priority', () => {
    const visible = pickVisibleLabels(
      [candidate('low', 0, 0, { priority: 'low' }), candidate('high', 0, 15, { priority: 'high' })],
      GEOMETRY,
    )
    expect([...visible]).toEqual(['high'])
  })

  it('never lets a label lie on another incident’s dot', () => {
    // b's dot sits inside a's label bubble (a's label runs from x=20 to x=120).
    const visible = pickVisibleLabels([candidate('a', 0, 0, { priority: 'high' }), candidate('b', 60, 0)], GEOMETRY)
    expect(visible.has('a')).toBe(false)
  })

  it('treats a shared address as one spot, whose stepped labels stack below it', () => {
    const step = 30
    const visible = pickVisibleLabels(
      [candidate('a', 0, 0), candidate('b', 0, 0, { dy: step }), candidate('c', 0, 0, { dy: step * 2 })],
      GEOMETRY,
    )
    expect([...visible].sort()).toEqual(['a', 'b', 'c'])
  })

  it('ignores anchors outside the viewport, so they block nothing', () => {
    const visible = pickVisibleLabels([candidate('off', -50, 0, { priority: 'high' }), candidate('on', 5, 5)], {
      ...GEOMETRY,
      viewport: { width: 390, height: 400 },
    })
    expect([...visible]).toEqual(['on'])
  })
})

describe('estimateLabelWidth', () => {
  it('grows with the text and with each crew counter', () => {
    const short = estimateLabelWidth('Weg 1', 0)
    const long = estimateLabelWidth('Bahnhofstrasse 1, Coop Center', 0)
    expect(long).toBeGreaterThan(short)
    expect(estimateLabelWidth('Weg 1', 2)).toBeGreaterThan(short)
  })
})
