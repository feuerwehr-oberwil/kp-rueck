import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'

/**
 * The two card toggles (§18.12): "Meldung" and "Reko" are separate switches.
 *
 * They used to be one — the Reko block rode along with whatever the Meldung
 * pill was doing — which put the phone call and the reconnaissance under one
 * control even though they answer different questions.
 */

vi.mock('@/lib/contexts/materials-context', () => ({
  useMaterials: () => ({ materialGroups: [] }),
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

import { DraggableOperation } from '@/components/kanban/draggable-operation'

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'incident-1',
    location: 'Hauptstrasse 1',
    vehicle: null,
    vehicles: [],
    incidentType: 'brand',
    dispatchTime: new Date('2026-08-09T10:00:00Z'),
    crew: [],
    priority: 'low',
    status: 'incoming',
    coordinates: [47.1, 7.2],
    materials: [],
    notes: 'Anruferin meldet Wasser im Keller',
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
      hasDangers: true,
      dangerTypes: ['Einsturzgefahr'],
      personnelCount: 4,
      estimatedDuration: 2,
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

function renderCard(props: { showMeldung?: boolean; showReko?: boolean }) {
  renderWithIntl(
    <DraggableOperation
      operation={operation()}
      onRemoveCrew={vi.fn()}
      onRemoveMaterial={vi.fn()}
      onRemoveVehicle={vi.fn()}
      onClick={vi.fn()}
      onHover={vi.fn()}
      isDraggingRef={{ current: false }}
      materials={[]}
      index={0}
      formatLocation={(address: string) => address}
      {...props}
    />,
  )
}

describe('the card toggles', () => {
  it('shows both blocks when both toggles are on', () => {
    renderCard({ showMeldung: true, showReko: true })
    expect(screen.getByText('Anruferin meldet Wasser im Keller')).toBeInTheDocument()
    expect(screen.getByText('Einsturzgefahr')).toBeInTheDocument()
  })

  it('hides the Reko block without touching the Meldung', () => {
    renderCard({ showMeldung: true, showReko: false })
    expect(screen.getByText('Anruferin meldet Wasser im Keller')).toBeInTheDocument()
    expect(screen.queryByText('Einsturzgefahr')).not.toBeInTheDocument()
  })

  it('hides the Meldung without touching the Reko', () => {
    renderCard({ showMeldung: false, showReko: true })
    expect(screen.queryByText('Anruferin meldet Wasser im Keller')).not.toBeInTheDocument()
    expect(screen.getByText('Einsturzgefahr')).toBeInTheDocument()
  })

  it('keeps the Reko block when the prop is omitted, as the card always did', () => {
    renderCard({ showMeldung: false })
    expect(screen.getByText('Einsturzgefahr')).toBeInTheDocument()
  })
})
