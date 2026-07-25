import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  RETRY_DELAYS_MS,
  clearRetryAttempts,
  isDisplayRoute,
  readRetryAttempts,
  retryDelayFor,
  writeRetryAttempts,
} from './display-retry'

function installSessionStorage(overrides: Partial<Storage> = {}) {
  const data = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
    ...overrides,
  } as Storage)
}

describe('display-retry', () => {
  beforeEach(() => {
    installSessionStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('retryDelayFor', () => {
    it('backs off across consecutive failures', () => {
      // A flat retry would hot-loop a broken deploy and turn every display in
      // the station into a load generator against an ailing backend.
      expect(retryDelayFor(0)).toBe(RETRY_DELAYS_MS[0])
      expect(retryDelayFor(1)).toBe(RETRY_DELAYS_MS[1])
      expect(retryDelayFor(2)).toBe(RETRY_DELAYS_MS[2])
    })

    it('caps at the longest delay instead of growing without bound', () => {
      expect(retryDelayFor(3)).toBe(RETRY_DELAYS_MS.at(-1))
      expect(retryDelayFor(99)).toBe(RETRY_DELAYS_MS.at(-1))
    })

    it('never returns less than the base delay for odd input', () => {
      expect(retryDelayFor(-5)).toBe(RETRY_DELAYS_MS[0])
    })
  })

  describe('attempt bookkeeping', () => {
    it('round-trips across a simulated reload', () => {
      // Each reload is a fresh document, which is why this lives in storage
      // rather than memory.
      writeRetryAttempts(2)
      expect(readRetryAttempts()).toBe(2)
    })

    it('starts at zero when nothing is stored', () => {
      expect(readRetryAttempts()).toBe(0)
    })

    it('treats a corrupt counter as a fresh start', () => {
      sessionStorage.setItem('display-error-attempts', 'not-a-number')
      expect(readRetryAttempts()).toBe(0)
    })

    it('clears back to the base delay once a screen is healthy again', () => {
      writeRetryAttempts(3)
      clearRetryAttempts()
      expect(readRetryAttempts()).toBe(0)
      expect(retryDelayFor(readRetryAttempts())).toBe(RETRY_DELAYS_MS[0])
    })

    it('never throws when sessionStorage is unavailable', () => {
      installSessionStorage({
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('SecurityError')
        },
        removeItem: () => {
          throw new Error('SecurityError')
        },
      })
      expect(() => writeRetryAttempts(1)).not.toThrow()
      expect(() => clearRetryAttempts()).not.toThrow()
      expect(readRetryAttempts()).toBe(0)
    })
  })

  describe('isDisplayRoute', () => {
    it.each([
      ['/display', true],
      ['/display/board', true],
      ['/display/map', true],
      ['/', false],
      ['/map', false],
      ['/settings', false],
    ])('%s -> %s', (pathname, expected) => {
      vi.stubGlobal('window', { location: { pathname } })
      expect(isDisplayRoute()).toBe(expected)
    })
  })
})
