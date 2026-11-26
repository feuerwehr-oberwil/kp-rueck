import { describe, expect, it } from 'vitest'

import type { GroupResources } from '@/lib/types/groups'
import { assignedVehicle, makeOperation } from '@/test-utils/operation-fixtures'
import { vehicleOnSite } from './vehicle-on-site'

const route = (...names: string[]): GroupResources => ({
  vehicles: names.map((name) => ({ assignmentId: `a-${name}`, resourceId: `v-${name}`, name })),
  personnel: [],
  materials: [],
})

describe('vehicleOnSite', () => {
  it('counts an own vehicle only while its driver stays', () => {
    const tlf = assignedVehicle('TLF 1', { driverStay: false })
    expect(vehicleOnSite(makeOperation({ vehicles: [tlf] }))).toBeNull()
    expect(vehicleOnSite(makeOperation({ vehicles: [{ ...tlf, driverStay: undefined }] }))).toBeNull()
    expect(vehicleOnSite(makeOperation({ vehicles: [tlf, assignedVehicle('Pio', { driverStay: true })] }))).toBe('Pio')
  })

  it('counts any Auftrag vehicle – it travels with the crew', () => {
    const tlf = assignedVehicle('TLF 1', { driverStay: false })
    expect(vehicleOnSite(makeOperation({ vehicles: [tlf], auftragResources: route('MTF') }))).toBe('MTF')
    expect(vehicleOnSite(makeOperation({ auftragResources: route() }))).toBeNull()
  })
})
