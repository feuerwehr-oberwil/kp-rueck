import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportUpdate, ApiSchadenplatzRapport } from '@/lib/api/types'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

import { FeldRapportForm } from '@/components/feld/feld-rapport-form'

function rapport(overrides: Partial<ApiSchadenplatzRapport> = {}): ApiSchadenplatzRapport {
  return {
    incident_id: 'inc-1',
    exists: false,
    is_draft: true,
    submitted_at: null,
    materials: [],
    vehicles: [],
    photos: [],
    extra_material_note: null,
    kurzbericht: null,
    handed_over_to: null,
    owner_note: null,
    personnel_count: 0,
    personnel_count_corrected: false,
    cost_snapshot_json: null,
    arrived_at: null,
    created_by_name: null,
    created_in_kp: false,
    updated_by_name: null,
    updated_in_kp: false,
    updated_at: null,
    concurrent_editor: null,
    prefill: {
      location_address: 'Hauptstrasse 1',
      incident_ref: 'Wasser im Keller',
      leader_personnel_id: null,
      leader_name: null,
      melder_name: null,
      melder_street: null,
      melder_city: null,
      board_personnel_count: 0,
      material_name_suggestions: [],
    },
    ...overrides,
  }
}

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('an absent rapport (§18.16)', () => {
  it('is a plain line, not an error — it is the normal state of a Schadenplatz', async () => {
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(
      <FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} mount="kp" />,
    )

    expect(await screen.findByText('Noch kein Rapport')).toBeInTheDocument()
    expect(screen.queryByText('Rapport konnte nicht geladen werden.')).not.toBeInTheDocument()
    // …and the form is there, because the KP must be able to dictate one.
    expect(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument()
  })

  it('opens as an empty form when localStorage holds a draft of an older shape', async () => {
    // The form has already lost a Schadensart, a vehicle count, five owner
    // inputs and the two Tätigkeit times. A draft from any of those versions
    // must not read as "Rapport konnte nicht geladen werden".
    storage.set('feld-rapport-inc-1', JSON.stringify({ data: { schadensart: 'wasser' }, timestamp: null }))
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByText('Noch kein Rapport')).toBeInTheDocument()
    expect(screen.queryByText('Rapport konnte nicht geladen werden.')).not.toBeInTheDocument()
  })

  it('keeps an error with a retry when the load genuinely fails', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByText('Rapport konnte nicht geladen werden.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByText('Noch kein Rapport')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the KP mount saves itself (§18.17)', () => {
  it('has no submit button — the board autosaves everything else too', async () => {
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} mount="kp" />)

    await screen.findByText('Noch kein Rapport')
    expect(screen.queryByRole('button', { name: /Rapport abschliessen/ })).not.toBeInTheDocument()
    expect(screen.getByText('Wird laufend gespeichert – kein Abschliessen nötig.')).toBeInTheDocument()
  })

  it('files what it saves: is_draft false, so a KP rapport is never an eternal draft', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(rapport({ exists: true, is_draft: false, submitted_at: '2026-08-09T21:00:00Z' }))
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save }} mount="kp" />)

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte'), {
      target: { value: 'Baum auf Fahrbahn, per Funk gemeldet.' },
    })

    await vi.advanceTimersByTimeAsync(2500)
    expect(save).toHaveBeenCalledTimes(1)
    const payload = save.mock.calls[0][0] as ApiRapportUpdate
    expect(payload.is_draft).toBe(false)
    expect(payload.kurzbericht).toBe('Baum auf Fahrbahn, per Funk gemeldet.')
  })

  it('writes nothing at all while nobody types', async () => {
    // Otherwise opening a detail modal would create an empty rapport — and
    // stamp "zuletzt bearbeitet im KP" on a crew's — for merely being looked at.
    vi.useFakeTimers()
    const save = vi.fn()
    const load = vi.fn().mockResolvedValue(rapport({ exists: true, is_draft: false, kurzbericht: 'Vom Trupp erfasst.' }))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save }} mount="kp" />)

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument())
    await vi.advanceTimersByTimeAsync(65000)

    expect(save).not.toHaveBeenCalled()
  })

  it('does not file an empty form somebody only clicked in', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save }} mount="kp" />)

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte'), { target: { value: '   ' } })
    await vi.advanceTimersByTimeAsync(65000)

    expect(save).not.toHaveBeenCalled()
  })
})

describe('the /feld mount keeps its "I am done" moment', () => {
  it('files explicitly, and its autosave stays a draft', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(rapport({ exists: true, is_draft: true }))
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save }} />)

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Rapport abschliessen/ })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Lage, Tätigkeit, Geräte'), { target: { value: 'Keller ausgepumpt.' } })
    // No KP debounce here — the phone's own 30 s interval is the draft-save.
    await vi.advanceTimersByTimeAsync(3000)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30000)
    expect(save).toHaveBeenCalledTimes(1)
    expect((save.mock.calls[0][0] as ApiRapportUpdate).is_draft).toBe(true)
  })
})
