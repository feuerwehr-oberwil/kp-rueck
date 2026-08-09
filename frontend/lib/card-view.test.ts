import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CARD_VIEW_KEYS,
  CARD_VIEW_PRESETS,
  CARD_VIEW_STORAGE_KEY,
  DEFAULT_CARD_VIEW,
  cardViewEquals,
  coerceCardView,
  matchCardViewPreset,
  setCardView,
  toggleCardViewKey,
  __resetCardViewForTests,
} from '@/lib/card-view'

describe('the presets', () => {
  it('Kompakt is header only — every switch off', () => {
    for (const key of CARD_VIEW_KEYS) {
      expect(CARD_VIEW_PRESETS.kompakt[key]).toBe(false)
    }
  })

  it('Alles is every switch on', () => {
    for (const key of CARD_VIEW_KEYS) {
      expect(CARD_VIEW_PRESETS.alles[key]).toBe(true)
    }
  })

  it("Standard is today's card: everything except the Melder", () => {
    expect(CARD_VIEW_PRESETS.standard.melder).toBe(false)
    for (const key of CARD_VIEW_KEYS.filter((k) => k !== 'melder')) {
      expect(CARD_VIEW_PRESETS.standard[key]).toBe(true)
    }
  })

  it('defaults to Standard', () => {
    expect(cardViewEquals(DEFAULT_CARD_VIEW, CARD_VIEW_PRESETS.standard)).toBe(true)
  })

  it('names the preset a settings object matches', () => {
    expect(matchCardViewPreset(CARD_VIEW_PRESETS.kompakt)).toBe('kompakt')
    expect(matchCardViewPreset(CARD_VIEW_PRESETS.standard)).toBe('standard')
    expect(matchCardViewPreset(CARD_VIEW_PRESETS.alles)).toBe('alles')
  })
})

describe('flipping a switch after a preset', () => {
  it('leaves a custom set — no snap-back to the preset', () => {
    const custom = toggleCardViewKey(CARD_VIEW_PRESETS.standard, 'material')

    expect(custom.material).toBe(false)
    expect(matchCardViewPreset(custom)).toBeNull()
    // Nothing else moved: a switch changes its own switch and nothing more.
    for (const key of CARD_VIEW_KEYS.filter((k) => k !== 'material')) {
      expect(custom[key]).toBe(CARD_VIEW_PRESETS.standard[key])
    }
  })

  it('does not mutate the preset it started from', () => {
    toggleCardViewKey(CARD_VIEW_PRESETS.alles, 'meldung')
    expect(CARD_VIEW_PRESETS.alles.meldung).toBe(true)
  })

  it('walks a switch back on without disturbing the rest', () => {
    const off = toggleCardViewKey(CARD_VIEW_PRESETS.alles, 'fahrzeuge')
    const backOn = toggleCardViewKey(off, 'fahrzeuge')
    expect(cardViewEquals(backOn, CARD_VIEW_PRESETS.alles)).toBe(true)
  })
})

/**
 * The card's memo comparator is `cardViewEquals`. This is the test that makes a
 * forgotten flag impossible: it is driven by CARD_VIEW_KEYS, and
 * `CardViewSettings` is derived from that same list — a new flag cannot exist
 * without appearing here.
 */
describe('cardViewEquals', () => {
  it('reports a difference for EVERY single switch', () => {
    for (const key of CARD_VIEW_KEYS) {
      const flipped = toggleCardViewKey(CARD_VIEW_PRESETS.alles, key)
      expect(cardViewEquals(CARD_VIEW_PRESETS.alles, flipped)).toBe(false)
    }
  })

  it('compares by value, not by identity', () => {
    expect(cardViewEquals({ ...CARD_VIEW_PRESETS.standard }, CARD_VIEW_PRESETS.standard)).toBe(true)
  })
})

describe('reading a stored value', () => {
  it('accepts a complete object', () => {
    expect(coerceCardView(CARD_VIEW_PRESETS.kompakt)).toEqual(CARD_VIEW_PRESETS.kompakt)
  })

  it('fills unknown keys from the default rather than blanking the card', () => {
    // An object written by an older build that knew fewer blocks.
    const partial = coerceCardView({ meldung: false })
    expect(partial).not.toBeNull()
    expect(partial?.meldung).toBe(false)
    expect(partial?.mannschaft).toBe(DEFAULT_CARD_VIEW.mannschaft)
  })

  it('rejects anything that carries no switches at all', () => {
    expect(coerceCardView(null)).toBeNull()
    expect(coerceCardView('kompakt')).toBeNull()
    expect(coerceCardView([true, false])).toBeNull()
    expect(coerceCardView({ nonsense: 1 })).toBeNull()
  })
})

// Node 26 does not expose localStorage unless --localstorage-file is passed, so
// the suite drives an in-memory stand-in (mirrors safe-storage.test.ts).
function installStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  } as Storage)
}

describe('per-device persistence', () => {
  beforeEach(() => {
    installStorage()
    __resetCardViewForTests()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('writes the whole settings object under one key', () => {
    setCardView(CARD_VIEW_PRESETS.kompakt)
    const raw = localStorage.getItem(CARD_VIEW_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual(CARD_VIEW_PRESETS.kompakt)
  })

  it('round-trips through the store', () => {
    setCardView(CARD_VIEW_PRESETS.alles)
    const stored = coerceCardView(JSON.parse(localStorage.getItem(CARD_VIEW_STORAGE_KEY) as string))
    expect(cardViewEquals(stored as never, CARD_VIEW_PRESETS.alles)).toBe(true)
  })
})
