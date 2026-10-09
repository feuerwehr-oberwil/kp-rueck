import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUuid } from './validation'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is a v4 UUID', () => {
    expect(randomUuid()).toMatch(UUID_V4)
  })

  it('is still a v4 UUID on plain HTTP, where crypto.randomUUID does not exist', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0xab) })
    expect(randomUuid()).toMatch(UUID_V4)
  })
})
