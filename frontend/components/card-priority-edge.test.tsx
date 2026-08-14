import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material, Operation } from '@/lib/contexts/operations-context'
import { PRIORITY_EDGE_CLASSES } from '@/lib/priority'

/**
 * The card's left edge means PRIORITY — on the board and on the wall board
 * alike. It used to mean status on the wall's Status page, which is a colour
 * with two meanings on two screens hanging next to each other.
 *
 * Both cards read `PRIORITY_EDGE_CLASSES` now, so this renders them and asserts
 * the edge that actually lands on the element. Note the trap it guards: `cn()`
 * is twMerge, so a later `border-*` utility silently wins over `border-l-*`.
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
vi.mock('@atlaskit/pragmatic-drag-and-drop/combine', () => ({ combine: () => () => {} }))

import { DraggableOperation } from '@/components/kanban/draggable-operation'
import { DisplayIncidentCard } from '@/components/display/incident-card'

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
    status: 'incoming',
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

function renderBoardCard(op: Operation) {
  return renderWithIntl(
    <DraggableOperation
      operation={op}
      onRemoveCrew={vi.fn()}
      onRemoveMaterial={vi.fn()}
      onRemoveVehicle={vi.fn()}
      onClick={vi.fn()}
      onHover={vi.fn()}
      isDraggingRef={{ current: false }}
      materials={[] as unknown as Material[]}
      index={0}
      formatLocation={(address: string) => address}
    />,
  )
}

const card = () => document.querySelector('[data-incident-id="incident-1"]')!

describe.each([
  ['the board card', (op: Operation) => renderBoardCard(op)],
  ['the wall board card', (op: Operation) => renderWithIntl(<DisplayIncidentCard operation={op} />)],
])('%s', (_name, render) => {
  it.each(['high', 'medium', 'low'] as const)('draws the %s priority edge', (priority) => {
    render(operation({ priority }))
    expect(card().className).toContain(PRIORITY_EDGE_CLASSES[priority])
  })

  it('keeps the priority edge on a high card, under the pulse that eats box-shadows', () => {
    render(operation({ priority: 'high' }))
    // The pulse animates `box-shadow` in its keyframes, so `ring-*`/`shadow-*`
    // are wiped on exactly this card. `border-left-color` is a different
    // property and survives — which is why the edge, not a ring, carries it.
    expect(card().className).toContain('priority-high-pulse')
    expect(card().className).toContain('border-l-destructive')
  })

  it('never colours the edge by status', () => {
    render(operation({ priority: 'low', status: 'returning' }))
    expect(card().className).not.toMatch(/border-l-(sky|emerald|teal|orange|blue|slate|zinc)-/)
  })
})

describe('the board card heading', () => {
  it('prefers the label the server computed over its own formatter', () => {
    // c2f97d18 fixed the address formatter server-side; the board card ran a
    // client-side copy through a prop and so never saw the fix.
    renderBoardCard(operation({ locationDisplay: 'Bahnhofstrasse 12, Therwil' }))
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Bahnhofstrasse 12, Therwil')
  })

  it('falls back to the Einsatzart when the address says nothing beyond the home town', () => {
    renderBoardCard(operation({ location: '', locationDisplay: '' }))
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Brandbekämpfung')
  })
})
