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
const routerPush = vi.hoisted(() => vi.fn())
const getFeldPersonnel = vi.hoisted(() => vi.fn())
const getFeldAssignments = vi.hoisted(() => vi.fn())
const unlockFeld = vi.hoisted(() => vi.fn())
const claimFeldPerson = vi.hoisted(() => vi.fn())
const mintFeldRekoLink = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  // A Reko row navigates straight to the form instead of opening a detail page.
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { getFeldPersonnel, getFeldAssignments, unlockFeld, claimFeldPerson, mintFeldRekoLink },
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
    // The union's default: this row is here because it is the person's own
    // assignment, which is also the only source that owes a Rapport.
    source: 'crew',
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

/**
 * A phone that has already been through the door (plan 26): it holds a bound
 * token and the person it belongs to, so the page skips the code and the
 * picker entirely — which is what a returning device does in the field.
 *
 * Tests about the door itself seed nothing and get the code screen.
 */
const seedDevice = () => {
  // No `path=/feld` here, unlike the real page: jsdom serves these tests from
  // "/", and a path-scoped cookie would be written and then never read back.
  document.cookie = 'feld-device-token=bound-token'
  document.cookie = 'feld-selected-person=p-1'
}

const forgetDevice = () => {
  document.cookie = 'feld-device-token=;expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = 'feld-selected-person=;expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT'
}

