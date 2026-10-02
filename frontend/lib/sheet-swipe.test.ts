import { describe, expect, it } from 'vitest'

import {
  DISMISS_PX,
  ENGAGE_PX,
  FLICK_PX,
  FLICK_VELOCITY,
  canStartSwipe,
  dragOffset,
  releaseVelocity,
  shouldDismiss,
  swipeIntent,
} from '@/lib/sheet-swipe'

describe('canStartSwipe', () => {
  it('never drags from a control', () => {
    expect(canStartSwipe({ onControl: true, onHandle: true, scrollTop: null })).toBe(false)
  })
  it('always drags from the grip / header', () => {
    expect(canStartSwipe({ onControl: false, onHandle: true, scrollTop: 300 })).toBe(true)
  })
  it('drags from content only while it is scrolled to the very top', () => {
    expect(canStartSwipe({ onControl: false, onHandle: false, scrollTop: 0 })).toBe(true)
    expect(canStartSwipe({ onControl: false, onHandle: false, scrollTop: 1 })).toBe(false)
    expect(canStartSwipe({ onControl: false, onHandle: false, scrollTop: null })).toBe(true)
  })
})

describe('swipeIntent', () => {
  it('waits for ENGAGE_PX of downward travel', () => {
    expect(swipeIntent(0, ENGAGE_PX - 1)).toBe('pending')
    expect(swipeIntent(0, ENGAGE_PX)).toBe('engage')
  })
  it('leaves upward and sideways gestures to the content', () => {
    expect(swipeIntent(0, -3)).toBe('reject')
    expect(swipeIntent(20, 8)).toBe('reject')
  })
  it('tolerates a small sideways wobble on a downward pull', () => {
    expect(swipeIntent(3, 2)).toBe('pending')
    expect(swipeIntent(6, 12)).toBe('engage')
  })
})

describe('release', () => {
  it('follows the finger minus the engage travel, never upwards', () => {
    expect(dragOffset(ENGAGE_PX + 30)).toBe(30)
    expect(dragOffset(2)).toBe(0)
  })
  it('closes past the distance threshold whatever the speed', () => {
    expect(shouldDismiss(DISMISS_PX + 1, 0)).toBe(true)
    expect(shouldDismiss(DISMISS_PX, 0)).toBe(false)
  })
  it('closes on a flick after a shorter pull, not on a slow one', () => {
    expect(shouldDismiss(FLICK_PX + 1, FLICK_VELOCITY + 0.1)).toBe(true)
    expect(shouldDismiss(FLICK_PX + 1, FLICK_VELOCITY - 0.1)).toBe(false)
    expect(shouldDismiss(FLICK_PX - 1, 5)).toBe(false)
  })
  it('measures the velocity over the last ~100 ms, so a slow pull ending in a flick is a flick', () => {
    const samples = [
      { y: 0, t: 0 },
      { y: 10, t: 400 }, // slow…
      { y: 20, t: 800 },
      { y: 80, t: 900 }, // …then fast
    ]
    expect(releaseVelocity(samples)).toBeCloseTo(0.6)
    expect(releaseVelocity([{ y: 0, t: 0 }])).toBe(0)
  })
})
