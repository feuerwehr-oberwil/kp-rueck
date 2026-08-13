import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material, Operation } from '@/lib/contexts/operations-context'

/**
 * Tests OF the card's hand-written `memo` comparator — the values it compares by
 * count or by identity where the card actually draws the *content*.
 *
 * The one that bit: the danger chips were compared by `dangerTypes.length`, so a
 * Reko correcting Einsturz to Brandgefahr left the old word on the board (one
 * chip before, one chip after). Each case below changes exactly one thing on an
 * already-mounted card; a field the comparator does not look at leaves the
 * previous tree in place and the assertion fails.
 */

vi.mock('@/lib/contexts/materials-context', () => ({
  useMaterials: () => ({ materialGroups: [] }),
}))
vi.mock('@/lib/contexts/operations-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/contexts/operations-context')>()),
  useOperations: () => ({ materialOnSite: new Map() }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({
  useGroups: () => ({ groups: [], getGroupResources: () => null }),
}))
vi.mock('@/lib/hooks/use-print-job-toast', () => ({ usePrintJobToast: () => vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: {} }))
vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
}))
vi.mock('@atlaskit/pragmatic-drag-and-drop/combine', () => ({
  combine: () => () => {},
}))

import { DraggableOperation, sameStrings } from '@/components/kanban/draggable-operation'

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'incident-1',
    location: 'Hauptstrasse 1, 4104 Oberwil',
    vehicle: null,
    vehicles: ['TLF Oberwil'],
    incidentType: 'brandbekaempfung',
    dispatchTime: new Date('2026-08-09T10:00:00Z'),
    crew: ['Muster Hans'],
    priority: 'low',
    status: 'incoming',
    coordinates: [47.1, 7.2],
    materials: ['mat-1'],
    notes: 'Wasser im Keller',
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
    hasCompletedReko: true,
    rekoArrivedAt: null,
    rekoSummary: {
      isRelevant: true,
      hasDangers: true,
      dangerTypes: ['Einsturz'],
      personnelCount: 4,
      estimatedDuration: 2,
      summaryText: null,
      photos: [],
    },
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

const MATERIALS = [{ id: 'mat-1', name: 'Tauchpumpe' }] as unknown as Material[]

function card(op: Operation) {
  return (
    <DraggableOperation
      operation={op}
      onRemoveCrew={vi.fn()}
      onRemoveMaterial={vi.fn()}
      onRemoveVehicle={vi.fn()}
      onClick={vi.fn()}
      onHover={vi.fn()}
      isDraggingRef={{ current: false }}
      materials={MATERIALS}
      index={0}
      formatLocation={(address: string) => address}
    />
  )
}

/** Mount a card, then hand it a changed incident — as a board sync does. */
function mountAndUpdate(before: Operation, after: Operation) {
  const { rerender } = renderWithIntl(card(before))
  rerender(card(after))
}

describe('the card repaints when its content changes, not just its shape', () => {
  it('swaps a danger chip for another one — same count, different word', () => {
    mountAndUpdate(
      operation(),
      operation({
        rekoSummary: { ...operation().rekoSummary!, dangerTypes: ['Brandgefahr'] },
      }),
    )
    expect(screen.getByText('Brandgefahr')).toBeInTheDocument()
    expect(screen.queryByText('Einsturz')).not.toBeInTheDocument()
  })

  it('shows a corrected Nachbarhilfe note, not the town it used to say', () => {
    mountAndUpdate(
      operation({ nachbarhilfe: true, nachbarhilfeNote: 'Nachbarhilfe Biel-Benken' }),
      operation({ nachbarhilfe: true, nachbarhilfeNote: 'Nachbarhilfe Therwil' }),
    )
    expect(screen.getByText('Nachbarhilfe Therwil')).toBeInTheDocument()
  })

  it('picks up a Funkrufname that was set in the fleet settings', () => {
    mountAndUpdate(
      operation(),
      operation({ vehicleCallsigns: new Map([['TLF Oberwil', 'Florian 1']]) }),
    )
    expect(screen.getByTitle(/Florian 1/)).toBeInTheDocument()
  })

  it('renames the Reko person under the same id', () => {
    mountAndUpdate(
      operation({ assignedReko: { id: 'p-1', name: 'Muster Hans' } }),
      operation({ assignedReko: { id: 'p-1', name: 'Muster Hansruedi' } }),
    )
    expect(screen.getByText('Muster Hansruedi')).toBeInTheDocument()
  })
})

describe('sameStrings', () => {
  it('is false when a value is swapped without changing the count', () => {
    expect(sameStrings(['Einsturz'], ['Brandgefahr'])).toBe(false)
    expect(sameStrings(['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('is true only for the same values in the same order', () => {
    expect(sameStrings(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameStrings([], [])).toBe(true)
    expect(sameStrings(['a'], ['a', 'b'])).toBe(false)
  })
})
