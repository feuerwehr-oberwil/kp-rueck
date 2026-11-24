import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useScrolledUnder } from '@/lib/hooks/use-scrolled-under'

afterEach(() => vi.unstubAllGlobals())

describe('useScrolledUnder', () => {
  it('cuts the bar off the viewport and flips with the element', () => {
    // `bottom` is where the element ends; the root (viewport minus the bar) starts at 61.
    let report: (isIntersecting: boolean, bottom: number) => void = () => {}
    const options: IntersectionObserverInit[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(
          callback: (entries: Pick<IntersectionObserverEntry, 'isIntersecting' | 'boundingClientRect' | 'rootBounds'>[]) => void,
          init: IntersectionObserverInit,
        ) {
          report = (isIntersecting, bottom) =>
            callback([{ isIntersecting, boundingClientRect: { bottom } as DOMRectReadOnly, rootBounds: { top: 61 } as DOMRectReadOnly }])
          options.push(init)
        }
        observe() {}
        disconnect() {}
      },
    )
    const ref = { current: document.createElement('div') }
    const { result } = renderHook(() => useScrolledUnder(ref, 61))

    expect(options[0].rootMargin).toBe('-61px 0px 0px 0px')
    expect(result.current).toBe(false)
    act(() => report(false, 40))
    expect(result.current).toBe(true)
    act(() => report(true, 120))
    expect(result.current).toBe(false)
  })

  it('stays false for an element below the fold', () => {
    let report: (bottom: number) => void = () => {}
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Pick<IntersectionObserverEntry, 'isIntersecting' | 'boundingClientRect' | 'rootBounds'>[]) => void) {
          report = bottom =>
            callback([{ isIntersecting: false, boundingClientRect: { bottom } as DOMRectReadOnly, rootBounds: { top: 61 } as DOMRectReadOnly }])
        }
        observe() {}
        disconnect() {}
      },
    )
    const { result } = renderHook(() => useScrolledUnder({ current: document.createElement('div') }, 61))
    act(() => report(1200))
    expect(result.current).toBe(false)
  })

  it('stays false without an IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { result } = renderHook(() => useScrolledUnder({ current: document.createElement('div') }, 61))
    expect(result.current).toBe(false)
  })
})
