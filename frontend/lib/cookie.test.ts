import { afterEach, describe, expect, it } from 'vitest'

import { clearCookie, readCookie, writeCookie } from '@/lib/cookie'

const SCOPE = { path: '/', days: 7 }

afterEach(() => {
  for (const name of ['feld-device-token', 'x-feld-device-token', 'feld-person-name']) clearCookie(name, SCOPE)
})

describe('lib/cookie', () => {
  it('reads back exactly what was written, and nothing once cleared', () => {
    writeCookie('feld-person-name', encodeURIComponent('Müller, Hans'), SCOPE)
    expect(readCookie('feld-person-name')).toBe('M%C3%BCller%2C%20Hans')

    clearCookie('feld-person-name', SCOPE)
    expect(readCookie('feld-person-name')).toBeNull()
  })

  it('does not mistake a cookie whose name merely ends the same way', () => {
    writeCookie('x-feld-device-token', 'other', SCOPE)
    expect(readCookie('feld-device-token')).toBeNull()

    writeCookie('feld-device-token', 'mine', SCOPE)
    expect(readCookie('feld-device-token')).toBe('mine')
  })
})
