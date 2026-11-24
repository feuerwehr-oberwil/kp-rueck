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

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiFeldAssignment, ApiFeldPersonnel } from '@/lib/api/types'
import { ApiError } from '@/lib/api/types/common'

const searchParams = vi.hoisted(() => new URLSearchParams())
const routerPush = vi.hoisted(() => vi.fn())
const getFeldAssignments = vi.hoisted(() => vi.fn())
const unlockFeld = vi.hoisted(() => vi.fn())
// A phone that is not logged in to Rück: the session door answers «no», the code screen shows.
const unlockFeldWithSession = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const claimFeldPerson = vi.hoisted(() => vi.fn())
const mintFeldRekoLink = vi.hoisted(() => vi.fn())
const getFeldMaterial = vi.hoisted(() => vi.fn())
const logoutFeld = vi.hoisted(() => vi.fn())
const setFeldAttendancePlan = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  // A Reko row navigates straight to the form instead of opening a detail page.
  useRouter: () => ({ push: routerPush }),
}))

// What `unlockFeld` rejects with; the page tells its failures apart by `failure.kind`.
const FeldUnlockError = vi.hoisted(
  () =>
    class FeldUnlockError extends Error {
      constructor(readonly failure: { kind: string }) {
        super(failure.kind)
      }
    },
)

vi.mock('@/lib/api-client', () => ({
  FeldUnlockError,
  apiClient: {
    getFeldAssignments,
    unlockFeld,
    unlockFeldWithSession,
    claimFeldPerson,
    mintFeldRekoLink,
    getFeldMaterial,
    logoutFeld,
    setFeldAttendancePlan,
    // The door's proof-of-place fetch; null = render without the proof.
    getFeldContext: vi.fn().mockResolvedValue(null),
  },
}))

