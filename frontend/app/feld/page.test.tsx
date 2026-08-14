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

/**
 * §18.27 — a crew cannot file a rapport about a Schadenplatz nobody was sent to.
 *
 * The form and the state chip both come off the same answer, so they are
 * asserted together: a chip reading "kein Rapport" over a page with no form
 * would be the worst of both.
 */
describe('/feld before the Schadenplatz was disponiert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.cookie = 'feld-selected-person=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    getFeldPersonnel.mockResolvedValue({
      personnel: [PERSON],
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
    })
  })

  const openDetail = async (overrides: Partial<ApiFeldAssignment>) => {
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment({ incident_id: 'inc-1', ...overrides })],
      message_chips: [],
    })
    setParams({ token: 'feld-token', incident_id: 'inc-1' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)
    await user.click(await screen.findByText('Muster Hans'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Keller Wasser' })).toBeInTheDocument())
  }

  it('says why there is no form, and shows no rapport chip', async () => {
    await openDetail({ incident_status: 'incoming', has_been_dispatched: false })

    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
    expect(
      screen.getByText('Ein Rapport wird erst erfasst, wenn der Schadenplatz disponiert wurde.'),
    ).toBeInTheDocument()
    // "kein Rapport" would read as a to-do the crew cannot do.
    expect(screen.queryByText('kein Rapport')).not.toBeInTheDocument()
  })

  it('offers the form on a disponierter Schadenplatz', async () => {
    await openDetail({ incident_status: 'enroute', has_been_dispatched: true })

    expect(screen.getByTestId('feld-rapport-form')).toBeInTheDocument()
    expect(screen.getAllByText('kein Rapport').length).toBeGreaterThan(0)
  })

  it('never hides a rapport that was already filed', async () => {
    await openDetail({ incident_status: 'incoming', has_been_dispatched: false, rapport_state: 'draft' })

    expect(screen.getByTestId('feld-rapport-form')).toBeInTheDocument()
  })
})

/**
 * The phone remembers the Schadenplatz, not just the person.
 *
 * A crew opens their address and then the phone locks, Safari drops the
 * background tab, or somebody pulls to refresh with a wet glove. Before this,
 * every one of those put them back on "meine Einsatzstellen" — with the person
 * remembered but the place forgotten, which is the half that costs a tap in the
 * rain. Leaving via «Zurück» is the one thing that forgets it.
 */
describe('/feld remembers the open Schadenplatz across a reload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The cookies are path-scoped to /feld, and jsdom applies that rule: at the
    // default document URL ("/") they would be written and never read back.
    window.history.pushState({}, '', '/feld')
    document.cookie = 'feld-selected-person=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
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
    setParams({ token: 'feld-token' })
  })

  it('comes back to the Schadenplatz that was open, without a slip in the URL', async () => {
    const user = userEvent.setup()
    const first = renderWithIntl(<FeldPage />)
    await user.click(await screen.findByText('Muster Hans'))
    await user.click(await screen.findByText('Baum Strasse'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Baum Strasse' })).toBeInTheDocument())
    first.unmount()

    // Same device, fresh page: person AND place come back.
    renderWithIntl(<FeldPage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Baum Strasse' })).toBeInTheDocument())
  })

  it('forgets it when the crew leaves via «Zurück»', async () => {
    const user = userEvent.setup()
    const first = renderWithIntl(<FeldPage />)
    await user.click(await screen.findByText('Muster Hans'))
    await user.click(await screen.findByText('Baum Strasse'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Baum Strasse' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Zurück' }))
    first.unmount()

    renderWithIntl(<FeldPage />)
    // Their own list, both rows, no detail — "Baum Strasse" is a row heading
    // here, so the detail-only «Zurück» is what tells the two views apart.
    await waitFor(() => expect(screen.getByText('Keller Wasser')).toBeInTheDocument())
    expect(screen.getByText('Baum Strasse')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
  })

  it('drops a remembered Schadenplatz that is no longer assigned to this person', async () => {
    document.cookie = 'feld-selected-incident=inc-weg;path=/feld'
    document.cookie = 'feld-selected-person=p-1;path=/feld'

    renderWithIntl(<FeldPage />)

    await waitFor(() => expect(screen.getByText('Keller Wasser')).toBeInTheDocument())
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
    expect(document.cookie).not.toContain('inc-weg')
  })
})

/**
 * The address comes ready-made from the server.
 *
 * `/feld` is login-less, so nothing on this page ever learns the station's home
 * city — the client-side formatter has no city to strip against and would print
 * the full address, permanently on this surface and as a first-paint flash on
 * the logged-in ones. `location_display` is the answer; these assert the page
 * actually prefers it, and still formats when a payload lacks it.
 */
describe('/feld renders the server-computed address label', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.cookie = 'feld-selected-person=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    getFeldPersonnel.mockResolvedValue({
      personnel: [PERSON],
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
    })
    setParams({ token: 'feld-token' })
  })

  const withAssignment = (overrides: Partial<ApiFeldAssignment>) => {
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment(overrides)],
      message_chips: [],
    })
  }

  it('shows the short label on the list, not the raw address', async () => {
    withAssignment({
      location_address: 'Hauptstrasse 1, 4104 Oberwil',
      location_display: 'Hauptstrasse 1',
    })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Muster Hans'))

    expect(await screen.findByText('Hauptstrasse 1')).toBeInTheDocument()
    expect(screen.queryByText('Hauptstrasse 1, 4104 Oberwil')).not.toBeInTheDocument()
  })

  it('falls back to client formatting when the payload has no label', async () => {
    withAssignment({ location_address: 'Hauptstrasse 1, 4104 Oberwil', location_display: undefined })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Muster Hans'))

    // No home city known here, so the formatter passes the address through —
    // the row is never blank.
    expect(await screen.findByText('Hauptstrasse 1, 4104 Oberwil')).toBeInTheDocument()
  })
})
