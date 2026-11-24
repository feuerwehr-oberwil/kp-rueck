import { describe, expect, it } from 'vitest'

import { personPlaces } from './person-places'
import { personMatchesQuery } from './resource-status'

// Owner feedback 23.11.2026 #8: every person picker finds people by where they are dispatched
// now – Einsatz number, address, Auftrag – not only by name.
const op = (id: string, extra: Partial<Parameters<typeof personPlaces>[0][number]> = {}) => ({
  id,
  number: null,
  location: '',
  status: 'active' as const,
  groupId: null,
  crew: [],
  vehicles: [],
  assignedReko: null,
  ...extra,
})

const ringstrasse = op('i-12', { number: 12, location: 'Ringstrasse 11, Oberwil', locationDisplay: 'Ringstrasse 11', crew: [{ personnelId: 'egger' }] })
const bachweg = op('i-7', { number: 7, location: 'Bachweg 3', groupId: 'g-sturm' })
const sturmholz = { id: 'g-sturm', name: 'Sturmholz West', stopIds: ['i-7'], assignments: [{ resourceType: 'personnel' as const, resourceId: 'keller' }] }

const egger = { id: 'egger', name: 'Egger Olivier', role: 'Soldat' }
const keller = { id: 'keller', name: 'Keller Marco', role: 'Gefreiter' }
const matches = (person: { id: string; name: string }, query: string, places = personPlaces([ringstrasse, bachweg], [sturmholz])) =>
  personMatchesQuery({ ...person, places: places.get(person.id) }, query)

describe('person search by current place', () => {
  it('finds the crew of an Einsatz by its number and its address', () => {
    expect(matches(egger, '12')).toBe(true)
    expect(matches(egger, 'ringstr')).toBe(true)
    expect(matches(keller, 'ringstr')).toBe(false)
  })

  it('takes a number as the Einsatz number, exactly', () => {
    // «1» is not Einsatz 12, and not the «11» of the address either.
    expect(matches(egger, '1')).toBe(false)
  })

  it('finds an Auftrag crew by the Auftrag name and by its stops', () => {
    expect(matches(keller, 'sturmholz')).toBe(true)
    expect(matches(keller, '7')).toBe(true)
    expect(matches(keller, 'bachweg')).toBe(true)
    expect(matches(egger, 'sturmholz')).toBe(false)
  })

  it('finds an Auftrag by a name of digits, apart from the Einsatz numbers', () => {
    const jahr = { ...sturmholz, name: 'Unwetter 2026' }
    const places = personPlaces([ringstrasse, bachweg], [jahr])
    expect(matches(keller, '2026', places)).toBe(true)
    expect(matches(keller, '7', places)).toBe(true)
    expect(matches(egger, '2026', places)).toBe(false)
  })

  it('finds the Reko person and the driver of a vehicle out there', () => {
    const reko = op('i-3', { number: 3, location: 'Hauptstrasse 5', assignedReko: { id: 'egger' }, vehicles: [{ vehicleId: 'tlf' }] })
    const places = personPlaces([reko], [], [{ id: 'keller', isDriver: true, driverVehicleId: 'tlf' }])
    expect(matches(egger, 'hauptstrasse', places)).toBe(true)
    expect(matches(keller, '3', places)).toBe(true)
  })

  it('does not place anybody on a closed Einsatz', () => {
    const closed = op('i-9', { number: 9, location: 'Kirchweg 1', status: 'complete', assignedReko: { id: 'egger' } })
    expect(matches(egger, '9', personPlaces([closed], []))).toBe(false)
  })
})