// The detail view is a stack of sections; this test is about which section the
// page opens, not about what the sections do.
vi.mock('@/components/feld/feld-actions', () => ({
  FeldActions: () => <div data-testid="feld-actions" />,
}))
vi.mock('@/components/feld/feld-rapport-form', () => ({
  FeldRapportForm: () => <div data-testid="feld-rapport-form" />,
}))
// The Melden sheet pulls in FooterSheet → useIsMobile → matchMedia, which jsdom
// does not have. This file is about which view the page opens, not the sheet.
vi.mock('@/components/feld/feld-melden-sheet', () => ({
  FeldMeldenSheet: () => <div data-testid="feld-melden-sheet" />,
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
    number: 1,
    priority: 'medium',
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
    group_id: null,
    group_name: null,
    group_position: null,
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

/** Device forgetting is server-side revocation, not just deleting a browser cookie. */
describe('/feld handing the phone to someone else', () => {
  const boundLink = [
    btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    btoa(JSON.stringify({ type: 'feld', unlocked: true, personnel_id: 'p-1', claim_id: 'c-1' })),
    'signature',
  ].join('.')

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/feld')
    forgetDevice()
    for (const name of ['feld-device-token', 'feld-selected-person', 'feld-selected-incident']) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld`
    }
    document.cookie = 'feld-device-token=bound-token;path=/feld'
    document.cookie = 'feld-selected-person=p-1;path=/feld'
    setParams({ token: 'poster-token' })
    logoutFeld.mockResolvedValue(undefined)
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1', personnel_name: 'Muster Hans', personnel_role: 'Offizier',
      event_id: 'e-1', event_name: 'Sturm', assignments: [assignment()], message_chips: [],
    })
  })

  afterEach(() => {
    forgetDevice()
    for (const name of ['feld-device-token', 'feld-selected-person', 'feld-selected-incident']) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld`
    }
    window.history.replaceState(null, '', '/')
  })

  async function confirmLogout() {
    const user = userEvent.setup()
    // «Nicht ich» sits behind the name in the header (owner pick 1A).
    await user.click(await screen.findByRole('button', { name: /Muster Hans/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Nicht ich' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abmelden' }))
  }

  it('waits for server revocation before clearing the phone and returning to the poster code', async () => {
    let finish!: () => void
    logoutFeld.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    renderWithIntl(<FeldPage />)
    await confirmLogout()
    expect(logoutFeld).toHaveBeenCalledWith('bound-token')
    expect(document.cookie).toContain('feld-device-token=bound-token')
    expect(screen.queryByRole('heading', { name: 'Code eingeben' })).not.toBeInTheDocument()
    await act(async () => finish())
    expect(await screen.findByRole('heading', { name: 'Code eingeben' })).toBeInTheDocument()
    expect(document.cookie).not.toContain('feld-device-token=')
    expect(claimFeldPerson).not.toHaveBeenCalled()
  })

  it('keeps the device and its assignments when the server cannot confirm revocation', async () => {
    logoutFeld.mockRejectedValue(new Error('offline'))
    renderWithIntl(<FeldPage />)
    await confirmLogout()
    expect(toastError).toHaveBeenCalledWith('Hat nicht geklappt. Erneut versuchen.')
    expect(document.cookie).toContain('feld-device-token=bound-token')
    expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Code eingeben' })).not.toBeInTheDocument()
  })

  it('requires a fresh link after revoking a bound QR credential', async () => {
    setParams({ token: boundLink })
    renderWithIntl(<FeldPage />)
    await confirmLogout()
    expect(logoutFeld).toHaveBeenCalledWith(boundLink)
    expect(await screen.findByRole('heading', { name: 'Link abgelaufen' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(unlockFeld).not.toHaveBeenCalled()
    expect(claimFeldPerson).not.toHaveBeenCalled()
  })

  it('does not present a code or picker for a one-use picker URL credential', async () => {
    const picker = ['header', btoa(JSON.stringify({ type: 'feld', unlocked: true })), 'signature'].join('.')
    setParams({ token: picker })
    renderWithIntl(<FeldPage />)
    expect(await screen.findByRole('heading', { name: 'Link abgelaufen' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(unlockFeld).not.toHaveBeenCalled()
    expect(claimFeldPerson).not.toHaveBeenCalled()
  })

  it('requires a new code exchange when the server refuses a consumed picker', async () => {
    document.cookie = 'feld-device-token=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    document.cookie = 'feld-selected-person=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    unlockFeld.mockResolvedValue({ token: 'picker-token', personnel: [PERSON], event_name: 'Sturm' })
    claimFeldPerson.mockRejectedValue(new ApiError('Ungültiger Zugriffscode', 401))
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)
    await user.type(await screen.findByRole('textbox'), '4713')
    await user.click(await screen.findByText('Muster Hans'))
    expect(await screen.findByRole('heading', { name: 'Code eingeben' })).toBeInTheDocument()
    expect(screen.queryByText('Muster Hans')).not.toBeInTheDocument()
    expect(claimFeldPerson).toHaveBeenCalledTimes(1)
  })

  it('returns a revoked bound link to the rescan prompt using the real API status', async () => {
    setParams({ token: boundLink })
    getFeldAssignments.mockRejectedValue(new ApiError('Ungültiger Zugriffscode', 401))
    renderWithIntl(<FeldPage />)
    expect(await screen.findByRole('heading', { name: 'Link abgelaufen' })).toBeInTheDocument()
    expect(document.cookie).not.toContain('feld-device-token=')
  })
})

describe('/feld preselect from the Einsatzzettel QR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
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

  it('an address that is not the poster link asks for the QR code again, not for the digits', async () => {
    // The backend answers `feld_reopen_qr`; this used to read «Falscher Code».
    forgetDevice()
    setParams({ token: 'feld-token' })
    unlockFeld.mockRejectedValue(new FeldUnlockError({ kind: 'reopen' }))
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.type(await screen.findByRole('textbox'), '4713')

    expect(await screen.findByRole('heading', { name: 'QR-Code neu öffnen' })).toBeInTheDocument()
    expect(screen.getByText('Bitte den QR-Code auf dem Plakat erneut scannen.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
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

    // The fourth digit submits by itself — there is no button on the door.
    await user.type(await screen.findByRole('textbox'), '4713')

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

  // Owner, iPhone, 24.11.2026: the number pad and Safari's form bar covered the hint, and the
  // centred boxes sat low with the top half empty. The hint reads before the boxes, and on a
  // phone the screen starts at the top.
  it('puts the code hint above the boxes and the code screen in the upper part', async () => {
    forgetDevice()
    setParams({ token: 'feld-token' })
    renderWithIntl(<FeldPage />)
    const field = await screen.findByRole('textbox')
    const hint = screen.getByText('Der Code steht auf dem Zettel unter dem QR-Code.')
    expect(hint.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('feld-code-screen')).toHaveClass('justify-start')
    expect(screen.getByTestId('feld-code-screen')).not.toHaveClass('justify-center')
  })

  // Owner, 24.11.2026: in a long roster the search was a scroll away. The intro and the search
  // stick under the bar; only the names scroll.
  it('keeps the picker intro and the name search in one block that sticks under the bar', async () => {
    forgetDevice()
    unlockFeld.mockResolvedValue({ token: 'unlocked-token', personnel: [PERSON], event_id: 'e-1', event_name: 'Sturm' })
    setParams({ token: 'feld-token' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)
    await user.type(await screen.findByRole('textbox'), '4713')

    const head = await screen.findByTestId('feld-picker-head')
    expect(head).toHaveClass('sticky')
    expect(head).toHaveTextContent('Wähle dich aus der Liste')
    expect(within(head).getByPlaceholderText('Name suchen …')).toBeInTheDocument()
    expect(head).not.toHaveTextContent('Muster Hans')
  })

  it('opens the named Schadenplatz once the person is picked', async () => {
    setParams({ token: 'feld-token', incident_id: 'inc-2' })
    renderWithIntl(<FeldPage />)

    // Straight into the detail of the incident the slip names — skipping the
    // "meine Einsatzstellen" list it would otherwise land on.
    await waitFor(() => expect(screen.getByTestId('feld-rapport-form')).toBeInTheDocument())
    // The detail's h1 is the ADDRESS now; the incident title rides in the bar.
    expect(screen.getByRole('heading', { name: /Baumgasse\s7/ })).toBeInTheDocument()
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
  })

  const openDetail = async (overrides: Partial<ApiFeldAssignment>) => {
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      // Midday, so the header's day is Saturday 14.11. in any test machine's zone.
      event_started_at: '2026-11-14T12:00:00Z',
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

  it('says the Einsatzart and the title under the address, and no «KP: …» status', async () => {
    await openDetail({ incident_status: 'enroute', has_been_dispatched: true })

    // The headline has the full width: the rapport chip sits on the Einsatzart line,
    // and the house number cannot wrap away from its street.
    const headline = screen.getByRole('heading', { level: 1 })
    expect(headline.textContent).toContain('Hauptstrasse\u00A01')
    expect(headline).not.toHaveTextContent('kein Rapport')
    expect(screen.getByText('Elementarereignis · Keller Wasser')).toBeInTheDocument()
    // The board's status word is gone (P12); the header is meta only.
    expect(screen.queryByText(/^KP: /)).not.toBeInTheDocument()
    expect(screen.getByText('Sturm Oberwil · Sa 14.11.')).toBeInTheDocument()
  })

  it('shows the KP\'s messages to the squad (§P3.2)', async () => {
    await openDetail({
      incident_status: 'active',
      has_been_dispatched: true,
      kp_messages: [
        {
          id: 'm-1',
          incident_id: 'inc-1',
          message: 'Rückzug über die Hauptstrasse',
          author_name: 'B. Eichenberger',
          created_at: '2026-08-19T18:30:00Z',
        },
      ],
    })

    expect(screen.getByText('Meldungen vom KP')).toBeInTheDocument()
    expect(screen.getByText('Rückzug über die Hauptstrasse')).toBeInTheDocument()
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
    expect(screen.getByRole('heading', { name: /Baumgasse\s7/ })).toBeInTheDocument())
    first.unmount()

    // Same device, fresh page: person AND place come back.
    renderWithIntl(<FeldPage />)
    await waitFor(() => // The detail's h1 is the ADDRESS now; the incident title rides in the bar.
    expect(screen.getByRole('heading', { name: /Baumgasse\s7/ })).toBeInTheDocument())
  })

  it('forgets it when the crew leaves via «Zurück»', async () => {
    const user = userEvent.setup()
    const first = renderWithIntl(<FeldPage />)
    await user.click(await screen.findByText('Baumgasse 7'))
    await waitFor(() => // The detail's h1 is the ADDRESS now; the incident title rides in the bar.
    expect(screen.getByRole('heading', { name: /Baumgasse\s7/ })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Zurück' }))
    first.unmount()

    renderWithIntl(<FeldPage />)
    // Their own list, both rows, no detail — "Baum Strasse" is a row heading
    // here, so the detail-only «Zurück» is what tells the two views apart.
    await waitFor(() => expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument())
    expect(screen.getByText('Baumgasse 7')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
  })

  // Phone sweep 24.11.2026: the edge swipe on a Schadenplatz left /feld instead of going back.
  it('the back gesture on a Schadenplatz returns to the list, and forgets it like «Zurück»', async () => {
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)
    await user.click(await screen.findByText('Baumgasse 7'))
    await waitFor(() => expect(screen.getByRole('heading', { name: /Baumgasse\s7/ })).toBeInTheDocument())

    window.history.back()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument())
    expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument()
    expect(screen.getByText('Baumgasse 7')).toBeInTheDocument()
    expect(document.cookie).not.toContain('feld-selected-incident=inc-2')
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

  it('puts the priority mark and the Einsatz number before the address (D3)', async () => {
    withAssignment({ location_display: 'Hauptstrasse 1', number: 14, priority: 'high' })
    renderWithIntl(<FeldPage />)

    const heading = (await screen.findByText('Hauptstrasse 1')).closest('h3')
    expect(heading).not.toBeNull()
    expect(heading?.textContent).toBe('14Hauptstrasse\u00A01')
    expect(within(heading as HTMLElement).getByRole('img', { name: 'Hohe Priorität' })).toBeInTheDocument()
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
      // Status `reko`: a LIVE auftrag. From «Disponiert» on the window closes
      // and the row opens as a plain detail instead — see the suite below.
      assignments: [assignment({ source: 'reko', incident_status: 'reko' })],
      message_chips: [],
    })
  })

  it('goes to the Reko form and never shows the detail sections', async () => {
    setParams({ token: 'feld-token' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Hauptstrasse 1'))

    // With the way home: once sent, the form comes back to this list (owner, 19.11.2026).
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        `/reko?incident_id=inc-1&token=form-token&personnel_id=p-1&return_to=${encodeURIComponent('/feld?token=feld-token')}`,
      ),
    )
    // No Aktionen, no Rapport — the two things a Reko trupp has no business with.
    expect(screen.queryByTestId('feld-actions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })

  it('says at the row when the form could not be opened, and tries again', async () => {
    setParams({ token: 'feld-token' })
    mintFeldRekoLink.mockRejectedValueOnce(new TypeError('Load failed'))
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Hauptstrasse 1'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reko-Formular konnte nicht geöffnet werden.')
    expect(routerPush).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledTimes(1))
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

/**
 * A cellar or a dead spot (phone sweep 24.11.2026). An offline GET resolves to nothing
 * (`lib/api/http.ts`), which is what these mocks answer. The rows stay and the page says how old
 * they are; with nothing loaded yet it says it could not load, never «kein Auftrag».
 */
describe('/feld without a connection', () => {
  const answer = {
    personnel_id: 'p-1',
    personnel_name: 'Muster Hans',
    personnel_role: 'Offizier',
    event_id: 'e-1',
    event_name: 'Sturm Oberwil',
    assignments: [assignment()],
    message_chips: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
    setParams({ token: 'feld-token' })
  })

  it('keeps the rows after a failed refresh and says since when', async () => {
    getFeldAssignments.mockResolvedValueOnce(answer).mockResolvedValue(undefined)
    renderWithIntl(<FeldPage />)
    await screen.findByText('Hauptstrasse 1')
    expect(screen.queryByText(/Keine Verbindung/)).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText(/^Keine Verbindung – Stand \d\d:\d\d$/)).toBeInTheDocument()
    expect(screen.getByText('Hauptstrasse 1')).toBeInTheDocument()
  })

  it('an older load failing after a newer one landed does not bring the band back', async () => {
    let failOld: (err: Error) => void = () => {}
    getFeldAssignments
      .mockResolvedValueOnce(answer)
      .mockReturnValueOnce(new Promise((_, reject) => { failOld = reject }))
      .mockResolvedValueOnce(answer)
    renderWithIntl(<FeldPage />)
    await screen.findByText('Hauptstrasse 1')

    act(() => {
      window.dispatchEvent(new Event('focus')) // the old one, still out
      window.dispatchEvent(new Event('focus')) // the new one, lands
    })
    await waitFor(() => expect(getFeldAssignments).toHaveBeenCalledTimes(3))
    await act(async () => failOld(new ApiError('Service Unavailable', 503)))
    expect(screen.queryByText(/Keine Verbindung/)).not.toBeInTheDocument()
  })

  it('no poll starts while a load is still out – on a slow link each would supersede the last', async () => {
    getFeldAssignments.mockResolvedValueOnce(answer).mockReturnValueOnce(new Promise(() => {}))
    vi.useFakeTimers({ toFake: ['setInterval'] })
    try {
      renderWithIntl(<FeldPage />)
      await screen.findByText('Hauptstrasse 1')
      act(() => {
        window.dispatchEvent(new Event('focus')) // out, never answers
      })
      expect(getFeldAssignments).toHaveBeenCalledTimes(2)
      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(getFeldAssignments).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a first load that failed is not an empty list, and «Erneut versuchen» loads it', async () => {
    getFeldAssignments.mockResolvedValueOnce(undefined).mockResolvedValue(answer)
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Deine Schadenplätze konnten nicht geladen werden.')
    expect(screen.queryByText(/Noch kein Auftrag|sobald du zugewiesen/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(await screen.findByText('Hauptstrasse 1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

/**
 * «Melden» belongs to the person, so it is on every page they can be on.
 *
 * It used to hang on the list alone, which put it exactly where the crew is
 * not: somebody standing at a Schadenplatz — four taps deep, Rapport open — is
 * the person who spots the next tree, and having to navigate back first is how
 * a Meldung becomes a radio call. The suppression for the people AT the station
 * stays: they type theirs on the board.
 */
describe('/feld offers «Melden» from the detail view as well', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
    document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
  })

  const withFunctions = (functions: string[]) => {
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment({ incident_id: 'inc-1' })],
      message_chips: [],
      functions,
    })
    setParams({ token: 'feld-token', incident_id: 'inc-1' })
  }

  it('shows the button and its sheet on the open Schadenplatz', async () => {
    withFunctions([])
    renderWithIntl(<FeldPage />)

    // `feld-actions` is detail-only — the list never renders it.
    await waitFor(() => expect(screen.getByTestId('feld-actions')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Neuer Schadenplatz' })).toBeInTheDocument()
    // One sheet, not one per view: the node is built once and mounted by
    // whichever view is on screen.
    expect(screen.getAllByTestId('feld-melden-sheet')).toHaveLength(1)
  })

  it('stays away from the people who are AT the station', async () => {
    // The Magazin and the KP report on the board; the button would be an
    // invitation to do their job twice. (`kommandoposten` rather than
    // `magazin`, which would also pull in the material endpoint.)
    withFunctions(['kommandoposten'])
    renderWithIntl(<FeldPage />)

    await waitFor(() => expect(screen.getByTestId('feld-actions')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Neuer Schadenplatz' })).not.toBeInTheDocument()
  })
})

/**
 * The board's direct Reko link carries a *bound* token (§P2.1): the person it
 * was sent to lands here already authenticated — no code, no picker — and the
 * incident deep link then routes a Reko auftrag straight into the form.
 */
describe('/feld with a person-bound link token', () => {
  // Shape only, never verified client-side: the server checks the signature on
  // every request. header.payload.signature with a base64url payload.
  const boundToken = [
    btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    btoa(JSON.stringify({ type: 'feld', unlocked: true, personnel_id: 'p-1', claim_id: 'c-1', event_id: 'e-1' })),
    'signature',
  ].join('.')

  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    // An earlier suite moves the document to /feld, which makes the
    // path-scoped incident cookie readable here — clear that variant too.
    document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment()],
      message_chips: [],
    })
  })

  it('skips the code and the picker on a fresh phone', async () => {
    setParams({ token: boundToken })
    renderWithIntl(<FeldPage />)

    await waitFor(() => expect(getFeldAssignments).toHaveBeenCalledWith('p-1', boundToken))
    expect(await screen.findByText('Hauptstrasse 1')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Code eingeben' })).not.toBeInTheDocument()
    expect(unlockFeld).not.toHaveBeenCalled()
    expect(claimFeldPerson).not.toHaveBeenCalled()
  })

  it('outranks whatever the device remembered — the link names its own person', async () => {
    seedDevice()
    setParams({ token: boundToken })
    renderWithIntl(<FeldPage />)

    // The bound token from the URL, not the stored `bound-token` cookie.
    await waitFor(() => expect(getFeldAssignments).toHaveBeenCalledWith('p-1', boundToken))
  })
})

/**
 * §P2.6 — the Reko person's window closes when the KP disponierts without
 * waiting for the Meldung: the row moves under «Früher», the form stops being
 * offered, and the tap opens a plain detail instead of minting a form token.
 */
describe('/feld when the Reko window has closed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
    // An earlier suite moves the document to /feld, which makes the
    // path-scoped incident cookie readable here — clear that variant too.
    document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment({ source: 'reko', incident_status: 'enroute', reko: null })],
      message_chips: [],
    })
  })

  it('lists the auftrag under «Früher» and stops offering «Reko erfassen»', async () => {
    setParams({ token: 'feld-token' })
    renderWithIntl(<FeldPage />)

    expect(await screen.findByText('Früher')).toBeInTheDocument()
    expect(screen.queryByText('Reko erfassen')).not.toBeInTheDocument()
    expect(screen.getByText('Ohne Reko disponiert – keine Meldung mehr nötig')).toBeInTheDocument()
  })

  it('opens the detail on tap instead of minting a form link', async () => {
    setParams({ token: 'feld-token' })
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByText('Hauptstrasse 1'))

    expect(mintFeldRekoLink).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
    // The read-only detail: actions (Meldung) mount, the rapport never does —
    // a Reko row owes none.
    await waitFor(() => expect(screen.getByTestId('feld-actions')).toBeInTheDocument())
    expect(screen.queryByTestId('feld-rapport-form')).not.toBeInTheDocument()
  })
})

/**
 * Hin — dran — zurück: the row says where the crew is in its own evening.
 *
 * The board's own status stays off the rows (a crew reads «Disponiert» as a
 * claim about themselves), but carrying nothing at all made a Schadenplatz
 * somebody had finished look exactly like the one they were driving to.
 */
describe('/feld says where the crew is on each row', () => {
  const withRow = (overrides: Partial<ApiFeldAssignment>) => {
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [assignment(overrides)],
      message_chips: [],
    })
    setParams({ token: 'feld-token' })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
    document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
  })

  it('reads «Anfahrt» before they get there', async () => {
    withRow({})
    renderWithIntl(<FeldPage />)

    expect(await screen.findByText('Anfahrt')).toBeInTheDocument()
  })

  it('reads «Vor Ort» once they reported arriving', async () => {
    withRow({ arrived_at: '2026-08-20T09:00:00Z' })
    renderWithIntl(<FeldPage />)

    expect(await screen.findByText('Vor Ort')).toBeInTheDocument()
  })

  it('reads «Rückfahrt» on the job they have finished', async () => {
    // The reported case: the KP moved the card to «Rückfahrt» and the
    // row went on sitting at the top of the list saying nothing.
    withRow({ incident_status: 'returning', arrived_at: '2026-08-20T09:00:00Z' })
    renderWithIntl(<FeldPage />)

    expect(await screen.findByText('Rückfahrt')).toBeInTheDocument()
    expect(screen.queryByText('Vor Ort')).not.toBeInTheDocument()
  })

  it('says nothing on a row that is no longer theirs', async () => {
    withRow({ is_active_assignment: false })
    renderWithIntl(<FeldPage />)

    expect(await screen.findByText('Nicht mehr zugewiesen')).toBeInTheDocument()
    expect(screen.queryByText('Anfahrt')).not.toBeInTheDocument()
  })

  it('says «Anfahrt» once on an Auftrag, not on every stop of it', async () => {
    // A squad drives a route in order. Reported from the field: both stops read
    // «Anfahrt», which claims the crew is in two places — the later stop is
    // simply next on the list, and nobody has set off for it.
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [
        assignment({
          incident_id: 'inc-1',
          location_address: 'Hohestrasse 120',
          group_id: 'g-1',
          group_name: 'Graf Sven',
          group_position: 0,
        }),
        assignment({
          incident_id: 'inc-2',
          location_address: 'Stallenmattstrasse 11',
          group_id: 'g-1',
          group_name: 'Graf Sven',
          group_position: 1,
        }),
      ],
      message_chips: [],
    })
    setParams({ token: 'feld-token' })
    renderWithIntl(<FeldPage />)

    expect(await screen.findByText('Stallenmattstrasse 11')).toBeInTheDocument()
    expect(screen.getAllByText('Anfahrt')).toHaveLength(1)
  })

  it('moves «Anfahrt» to the stop the squad is actually at', async () => {
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Offizier',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments: [
        assignment({
          incident_id: 'inc-1',
          location_address: 'Hohestrasse 120',
          group_id: 'g-1',
          group_name: 'Graf Sven',
          group_position: 0,
          arrived_at: '2026-08-20T09:00:00Z',
        }),
        assignment({
          incident_id: 'inc-2',
          location_address: 'Stallenmattstrasse 11',
          group_id: 'g-1',
          group_name: 'Graf Sven',
          group_position: 1,
        }),
      ],
      message_chips: [],
    })
    setParams({ token: 'feld-token' })
    renderWithIntl(<FeldPage />)

    // Standing at stop 1: that row carries «Vor Ort» and the one behind it
    // carries nothing at all.
    expect(await screen.findByText('Vor Ort')).toBeInTheDocument()
    expect(screen.queryByText('Anfahrt')).not.toBeInTheDocument()
  })
})

/**
 * A Materialwart who is ALSO out on a Schadenplatz — a normal militia evening,
 * and the case that made the page look broken: the inventory is thirty-eight
 * rows, it opened the screen, and the two stops of their own Auftrag sat below
 * it where nobody scrolls. Their own work leads now; the table follows, folded.
 */
describe('/feld for a Magazin person who also has own work', () => {
  const withOwnWork = (assignments: ApiFeldAssignment[]) => {
    getFeldMaterial.mockResolvedValue({
      materials: [
        { material_id: 'm-1', name: 'Tauchpumpe', state: 'out', at: 'Hauptstrasse 1', home_location: 'Magazin' },
        { material_id: 'm-2', name: 'Wassersauger', state: 'in', at: null, home_location: 'Magazin' },
      ],
    })
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1',
      personnel_name: 'Muster Hans',
      personnel_role: 'Materialwart',
      event_id: 'e-1',
      event_name: 'Sturm Oberwil',
      assignments,
      message_chips: [],
      functions: ['magazin'],
    })
    setParams({ token: 'feld-token' })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
    document.cookie = 'feld-selected-incident=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld'
  })

  it('lists their own Schadenplätze and folds the material table away', async () => {
    withOwnWork([assignment({ incident_id: 'inc-1', location_address: 'Hauptstrasse 1' })])
    renderWithIntl(<FeldPage />)

    // The regression: the crew row is on the page at all.
    expect(await screen.findByText('Hauptstrasse 1')).toBeInTheDocument()
    // Folded: the header states the count, the rows themselves stay away.
    expect(await screen.findByText('1 von 2 draussen')).toBeInTheDocument()
    expect(screen.queryByText('Tauchpumpe')).not.toBeInTheDocument()
  })

  it('opens the table on tap', async () => {
    withOwnWork([assignment({ incident_id: 'inc-1' })])
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByRole('button', { name: /Material/ }))

    expect(await screen.findByText('Tauchpumpe')).toBeInTheDocument()
  })

  it('leads with the material table when there is no own work', async () => {
    withOwnWork([])
    renderWithIntl(<FeldPage />)

    // Nothing of their own to do: the inventory IS the page, so it stands open.
    expect(await screen.findByText('Tauchpumpe')).toBeInTheDocument()
  })
})

