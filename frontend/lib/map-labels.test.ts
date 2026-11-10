import { describe, expect, it } from 'vitest'
import { estimateLabelWidth, labelMode, pickVisibleLabels, placeLabelSides, PHONE_LABEL_MIN_ZOOM, type LabelCandidate } from './map-labels'

const GEOMETRY = { labelOffsetX: 20, labelHeight: 28, dotSize: 24 }

function candidate(id: string, x: number, y: number, extra: Partial<LabelCandidate> = {}): LabelCandidate {
  return { id, x, y, width: 100, priority: 'medium', ...extra }
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

  it('ignores anchors outside the viewport, so they block nothing', () => {
    const visible = pickVisibleLabels([candidate('off', -50, 50, { priority: 'high' }), candidate('on', 5, 50)], {
      ...GEOMETRY,
      viewport: { width: 390, height: 400 },
    })
    expect([...visible]).toEqual(['on'])
  })

  it('drops a label that would hang off the edge, but keeps its dot as an obstacle', () => {
    const viewport = { width: 390, height: 400 }
    // «edge» sits 40px from the right edge: its 100px label cannot fit.
    const visible = pickVisibleLabels([candidate('edge', 350, 100, { priority: 'high' }), candidate('left', 300, 100)], {
      ...GEOMETRY,
      viewport,
    })
    expect(visible.has('edge')).toBe(false)
    // «left»'s label (320–420) would also leave the map; nothing is drawn rather than a stub.
    expect(visible.has('left')).toBe(false)
    const inner = pickVisibleLabels([candidate('edge', 350, 100), candidate('inner', 200, 100)], { ...GEOMETRY, viewport })
    // «inner»'s label (220–320) stays clear of edge's dot (338–362) and fits.
    expect([...inner]).toEqual(['inner'])
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

describe('placeLabelSides (desktop)', () => {
  it('keeps a label that collides with nothing on the right', () => {
    expect([...placeLabelSides([candidate('a', 200, 0), candidate('b', 200, 100)], GEOMETRY)]).toEqual([])
  })

  it('flips the lower claim of two colliding labels to the left of its pin', () => {
    // Rebbergstrasse 31 (Hoch) over Rebbergstrasse 5 (Mittel), 20px apart: 5 goes left.
    const left = placeLabelSides(
      [candidate('31', 210, 0, { priority: 'high' }), candidate('5', 200, 20, { priority: 'medium' })],
      GEOMETRY,
    )
    expect([...left]).toEqual(['5'])
  })

  it('flips a label whose right side would lie on another incident’s dot', () => {
    // b's dot sits inside a's right-hand label (x 220–320).
    expect([...placeLabelSides([candidate('a', 200, 0, { priority: 'high' }), candidate('b', 260, 0)], GEOMETRY)]).toContain('a')
  })

  it('stays right when the left side is taken too – overlapping, never dropped', () => {
    // c sits between two dots that cover both of its sides.
    const left = placeLabelSides(
      [candidate('w', 140, 0, { priority: 'high' }), candidate('c', 200, 0), candidate('e', 260, 0, { priority: 'high' })],
      GEOMETRY,
    )
    expect(left.has('c')).toBe(false)
  })

  it('flips a label whose right side would lie on a count bubble', () => {
    // A bubble at x=260 has no label of its own and belongs to no candidate.
    const left = placeLabelSides([candidate('a', 200, 0)], { ...GEOMETRY, obstacles: [{ x: 260, y: 0, width: 44, height: 44 }] })
    expect([...left]).toEqual(['a'])
  })

  it('flips a label away from a vehicle pill, and drops it on a phone', () => {
    // A 70×20 pill centred at x=260 lies on a's right-hand label (x 220–320).
    const pill = { x: 260, y: 0, width: 70, height: 20 }
    expect([...placeLabelSides([candidate('a', 200, 0)], { ...GEOMETRY, obstacles: [pill] })]).toEqual(['a'])
    expect(pickVisibleLabels([candidate('a', 200, 0)], { ...GEOMETRY, obstacles: [pill] }).size).toBe(0)
  })

  it('flips a label that would hang off the map’s right edge', () => {
    const left = placeLabelSides([candidate('edge', 350, 100)], { ...GEOMETRY, viewport: { width: 390, height: 400 } })
    expect([...left]).toEqual(['edge'])
  })
})
