import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material, Operation } from '@/lib/contexts/operations-context'
import { CARD_VIEW_KEYS, CARD_VIEW_PRESETS, type CardViewSettings } from '@/lib/card-view'

/**
 * What the card renders for a given Ansicht.
 *
 * The card is `React.memo`'d with a hand-written comparator, so the second
 * describe below is a test OF that comparator: each switch is flipped on an
 * already-mounted card, and a flag the comparator did not look at would leave
 * the previous tree in place.
 */

const mockGroups: { id: string; name: string; stopIds: string[]; color: string | null }[] = []

vi.mock('@/lib/contexts/materials-context', () => ({
  useMaterials: () => ({ materialGroups: [] }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({
  useGroups: () => ({ groups: mockGroups, getGroupResources: () => null }),
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
    vehicles: ['TLF Oberwil'],
    incidentType: 'brandbekaempfung',
    dispatchTime: new Date('2026-08-09T10:00:00Z'),
    crew: ['Muster Hans'],
    priority: 'low',
    status: 'incoming',
    coordinates: [47.1, 7.2],
    materials: ['mat-1'],
    notes: 'Anruferin meldet Wasser im Keller',
    contact: 'Frau Meier',
    contactPhone: '079 123 45 67',
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

const MATERIALS = [{ id: 'mat-1', name: 'Tauchpumpe' }] as unknown as Material[]

function card(cardView?: CardViewSettings, op: Operation = operation()) {
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
      cardView={cardView}
    />
  )
}

function renderCard(cardView?: CardViewSettings, op?: Operation) {
  return renderWithIntl(card(cardView, op))
}

describe('the card view switches', () => {
  it('Standard shows what the board showed before the Ansicht control existed', () => {
    renderCard(CARD_VIEW_PRESETS.standard)
    expect(screen.getByText('Anruferin meldet Wasser im Keller')).toBeInTheDocument()
    expect(screen.getByText('Einsturzgefahr')).toBeInTheDocument()
    expect(screen.getByText('Muster Hans')).toBeInTheDocument()
    expect(screen.getByText(/TLF Oberwil/)).toBeInTheDocument()
    expect(screen.getByText('Tauchpumpe')).toBeInTheDocument()
    // Melder is the one block the card never had — off in Standard.
    expect(screen.queryByText('Frau Meier')).not.toBeInTheDocument()
  })

  it('Alles adds the Melder and a dialable number', () => {
    renderCard(CARD_VIEW_PRESETS.alles)
    expect(screen.getByText('Frau Meier')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '079 123 45 67' })).toHaveAttribute(
      'href',
      'tel:0791234567',
    )
  })

  it('Kompakt leaves the header and nothing else', () => {
    renderCard(CARD_VIEW_PRESETS.kompakt)
    // The address survives every preset — it is not switchable.
    expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument()
    for (const text of [
      'Anruferin meldet Wasser im Keller',
      'Einsturzgefahr',
      'Muster Hans',
      'Tauchpumpe',
      'Frau Meier',
    ]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/TLF Oberwil/)).not.toBeInTheDocument()
  })

  it('takes the separator and the padding with a hidden block, so Kompakt is really compact', () => {
    const { container: full, unmount } = renderCard(CARD_VIEW_PRESETS.standard)
    expect(full.querySelectorAll('.operation-card .border-t').length).toBeGreaterThan(0)
    unmount()

    const { container: compact } = renderCard(CARD_VIEW_PRESETS.kompakt)
    // No orphan divider, and no bordered box left holding only its own padding.
    expect(compact.querySelectorAll('.operation-card .border-t')).toHaveLength(0)
    expect(compact.querySelectorAll('.operation-card .pt-3')).toHaveLength(0)
  })

  it('drops the resource block entirely when all three resource switches are off', () => {
    const { container } = renderCard({
      ...CARD_VIEW_PRESETS.standard,
      mannschaft: false,
      fahrzeuge: false,
      material: false,
      meldung: false,
      reko: false,
    })
    // Crew/vehicles/materials all present on the incident, all switched off:
    // the bordered wrapper must go with them.
    expect(container.querySelectorAll('.operation-card .border-t')).toHaveLength(0)
  })

  it('hides the Meldung without touching the Reko, and the other way round', () => {
    const { unmount } = renderCard({ ...CARD_VIEW_PRESETS.standard, reko: false })
    expect(screen.getByText('Anruferin meldet Wasser im Keller')).toBeInTheDocument()
    expect(screen.queryByText('Einsturzgefahr')).not.toBeInTheDocument()
    unmount()

    renderCard({ ...CARD_VIEW_PRESETS.standard, meldung: false })
    expect(screen.queryByText('Anruferin meldet Wasser im Keller')).not.toBeInTheDocument()
    expect(screen.getByText('Einsturzgefahr')).toBeInTheDocument()
  })

  it('falls back to Standard when no view is passed, as the card always did', () => {
    renderCard(undefined)
    expect(screen.getByText('Einsturzgefahr')).toBeInTheDocument()
    expect(screen.getByText('Anruferin meldet Wasser im Keller')).toBeInTheDocument()
  })

  it('keeps the address and the priority marker on every preset', () => {
    renderCard(CARD_VIEW_PRESETS.kompakt)
    expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Niedrige Priorität')).toBeInTheDocument()
  })

  it('keeps the Nachbarhilfe note on the card even in Kompakt', () => {
    renderCard(
      CARD_VIEW_PRESETS.kompakt,
      operation({ nachbarhilfe: true, nachbarhilfeNote: 'FW Therwil vor Ort' }),
    )
    // A status is not a detail — it is not in CARD_VIEW_KEYS at all.
    expect(screen.getByText('FW Therwil vor Ort')).toBeInTheDocument()
  })
})

/**
 * The memo guard. Every switch is flipped on a mounted card; if the comparator
 * ignored that key React would keep the previous tree and the text would not
 * change. Driven by CARD_VIEW_KEYS, so a flag added later is covered the moment
 * it exists.
 */
describe('the memo comparator sees every switch', () => {
  for (const key of CARD_VIEW_KEYS) {
    it(`repaints the card when "${key}" is turned off`, () => {
      const inAuftrag = key === 'auftrag'
      if (inAuftrag) {
        mockGroups.push({ id: 'route-1', name: 'Route Nord', stopIds: ['incident-1'], color: null })
      }
      const op = inAuftrag ? operation({ groupId: 'route-1' }) : operation()

      const { container, rerender } = renderCard(CARD_VIEW_PRESETS.alles, op)
      const before = container.textContent

      rerender(card({ ...CARD_VIEW_PRESETS.alles, [key]: false }, op))
      expect(container.textContent).not.toBe(before)

      mockGroups.length = 0
    })
  }
})
