import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material, Operation } from '@/lib/contexts/operations-context'

/**
 * The phone Einsatz sheet is read-only for every role (owner's pick 14.11.2026, «Board
 * read-only, intake stays»): status, Meldung and Kontakt are read, never edited – for an editor
 * too.
 */

vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
vi.mock('@/components/reko/reko-report-section', () => ({ default: () => null }))

import { MobileIncidentDetailSheet } from '@/components/mobile/mobile-incident-detail-sheet'

const OPERATION = {
  id: 'incident-1',
  number: 7,
  location: 'Hauptstrasse 1',
  incidentType: 'elementarereignis',
  priority: 'high',
  status: 'active',
  dispatchTime: new Date('2026-11-14T18:00:00Z'),
  statusChangedAt: null,
  notes: 'Keller unter Wasser, 30 cm',
  contact: 'Muster Anna',
  contactPhone: '061 111 11 11',
  vehicles: [],
  crew: [],
  materials: [],
  zuFuss: false,
  hasCompletedReko: false,
  rekoSummary: null,
  leaderId: null,
} as unknown as Operation

function renderSheet() {
  return renderWithIntl(
    <MobileIncidentDetailSheet
      operation={OPERATION}
      open
      onOpenChange={vi.fn()}
      materials={[] as Material[]}
      formatLocation={(a) => a}
    />,
  )
}

describe('the phone Einsatz sheet is read-only', () => {
  it('says the status as a word, with no select to change it', () => {
    renderSheet()
    expect(screen.getByText('Im Einsatz')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows the Meldung as text – no field, nothing to tap into', () => {
    renderSheet()
    expect(screen.getByText('Keller unter Wasser, 30 cm')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('makes the Melder one tel: link', () => {
    renderSheet()
    expect(screen.getByRole('link', { name: 'Muster Anna · 061 111 11 11' })).toHaveAttribute('href', 'tel:0611111111')
  })
})

// Opened on the Lagekarte, «Auf Karte anzeigen» linked to the page it was on (sweep 24.11.2026).
describe('«Auf Karte anzeigen»', () => {
  it('goes to the Lagekarte from the board', () => {
    renderSheet()
    expect(screen.getByRole('link', { name: 'Auf Karte anzeigen' })).toHaveAttribute('href', '/map?highlight=incident-1')
  })

  it('hands the Einsatz back to the Lagekarte it was opened on, without a link', () => {
    const onShowOnMap = vi.fn()
    renderWithIntl(
      <MobileIncidentDetailSheet
        operation={OPERATION}
        open
        onOpenChange={vi.fn()}
        onShowOnMap={onShowOnMap}
        materials={[] as Material[]}
        formatLocation={(a) => a}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Auf Karte anzeigen' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Auf Karte anzeigen' }))
    expect(onShowOnMap).toHaveBeenCalledWith('incident-1')
  })
})
