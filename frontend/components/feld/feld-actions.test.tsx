import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiFeldAssignment, ApiFieldReportState } from '@/lib/api/types'

const feldReportArrived = vi.hoisted(() => vi.fn())
const feldReportComplete = vi.hoisted(() => vi.fn())
const feldReportPickup = vi.hoisted(() => vi.fn())
const feldSendMessage = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { feldReportArrived, feldReportComplete, feldReportPickup, feldSendMessage },
}))

import { FeldActions } from '@/components/feld/feld-actions'

const STATE: ApiFieldReportState = {
  incident_id: 'inc-1',
  arrived_at: null,
  arrived_by_personnel_id: null,
  arrived_by_automation: false,
  arrived_in_kp: false,
  field_complete_reported_at: '2026-08-09T21:00:00Z',
  field_complete_reported_by: 'p-1',
  pickup_needed: false,
  pickup_note: null,
  pickup_requested_at: null,
  pickup_requested_by: null,
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

function render(overrides: Partial<ApiFeldAssignment> = {}, onReported = vi.fn()) {
  renderWithIntl(
    <FeldActions
      assignment={assignment(overrides)}
      personnelId="p-1"
      token="tok"
      messageChips={['Verstärkung nötig', 'Material nötig']}
      onReported={onReported}
    />,
  )
  return onReported
}

/**
 * The two irreversible reports ask first (§18.18) — from the field neither can
 * be taken back, only the KP can clear them. Every test that wants the report
 * itself goes through the question, exactly as a thumb does.
 */
async function confirmArrived(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Angekommen/ }))
  await user.click(screen.getByRole('button', { name: 'Ja, angekommen' }))
}

async function confirmComplete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Einsatz beendet/ }))
  await user.click(screen.getByRole('button', { name: 'Ja, beendet' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  feldReportArrived.mockResolvedValue(STATE)
  feldReportComplete.mockResolvedValue(STATE)
  feldReportPickup.mockResolvedValue(STATE)
  feldSendMessage.mockResolvedValue(undefined)
})

describe('Angekommen', () => {
  it('reports once and then locks the button', async () => {
    const user = userEvent.setup()
    render()
    await confirmArrived(user)
    await waitFor(() => expect(feldReportArrived).toHaveBeenCalledWith('inc-1', 'p-1', 'tok'))
  })

  it('asks before it reports — a mistap in the rain sends nothing', async () => {
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: /Angekommen/ }))
    expect(screen.getByText('Angekommen melden?')).toBeInTheDocument()
    expect(feldReportArrived).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.queryByText('Angekommen melden?')).not.toBeInTheDocument()
    expect(feldReportArrived).not.toHaveBeenCalled()
  })

  it('is already done when the crew reported it before', () => {
    render({ arrived_at: '2026-08-09T20:00:00Z' })
    expect(screen.getByRole('button', { name: /Angekommen gemeldet/ })).toBeDisabled()
  })

  it('stops asking once the GPS automation saw the vehicle arrive (§18.24)', () => {
    // The board already concluded the crew is there — asking them to confirm it
    // is asking for a tap that changes nothing. The wording is its own, because
    // nobody reported anything: "erkannt", not "gemeldet".
    render({ arrived_at: '2026-08-09T20:00:00Z', arrived_by_automation: true })

    const button = screen.getByRole('button', { name: /Angekommen erkannt/ })
    expect(button).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Angekommen gemeldet/ })).not.toBeInTheDocument()
  })

  it('still offers the tap to a crew that went zu Fuss — no vehicle, no GPS', async () => {
    // The manual route must stay, and must not look broken when it is the only
    // one: nothing about it changes when there is no automation arrival.
    const user = userEvent.setup()
    render({ arrived_at: null, arrived_by_automation: false })

    const button = screen.getByRole('button', { name: /Angekommen/ })
    expect(button).not.toBeDisabled()
    await confirmArrived(user)
    await waitFor(() => expect(feldReportArrived).toHaveBeenCalledWith('inc-1', 'p-1', 'tok'))
  })
})

