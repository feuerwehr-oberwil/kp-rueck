import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePersistedState } from './use-persisted-state'

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/** jsdom's localStorage is unreliable under Node 26 — drive a plain Map instead. */
function stubStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  })
  return store
}

describe('usePersistedState', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores a stored value over the fallback', () => {
    stubStorage({ 'kp-test-flag': 'false' })

    const { result } = renderHook(() => usePersistedState('kp-test-flag', true, isBoolean))

    expect(result.current[0]).toBe(false)
  })

  it('does not clobber the stored value while restoring it', () => {
    const store = stubStorage({ 'kp-test-flag': 'false' })

    renderHook(() => usePersistedState('kp-test-flag', true, isBoolean))

    // The whole point: a closed sidebar must still be closed after the mount
    // settles, not overwritten by the `true` default on the way through.
    expect(store.get('kp-test-flag')).toBe('false')
  })

  // The regression that shipped the first time: StrictMode runs effects twice,
  // so a write of the fallback between the two reads makes the second read pick
  // up the default and the closed sidebar springs open again on reload.
  it('survives StrictMode double-invoked effects', () => {
    const store = stubStorage({ 'kp-test-flag': 'false' })

    const { result } = renderHook(() => usePersistedState('kp-test-flag', true, isBoolean), {
      wrapper: StrictMode,
    })

    expect(result.current[0]).toBe(false)
    expect(store.get('kp-test-flag')).toBe('false')
  })

  it('persists a later change', () => {
    const store = stubStorage()

    const { result } = renderHook(() => usePersistedState('kp-test-flag', true, isBoolean))
    act(() => result.current[1](false))

    expect(store.get('kp-test-flag')).toBe('false')
  })
})
