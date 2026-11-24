import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettledAfter } from './use-settled-after'

describe('useSettledAfter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const mount = (active: boolean) =>
    renderHook(({ on }) => useSettledAfter(on, 500), { initialProps: { on: active } })

  it('settles only after the wait', () => {
    const { result } = mount(true)
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(499))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('drops at once and waits again the next time', () => {
    const { result, rerender } = mount(true)
    act(() => vi.advanceTimersByTime(500))
    rerender({ on: false })
    expect(result.current).toBe(false)
    rerender({ on: true })
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toBe(true)
  })
})