describe('the Abholung follow-up (decision 24)', () => {
  it('asks "Kommt ihr selbst zurück?" right after Einsatz beendet', async () => {
    const user = userEvent.setup()
    render()
    expect(screen.queryByText('Kommt ihr selbst zurück?')).not.toBeInTheDocument()

    await confirmComplete(user)

    await waitFor(() => expect(screen.getByText('Kommt ihr selbst zurück?')).toBeInTheDocument())
  })

  it('does NOT ask when the beendet-Meldung failed', async () => {
    // A pickup attached to a report that never landed would be a crew waiting
    // for a car nobody was told to send.
    feldReportComplete.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render()

    await confirmComplete(user)

    await waitFor(() => expect(screen.getByText(/nicht gesendet werden/)).toBeInTheDocument())
    expect(screen.queryByText('Kommt ihr selbst zurück?')).not.toBeInTheDocument()
  })

  it('"Wir fahren selbst" clears the flag and closes the question', async () => {
    const user = userEvent.setup()
    render()
    await confirmComplete(user)
    await waitFor(() => expect(screen.getByText('Kommt ihr selbst zurück?')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Wir fahren selbst' }))

    await waitFor(() => expect(feldReportPickup).toHaveBeenCalledWith('inc-1', 'p-1', 'tok', false, null))
    await waitFor(() => expect(screen.queryByText('Kommt ihr selbst zurück?')).not.toBeInTheDocument())
  })

  it('"Wir müssen abgeholt werden" sends the flag with the note', async () => {
    const user = userEvent.setup()
    render()
    await confirmComplete(user)
    await waitFor(() => expect(screen.getByText('Kommt ihr selbst zurück?')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText(/Notiz/), '3 Personen')
    await user.click(screen.getByRole('button', { name: 'Wir müssen abgeholt werden' }))

    await waitFor(() =>
      expect(feldReportPickup).toHaveBeenCalledWith('inc-1', 'p-1', 'tok', true, '3 Personen'),
    )
  })
})

describe('Einsatz beendet', () => {
  it('asks before it reports, and cancelling sends nothing', async () => {
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: /Einsatz beendet/ }))
    expect(screen.getByText('Einsatz beendet melden?')).toBeInTheDocument()
    expect(feldReportComplete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(feldReportComplete).not.toHaveBeenCalled()
    // …and the Abholung question never opens off an unsent report.
    expect(screen.queryByText('Kommt ihr selbst zurück?')).not.toBeInTheDocument()
  })
})

describe('an open Abholung', () => {
  it('is shown standing, so nobody asks twice', () => {
    render({ pickup_needed: true, pickup_requested_at: '2026-08-09T21:14:00Z', pickup_note: '3 Personen' })
    expect(screen.getAllByText(/Abholung/).length).toBeGreaterThan(0)
    expect(screen.getByText('3 Personen')).toBeInTheDocument()
  })

  it('never offers to report itself abgeholt — that is the KP\'s chip (§18.9)', async () => {
    const user = userEvent.setup()
    render({ pickup_needed: true, pickup_requested_at: '2026-08-09T21:14:00Z' })

    expect(screen.queryByRole('button', { name: /Abgeholt/i })).not.toBeInTheDocument()

    // The button is still there and still only asks — re-opening it updates the
    // note rather than clearing anything.
    await user.click(screen.getByRole('button', { name: 'Abholung' }))
    await user.type(screen.getByPlaceholderText(/Notiz/), '5 Personen')
    await user.click(screen.getByRole('button', { name: 'Notiz aktualisieren' }))

    await waitFor(() =>
      expect(feldReportPickup).toHaveBeenCalledWith('inc-1', 'p-1', 'tok', true, '5 Personen'),
    )
  })
})

describe('Freitext-Meldung', () => {
  it('sends a station chip with one tap', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: 'Meldung' }))
    await user.click(screen.getByRole('button', { name: 'Verstärkung nötig' }))

    await waitFor(() => expect(feldSendMessage).toHaveBeenCalledWith('inc-1', 'p-1', 'tok', 'Verstärkung nötig'))
  })

  it('refuses to send whitespace', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: 'Meldung' }))
    await user.type(screen.getByPlaceholderText(/Kurze Meldung/), '   ')

    expect(feldSendMessage).not.toHaveBeenCalled()
  })
})

describe('delivery feedback (a phone on a bad connection)', () => {
  it('confirms explicitly that the KP got the Meldung', async () => {
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: 'Meldung' }))
    await user.click(screen.getByRole('button', { name: 'Verstärkung nötig' }))

    await waitFor(() =>
      expect(screen.getByText(/«Verstärkung nötig» ist beim KP angekommen/)).toBeInTheDocument(),
    )
  })

  it('keeps the typed text and offers a retry when the send fails', async () => {
    feldSendMessage.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: 'Meldung' }))
    const input = screen.getByPlaceholderText(/Kurze Meldung/)
    await user.type(input, 'Keller 40cm Wasser')
    await user.click(screen.getByRole('button', { name: 'Meldung senden' }))

    await waitFor(() => expect(screen.getByText(/nicht übermittelt/)).toBeInTheDocument())
    // The text is still there — retyping a Meldung in the rain is not a retry.
    expect(screen.getByPlaceholderText(/Kurze Meldung/)).toHaveValue('Keller 40cm Wasser')

    feldSendMessage.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole('button', { name: /Nochmals senden/ }))

    await waitFor(() => expect(feldSendMessage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText(/beim KP angekommen/)).toBeInTheDocument())
  })

  it('confirms Angekommen too, not just the free text', async () => {
    const user = userEvent.setup()
    render()
    await confirmArrived(user)
    await waitFor(() => expect(screen.getByText(/«Angekommen» ist beim KP angekommen/)).toBeInTheDocument())
  })

  it('reports a failed Abholung with a retry', async () => {
    feldReportPickup.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render()
    await user.click(screen.getByRole('button', { name: 'Abholung' }))
    await user.click(screen.getByRole('button', { name: 'Wir müssen abgeholt werden' }))

    await waitFor(() => expect(screen.getByText(/nicht übermittelt/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Nochmals senden/ })).toBeInTheDocument()
  })
})
