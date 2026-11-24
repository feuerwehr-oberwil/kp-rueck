import { describe, expect, it } from 'vitest'
import { homeFor, mayOpen } from './role-home'

describe('role home', () => {
  it('starts a viewer on the phone board on a phone and on the wall board anywhere wider', () => {
    expect(homeFor('viewer', true)).toBe('/')
    expect(homeFor('viewer', false)).toBe('/display/board')
    expect(homeFor('editor', false)).toBe('/')
    expect(homeFor('admin', true)).toBe('/')
  })

  it('opens only the phone shell pages to a viewer, and only on a phone', () => {
    for (const page of ['/', '/map', '/events']) {
      expect(mayOpen('viewer', page, true)).toBe(true)
      expect(mayOpen('viewer', page, false)).toBe(false)
    }
    for (const page of ['/settings', '/training', '/divera-pool']) {
      expect(mayOpen('viewer', page, true)).toBe(false)
      expect(mayOpen('editor', page, false)).toBe(true)
    }
  })
})
