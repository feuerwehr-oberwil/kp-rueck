import { describe, expect, it } from 'vitest'
import { isLastResource } from '@/components/gps-release-prompt'

const vehicle = (vehicleId: string) => ({ vehicleId, assignmentId: `a-${vehicleId}`, name: vehicleId, callsign: null })
const member = (personnelId: string) => ({ personnelId, assignmentId: `a-${personnelId}`, name: personnelId })
const driver = { id: 'p-fahrer', isDriver: true, driverVehicleId: 'v-mowa' }
const mowa = { vehicleId: 'v-mowa', assignmentId: 'a-v-mowa' }

// Owner pick #21: «Einsatz abschliessen» is the main answer only when the Mowa is all that is left.
describe('isLastResource', () => {
  it('is the last one when only the vehicle and its returning driver are on the Einsatz', () => {
    const op = { vehicles: [{ ...vehicle('v-mowa'), driverStay: false }], crew: [member('p-fahrer')], materials: [] }
    expect(isLastResource(op, mowa, [driver])).toBe(true)
  })

  it('is never when the driver «bleibt vor Ort» – on the crew list, only as Fahrer, or unknown', () => {
    const staying = { ...vehicle('v-mowa'), driverStay: true }
    expect(isLastResource({ vehicles: [staying], crew: [member('p-fahrer')], materials: [] }, mowa, [driver])).toBe(false)
    expect(isLastResource({ vehicles: [staying], crew: [], materials: [] }, mowa, [driver])).toBe(false)
    expect(isLastResource({ vehicles: [staying], crew: [], materials: [] }, mowa, [])).toBe(false)
  })

  it('is not when the prompted assignment is gone from the Einsatz', () => {
    expect(isLastResource({ vehicles: [], crew: [], materials: [] }, mowa, [driver])).toBe(false)
    const reassigned = { ...vehicle('v-mowa'), assignmentId: 'a-new' }
    expect(isLastResource({ vehicles: [reassigned], crew: [], materials: [] }, mowa, [driver])).toBe(false)
  })

  it('is not when another vehicle, other crew or material is still assigned', () => {
    const base = { vehicles: [vehicle('v-mowa')], crew: [], materials: [] }
    expect(isLastResource({ ...base, vehicles: [vehicle('v-mowa'), vehicle('v-tlf')] }, mowa, [driver])).toBe(false)
    expect(isLastResource({ ...base, crew: [member('p-trupp')] }, mowa, [driver])).toBe(false)
    expect(isLastResource({ ...base, materials: ['m-pumpe'] }, mowa, [driver])).toBe(false)
  })
})
