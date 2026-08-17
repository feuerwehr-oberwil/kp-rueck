import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const getIntakeContext = vi.hoisted(() => vi.fn())
const createIntakeAlarm = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=tok'),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: { getIntakeContext, createIntakeAlarm } }))
// The geocoder-backed location field is a product of its own; this form only
// needs "an address went in", so it is reduced to the one input it wraps.
vi.mock('@/components/location/location-input', () => ({
  LocationInput: ({ address, onAddressChange }: { address: string | null; onAddressChange: (v: string) => void }) => (
    <input aria-label="Ort" value={address ?? ''} onChange={e => onAddressChange(e.target.value)} />
  ),
}))

import AlarmPage from '@/app/alarm/page'

/** Renders the page and waits out the token check that gates the form. */
async function renderForm() {
  renderWithIntl(<AlarmPage />)
  await screen.findByLabelText(/Meldung/)
}

describe('AlarmPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getIntakeContext.mockResolvedValue({ event: { id: 'e-1', name: 'Sturm Oberwil', training_flag: false } })
    createIntakeAlarm.mockResolvedValue({ id: 'inc-1' })
  })

  it('sends nothing until the review step has been read', async () => {
    const user = userEvent.setup()
    await renderForm()

    await user.type(screen.getByLabelText(/Meldung/), 'Baum auf der Fahrbahn')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    // The step exists to be read, so it shows what was typed — not just a
    // "sicher?" over a form nobody can see any more.
    expect(screen.getByText('Stimmt das so?')).toBeInTheDocument()
    expect(screen.getByText('Baum auf der Fahrbahn')).toBeInTheDocument()
    expect(createIntakeAlarm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Alarm absenden' }))
    await waitFor(() => expect(createIntakeAlarm).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Alarm erfasst')).toBeInTheDocument()
  })

  it('puts the Meldung in the Meldung and the Hinweise in the Notizen', async () => {
    const user = userEvent.setup()
    await renderForm()

    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
    await user.type(screen.getByLabelText(/Meldung/), 'Wasser im Keller')
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

  it('offers the number pad for the phone number', async () => {
    await renderForm()
    expect(screen.getByLabelText('Telefonnummer')).toHaveAttribute('type', 'tel')
  })
})