describe('/feld on a phone that is logged in to Rück', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    for (const name of ['feld-device-token', 'feld-selected-person', 'feld-selected-incident']) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld`
    }
    setParams({ token: 'poster-token' })
  })
  afterEach(() => {
    unlockFeldWithSession.mockResolvedValue(null)
  })

  it('skips the Feld-Code: the session opens the door straight to the picker', async () => {
    unlockFeldWithSession.mockResolvedValue({ token: 'picker-token', personnel: [PERSON], event_name: 'Sturm' })
    renderWithIntl(<FeldPage />)
    expect(await screen.findByText('Muster Hans')).toBeInTheDocument()
    expect(unlockFeldWithSession).toHaveBeenCalledWith('poster-token')
    expect(screen.queryByRole('heading', { name: 'Code eingeben' })).not.toBeInTheDocument()
    expect(unlockFeld).not.toHaveBeenCalled()
  })

  it('asks for the code as before when there is no (valid) session', async () => {
    renderWithIntl(<FeldPage />)
    expect(await screen.findByRole('heading', { name: 'Code eingeben' })).toBeInTheDocument()
    expect(unlockFeldWithSession).toHaveBeenCalledWith('poster-token')
  })
})

/** #3: the person's own plan – «Ich komme um …» before they are in; no «bis» on /feld (20.11.2026). */
describe('/feld · the own plan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDevice()
    seedDevice()
    setParams({ token: 'feld-token' })
  })

  const answer = (overrides: Record<string, unknown>) =>
    getFeldAssignments.mockResolvedValue({
      personnel_id: 'p-1', personnel_name: 'Muster Hans', personnel_role: 'Offizier',
      event_id: 'e-1', event_name: 'Sturm', assignments: [], message_chips: [], ...overrides,
    })

  it('not in yet: «Ich komme um …» under «Einchecken», written through the device’s own door', async () => {
    answer({ checked_in: false })
    setFeldAttendancePlan.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithIntl(<FeldPage />)

    await user.click(await screen.findByRole('button', { name: 'Ich komme um …' }))
    await user.type(await screen.findByLabelText('Ich komme um', { selector: 'input' }), '20:00')
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }))

    await waitFor(() => expect(setFeldAttendancePlan).toHaveBeenCalledTimes(1))
    const [id, token, plan] = setFeldAttendancePlan.mock.calls[0]
    expect([id, token, Object.keys(plan)]).toEqual(['p-1', 'bound-token', ['planned_from']])
    expect(await screen.findByRole('button', { name: /^Komme um 20:00$/ })).toBeInTheDocument()
  })

  it('in: offers no «Ich bin da bis …» – people on /feld stay to the end', async () => {
    answer({ checked_in: true, planned_until: new Date(2026, 10, 19, 22, 0).toISOString() })
    renderWithIntl(<FeldPage />)
    expect(await screen.findByText('Muster Hans')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ich bin da bis|Da bis|Ich komme um/ })).not.toBeInTheDocument()
  })
})
