import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Material, Operation } from '@/lib/contexts/operations-context'

/**
 * The phone Einsatz sheet is read-only for every role (owner's pick 14.11.2026, «Board
 * read-only, intake stays»): status, Meldung and Kontakt are read, never edited – for an editor
 * too.
 */

vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
const sheet = vi.hoisted(() => ({ pending: new Set<string>(), scrolls: [] as { ready?: boolean }[] }))
vi.mock('@/components/reko/reko-report-section', async () => {
  const { useEffect, useState } = await import('react')
  return {
    // Like the real one: the first read answers once per mount, for the incident it was mounted
    // with – a new `incidentId` alone does not read again. `sheet.pending` = not answered yet.
    default: function RekoReportSection({ incidentId, onLoadedChange }: { incidentId: string; onLoadedChange?: (loaded: boolean) => void }) {
      const [read] = useState(incidentId)
      useEffect(() => {
        if (sheet.pending.has(read) || !onLoadedChange) return
        onLoadedChange(true)
        return () => onLoadedChange(false)
      }, [read, onLoadedChange])
      return null
    },
  }
})
vi.mock('@/lib/hooks/use-scroll-block-into-view', () => ({
  useScrollBlockIntoView: (_scroller: unknown, _block: unknown, _trigger: unknown, options: { ready?: boolean }) => {
    sheet.scrolls.push(options)
  },
}))

import { MobileIncidentDetailSheet } from '@/components/mobile/mobile-incident-detail-sheet'
import { REKO_TARGET } from '@/lib/detail-target'

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

// Sol review I round 2: the sheet stays open while it switches incidents.
describe('the phone Einsatz sheet scrolls to a Reko-Bericht only once THAT one is drawn', () => {
  it('does not take the last incident\'s loaded Bericht for the next one', () => {
    const withReko = (id: string) => ({ ...OPERATION, id, hasCompletedReko: true }) as Operation
    const sheetFor = (id: string) => (
      <MobileIncidentDetailSheet
        operation={withReko(id)}
        open
        onOpenChange={vi.fn()}
        target={{ ...REKO_TARGET }}
        materials={[] as Material[]}
        formatLocation={(a) => a}
      />
    )
    sheet.pending.add('incident-b')
    const { rerender } = renderWithIntl(sheetFor('incident-a'))
    expect(sheet.scrolls.at(-1)?.ready).toBe(true)

    rerender(sheetFor('incident-b'))
    expect(sheet.scrolls.at(-1)?.ready).toBe(false)
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

// A controlled sheet has no Radix trigger: VoiceOver lost its place on close (review, 24.11.2026).
describe('closing the sheet', () => {
  it('gives the focus back to the detail button that opened it', async () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button" data-detail-opener>Details anzeigen: 7 · Hauptstrasse 1</button>
          <MobileIncidentDetailSheet operation={OPERATION} open={open} onOpenChange={vi.fn()} materials={[]} formatLocation={(a) => a} />
        </>
      )
    }
    const { rerender } = renderWithIntl(<Harness open={false} />)
    const opener = screen.getByRole('button', { name: /Details anzeigen/ })
    opener.focus()
    rerender(<Harness open />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    rerender(<Harness open={false} />)
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
