import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handOverSnailClock, resetSnailClock, snailClockElapsed } from '@/lib/snail-clock'

import { SnailLoader } from './snail-loader'

// jsdom runs no CSS animations; stand in for the SVG's arrival + idle loops.
type FakeAnimation = { currentTime: number | null }
let animations: FakeAnimation[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  sessionStorage.clear()
  resetSnailClock()
  animations = []
  ;(Element.prototype as unknown as { getAnimations: () => FakeAnimation[] }).getAnimations = function () {
    const mine = [{ currentTime: 0 }, { currentTime: 0 }]
    animations.push(...mine)
    return mine
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete (Element.prototype as unknown as { getAnimations?: unknown }).getAnimations
})

describe('SnailLoader', () => {
  it('renders paused, so a server-rendered snail cannot start its arrival early', () => {
    const svg = render(<SnailLoader />).container.querySelector('svg')!
    // Rendered with the pause; the mount effect has already lifted it.
    expect(svg.getAttribute('class')).toContain('firefighter-snail')
    expect(svg.classList.contains('snail-paused')).toBe(false)
  })

  it('carries the pause in its markup (the hook the shared SVG provides)', async () => {
    const { renderToString } = await import('react-dom/server')
    expect(renderToString(<SnailLoader />)).toContain('firefighter-snail snail-paused')
  })

  it('arrives from 0 as the first snail of a launch', () => {
    render(<SnailLoader />)
    expect(animations.map((a) => a.currentTime)).toEqual([0, 0])
  })

  it('a later stage continues the clock instead of replaying the arrival', () => {
    const first = render(<SnailLoader />)
    vi.advanceTimersByTime(900)
    first.unmount()
    animations = []
    render(<SnailLoader />)
    expect(animations.map((a) => a.currentTime)).toEqual([900, 900])
  })

  it('after the Microsoft callback, the next document\'s snail appears standing', () => {
    render(<SnailLoader />) // the callback's snail
    vi.advanceTimersByTime(2_000)
    handOverSnailClock()
    resetSnailClock() // full page load: a new document, a new module
    animations = []
    vi.advanceTimersByTime(300)
    render(<SnailLoader />)
    expect(animations.map((a) => a.currentTime)).toEqual([2_300, 2_300])
    expect(snailClockElapsed()).toBe(2_300)
  })
})
