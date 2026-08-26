import { afterEach, describe, expect, it } from 'vitest'

import { setRuntimeCartoApiKey } from '@/lib/env'
import { onlineTileUrl } from './use-map-mode'

afterEach(() => {
  setRuntimeCartoApiKey(null)
})

describe('onlineTileUrl', () => {
  it('adds the URL-encoded runtime key to every CARTO raster style', () => {
    setRuntimeCartoApiKey('test key/+?')

    expect(onlineTileUrl('carto-light')).toContain('?key=test%20key%2F%2B%3F')
    expect(onlineTileUrl('carto-dark')).toContain('?key=test%20key%2F%2B%3F')
  })

  it('does not leak the CARTO key to another tile provider', () => {
    setRuntimeCartoApiKey('carto-test-key')

    expect(onlineTileUrl('osm')).not.toContain('key=')
    expect(onlineTileUrl('topo')).not.toContain('key=')
  })

  it('keeps the existing CARTO URL when no key is configured', () => {
    expect(onlineTileUrl('carto-light')).toBe(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    )
  })
})
