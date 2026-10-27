import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import de from '@/messages/de.json'

const board = vi.hoisted(() => ({
  operations: [
    {
      id: 'op-12',
      number: 12,
      location: 'Ringstrasse 11',
      locationDisplay: 'Ringstrasse 11',
      crew: [{ personnelId: 'p-2', assignmentId: 'a-2', name: 'Anna Crew' }],
      vehicles: [{ vehicleId: 'v-mowa', assignmentId: 'a-mowa', name: 'Mowa', callsign: null }],
    },
  ],
  personnel: [
    { id: 'p-1', name: 'Koch René', isDriver: true, driverVehicleId: 'v-mowa', driverVehicleName: 'Mowa' },
    { id: 'p-2', name: 'Anna Crew', isDriver: true, driverVehicleId: 'v-mowa', driverVehicleName: 'Mowa' },
    { id: 'p-3', name: 'Depot Fahrer', isDriver: true, driverVehicleId: 'v-tlf', driverVehicleName: 'TLF' },
  ],
}))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => board }))
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ groups: [], getGroupResources: () => ({ personnel: [] }) }) }))

import { usePersonEngagements } from './use-person-engagements'

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">{children}</NextIntlClientProvider>
)

// UX-DESKTOP-05: «where is Koch René?» – a driver who is not crew is where the vehicle stands.
describe('usePersonEngagements', () => {
  it('maps a Fahrer to the Einsatz their vehicle stands on, role first', () => {
    const { result } = renderHook(() => usePersonEngagements(), { wrapper })
    expect(result.current.get('p-1')?.short).toBe('Fahrer Mowa · 12 · Ringstrasse 11')
    // Crew on that Einsatz already says where; a vehicle in the depot says nothing here.
    expect(result.current.get('p-2')?.short).toBe('12 · Ringstrasse 11')
    expect(result.current.has('p-3')).toBe(false)
  })
})
