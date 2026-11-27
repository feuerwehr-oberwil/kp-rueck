import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useHiddenRelease } from './use-hidden-release'

let visibility: DocumentVisibilityState = 'visible'
const show = (state: DocumentVisibilityState) => {
  visibility = state
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

beforeEach(() => {
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useHiddenRelease', () => {
  it('releases after the hidden time and calls back once the tab returns', () => {
    const release = vi.fn()
    const onReturn = vi.fn()
    renderHook(() => useHiddenRelease({ enabled: true, afterMs: 600_000, release, onReturn }))

    show('hidden')
    act(() => { vi.advanceTimersByTime(540_000) })
    show('visible')
    expect(release).not.toHaveBeenCalled() // a short look away changes nothing
    expect(onReturn).not.toHaveBeenCalled()

    show('hidden')
    act(() => { vi.advanceTimersByTime(600_000) })
    expect(release).toHaveBeenCalledOnce()
    show('visible')
    expect(onReturn).toHaveBeenCalledOnce()
  })

  it('does nothing while disabled', () => {
    const release = vi.fn()
    renderHook(() => useHiddenRelease({ enabled: false, afterMs: 1000, release, onReturn: vi.fn() }))
    show('hidden')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(release).not.toHaveBeenCalled()
  })
})
