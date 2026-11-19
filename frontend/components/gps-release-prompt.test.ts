import { describe, expect, it } from 'vitest'
import { isLastResource } from '@/components/gps-release-prompt'

const vehicle = (vehicleId: string) => ({ vehicleId, assignmentId: `a-${vehicleId}`, name: vehicleId, callsign: null })
const member = (personnelId: string) => ({ personnelId, assignmentId: `a-${personnelId}`, name: personnelId })
const driver = { id: 'p-fahrer', isDriver: true, driverVehicleId: 'v-mowa' }
const mowa = { vehicleId: 'v-mowa', assignmentId: 'a-v-mowa' }

// Owner pick #21: «Einsatz abschliessen» is the main answer only when the Mowa is all that is left.
describe('isLastResource', () => {
  it('is the last one when only the vehicle and its returning driver are on the Einsatz', () => {
    const op = { vehicles: [{ ...vehicle('v-mowa'), driverStay: false }], crew: [member('p-fahrer')], materials: [], groupId: null }
    expect(isLastResource(op, mowa, [driver], undefined)).toBe(true)
  })

  it('is never when the driver «bleibt vor Ort» – on the crew list, only as Fahrer, or unknown', () => {
    const staying = { ...vehicle('v-mowa'), driverStay: true }
    expect(isLastResource({ vehicles: [staying], crew: [member('p-fahrer')], materials: [], groupId: null }, mowa, [driver], undefined)).toBe(false)
    expect(isLastResource({ vehicles: [staying], crew: [], materials: [], groupId: null }, mowa, [driver], undefined)).toBe(false)
    expect(isLastResource({ vehicles: [staying], crew: [], materials: [], groupId: null }, mowa, [], undefined)).toBe(false)
  })

  it('is not when the prompted assignment is gone from the Einsatz', () => {
    expect(isLastResource({ vehicles: [], crew: [], materials: [], groupId: null }, mowa, [driver], undefined)).toBe(false)
    const reassigned = { ...vehicle('v-mowa'), assignmentId: 'a-new' }
    expect(isLastResource({ vehicles: [reassigned], crew: [], materials: [], groupId: null }, mowa, [driver], undefined)).toBe(false)
  })

  it('is not when another vehicle, other crew or material is still assigned', () => {
    const base = { vehicles: [vehicle('v-mowa')], crew: [], materials: [], groupId: null }
    expect(isLastResource({ ...base, vehicles: [vehicle('v-mowa'), vehicle('v-tlf')] }, mowa, [driver], undefined)).toBe(false)
    expect(isLastResource({ ...base, crew: [member('p-trupp')] }, mowa, [driver], undefined)).toBe(false)
    expect(isLastResource({ ...base, materials: ['m-pumpe'] }, mowa, [driver], undefined)).toBe(false)
  })

  it('is not on an Auftrag stop while the route still has resources, or is unknown here (pass 2, S10)', () => {
    const op = { vehicles: [{ ...vehicle('v-mowa'), driverStay: false }], crew: [], materials: [], groupId: 'g-nord' }
    expect(isLastResource(op, mowa, [driver], { assignments: [{ resourceType: 'personnel' }] })).toBe(false)
    expect(isLastResource(op, mowa, [driver], undefined)).toBe(false)
    expect(isLastResource(op, mowa, [driver], { assignments: [] })).toBe(true)
  })
})
