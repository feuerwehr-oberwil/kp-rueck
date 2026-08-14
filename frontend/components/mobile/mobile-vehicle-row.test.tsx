import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material, Operation } from '@/lib/contexts/operations-context'

/**
 * The vehicle row of the phone's incident sheet.
 *
 * Two facts the board and the wall have always shown, and the phone did not:
 *
 *  * «Zu Fuss». A crew that walked to the address rendered as «Keine Fahrzeuge
 *    zugewiesen» — not a missing detail but the opposite of the truth, on the
 *    one surface people read when they are not at the board.
 *
 *  * The driver-stay glyph, per vehicle: MapPin = «bleibt», Undo2 = «zurück».
 *    Whether the driver is still with his vehicle decides whether it can be
 *    moved, and it changes without the incident changing.
 *
 * The rerender cases exist because of the shape of the bug this file class
 * keeps producing: `mobile-incident-card.tsx` is memoised with a HAND-WRITTEN
 * comparator, and a field drawn but not compared renders stale forever (see
 * `mobile-pickup.test.tsx`, commit e1e561f0). The sheet is unmemoised today, so
 * these three pass trivially — they are here to fail the day somebody wraps it
 * in `memo` with a comparator that forgets `zuFuss` or `vehicleDriverStay`.
 */

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/contexts/operations-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/contexts/operations-context')>()),
  useOperations: () => ({ refreshOperations: vi.fn(), changeStatusToTop: vi.fn() }),
}))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
vi.mock('@/components/reko/reko-report-section', () => ({ default: () => null }))

import { MobileIncidentDetailSheet } from '@/components/mobile/mobile-incident-detail-sheet'

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'incident-1',
    location: 'Hauptstrasse 1, 4104 Oberwil',
    vehicle: null,
    vehicles: [],
    incidentType: 'brandbekaempfung',
    dispatchTime: new Date('2026-08-09T10:00:00Z'),
    crew: [],
    priority: 'low',
    status: 'active',
    coordinates: [47.1, 7.2],
    materials: [],
    notes: '',
    contact: '',
    contactPhone: '',
    internalNotes: '',
    nachbarhilfe: false,
    nachbarhilfeNote: '',
    amWarten: false,
    amWartenNote: '',
    zuFuss: false,
    groupId: null,
    groupPosition: 0,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    leaderName: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  } as Operation
}

function sheet(op: Operation) {
  return (
    <MobileIncidentDetailSheet
      operation={op}
      open
      onOpenChange={vi.fn()}
      materials={[] as unknown as Material[]}
      formatLocation={(a) => a}
      onUpdateOperation={vi.fn()}
      isEditor={false}
    />
  )
}

const ON_FOOT = operation({ zuFuss: true })
const WITH_TLF = operation({
  vehicles: ['TLF 1'],
  vehicleDriverStay: new Map([['TLF 1', false]]),
})

describe('«Zu Fuss» in the phone detail sheet', () => {
  it('names the crew on foot instead of claiming no vehicles', () => {
    renderWithIntl(sheet(ON_FOOT))
    expect(screen.getByText('Zu Fuss')).toBeInTheDocument()
    expect(screen.queryByText('Keine Fahrzeuge zugewiesen')).not.toBeInTheDocument()
  })

  it('sits alongside a vehicle when the crew took both routes', () => {
    renderWithIntl(sheet(operation({ ...WITH_TLF, zuFuss: true })))
    expect(screen.getByText('Zu Fuss')).toBeInTheDocument()
    expect(screen.getByText(/TLF 1/)).toBeInTheDocument()
  })

  it('still reports an empty row when there is genuinely nothing', () => {
    renderWithIntl(sheet(operation()))
    expect(screen.getByText('Keine Fahrzeuge zugewiesen')).toBeInTheDocument()
  })

  it('appears when the board marks it on an already-open sheet', () => {
    const { rerender } = renderWithIntl(sheet(operation()))
    rerender(sheet(ON_FOOT))
    expect(screen.getByText('Zu Fuss')).toBeInTheDocument()
    expect(screen.queryByText('Keine Fahrzeuge zugewiesen')).not.toBeInTheDocument()
  })
})

describe('the driver-stay glyph in the phone detail sheet', () => {
  it('marks a driver who stays with his vehicle', () => {
    renderWithIntl(sheet(operation({ ...WITH_TLF, vehicleDriverStay: new Map([['TLF 1', true]]) })))
    expect(screen.getByLabelText('bleibt')).toBeInTheDocument()
  })

  it('marks a driver who takes the vehicle back', () => {
    renderWithIntl(sheet(WITH_TLF))
    expect(screen.getByLabelText('zurück')).toBeInTheDocument()
  })

  it('says nothing when the assignment carries no answer', () => {
    renderWithIntl(sheet(operation({ vehicles: ['TLF 1'] })))
    expect(screen.queryByLabelText('bleibt')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('zurück')).not.toBeInTheDocument()
  })

  it('follows the toggle on an already-open sheet', () => {
    const { rerender } = renderWithIntl(sheet(WITH_TLF))
    rerender(sheet(operation({ ...WITH_TLF, vehicleDriverStay: new Map([['TLF 1', true]]) })))
    expect(screen.getByLabelText('bleibt')).toBeInTheDocument()
    expect(screen.queryByLabelText('zurück')).not.toBeInTheDocument()
  })

  it('is a state, never the board’s toggle button', () => {
    renderWithIntl(sheet(WITH_TLF))
    expect(screen.queryByRole('button', { name: /zurück|bleibt/ })).not.toBeInTheDocument()
  })
})
