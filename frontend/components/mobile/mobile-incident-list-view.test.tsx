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

function renderBare(props: Partial<React.ComponentProps<typeof MobileIncidentListView>> = {}) {
  return renderWithIntl(
    <MobileIncidentListView operations={[]} materials={[]} formatLocation={(a) => a} {...props} />,
  )
}

describe('MobileIncidentListView — «Neuer Einsatz»', () => {
  it('gives the phone a visible way in that opens the form', async () => {
    const onNewIncident = vi.fn()
    renderBare({ isEditor: true, onNewIncident })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Neuer Einsatz' }))
    expect(onNewIncident).toHaveBeenCalledOnce()
  })

  it('is not there without the handler (viewers)', () => {
    renderBare({ isEditor: false })
    expect(screen.queryByRole('button', { name: 'Neuer Einsatz' })).toBeNull()
  })

  it('stands below the training CTA in an Übung, above the search', () => {
    renderBare({ isEditor: true, isTraining: true, onNewIncident: () => {} })
    const training = screen.getByRole('button', { name: /Übungs-Einsatz erstellen/ })
    const neu = screen.getByRole('button', { name: 'Neuer Einsatz' })
    const search = screen.getByPlaceholderText('Einsatz suchen …')
    expect(training.compareDocumentPosition(neu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(neu.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
