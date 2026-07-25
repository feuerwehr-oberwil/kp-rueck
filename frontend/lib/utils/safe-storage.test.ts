import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import {
  isBooleanRecord,
  isStringArray,
  readItem,
  readJson,
  removeItem,
  writeItem,
  writeJson,
} from './safe-storage'

// Node 26 does not expose localStorage unless --localstorage-file is passed,
// so the suite drives an in-memory stand-in.
function installStorage(overrides: Partial<Storage> = {}) {
  const data = new Map<string, string>()
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
    ...overrides,
  } as Storage
  vi.stubGlobal('localStorage', store)
  return data
}

describe('safe-storage', () => {
  beforeEach(() => {
    installStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('readJson', () => {
    it('returns the parsed value when it is valid', () => {
      localStorage.setItem('k', JSON.stringify(['a', 'b']))
      expect(readJson('k', isStringArray, [])).toEqual(['a', 'b'])
    })

    it('returns the fallback when the key is absent', () => {
      expect(readJson('missing', isStringArray, ['fallback'])).toEqual(['fallback'])
    })

    it('returns the fallback on invalid JSON', () => {
      // A quota-truncated write leaves exactly this: valid-looking garbage.
      localStorage.setItem('k', '["a",')
      expect(readJson('k', isStringArray, [])).toEqual([])
    })

    it('returns the fallback when the value parses to the WRONG SHAPE', () => {
      // The crash this whole module exists to prevent: `{}` parses fine, then
      // throws on the first array method. Rendered in a root-layout provider,
      // that white-screened the app on every load until site data was cleared.
      localStorage.setItem('k', '{}')
      expect(readJson('k', isStringArray, [])).toEqual([])
    })

    it('drops a poisoned value so it cannot re-throw on the next read', () => {
      localStorage.setItem('k', 'not json')
      readJson('k', isStringArray, [])
      expect(localStorage.getItem('k')).toBeNull()
    })

    it('never throws when storage itself is unavailable', () => {
      installStorage({
        getItem: () => {
          throw new Error('SecurityError: storage disabled by policy')
        },
      })
      expect(() => readJson('k', isStringArray, [])).not.toThrow()
      expect(readJson('k', isStringArray, ['fb'])).toEqual(['fb'])
    })

    it('supports a null fallback to distinguish absent from empty', () => {
      localStorage.setItem('present', JSON.stringify([]))
      expect(readJson('present', isStringArray, null)).toEqual([])
      expect(readJson('absent', isStringArray, null)).toBeNull()
    })
  })

  describe('writeJson / writeItem', () => {
    it('persists and reports success', () => {
      expect(writeJson('k', { a: true })).toBe(true)
      expect(localStorage.getItem('k')).toBe('{"a":true}')
    })

    it('reports failure instead of throwing when the quota is exceeded', () => {
      installStorage({
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      })
      expect(writeJson('k', { a: true })).toBe(false)
      expect(writeItem('k', 'v')).toBe(false)
    })
  })

  describe('readItem / removeItem', () => {
    it('round-trips a raw string', () => {
      writeItem('k', 'true')
      expect(readItem('k')).toBe('true')
      removeItem('k')
      expect(readItem('k')).toBeNull()
    })

    it('never throws when storage is unavailable', () => {
      installStorage({
        removeItem: () => {
          throw new Error('SecurityError')
        },
      })
      expect(() => removeItem('k')).not.toThrow()
    })
  })

  describe('type guards', () => {
    it('isStringArray accepts only arrays of strings', () => {
      expect(isStringArray([])).toBe(true)
      expect(isStringArray(['a'])).toBe(true)
      expect(isStringArray(['a', 1])).toBe(false)
      expect(isStringArray({})).toBe(false)
      expect(isStringArray(null)).toBe(false)
    })

    it('isBooleanRecord accepts only flat boolean maps', () => {
      expect(isBooleanRecord({})).toBe(true)
      expect(isBooleanRecord({ a: true, b: false })).toBe(true)
      expect(isBooleanRecord({ a: 'yes' })).toBe(false)
      expect(isBooleanRecord([])).toBe(false)
      expect(isBooleanRecord(null)).toBe(false)
    })
  })
})
