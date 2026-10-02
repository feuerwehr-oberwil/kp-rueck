import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'

/** The phone list's empty states (#3): a search that found nothing gets its
 *  own sentence and «Suche leeren»; a status chip that hides everything says
 *  which, and «Alle zeigen». */

vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
vi.mock('@/components/mobile/mobile-incident-card', () => ({
  MobileIncidentCard: ({ operation }: { operation: Operation }) => <div data-testid="card">{operation.location}</div>,
}))
vi.mock('@/components/mobile/mobile-incident-detail-sheet', () => ({ MobileIncidentDetailSheet: () => null }))

import { MobileIncidentListView } from '@/components/mobile/mobile-incident-list-view'

const op = (id: string, location: string, status: Operation['status']) =>
  ({
    id,
    location,
    status,
    incidentType: 'elementarereignis',
    priority: 'medium',
    vehicles: [],
    crew: [],
    dispatchTime: new Date('2026-10-02T10:00:00Z'),
  }) as unknown as Operation

function renderList() {
  return renderWithIntl(
    <MobileIncidentListView
      operations={[op('1', 'Hauptstrasse 41', 'incoming'), op('2', 'Langegasse 97', 'incoming')]}
      materials={[]}
      formatLocation={(a) => a}
    />,
  )
}

describe('MobileIncidentListView — empty states', () => {
  it('search without hits: «Keine Einsätze für «xyz».» and «Suche leeren» brings the list back', async () => {
    const user = userEvent.setup()
    renderList()

    const field = screen.getByPlaceholderText('Einsatz suchen …')
    await user.type(field, 'xyz')

    const empty = screen.getByRole('status')
    expect(within(empty).getByText('Keine Einsätze für «xyz».')).toBeDefined()
    await user.click(within(empty).getByRole('button', { name: 'Suche leeren' }))

    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(screen.getAllByTestId('card')).toHaveLength(2)
  })

  it('a status chip that hides everything says which, and «Alle zeigen» lifts it', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: /Aktiv \(0\)/ }))
    const empty = screen.getByRole('status')
    expect(empty.textContent).toContain('Keine Einsätze mit Status «Aktiv».')

    await user.click(within(empty).getByRole('button', { name: 'Alle zeigen' }))
    expect(screen.getAllByTestId('card')).toHaveLength(2)
  })
})
