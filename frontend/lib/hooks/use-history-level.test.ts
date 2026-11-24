import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useHistoryLevel } from './use-history-level'

const hasLevel = () => typeof window.history.state === 'object' && window.history.state !== null && 'kpLevel' in window.history.state

describe('useHistoryLevel', () => {
  it('pushes one entry when the level opens, and the native back calls onBack', async () => {
    const onBack = vi.fn()
    const before = window.history.length
    const { rerender } = renderHook(({ open }) => useHistoryLevel(open, onBack), { initialProps: { open: false } })
    expect(window.history.length).toBe(before)

    rerender({ open: true })
    expect(window.history.length).toBe(before + 1)
    expect(hasLevel()).toBe(true)

    window.history.back()
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(hasLevel()).toBe(false)
  })

  it('the in-page back walks the same history', async () => {
    const onBack = vi.fn()
    const { result } = renderHook(() => useHistoryLevel(true, onBack))
    expect(hasLevel()).toBe(true)

    result.current()
    expect(onBack).toHaveBeenCalledTimes(1) // at once – the history follows
    await waitFor(() => expect(hasLevel()).toBe(false))
  })

  it('a level closed another way walks back over its entry, without calling onBack', async () => {
    const onBack = vi.fn()
    const { rerender } = renderHook(({ open }) => useHistoryLevel(open, onBack), { initialProps: { open: true } })
    expect(hasLevel()).toBe(true)

    rerender({ open: false })
    await waitFor(() => expect(hasLevel()).toBe(false))
    expect(onBack).not.toHaveBeenCalled()
  })

  it('reuses an entry left over from a reload instead of stacking a second one', () => {
    window.history.pushState({ kpLevel: 'from-before-the-reload' }, '')
    const before = window.history.length
    renderHook(() => useHistoryLevel(true, vi.fn()))
    expect(window.history.length).toBe(before)
    expect(window.history.state).not.toEqual({ kpLevel: 'from-before-the-reload' })
    expect(hasLevel()).toBe(true)
  })

  it('on a page nobody has touched yet, waits for the first activating touch – Chromium would skip the entry', () => {
    const userActivation = { hasBeenActive: false, isActive: false }
    vi.stubGlobal('navigator', { ...navigator, userActivation })
    try {
      window.history.pushState({}, '') // a plain page under it, not a level left over
      const before = window.history.length
      renderHook(() => useHistoryLevel(true, vi.fn()))
      expect(window.history.length).toBe(before)

      // Escape is a key that does not activate the page: still nothing.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(window.history.length).toBe(before)

      userActivation.hasBeenActive = true // what the browser sets before the touch's listeners run
      window.dispatchEvent(new Event('pointerup'))
      window.dispatchEvent(new Event('keydown'))
      expect(window.history.length).toBe(before + 1)
      expect(hasLevel()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('before that touch, the in-page back goes down in memory and leaves the history alone', () => {
    vi.stubGlobal('navigator', { ...navigator, userActivation: { hasBeenActive: false, isActive: false } })
    try {
      const onBack = vi.fn()
      const before = window.history.length
      const { result } = renderHook(() => useHistoryLevel(true, onBack))
      result.current()
      expect(onBack).toHaveBeenCalledTimes(1)
      expect(window.history.length).toBe(before)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
