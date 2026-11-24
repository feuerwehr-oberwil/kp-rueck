import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ materialOnSite: new Map() }) }))

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { MaterialSidebar, type MaterialSidebarProps } from '@/components/board/material-sidebar'
import type { Material } from '@/lib/contexts/materials-context'
import { DEFAULT_MATERIAL_VIEW, type MaterialViewPrefs } from '@/lib/material-view'
import { summarizeMaterials } from '@/lib/resource-status'

/** The Material-Leiste's wiring of its view: which handler a row calls, the saved view against
 *  the catalogue, and the footer next to the popover's counts. */

function device(id: string, name: string, extra: Partial<Material> = {}): Material {
  return {
    id,
    name,
    category: 'Magazin',
    type: 'Pumpen',
    status: 'available',
    outOfService: false,
    outOfServiceSince: null,
    categorySortOrder: 0,
    consumable: false,
    groupId: null,
    ...extra,
  }
}

function renderSidebar(materials: Material[], view: Partial<MaterialViewPrefs> = {}) {
  const props: MaterialSidebarProps = {
    setShowRightSidebar: vi.fn(),
    materialSearchQuery: '',
    setMaterialSearchQuery: vi.fn(),
    setSearchQuery: vi.fn(),
    isMobile: false,
    materialView: { ...DEFAULT_MATERIAL_VIEW, ...view },
    setMaterialView: vi.fn(),
    materialOnSiteEntries: [],
    openIncidentDetail: vi.fn(),
    isLoaded: true,
    boardNeverLoaded: false,
    isEditor: true,
    materials,
    materialGroups: [{ id: 'mod', name: 'Pumpenmodul', description: null, location: 'Magazin', materialIds: ['p1'] }],
    filteredMaterials: materials,
    effectiveMaterialQuery: '',
    handleMaterialClick: vi.fn(),
    handleModuleMaterialClick: vi.fn(),
    handleAggregateMaterialClick: vi.fn(),
    handleToggleMaterialOutOfService: vi.fn(),
    bindingsPopover: null,
    setBindingsPopover: vi.fn(),
    followBinding: vi.fn(),
    materialSummary: summarizeMaterials(materials),
  }
  renderWithIntl(<MaterialSidebar {...props} />)
  return props
}

describe('the Material-Leiste', () => {
  it('by Typ, a module device is its own row and opens its bindings like any row', async () => {
    const user = userEvent.setup()
    const pump = device('p1', 'Tauchpumpe', { groupId: 'mod', status: 'assigned' })
    const props = renderSidebar([pump], { sort: 'type' })

    await user.click(screen.getByTitle('Tauchpumpe'))

    expect(props.handleMaterialClick).toHaveBeenCalledWith(pump)
    expect(props.handleModuleMaterialClick).not.toHaveBeenCalled()
  })

  it('ignores a saved Standort the catalogue no longer has (a renamed depot)', () => {
    renderSidebar([device('p1', 'Tauchpumpe')], { locations: ['Depot'] })
    expect(screen.getByTitle('Tauchpumpe')).toBeInTheDocument()
    expect(screen.queryByText('Kein Gerät passt zu diesen Filtern')).not.toBeInTheDocument()
  })

  it('counts a defective device as nicht einsatzbereit in the footer, not as gebunden', () => {
    renderSidebar([device('p1', 'Tauchpumpe'), device('p2', 'Wassersauger', { outOfService: true })])
    expect(screen.getByText('1 nicht einsatzbereit')).toBeInTheDocument()
    expect(screen.queryByText(/gebunden/)).not.toBeInTheDocument()
  })
})
