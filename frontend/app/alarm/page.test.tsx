import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const getIntakeContext = vi.hoisted(() => vi.fn())
const createIntakeAlarm = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=tok'),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: { getIntakeContext, createIntakeAlarm } }))
vi.mock('@/lib/env', () => ({ getApiUrl: () => 'http://test-backend' }))
// The geocoder-backed location field is a product of its own; this form only
// needs "an address went in", so it is reduced to the one input it wraps. The
// two pin buttons stand in for the real component's coordinate paths: picking
// a geocoded suggestion sets a pin, and a CHANGED freetext commit clears it —
// the clearing itself is covered in location-input.test.tsx.
vi.mock('@/components/location/location-input', () => ({
  LocationInput: ({
    address,
    onAddressChange,
    onCoordinatesChange,
  }: {
    address: string | null
    onAddressChange: (v: string) => void
    onCoordinatesChange: (lat: number | null, lng: number | null) => void
  }) => (
    <div>
      <input aria-label="Ort" value={address ?? ''} onChange={e => onAddressChange(e.target.value)} />
      <button type="button" onClick={() => onCoordinatesChange(47.51666, 7.56234)}>Pin setzen</button>
      <button type="button" onClick={() => onCoordinatesChange(null, null)}>Pin löschen</button>
    </div>
  ),
}))

import AlarmPage from '@/app/alarm/page'

/** The receipt's own two calls (status + correction) go over plain `fetch`. */
const fetchMock = vi.fn()

/** Answer every `/api/intake/alarm/{id}` call with this receipt state. */
function serveReceiptState(state: { status: string; editable: boolean; vehicles: string[] }) {
  fetchMock.mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(state) })
  )
}

/** Renders the page and waits out the token check that gates the form. */
async function renderForm() {
  renderWithIntl(<AlarmPage />)
  await screen.findByLabelText(/Meldung/)
}

/** Fill in the minimum and send it, leaving the receipt on screen. The minimum
 *  includes an Einsatzort — the form refuses to review without one. */
async function sendAlarm(user: ReturnType<typeof userEvent.setup>, message: string) {
  const ort = screen.getByLabelText('Ort') as HTMLInputElement
  if (!ort.value) await user.type(ort, 'Hauptstrasse 12')
  await user.type(screen.getByLabelText(/Meldung/), message)
  await user.click(screen.getByRole('button', { name: 'Weiter' }))
  await user.click(screen.getByRole('button', { name: 'Alarm absenden' }))
  await waitFor(() => expect(createIntakeAlarm).toHaveBeenCalled())
}

