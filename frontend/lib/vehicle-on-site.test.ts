import { describe, expect, it } from 'vitest'

import { vehicleOnSite } from './vehicle-on-site'

describe('vehicleOnSite', () => {
  it('counts an own vehicle only while its driver stays', () => {
    expect(vehicleOnSite([{ name: 'TLF 1', driverStay: false }])).toBeNull()
    expect(vehicleOnSite([{ name: 'TLF 1', driverStay: undefined }])).toBeNull()
    expect(vehicleOnSite([{ name: 'TLF 1', driverStay: false }, { name: 'Pio', driverStay: true }])).toBe('Pio')
  })

  it('counts any Auftrag vehicle – it travels with the crew', () => {
    expect(vehicleOnSite([{ name: 'TLF 1', driverStay: false }], [{ name: 'MTF' }])).toBe('MTF')
    expect(vehicleOnSite([], [])).toBeNull()
  })
})
