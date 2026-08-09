/**
 * `/feld?token=…&incident_id=…` — the Einsatzzettel's second QR (plan 25, decision 19).
 *
 * The slip can preselect the *Schadenplatz* and nothing else: it is printed
 * before it is known who drives. So the person picker still decides who you are,
 * and the only thing the parameter saves is the "meine Einsatzstellen" tap
 * afterwards. Both halves of that are asserted here, plus the case that matters
 * for decision 4 — a slip for somebody else's incident lands on your own list
 * rather than opening it.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiFeldAssignment, ApiFeldPersonnel } from '@/lib/api/types'

const searchParams = vi.hoisted(() => new URLSearchParams())
const getFeldPersonnel = vi.hoisted(() => vi.fn())
const getFeldAssignments = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { getFeldPersonnel, getFeldAssignments },
}))

// The detail view is a stack of sections; this test is about which section the
// page opens, not about what the sections do.
vi.mock('@/components/feld/feld-actions', () => ({
  FeldActions: () => <div data-testid="feld-actions" />,
}))
vi.mock('@/components/feld/feld-rapport-form', () => ({
  FeldRapportForm: () => <div data-testid="feld-rapport-form" />,
}))

import FeldPage from '@/app/feld/page'

const PERSON: ApiFeldPersonnel = {
  personnel_id: 'p-1',
  name: 'Muster Hans',
  role: 'Offizier',
  incident_count: 2,
  open_count: 2,
  missing_rapport_count: 2,
}

function assignment(overrides: Partial<ApiFeldAssignment> = {}): ApiFeldAssignment {
  return {
    incident_id: 'inc-1',
    incident_title: 'Keller Wasser',
    incident_type: 'elementarereignis',
    incident_status: 'active',
    location_address: 'Hauptstrasse 1',
    location_lat: null,
    location_lng: null,
    is_active_assignment: true,
    rapport_state: 'none',
    arrived_at: null,
    field_complete_reported_at: null,
    pickup_needed: false,
    pickup_note: null,
    pickup_requested_at: null,
    leader_personnel_id: null,
    leader_name: null,
    ...overrides,
  }
}

function setParams(params: Record<string, string>) {
  Array.from(searchParams.keys()).forEach(key => searchParams.delete(key))
  Object.entries(params).forEach(([key, value]) => searchParams.set(key, value))
}

describe('/feld preselect from the Einsatzzettel QR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.cookie = 'feld-selected-person=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    getFeldPersonnel.mockResolvedValue({
      personnel: [PERSON],
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
    })
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment(), assignment({ incident_id: 'inc-2', incident_title: 'Baum Strasse' })],
      message_chips: [],
    })
  })

  it('still asks who you are — a slip never names the person', async () => {
    setParams({ token: 'feld-token', incident_id: 'inc-2' })
    renderWithIntl(<FeldPage />)

    // The picker, not a Schadenplatz: the slip was printed before it was known
    // who would drive.
    expect(await screen.findByText('Muster Hans')).toBeInTheDocument()
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })

  it('opens the named Schadenplatz once the person is picked', async () => {
    setParams({ token: 'feld-token', incident_id: 'inc-2' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Muster Hans'))

    // Straight into the detail of the incident the slip names — skipping the
    // "meine Einsatzstellen" list it would otherwise land on.
    await waitFor(() => expect(screen.getByTestId('feld-rapport-form')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Baum Strasse' })).toBeInTheDocument()
  })

  it('lands on the list when the slip names an incident that is not mine', async () => {
    // Visibility is "only mine" and it is enforced server-side; the parameter
    // cannot widen it, and pretending otherwise would be a blank screen.
    setParams({ token: 'feld-token', incident_id: 'inc-fremd' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Muster Hans'))

    await waitFor(() => expect(screen.getByText('Keller Wasser')).toBeInTheDocument())
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })

  it('shows the list when there is no incident_id at all', async () => {
    setParams({ token: 'feld-token' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Muster Hans'))

    await waitFor(() => expect(screen.getByText('Baum Strasse')).toBeInTheDocument())
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })
})
