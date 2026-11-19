import { describe, expect, it } from 'vitest'

import { ownPath, withReturnTo } from '@/lib/own-path'

describe('ownPath', () => {
  it('keeps a path on this site', () => {
    expect(ownPath('/feld?token=abc')).toBe('/feld?token=abc')
  })

  it.each(['https://example.com', '//example.com', '/\\example.com', '/\t/example.com', '/\n/example.com', '/a/..//example.com', 'feld', '', null])(
    'refuses %s',
    (raw) => {
      expect(ownPath(raw)).toBeNull()
    },
  )
})

describe('withReturnTo', () => {
  it('adds the way home to the link, keeping its own query', () => {
    const link = withReturnTo('/reko?incident_id=1&token=t', '/feld?token=x')
    const params = new URLSearchParams(link.split('?')[1])
    expect(link.startsWith('/reko?')).toBe(true)
    expect(params.get('incident_id')).toBe('1')
    expect(params.get('return_to')).toBe('/feld?token=x')
  })
})
