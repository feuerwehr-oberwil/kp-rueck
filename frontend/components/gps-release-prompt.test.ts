import { describe, expect, it } from 'vitest'
import { isLastResource } from '@/components/gps-release-prompt'

const vehicle = (vehicleId: string) => ({ vehicleId, assignmentId: `a-${vehicleId}`, name: vehicleId, callsign: null })
const member = (personnelId: string) => ({ personnelId, assignmentId: `a-${personnelId}`, name: personnelId })
const driver = { id: 'p-fahrer', isDriver: true, driverVehicleId: 'v-mowa' }

// Owner pick #21: «Einsatz abschliessen» is the main answer only when the Mowa is all that is left.
describe('isLastResource', () => {
  it('is the last one when only the vehicle and its own driver are on the Einsatz', () => {
    const op = { vehicles: [vehicle('v-mowa')], crew: [member('p-fahrer')], materials: [] }
    expect(isLastResource(op, 'v-mowa', [driver])).toBe(true)
  })

  it('is not when another vehicle, other crew or material is still assigned', () => {
    const base = { vehicles: [vehicle('v-mowa')], crew: [], materials: [] }
    expect(isLastResource({ ...base, vehicles: [vehicle('v-mowa'), vehicle('v-tlf')] }, 'v-mowa', [driver])).toBe(false)
    expect(isLastResource({ ...base, crew: [member('p-trupp')] }, 'v-mowa', [driver])).toBe(false)
    expect(isLastResource({ ...base, materials: ['m-pumpe'] }, 'v-mowa', [driver])).toBe(false)
  })
})
