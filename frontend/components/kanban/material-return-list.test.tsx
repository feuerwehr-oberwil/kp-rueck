import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const { api } = vi.hoisted(() => ({ api: { getRapportMaterialReturn: vi.fn(), unassignResource: vi.fn() } }))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ refreshOperations: vi.fn() }) }))

import { MaterialReturnList } from '@/components/kanban/material-return-list'

const unit = (name: string) => ({ assignment_id: `a-${name}`, name, used: true })

describe('MaterialReturnList', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows no «Material zurück – freigeben» heading when nothing is to release', async () => {
    api.getRapportMaterialReturn.mockResolvedValue({ returned: [], left_on_site: [unit('Tauchpumpe S-Gr.')], left_on_site_named: [] })
    renderWithIntl(<MaterialReturnList incidentId="inc-1" />)

    expect(await screen.findByText('Vor Ort verblieben')).toBeInTheDocument()
    expect(screen.queryByText('Material zurück – freigeben')).not.toBeInTheDocument()
  })

  it('heads the units to release', async () => {
    api.getRapportMaterialReturn.mockResolvedValue({ returned: [unit('Generator')], left_on_site: [], left_on_site_named: [] })
    renderWithIntl(<MaterialReturnList incidentId="inc-1" />)

    expect(await screen.findByText('Material zurück – freigeben')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 Gerät freigeben/ })).toBeInTheDocument()
  })
})
