import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useScrolledUnder } from '@/lib/hooks/use-scrolled-under'

afterEach(() => vi.unstubAllGlobals())

describe('useScrolledUnder', () => {
  it('cuts the bar off the viewport and flips with the element', () => {
    let report: (isIntersecting: boolean) => void = () => {}
    const options: IntersectionObserverInit[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void, init: IntersectionObserverInit) {
          report = isIntersecting => callback([{ isIntersecting }])
          options.push(init)
        }
        observe() {}
        disconnect() {}
      },
    )
    const ref = { current: document.createElement('div') }
    const { result } = renderHook(() => useScrolledUnder(ref, 57))

    expect(options[0].rootMargin).toBe('-57px 0px 0px 0px')
    expect(result.current).toBe(false)
    act(() => report(false))
    expect(result.current).toBe(true)
    act(() => report(true))
    expect(result.current).toBe(false)
  })

  it('stays false without an IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { result } = renderHook(() => useScrolledUnder({ current: document.createElement('div') }, 57))
    expect(result.current).toBe(false)
  })
})
