import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
vi.mock('@/components/mobile/mobile-incident-detail-sheet', () => ({ MobileIncidentDetailSheet: () => null }))

import { MobileIncidentListView } from '@/components/mobile/mobile-incident-list-view'

function renderList(props: Partial<React.ComponentProps<typeof MobileIncidentListView>> = {}) {
  return renderWithIntl(
    <MobileIncidentListView operations={[]} materials={[]} formatLocation={(a) => a} {...props} />,
  )
}

describe('MobileIncidentListView — «Neuer Einsatz»', () => {
  it('gives the phone a visible way in that opens the form', async () => {
    const onNewIncident = vi.fn()
    renderList({ isEditor: true, onNewIncident })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Neuer Einsatz' }))
    expect(onNewIncident).toHaveBeenCalledOnce()
  })

  it('is not there without the handler (viewers)', () => {
    renderList({ isEditor: false })
    expect(screen.queryByRole('button', { name: 'Neuer Einsatz' })).toBeNull()
  })

  it('stands below the training CTA in an Übung, above the search', () => {
    renderList({ isEditor: true, isTraining: true, onNewIncident: () => {} })
    const training = screen.getByRole('button', { name: /Übungs-Einsatz erstellen/ })
    const neu = screen.getByRole('button', { name: 'Neuer Einsatz' })
    const search = screen.getByPlaceholderText('Einsatz suchen …')
    expect(training.compareDocumentPosition(neu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(neu.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
