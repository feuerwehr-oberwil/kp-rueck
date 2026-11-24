import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const path = vi.hoisted(() => ({ current: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => path.current }))

import { TopLoadingBar, topLoading } from './top-loading-bar'

const bar = (container: HTMLElement) => container.querySelector<HTMLElement>('[aria-hidden] > div')!

describe('TopLoadingBar suppression', () => {
  it('stays invisible during a load while suppressed, and shows it once released', () => {
    const { container } = render(<TopLoadingBar />)
    let release!: () => void
    act(() => {
      release = topLoading.suppress()
      topLoading.start()
    })
    expect(bar(container).style.opacity).toBe('0')
    act(() => release())
    expect(bar(container).style.opacity).toBe('1')
    act(() => release()) // a second release is a no-op, never un-suppresses someone else
    expect(topLoading.isSuppressed()).toBe(false)
    act(() => topLoading.done())
  })
})

// Phone sweep 24.11.2026 #2: a tab tap answered only once the next page had rendered (up to 4 s).
describe('TopLoadingBar on a tap that leaves the page', () => {
  it('shows from the tap, and the route change finishes that same load', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<TopLoadingBar />)
    act(() => topLoading.startRoute())
    expect(bar(container).style.opacity).toBe('1')
    path.current = '/map'
    rerender(<TopLoadingBar />)
    act(() => vi.advanceTimersByTime(500 + 260))
    // one load, taken over – not a second one left running
    expect(topLoading.snapshot().active).toBe(false)
    vi.useRealTimers()
  })
  it('ends when two route changes come inside 500 ms', () => {
    vi.useFakeTimers()
    path.current = '/'
    const { rerender } = render(<TopLoadingBar />)
    path.current = '/map'
    rerender(<TopLoadingBar />)
    path.current = '/events'
    rerender(<TopLoadingBar />)
    act(() => vi.advanceTimersByTime(500 + 260))
    expect(topLoading.snapshot().active).toBe(false)
    vi.useRealTimers()
  })
})
