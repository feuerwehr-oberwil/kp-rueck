import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
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

describe('the phone Einsatz sheet has a Reko block before a Bericht is filed', () => {
  it('names the Reko person and «vor Ort» – the block «Reko vor Ort» lands on', () => {
    renderWithIntl(
      <MobileIncidentDetailSheet
        operation={{ ...OPERATION, assignedReko: { id: 'p-1', name: 'Keller Lea' }, rekoArrivedAt: new Date('2026-11-14T18:12:00') } as Operation}
        open
        onOpenChange={vi.fn()}
        materials={[] as Material[]}
        formatLocation={(a) => a}
      />,
    )
    expect(screen.getByText('Keller Lea')).toBeInTheDocument()
    expect(screen.getByText(/vor Ort 18:12/)).toBeInTheDocument()
  })
})