describe('AlarmPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getIntakeContext.mockResolvedValue({ event: { id: 'e-1', name: 'Sturm Oberwil', training_flag: false } })
    createIntakeAlarm.mockResolvedValue({ id: 'inc-1', receipt_token: 'receipt-token' })
    vi.stubGlobal('fetch', fetchMock)
    serveReceiptState({ status: 'incoming', editable: true, vehicles: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends nothing until the review step has been read', async () => {
    const user = userEvent.setup()
    await renderForm()

    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
    await user.type(screen.getByLabelText(/Meldung/), 'Baum auf der Fahrbahn')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    // The step exists to be read, so it shows what was typed — not just a
    // "sicher?" over a form nobody can see any more.
    expect(screen.getByText('Stimmt das so?')).toBeInTheDocument()
    expect(screen.getByText('Baum auf der Fahrbahn')).toBeInTheDocument()
    expect(createIntakeAlarm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Alarm absenden' }))
    await waitFor(() => expect(createIntakeAlarm).toHaveBeenCalledTimes(1))
    // What follows is a receipt, not a tick: the same rows the review step
    // showed, so "war es 12 oder 21?" is answerable without phoning the KP.
    expect(screen.getByText('Baum auf der Fahrbahn')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Weiteren Alarm erfassen/ })).toBeInTheDocument()
  })

  it('puts the Meldung in the Meldung and the Hinweise in the Notizen', async () => {
    const user = userEvent.setup()
    await renderForm()

    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
    await user.type(screen.getByLabelText(/Meldung/), 'Wasser im Keller')
    // Hinweise live behind the «Details ergänzen» fold now.
    await user.click(screen.getByRole('button', { name: 'Details ergänzen' }))
    await user.type(screen.getByLabelText('Weitere Hinweise'), 'Anwohner wartet vor dem Haus')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await user.click(screen.getByRole('button', { name: 'Alarm absenden' }))

    await waitFor(() => expect(createIntakeAlarm).toHaveBeenCalledTimes(1))
    expect(createIntakeAlarm.mock.calls[0][1]).toMatchObject({
      // What the board shows as «Meldung»…
      description: 'Wasser im Keller',
      // …and as «Notizen». Neither one may end up in the other.
      internal_notes: 'Anwohner wartet vor dem Haus',
      // `title` is the address column in all but name — a card reads
      // `location_address || title`, so the Meldung must not be parked there.
      title: 'Hauptstrasse 12',
      location_address: 'Hauptstrasse 12',
    })
  })

  it('defaults the priority to Niedrig', async () => {
    const user = userEvent.setup()
    await renderForm()

    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
    await user.type(screen.getByLabelText(/Meldung/), 'Ölspur')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(screen.getByText('Niedrig')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Alarm absenden' }))
    await waitFor(() => expect(createIntakeAlarm).toHaveBeenCalledTimes(1))
    expect(createIntakeAlarm.mock.calls[0][1]).toMatchObject({ priority: 'low' })
  })

  it('cannot reach the review step without a Meldung', async () => {
    await renderForm()
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
  })

  it('cannot reach the review step without an Einsatzort – a pin counts', async () => {
    const user = userEvent.setup()
    await renderForm()

    // A Meldung alone is not enough: a Schadenplatz with no location is the
    // one thing this form must not produce.
    await user.type(screen.getByLabelText(/Meldung/), 'Baum auf der Fahrbahn')
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
    // The gate names itself instead of leaving a dead button.
    expect(screen.getByText('Ohne Einsatzort kann der KP niemanden schicken.')).toBeInTheDocument()

    // Not every meadow has a street: a map pin satisfies the gate too.
    await user.click(screen.getByRole('button', { name: 'Pin setzen' }))
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled()
    expect(screen.queryByText('Ohne Einsatzort kann der KP niemanden schicken.')).not.toBeInTheDocument()
  })

  it('offers the number pad for the phone number', async () => {
    await renderForm()
    expect(screen.getByLabelText('Telefonnummer')).toHaveAttribute('type', 'tel')
  })

  it('says on the receipt who the KP has sent', async () => {
    const user = userEvent.setup()
    serveReceiptState({ status: 'dispatched', editable: false, vehicles: ['TLF 1'] })
    await renderForm()
    await sendAlarm(user, 'Baum auf der Fahrbahn')

    // The whole point of the status line: «beim KP» is not the same news as
    // «das TLF 1 fährt hin», and the reporter used to learn the difference by
    // radio or not at all.
    await waitFor(() => expect(screen.getByText('Disponiert · TLF 1')).toBeInTheDocument())
    // Once a squad is driving to that address it is not the reporter's to
    // change any more — the correction goes over the radio.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Weiteren Alarm erfassen/ })).toBeInTheDocument()
  })

  it('lets the reporter fix a typo until the KP disponiert it', async () => {
    const user = userEvent.setup()
    await renderForm()
    await sendAlarm(user, 'Wasser im Keler')

    // The correction link sits in the status row, above «Weiteren Alarm
    // erfassen». Found by position rather than by label: its German string is
    // still in the pending i18n patch, so next-intl renders the key path here.
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))
    await user.click(screen.getAllByRole('button')[0])

    // The same form, prefilled — a correction that starts from an empty form is
    // a re-typing exercise, which is how the second typo gets in.
    const message = await screen.findByLabelText(/Meldung/)
    expect(message).toHaveValue('Wasser im Keler')
    await user.clear(message)
    await user.type(message, 'Wasser im Keller')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    // The review step's send button — same reason as above for the position.
    await user.click(screen.getAllByRole('button')[0])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/intake/alarm/inc-1'),
      expect.objectContaining({ method: 'PUT' }),
    ))
    const putCall = fetchMock.mock.calls.find(call => call[1]?.method === 'PUT')
    expect(putCall?.[0]).toContain('receipt=receipt-token')
    const body = JSON.parse(putCall?.[1]?.body as string) as Record<string, unknown>
    expect(body.description).toBe('Wasser im Keller')
    // `''`, never `null`: the server reads `null` as «unverändert», so a Melder
    // typed in by mistake could otherwise never be taken back out again.
    expect(body.contact).toBe('')
    // «Notizen» is the exception, and it is not sent at all here. The server
    // APPENDS what arrives in that column instead of assigning it, because an
    // operator writes into it too and the receipt may not read it back — so an
    // unchanged hint stays out of the request rather than being posted as a
    // Nachtrag of itself.
    expect(body).not.toHaveProperty('internal_notes')

    // And back on the receipt, now showing what was corrected.
    await waitFor(() => expect(screen.getByText('Wasser im Keller')).toBeInTheDocument())
  })

  it('goes terminal when the receipt poll answers 403 – no correction offer, honest wording', async () => {
    const user = userEvent.setup()
    // The token has expired or the alarm was archived; the old page swallowed
    // this and kept claiming «noch nicht disponiert» plus a correction button.
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ detail: 'Beleg abgelaufen' }) })
    )
    await renderForm()
    await sendAlarm(user, 'Baum auf der Fahrbahn')

    await waitFor(() =>
      expect(screen.getByText('Nicht mehr korrigierbar – der Link ist abgelaufen.')).toBeInTheDocument()
    )
    // Only «Weiteren Alarm erfassen» is left — «Meldung korrigieren» is gone.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Weiteren Alarm erfassen/ })).toBeInTheDocument()
  })

  it('shows a neutral checking state, not the optimistic one, when the first poll fails', async () => {
    const user = userEvent.setup()
    // A phone that lost the network right after sending: the status is simply
    // unknown, and the page must not hard-code «noch korrigierbar».
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')))
    await renderForm()
    await sendAlarm(user, 'Baum auf der Fahrbahn')

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText('Status wird abgefragt...')).toBeInTheDocument()
    // No correction offer while nothing is known about the alarm's state.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('clears the pin explicitly – null, not omitted – when the corrected address became freetext', async () => {
    const user = userEvent.setup()
    await renderForm()
    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
    await user.click(screen.getByRole('button', { name: 'Pin setzen' }))
    await sendAlarm(user, 'Wasser im Keller')
    expect(createIntakeAlarm.mock.calls[0][1]).toMatchObject({ location_lat: '47.51666', location_lng: '7.56234' })

    // Into the correction, and the address becomes freetext: the real
    // LocationInput nulls the stale pin on a changed freetext commit — the
    // mock's button stands in for exactly that.
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))
    await user.click(screen.getAllByRole('button')[0])
    const ort = await screen.findByLabelText('Ort')
    await user.clear(ort)
    await user.type(ort, 'Hinter dem Schulhaus')
    await user.click(screen.getByRole('button', { name: 'Pin löschen' }))
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await user.click(screen.getAllByRole('button')[0])

    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(true))
    const putCall = fetchMock.mock.calls.find(call => call[1]?.method === 'PUT')
    const body = JSON.parse(putCall?.[1]?.body as string) as Record<string, unknown>
    // The coordinate contract: explicitly present as null ⇒ clear the pin on
    // the server too; omitted would mean «unverändert» and a re-sent value
    // would park the squad on the previous address.
    expect(body).toHaveProperty('location_lat', null)
    expect(body).toHaveProperty('location_lng', null)
    expect(body.location_address).toBe('Hinter dem Schulhaus')
  })

  it('sends the Hinweis along only when the reporter actually changed it', async () => {
    const user = userEvent.setup()
    await renderForm()
    await user.click(screen.getByRole('button', { name: 'Details ergänzen' }))
    await user.type(screen.getByLabelText('Weitere Hinweise'), 'Zufahrt gesperrt')
    await sendAlarm(user, 'Wasser im Keller')

    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2))
    await user.click(screen.getAllByRole('button')[0])

    const hints = await screen.findByLabelText('Weitere Hinweise')
    await user.clear(hints)
    await user.type(hints, 'Zufahrt doch frei')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await user.click(screen.getAllByRole('button')[0])

    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(true))
    const putCall = fetchMock.mock.calls.find(call => call[1]?.method === 'PUT')
    const body = JSON.parse(putCall?.[1]?.body as string) as Record<string, unknown>
    // A changed hint has to reach the KP — dropping the field wholesale would
    // leave the reporter no way to fix their own words. The server appends it,
    // so the operator's «Notizen» survive it either way.
    expect(body.internal_notes).toBe('Zufahrt doch frei')
  })
})
