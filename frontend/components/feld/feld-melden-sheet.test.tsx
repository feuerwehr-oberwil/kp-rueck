import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const createFeldIncident = vi.hoisted(() => vi.fn())
const updateFeldReport = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({ apiClient: { createFeldIncident, updateFeldReport } }))
// The sheet this mounts in asks the viewport; matchMedia is unimplemented in jsdom.
// `/feld` is a phone surface, so the mobile answer is the one worth testing against.
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The geocoder-backed location field is a product of its own; this sheet only
// needs "an address went in", so it is reduced to the one input it wraps.
vi.mock('@/components/location/location-input', () => ({
  LocationInput: ({ address, onAddressChange }: { address: string | null; onAddressChange: (v: string) => void }) => (
    <input aria-label="Ort" value={address ?? ''} onChange={e => onAddressChange(e.target.value)} />
  ),
}))

import { FeldMeldenSheet } from '@/components/feld/feld-melden-sheet'

/** Create mode only — the edit variant is a different member of the props union
 *  and gets its own render below. */
function render(props: { isPhoneDesk?: boolean; canTakeOver?: boolean } = {}) {
  const onReported = vi.fn()
  renderWithIntl(
    <FeldMeldenSheet
      open
      onOpenChange={vi.fn()}
      personnelId="p-1"
      token="tok"
      onReported={onReported}
      {...props}
    />,
  )
  return { onReported }
}

describe('FeldMeldenSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createFeldIncident.mockResolvedValue({ incident_id: 'inc-9', takeover: 'none' })
  })

  it('sends nothing until the review step has been read', async () => {
    const user = userEvent.setup()
    render()

    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    // The step exists to be read, so it has to show what was typed — not just
    // ask "sicher?" over a form nobody can see any more.
    expect(screen.getByText('Stimmt das so?')).toBeInTheDocument()
    expect(screen.getByText('Hauptstrasse 12')).toBeInTheDocument()
    expect(screen.getByText('Elementarereignis')).toBeInTheDocument()
    expect(createFeldIncident).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Meldung absetzen' }))
    await waitFor(() => expect(createFeldIncident).toHaveBeenCalledTimes(1))
    expect(createFeldIncident.mock.calls[0][2]).toMatchObject({ location_address: 'Hauptstrasse 12' })
  })

  it('goes back to the form with the entries intact', async () => {
    const user = userEvent.setup()
    render()

    await user.type(screen.getByLabelText('Ort'), 'Rebgasse 18')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await user.click(screen.getByRole('button', { name: 'Zurück zum Formular' }))

    expect(screen.getByLabelText('Ort')).toHaveValue('Rebgasse 18')
    expect(createFeldIncident).not.toHaveBeenCalled()
  })

  it('cannot reach the review step without a location', async () => {
    render()
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
  })

  it('corrects a Meldung it was handed, prefilled and without the takeover switch', async () => {
    const user = userEvent.setup()
    const onReported = vi.fn()
    const report = {
      incident_id: 'inc-3',
      title: 'Hauptstrasse 12',
      type: 'oelwehr',
      priority: 'medium',
      description: 'Ölspur',
      location_address: 'Hauptstrasse 12',
      location_display: 'Hauptstrasse 12',
      location_lat: null,
      location_lng: null,
      contact: null,
      contact_phone: null,
      status: 'incoming',
      created_at: '2026-08-17T19:14:00Z',
      editable: true,
      vehicles: [],
    }
    updateFeldReport.mockResolvedValue({ ...report, location_address: 'Hauptstrasse 21' })

    renderWithIntl(
      <FeldMeldenSheet
        open
        onOpenChange={vi.fn()}
        personnelId="p-1"
        token="tok"
        editing={report}
        onReported={onReported}
      />,
    )

    // Prefilled, and «wir übernehmen das gleich» is gone: taking a Schadenplatz
    // on happens once, at the moment of reporting.
    expect(screen.getByLabelText('Ort')).toHaveValue('Hauptstrasse 12')
    expect(screen.queryByText('Wir übernehmen das gleich')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Ort'))
    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 21')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    await user.click(screen.getByRole('button', { name: 'Korrektur senden' }))

    await waitFor(() => expect(updateFeldReport).toHaveBeenCalledTimes(1))
    expect(updateFeldReport.mock.calls[0][0]).toBe('inc-3')
    expect(updateFeldReport.mock.calls[0][3]).toMatchObject({ location_address: 'Hauptstrasse 21' })
    expect(createFeldIncident).not.toHaveBeenCalled()
    expect(onReported).toHaveBeenCalledOnce()
  })
})
