import { describe, expect, it } from 'vitest'

import {
  fullViewSrc,
  groupRuns,
  lightboxKeyAction,
  lineUp,
  PULL_CLOSE_PX,
  releaseIntent,
  stepIndex,
  type ViewerPhoto,
} from '@/lib/photo-lightbox'

const photo = (group: ViewerPhoto['group'], filename: string): ViewerPhoto => ({
  group,
  filename,
  src: `/api/photos/i/${filename}`,
  by: null,
  at: null,
})

describe('the photo viewer keys', () => {
  it('pages with the arrows, jumps with Home/End and leaves other keys to the page', () => {
    expect(lightboxKeyAction('ArrowLeft')).toBe('prev')
    expect(lightboxKeyAction('ArrowRight')).toBe('next')
    expect(lightboxKeyAction('Home')).toBe('first')
    expect(lightboxKeyAction('End')).toBe('last')
    expect(lightboxKeyAction('Escape')).toBe('close')
    expect(lightboxKeyAction('Enter')).toBeNull()
  })

  it('stops at both ends instead of wrapping', () => {
    expect(stepIndex(0, 'prev', 5)).toBe(0)
    expect(stepIndex(4, 'next', 5)).toBe(4)
    expect(stepIndex(1, 'next', 5)).toBe(2)
    expect(stepIndex(3, 'first', 5)).toBe(0)
    expect(stepIndex(0, 'last', 5)).toBe(4)
    expect(stepIndex(0, 'next', 0)).toBe(0)
  })
})

describe('the photo viewer finger', () => {
  const width = 390

  it('pages on a drag past a fifth of the width or a flick, springs back otherwise', () => {
    expect(releaseIntent({ dx: -100, dy: 5, vx: -0.1, vy: 0 }, width)).toBe('next')
    expect(releaseIntent({ dx: 100, dy: 5, vx: 0.1, vy: 0 }, width)).toBe('prev')
    expect(releaseIntent({ dx: -30, dy: 0, vx: -0.9, vy: 0 }, width)).toBe('next')
    expect(releaseIntent({ dx: -30, dy: 0, vx: -0.1, vy: 0 }, width)).toBe('none')
  })

  it('closes on a pull down, never on a push up', () => {
    expect(releaseIntent({ dx: 10, dy: PULL_CLOSE_PX + 1, vx: 0, vy: 0.1 }, width)).toBe('close')
    expect(releaseIntent({ dx: 0, dy: 40, vx: 0, vy: 0.9 }, width)).toBe('close')
    expect(releaseIntent({ dx: 0, dy: -200, vx: 0, vy: -0.9 }, width)).toBe('none')
  })
})

describe('the photo line-up', () => {
  it('puts the Reko photos before the Rapport photos, each once', () => {
    const photos = lineUp({
      rapport: [photo('rapport', 'r1.jpg')],
      reko: [photo('reko', 'a.jpg'), photo('reko', 'b.jpg'), photo('reko', 'a.jpg')],
    })
    expect(photos.map(p => p.filename)).toEqual(['a.jpg', 'b.jpg', 'r1.jpg'])
    expect(groupRuns(photos).map(run => [run.group, run.items.map(item => item.index)])).toEqual([
      ['reko', [0, 1]],
      ['rapport', [2]],
    ])
  })
})

describe('fullViewSrc', () => {
  it('asks for the uncached full view, keeping a share token', () => {
    expect(fullViewSrc('/api/photos/i/a.jpg')).toBe('/api/photos/i/a.jpg?view=full')
    expect(fullViewSrc('/api/photos/i/a.jpg?token=t')).toBe('/api/photos/i/a.jpg?token=t&view=full')
  })
})
