import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { DroppableColumn } from './droppable-column'
import { useCollapsedSections } from '@/lib/hooks/use-collapsed-sections'
import {
  BOARD_COLUMN_COLLAPSE_KEY,
  DEFAULT_COLLAPSED_COLUMN_IDS,
  columns,
} from '@/lib/kanban-utils'
import type { Material, Operation } from '@/lib/contexts/operations-context'

/**
 * Folding a column is a safety trade: the board buys width by hiding cards, so
 * the strip that is left MUST still say how many it is hiding, and the fold has
 * to survive the reload that a command post does after every restart.
 */

// jsdom implements neither matchMedia nor pragmatic-drag-and-drop.
vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  dropTargetForElements: () => () => {},
}))
// The cards themselves are covered by the draggable-operation tests; here they
// are just weight.
vi.mock('./draggable-operation', () => ({
  DraggableOperation: ({ operation }: { operation: Operation }) => <div>{operation.location}</div>,
}))

/** The column asks whether it is on a wide screen — here: yes, so the auto-fold
 *  of empty columns never fires and every fold in this file is an operator's. */
function installWideScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function installStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  } as Storage)
}

const HOUR_AGO = new Date(Date.now() - 90 * 60 * 1000)

function op(id: string, overrides: Partial<Operation> = {}): Operation {
  return {
    id,
    location: `Hauptstrasse ${id}`,
    locationDisplay: `Hauptstrasse ${id}`,
    incidentType: 'brand',
    status: 'incoming',
    priority: 'medium',
    crew: [],
    vehicles: [],
    materials: [],
    dispatchTime: new Date(),
    statusChangedAt: null,
    notes: '',
    contact: '',
    groupId: null,
    groupPosition: 0,
    nachbarhilfe: false,
    zuFuss: false,
    hasCompletedReko: false,
    assignedReko: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  } as Operation
}

const INCOMING = columns[0]

/** The board's own wiring, minus the board: one column, folded through the same
 *  per-device set app/page.tsx uses. */
function Board({ operations }: { operations: Operation[] }) {
  const collapsed = useCollapsedSections(BOARD_COLUMN_COLLAPSE_KEY, DEFAULT_COLLAPSED_COLUMN_IDS)
  return (
    <DroppableColumn
      column={INCOMING}
      operations={operations}
      onRemoveCrew={() => {}}
      onRemoveMaterial={() => {}}
      onRemoveVehicle={() => {}}
      onCardClick={() => {}}
      onCardHover={() => {}}
      highlightedOperationId={null}
      isDraggingRef={{ current: false }}
      materials={[] as Material[]}
      formatLocation={(address) => address}
      isCollapsed={collapsed.isCollapsed(INCOMING.id)}
      onToggleCollapsed={collapsed.toggle}
    />
  )
}

describe('folding a board column', () => {
  beforeEach(() => {
    installStorage()
    installWideScreen()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the count visible on the folded strip', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Board operations={[op('a'), op('b'), op('c')]} />)

    await user.click(screen.getByRole('button', { name: /Eingegangen: Spalte einklappen/ }))

    const strip = screen.getByRole('button', { name: /Spalte Eingegangen \(3 Einsätze\)/ })
    expect(strip).toHaveAttribute('aria-expanded', 'false')
    expect(strip).toHaveTextContent('3')
    // The cards are gone, the fact that there are three of them is not.
    expect(screen.queryByText('Hauptstrasse a')).not.toBeInTheDocument()
  })

  it('flags an overdue incident that the fold would otherwise hide', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Board operations={[op('a', { statusChangedAt: HOUR_AGO })]} />)

    await user.click(screen.getByRole('button', { name: /Spalte einklappen/ }))

    expect(screen.getByLabelText(/1 überfällig: Hauptstrasse a/)).toBeInTheDocument()
  })

  it('remembers the fold across a reload, and unfolds again from the strip', async () => {
    const user = userEvent.setup()
    const first = renderWithIntl(<Board operations={[op('a')]} />)
    await user.click(screen.getByRole('button', { name: /Spalte einklappen/ }))
    expect(JSON.parse(localStorage.getItem(BOARD_COLUMN_COLLAPSE_KEY) ?? '[]')).toContain('incoming')
    first.unmount()

    // Same device, fresh mount: the column comes back folded.
    renderWithIntl(<Board operations={[op('a')]} />)
    const strip = await screen.findByRole('button', { name: /Spalte Eingegangen/ })
    expect(strip).toHaveAttribute('aria-expanded', 'false')

    await user.click(strip)
    expect(screen.getByText('Hauptstrasse a')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(BOARD_COLUMN_COLLAPSE_KEY) ?? '[]')).not.toContain('incoming')
  })

  it('starts ABGESCHLOSSEN folded and nothing else — no live column hides itself', () => {
    expect(DEFAULT_COLLAPSED_COLUMN_IDS).toEqual(['complete'])
  })
})
