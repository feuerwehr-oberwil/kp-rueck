import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const { api } = vi.hoisted(() => ({ api: { getRapportMaterialReturn: vi.fn(), unassignResource: vi.fn() } }))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ refreshOperations: vi.fn() }) }))

import { MaterialRelease } from '@/components/kanban/material-release'

const unit = (name: string, used = true) => ({ assignment_id: `a-${name}`, name, used })

describe('MaterialRelease', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing when nothing is to release', async () => {
    api.getRapportMaterialReturn.mockResolvedValue({ returned: [], left_on_site: [unit('Tauchpumpe S-Gr.')], left_on_site_named: [] })
    const { container } = renderWithIntl(<MaterialRelease incidentId="inc-1" />)

    await vi.waitFor(() => expect(api.getRapportMaterialReturn).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('names the units the button frees, an unused one marked', async () => {
    api.getRapportMaterialReturn.mockResolvedValue({
      returned: [unit('Generator'), unit('Wassersauger', false)],
      left_on_site: [],
      left_on_site_named: [],
    })
    renderWithIntl(<MaterialRelease incidentId="inc-1" />)

    expect(await screen.findByRole('button', { name: /2 Geräte freigeben/ })).toBeInTheDocument()
    expect(screen.getByText('Noch zugewiesen: Generator, Wassersauger (nicht gebraucht)')).toBeInTheDocument()
  })
})
