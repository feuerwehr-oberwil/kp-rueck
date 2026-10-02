import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handOverSnailClock, resetSnailClock, snailClockElapsed } from '@/lib/snail-clock'

import { SnailLoader } from './snail-loader'

// jsdom runs no CSS animations; stand in for the SVG's arrival + idle loops.
type FakeAnimation = { currentTime: number | null }
let animations: FakeAnimation[] = []
let running = 0 // how far the snail's own (fake) animations have run when asked

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  sessionStorage.clear()
  resetSnailClock()
  animations = []
  running = 0
  ;(Element.prototype as unknown as { getAnimations: () => FakeAnimation[] }).getAnimations = function () {
    const mine = [{ currentTime: Math.min(running, 630) }, { currentTime: running }]
    animations.push(...mine)
    return mine
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete (Element.prototype as unknown as { getAnimations?: unknown }).getAnimations
})

describe('SnailLoader', () => {
  it('server-renders the plain animated SVG, so it arrives from the first paint', async () => {
    const { renderToString } = await import('react-dom/server')
    const html = renderToString(<SnailLoader />)
    expect(html).toMatch(/class="firefighter-snail fs[^"]*-arrival"/) // running, not paused
  })

  it('adopts the first snail as it runs and takes the clock from it', () => {
    running = 1_400 // server-rendered, arriving since the first paint; hydration comes late
    render(<SnailLoader />)
    // Nothing is set on the adopted snail: its animations keep running where they are …
    expect(animations.map((a) => a.currentTime)).toEqual([630, 1_400])
    // … and the launch's clock is the longest-running loop, not the ended 630 ms arrival.
    expect(snailClockElapsed()).toBe(1_400)
  })

  it('arrives from 0 as the first snail of a launch mounted on the client', () => {
    render(<SnailLoader />)
    expect(animations.map((a) => a.currentTime)).toEqual([0, 0])
    expect(snailClockElapsed()).toBe(0)
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
