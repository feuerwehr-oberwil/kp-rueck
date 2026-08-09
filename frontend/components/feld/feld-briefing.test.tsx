import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiFeldAssignment } from '@/lib/api/types'

import { FeldBriefing, FeldBriefingLine } from '@/components/feld/feld-briefing'

function assignment(overrides: Partial<ApiFeldAssignment> = {}): ApiFeldAssignment {
  return {
    incident_id: 'inc-1',
    incident_title: 'Keller Wasser',
    incident_type: 'elementarereignis',
    incident_status: 'active',
    description: null,
    contact: null,
    contact_phone: null,
    crew: [],
    vehicles: [],
    materials: [],
    reko: null,
    location_address: 'Hauptstrasse 1',
    location_lat: null,
    location_lng: null,
    is_active_assignment: true,
    rapport_state: 'none',
    arrived_at: null,
    arrived_by_automation: false,
    field_complete_reported_at: null,
    pickup_needed: false,
    pickup_note: null,
    pickup_requested_at: null,
    leader_personnel_id: null,
    leader_name: null,
    ...overrides,
  }
}

describe('the field briefing (§18.22)', () => {
  it('tells the crew what was dispatched with it and what the Reko found', () => {
    renderWithIntl(
      <FeldBriefing
        assignment={assignment({
          description: 'Wasser im Keller, Steigleitung defekt',
          contact: 'A. Bürgin',
          contact_phone: '079 000 00 00',
          crew: ['Muster Hans', 'Frey Marc'],
          vehicles: ['TLF 1', 'MTW'],
          materials: [
            { name: 'Tauchpumpe', count: 2 },
            { name: 'Nassauger', count: 1 },
          ],
          reko: {
            summary: 'Keller 20 cm unter Wasser.',
            notes: 'Zugang über Hinterhof.',
            dangers: ['electrical'],
            submitted_at: '2026-08-09T19:14:00Z',
            submitted_by_name: 'Frey Marc',
          },
        })}
      />,
    )

    expect(screen.getByText('Wasser im Keller, Steigleitung defekt')).toBeInTheDocument()
    expect(screen.getByText('Muster Hans, Frey Marc')).toBeInTheDocument()
    expect(screen.getByText('TLF 1, MTW')).toBeInTheDocument()
    // Grouped by name: two of one pump is a count, not two lines.
    expect(screen.getByText('Tauchpumpe ×2, Nassauger')).toBeInTheDocument()
    expect(screen.getByText('Keller 20 cm unter Wasser.')).toBeInTheDocument()
    expect(screen.getByText('Zugang über Hinterhof.')).toBeInTheDocument()
    // The board's own hazard wording, not a second one.
    expect(screen.getByText('Elektrisch')).toBeInTheDocument()
  })

  it('makes the Melder callable — that is the whole reason it is carried here', () => {
    renderWithIntl(
      <FeldBriefing assignment={assignment({ contact: 'A. Bürgin', contact_phone: '079 000 00 00' })} />,
    )
    const link = screen.getByRole('link', { name: 'A. Bürgin · 079 000 00 00' })
    expect(link.getAttribute('href')).toBe('tel:0790000000')
  })

  it('renders nothing at all when the board knows nothing', () => {
    const { container } = renderWithIntl(<FeldBriefing assignment={assignment()} />)
    expect(container.querySelector('section')).toBeNull()
  })

  it('never turns other_notes into a danger badge', () => {
    renderWithIntl(
      <FeldBriefing
        assignment={assignment({
          reko: {
            summary: null,
            notes: null,
            // An unknown key must be dropped, not rendered as a raw string.
            dangers: ['other_notes', 'collapse'],
            submitted_at: null,
            submitted_by_name: null,
          },
        })}
      />,
    )
    expect(screen.getByText('Einsturz')).toBeInTheDocument()
    expect(screen.queryByText('other_notes')).not.toBeInTheDocument()
  })
})

describe('the condensed row', () => {
  it('carries the Meldung, the vehicles and the Gefahren — and nothing else', () => {
    renderWithIntl(
      <FeldBriefingLine
        assignment={assignment({
          description: 'Wasser im Keller',
          crew: ['Muster Hans'],
          vehicles: ['TLF 1'],
          materials: [{ name: 'Tauchpumpe', count: 1 }],
          reko: {
            summary: 'Keller 20 cm unter Wasser.',
            notes: null,
            dangers: ['collapse'],
            submitted_at: null,
            submitted_by_name: null,
          },
        })}
      />,
    )

    expect(screen.getByText('Wasser im Keller')).toBeInTheDocument()
    expect(screen.getByText('TLF 1')).toBeInTheDocument()
    // A hazard is never something you have to tap through to.
    expect(screen.getByText('Einsturz')).toBeInTheDocument()
    // The list stays a list: crew, material and the Reko text are one tap away.
    expect(screen.queryByText('Muster Hans')).not.toBeInTheDocument()
    expect(screen.queryByText(/Tauchpumpe/)).not.toBeInTheDocument()
    expect(screen.queryByText(/20 cm/)).not.toBeInTheDocument()
  })

  it('renders nothing when there is nothing to condense', () => {
    const { container } = renderWithIntl(<FeldBriefingLine assignment={assignment({ crew: ['Muster Hans'] })} />)
    expect(container.firstChild).toBeNull()
  })
})
