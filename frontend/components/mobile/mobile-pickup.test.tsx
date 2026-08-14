import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material, Operation } from '@/lib/contexts/operations-context'

/**
 * Abholung on the phone.
 *
 * Two things are pinned here, and both are the kind that come back:
 *
 *  * The list card is `memo`ised with a hand-written comparator, so every field
 *    the body draws has to be in it. The board card has already been bitten by
 *    exactly this (see `draggable-operation-memo.test.tsx`); a comparator that
 *    ignores the pickup leaves an amber chip on a crew that was collected an
 *    hour ago, which is worse than never showing it.
 *
 *  * The phone is a VIEWING surface. «Abholung erledigt» erases the waiting
 *    time — the only record of how long they stood at the kerb — so the chip
 *    here is a label, and the KP clears it from the board or the Lagekarte.
 *    Nothing but a test stops the next person passing `canEdit` through for
 *    symmetry with the board.
 */

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/contexts/operations-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/contexts/operations-context')>()),
  useOperations: () => ({ refreshOperations: vi.fn() }),
}))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
vi.mock('@/components/reko/reko-report-section', () => ({ default: () => null }))

import { MobileIncidentCard } from '@/components/mobile/mobile-incident-card'
import { MobileIncidentDetailSheet } from '@/components/mobile/mobile-incident-detail-sheet'

const REQUESTED = new Date('2026-08-09T21:14:00Z')

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
    status: 'complete',
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

const WAITING = operation({ pickupNeeded: true, pickupRequestedAt: REQUESTED })

function listCard(op: Operation) {
  return <MobileIncidentCard operation={op} onClick={vi.fn()} formatLocation={(a) => a} />
}

function sheet(op: Operation, isEditor = false) {
  return (
    <MobileIncidentDetailSheet
      operation={op}
      open
      onOpenChange={vi.fn()}
      materials={[] as unknown as Material[]}
      formatLocation={(a) => a}
      onUpdateOperation={vi.fn()}
      isEditor={isEditor}
    />
  )
}

describe('the Abholung chip on the phone list', () => {
  it('shows a crew waiting to be collected', () => {
    renderWithIntl(listCard(WAITING))
    expect(screen.getByText('Abholung')).toBeInTheDocument()
  })

  it('is absent when nobody is waiting', () => {
    renderWithIntl(listCard(operation()))
    expect(screen.queryByText('Abholung')).not.toBeInTheDocument()
  })

  // The card is memoised: without the pickup fields in the comparator these two
  // rerenders are no-ops and the previous tree stays on screen.
  it('appears when the field reports one on an already-mounted card', () => {
    const { rerender } = renderWithIntl(listCard(operation()))
    rerender(listCard(WAITING))
    expect(screen.getByText('Abholung')).toBeInTheDocument()
  })

  it('disappears when the KP clears it on the board', () => {
    const { rerender } = renderWithIntl(listCard(WAITING))
    rerender(listCard(operation()))
    expect(screen.queryByText('Abholung')).not.toBeInTheDocument()
  })

  it('is a label, never the «Abholung erledigt» button', () => {
    renderWithIntl(listCard(WAITING))
    expect(screen.queryByRole('button', { name: /Abholung/ })).not.toBeInTheDocument()
  })
})

describe('the Abholung banner in the phone detail sheet', () => {
  it('states how long the crew has been waiting', () => {
    renderWithIntl(sheet(WAITING))
    expect(screen.getByText(/Abholung –/)).toBeInTheDocument()
  })

  // Stays on a completed incident on purpose: completing the card released the
  // crew while they were still standing at the address.
  it('stays on a completed incident', () => {
    renderWithIntl(sheet(operation({ ...WAITING, status: 'complete' })))
    expect(screen.getByText(/Abholung –/)).toBeInTheDocument()
  })

  it('offers no clear button, not even to an editor', () => {
    renderWithIntl(sheet(WAITING, true))
    expect(screen.queryByRole('button', { name: 'Abholung erledigt' })).not.toBeInTheDocument()
  })
})
