import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material } from '@/lib/contexts/operations-context'
import type { MaterialGroup } from '@/lib/contexts/materials-context'

/**
 * A device inside a module block has to offer the same two things the ungrouped
 * sidebar row offers (`MaterialSidebarRow` in `app/page.tsx`): the right-click
 * «Nicht einsatzbereit» flag, and — when it is busy in more than one place — the
 * list of its bindings instead of a silent jump to whichever came first.
 */

const setMaterialOutOfService = vi.fn(() => Promise.resolve())
const mockOperations: Array<{ id: string; materials: string[]; groupId: string | null; location: string; incidentType: string }> = []
const mockRouteMaterialIds: string[] = []

vi.mock('@/lib/contexts/materials-context', () => ({
  useMaterials: () => ({ setMaterialOutOfService }),
}))
vi.mock('@/lib/contexts/operations-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/contexts/operations-context')>()),
  useOperations: () => ({ operations: mockOperations, materialOnSite: new Map() }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({
  useGroups: () => ({
    groups: [{ id: 'route-1', name: 'Sturmholz Nord' }],
    getGroupResources: () => ({
      materials: mockRouteMaterialIds.map((id) => ({ resourceId: id })),
      personnel: [],
      vehicles: [],
    }),
  }),
}))
vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: () => () => {},
}))

import { MaterialGroupBlock } from '@/components/kanban/material-group-block'

const GROUP: MaterialGroup = {
  id: 'mod-1',
  name: 'Modul Wasser',
  description: null,
  location: 'Depot',
  materialIds: ['mat-1'],
}

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: 'mat-1',
    name: 'Tauchpumpe gross',
    category: 'Depot',
    type: 'Wasser',
    status: 'assigned',
    outOfService: false,
    outOfServiceSince: null,
    categorySortOrder: 0,
    consumable: false,
    groupId: 'mod-1',
    ...overrides,
  } as Material
}

function renderBlock(onMaterialClick = vi.fn(), materials: Material[] = [material()]) {
  const result = renderWithIntl(
    <MaterialGroupBlock
      group={GROUP}
      materials={materials}
      allAvailable={false}
      someAssigned
      allAssigned={false}
      onMaterialClick={onMaterialClick}
    />,
  )
  return { ...result, onMaterialClick }
}

/** The members only exist once the block is expanded. */
async function expand() {
  await userEvent.click(screen.getByText('Modul Wasser'))
}

beforeEach(() => {
  setMaterialOutOfService.mockClear()
  mockOperations.length = 0
  mockRouteMaterialIds.length = 0
})

describe('a device inside a module block', () => {
  it('offers «Nicht einsatzbereit» on right-click, and writes the one flag', async () => {
    renderBlock()
    await expand()

    fireEvent.contextMenu(screen.getByText('Tauchpumpe gross'))
    const item = await screen.findByText('Nicht einsatzbereit')
    await userEvent.click(item)

    expect(setMaterialOutOfService).toHaveBeenCalledWith('mat-1', true)
  })

  it('lists every binding when the device is spoken for in more than one place', async () => {
    mockOperations.push(
      { id: 'inc-1', materials: ['mat-1'], groupId: null, location: 'Hauptstrasse 1', incidentType: 'elementarereignis' },
      { id: 'inc-2', materials: ['mat-1'], groupId: null, location: 'Bahnhofweg 4', incidentType: 'elementarereignis' },
    )
    const { onMaterialClick } = renderBlock()
    await expand()

    await userEvent.click(screen.getByText('Tauchpumpe gross'))

    expect(await screen.findByText('2 Zuweisungen')).toBeInTheDocument()
    // Same «Ort (Einsatzart: Meldung)» label the board's own bindings list uses.
    expect(screen.getByText(/Hauptstrasse 1/)).toBeInTheDocument()
    expect(screen.getByText(/Bahnhofweg 4/)).toBeInTheDocument()
    // The list replaces the jump — it does not happen alongside it.
    expect(onMaterialClick).not.toHaveBeenCalled()
  })

  it('counts an Auftrag that owns the device as a binding of its own', async () => {
    mockOperations.push({
      id: 'inc-1', materials: ['mat-1'], groupId: null, location: 'Hauptstrasse 1', incidentType: 'elementarereignis',
    })
    mockRouteMaterialIds.push('mat-1')
    renderBlock()
    await expand()

    await userEvent.click(screen.getByText('Tauchpumpe gross'))

    expect(await screen.findByText('2 Zuweisungen')).toBeInTheDocument()
    expect(screen.getByText('Sturmholz Nord')).toBeInTheDocument()
  })

  it('leaves the single-binding jump to the board, exactly as before', async () => {
    mockOperations.push({
      id: 'inc-1', materials: ['mat-1'], groupId: null, location: 'Hauptstrasse 1', incidentType: 'elementarereignis',
    })
    const { onMaterialClick } = renderBlock()
    await expand()

    await userEvent.click(screen.getByText('Tauchpumpe gross'))

    expect(onMaterialClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('1 Bindung')).not.toBeInTheDocument()
  })
})