describe('/feld preselect from the Einsatzzettel QR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
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
      assignments: [assignment(), assignment({ incident_id: 'inc-2', incident_title: 'Baum Strasse', location_address: 'Baumgasse 7' })],
      message_chips: [],
    })
  })

  it('a slip on a fresh phone opens the code, not a Schadenplatz', async () => {
    // This used to assert the slip landed on the person picker. Since plan 26
    // it does not get that far: a link — printed, forwarded or three weeks old
    // — buys the right to be asked for the Feld-Code and nothing else. The
    // slip still names no person either, which is the original point, now made
    // one step earlier.
    forgetDevice()
    setParams({ token: 'feld-token', incident_id: 'inc-2' })
    renderWithIntl(<FeldPage />)

    expect(await screen.findByRole('heading', { name: 'Code eingeben' })).toBeInTheDocument()
    expect(screen.queryByText('Muster Hans')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })

  it('the code binds the device, and the slip then opens its Schadenplatz', async () => {
    // The whole door in one test: code → pick → bound token stored → and only
    // then does the slip's incident_id do its job.
    forgetDevice()
    unlockFeld.mockResolvedValue({
      token: 'unlocked-token',
      personnel: [PERSON],
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
    })
    claimFeldPerson.mockResolvedValue({ token: 'bound-token', personnel_id: 'p-1' })
    setParams({ token: 'feld-token', incident_id: 'inc-2' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.type(await screen.findByRole('textbox'), '4713')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    // The picker only appears after the code — it is what the code buys.
    await user.click(await screen.findByText('Muster Hans'))

    expect(claimFeldPerson).toHaveBeenCalledWith('unlocked-token', 'p-1')
    // Everything from here on uses the BOUND token, never the link again.
    // The bound token is what every later call carries — which is the property
    // that matters. (The cookie it is also written to is `path=/feld`, and jsdom
    // serves these tests from "/", so asserting on it would only be testing
    // jsdom's path handling.)
    await waitFor(() => expect(getFeldAssignments).toHaveBeenCalledWith('p-1', 'bound-token'))
  })

  it('opens the named Schadenplatz once the person is picked', async () => {
    setParams({ token: 'feld-token', incident_id: 'inc-2' })
    renderWithIntl(<FeldPage />)

    // Straight into the detail of the incident the slip names — skipping the
    // "meine Einsatzstellen" list it would otherwise land on.
    await waitFor(() => expect(screen.getByTestId('feld-rapport-form')).toBeInTheDocument())
    // The detail's h1 is the ADDRESS now; the incident title rides in the bar.
    expect(screen.getByRole('heading', { name: /Baumgasse 7/ })).toBeInTheDocument()
  })

  it('lands on the list when the slip names an incident that is not mine', async () => {
    // Visibility is "only mine" and it is enforced server-side; the parameter
    // cannot widen it, and pretending otherwise would be a blank screen.
    setParams({ token: 'feld-token', incident_id: 'inc-fremd' })
    renderWithIntl(<FeldPage />)

    await waitFor(() => expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument())
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })

  it('shows the list when there is no incident_id at all', async () => {
    setParams({ token: 'feld-token' })
    renderWithIntl(<FeldPage />)

    await waitFor(() => expect(screen.getByText('Baumgasse 7')).toBeInTheDocument())
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
    forgetDevice()
    seedDevice()
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
    renderWithIntl(<FeldPage />)
    // Wait for something only the DETAIL renders. The list row carries the same
    // title as a heading, so waiting on that returned while the page was still
    // the list and the preselect had not yet opened anything.
    await waitFor(() => expect(screen.getByTestId('feld-actions')).toBeInTheDocument())
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
    forgetDevice()
    seedDevice()
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
      assignments: [assignment(), assignment({ incident_id: 'inc-2', incident_title: 'Baum Strasse', location_address: 'Baumgasse 7' })],
      message_chips: [],
    })
    setParams({ token: 'feld-token' })
  })

  it('comes back to the Schadenplatz that was open, without a slip in the URL', async () => {
    const user = userEvent.setup()
    const first = renderWithIntl(<FeldPage />)
    await user.click(await screen.findByText('Baumgasse 7'))
    await waitFor(() => // The detail's h1 is the ADDRESS now; the incident title rides in the bar.
    expect(screen.getByRole('heading', { name: /Baumgasse 7/ })).toBeInTheDocument())
    first.unmount()

    // Same device, fresh page: person AND place come back.
    renderWithIntl(<FeldPage />)
    await waitFor(() => // The detail's h1 is the ADDRESS now; the incident title rides in the bar.
    expect(screen.getByRole('heading', { name: /Baumgasse 7/ })).toBeInTheDocument())
  })

  it('forgets it when the crew leaves via «Zurück»', async () => {
    const user = userEvent.setup()
    const first = renderWithIntl(<FeldPage />)
    await user.click(await screen.findByText('Baumgasse 7'))
    await waitFor(() => // The detail's h1 is the ADDRESS now; the incident title rides in the bar.
    expect(screen.getByRole('heading', { name: /Baumgasse 7/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Zurück' }))
    first.unmount()

    renderWithIntl(<FeldPage />)
    // Their own list, both rows, no detail — "Baum Strasse" is a row heading
    // here, so the detail-only «Zurück» is what tells the two views apart.
    await waitFor(() => expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument())
    expect(screen.getByText('Baumgasse 7')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
  })

  it('drops a remembered Schadenplatz that is no longer assigned to this person', async () => {
    document.cookie = 'feld-selected-incident=inc-weg;path=/feld'
    document.cookie = 'feld-selected-person=p-1;path=/feld'

    renderWithIntl(<FeldPage />)

    await waitFor(() => expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument())
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
    forgetDevice()
    seedDevice()
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
    renderWithIntl(<FeldPage />)

    expect(await screen.findByText('Hauptstrasse 1')).toBeInTheDocument()
    expect(screen.queryByText('Hauptstrasse 1, 4104 Oberwil')).not.toBeInTheDocument()
  })

  it('falls back to client formatting when the payload has no label', async () => {
    withAssignment({ location_address: 'Hauptstrasse 1, 4104 Oberwil', location_display: undefined })
    renderWithIntl(<FeldPage />)

    // No home city known here, so the formatter passes the address through —
    // the row is never blank.
    expect(await screen.findByText('Hauptstrasse 1, 4104 Oberwil')).toBeInTheDocument()
  })
})

/**
 * A Reko auftrag is not a Schadenplatz you work — it is one form, and the KP
 * sent you out to fill it. So the row skips the detail page entirely and lands
 * in the form, exactly as the old per-incident Reko link did. A page of
 * Aktionen and a Rapport section would be a page of things that are not theirs,
 * and the server would refuse half of them anyway.
 */
describe('/feld opens a Reko auftrag straight into the form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
    mintFeldRekoLink.mockResolvedValue({
      incident_id: 'inc-1',
      token: 'form-token',
      link: '/reko?incident_id=inc-1&token=form-token&personnel_id=p-1',
    })
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment({ source: 'reko' })],
      message_chips: [],
    })
  })

  it('goes to the Reko form and never shows the detail sections', async () => {
    setParams({ token: 'feld-token' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Hauptstrasse 1'))

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith('/reko?incident_id=inc-1&token=form-token&personnel_id=p-1'),
    )
    // No Aktionen, no Rapport — the two things a Reko trupp has no business with.
    expect(screen.queryByTestId('feld-actions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })

  it('mints the form token on the tap, not on render', async () => {
    // It is short-lived and one is enough per filing: minting while the row is
    // merely *shown* would spend one every ten seconds on the poll.
    setParams({ token: 'feld-token' })
    renderWithIntl(<FeldPage />)

    await screen.findByText('Hauptstrasse 1')
    expect(mintFeldRekoLink).not.toHaveBeenCalled()
  })
})
