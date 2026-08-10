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
    owner_name: null,
    owner_phone: null,
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
      melder_phone: null,
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

  it('says nothing at all on /feld — an empty form is its own explanation', async () => {
    // The KP scans many incidents and needs "nothing filed" told apart from
    // "not loaded"; on a phone the form IS the screen, so the line is one more
    // thing to scroll past in the rain.
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument()
    expect(screen.queryByText('Noch kein Rapport')).not.toBeInTheDocument()
    expect(screen.queryByText('Rapport konnte nicht geladen werden.')).not.toBeInTheDocument()
  })

  it('opens as an empty form when localStorage holds a draft of an older shape', async () => {
    // The form has already lost a Schadensart, a vehicle count, five owner
    // inputs and the two Tätigkeit times. A draft from any of those versions
    // must not read as "Rapport konnte nicht geladen werden".
    storage.set('feld-rapport-inc-1', JSON.stringify({ data: { schadensart: 'wasser' }, timestamp: null }))
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument()
    expect(screen.queryByText('Rapport konnte nicht geladen werden.')).not.toBeInTheDocument()
  })

  it('keeps an error with a retry when the load genuinely fails — on BOTH mounts', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByText('Rapport konnte nicht geladen werden.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByPlaceholderText('Lage, Tätigkeit, Geräte')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the two coaching lines are gone (§18.22)', () => {
  it('prints neither the dictation tip nor the retention sentence', async () => {
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await screen.findByPlaceholderText('Lage, Tätigkeit, Geräte')
    expect(screen.queryByText(/Diktiertaste/)).not.toBeInTheDocument()
    // The retention rule itself is unchanged — it lives in docs/DEPLOYMENT.md,
    // where the person who has to answer for it reads it.
    expect(screen.queryByText(/Wird mit dem Ereignis gelöscht/)).not.toBeInTheDocument()
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

describe('Eigentümer / Halter is a name and a phone (§18.28)', () => {
  it('offers a tel: link as soon as the number is dialable', async () => {
    // The entire reason the phone is its own field: somebody rings from the
    // pavement when nobody answers the door. Same affordance the incident
    // already gives the Melder.
    const load = vi.fn().mockResolvedValue(rapport({ exists: true, owner_phone: '079 111 22 33' }))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    const link = await screen.findByRole('link', { name: /Anrufen/ })
    expect(link).toHaveAttribute('href', 'tel:0791112233')
  })

  it('shows no call link for something that is not a number', async () => {
    const load = vi.fn().mockResolvedValue(rapport({ exists: true, owner_phone: 'unbekannt' }))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await screen.findByLabelText('Telefon')
    expect(screen.queryByRole('link', { name: /Anrufen/ })).toBeNull()
  })

  it('"Melder übernehmen" fills both fields and overwrites neither', async () => {
    const load = vi.fn().mockResolvedValue(
      rapport({
        exists: true,
        owner_name: 'Fam. Meier',
        prefill: {
          ...rapport().prefill,
          melder_name: 'A. Bürgin',
          melder_phone: '079 000 00 00',
        },
      }),
    )
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await userEvent.click(await screen.findByRole('button', { name: /Melder übernehmen/ }))

    // The crew's own words about who owns the place beat a name the dispatcher
    // took down — but an empty field has nothing to defend.
    expect(screen.getByLabelText('Eigentümer / Halter')).toHaveValue('Fam. Meier')
    expect(screen.getByLabelText('Telefon')).toHaveValue('079 000 00 00')
  })

  it('sends the two fields separately', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(rapport({ exists: true }))
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save }} />)

    await vi.waitFor(() => expect(screen.getByLabelText('Eigentümer / Halter')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Eigentümer / Halter'), { target: { value: 'Fam. Meier' } })
    fireEvent.change(screen.getByLabelText('Telefon'), { target: { value: '079 111 22 33' } })
    await vi.advanceTimersByTimeAsync(30000)

    const update = save.mock.calls[0][0] as ApiRapportUpdate
    expect(update.owner_name).toBe('Fam. Meier')
    expect(update.owner_phone).toBe('079 111 22 33')
  })
})
