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
    personnel: [],
    extra_personnel: [],
    photos: [],
    extra_materials: [],
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
      personnel_candidates: [],
      vehicle_candidates: [],
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
  it('says nothing at all — on EITHER mount. An empty form is its own explanation', async () => {
    // The line the KP mount used to render is gone: the section around it
    // already states «kein Rapport» in its header, and two lines saying it —
    // one of them a dashed box — made the normal state of most Schadenplätze
    // look like a failure. What §18.16 protects is the DIFFERENCE between
    // «nothing filed» and «not loaded», and that lives in the error below.
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(
      <FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} mount="kp" />,
    )

    expect(await screen.findByPlaceholderText('Lage, Tätigkeit, Material')).toBeInTheDocument()
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

    expect(await screen.findByPlaceholderText('Lage, Tätigkeit, Material')).toBeInTheDocument()
    expect(screen.queryByText('Rapport konnte nicht geladen werden.')).not.toBeInTheDocument()
  })

  it('keeps an error with a retry when the load genuinely fails — on BOTH mounts', async () => {
    const user = userEvent.setup()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByText('Rapport konnte nicht geladen werden.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByPlaceholderText('Lage, Tätigkeit, Material')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the two coaching lines are gone (§18.22)', () => {
  it('prints neither the dictation tip nor the retention sentence', async () => {
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await screen.findByPlaceholderText('Lage, Tätigkeit, Material')
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

    await screen.findByPlaceholderText('Lage, Tätigkeit, Material')
    expect(screen.queryByRole('button', { name: /Rapport abschliessen/ })).not.toBeInTheDocument()
    expect(screen.getByText('Wird laufend gespeichert – kein Abschliessen nötig.')).toBeInTheDocument()
  })

  it('files what it saves: is_draft false, so a KP rapport is never an eternal draft', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(rapport({ exists: true, is_draft: false, submitted_at: '2026-08-09T21:00:00Z' }))
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save }} mount="kp" />)

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Material')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Lage, Tätigkeit, Material'), {
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

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Material')).toBeInTheDocument())
    await vi.advanceTimersByTimeAsync(65000)

    expect(save).not.toHaveBeenCalled()
  })

  it('does not file an empty form somebody only clicked in', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const load = vi.fn().mockResolvedValue(rapport())
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save }} mount="kp" />)

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Material')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Lage, Tätigkeit, Material'), { target: { value: '   ' } })
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

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Lage, Tätigkeit, Material')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Rapport abschliessen/ })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Lage, Tätigkeit, Material'), { target: { value: 'Keller ausgepumpt.' } })
    // No KP debounce here — the phone's own 30 s interval is the draft-save.
    await vi.advanceTimersByTimeAsync(3000)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30000)
    expect(save).toHaveBeenCalledTimes(1)
    expect((save.mock.calls[0][0] as ApiRapportUpdate).is_draft).toBe(true)
  })
})

/** On /feld the blocks are folded (one screen instead of four), so anything
 *  below the fold is opened first — the same tap the crew makes. */
async function openSection(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
}

describe('Eigentümer / Halter is a name and a phone (§18.31)', () => {
  it('offers a tel: link as soon as the number is dialable', async () => {
    // The entire reason the phone is its own field: somebody rings from the
    // pavement when nobody answers the door. Same affordance the incident
    // already gives the Melder.
    const load = vi.fn().mockResolvedValue(rapport({ exists: true, owner_phone: '079 111 22 33' }))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await openSection(/Eigentümer- \/ Halterdaten/)
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

    await openSection(/Eigentümer- \/ Halterdaten/)
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

describe('a filed rapport on /feld (the amend flow)', () => {
  it('shows no send button until something actually changes, then sends the correction', async () => {
    // The old shape had a «Rapport ergänzen» button that unlocked fields which
    // were never locked — a dead tap — and until it was found, edits to a filed
    // rapport went nowhere at all.
    const filed = rapport({ exists: true, is_draft: false, submitted_at: '2026-08-11T18:41:00Z' })
    const save = vi.fn().mockImplementation((update: ApiRapportUpdate) =>
      Promise.resolve({ ...filed, ...update, is_draft: false }),
    )
    renderWithIntl(
      <FeldRapportForm incidentId="inc-1" transport={{ load: vi.fn().mockResolvedValue(filed), save }} />,
    )

    expect(await screen.findByText(/Abgeschlossen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Änderungen senden/ })).not.toBeInTheDocument()

    const kurzbericht = screen.getByPlaceholderText('Lage, Tätigkeit, Material')
    fireEvent.change(kurzbericht, { target: { value: 'Keller ausgepumpt, Pumpe bleibt vor Ort.' } })

    const send = await screen.findByRole('button', { name: /Änderungen senden/ })
    expect(screen.getByText(/noch nicht übermittelt/)).toBeInTheDocument()

    await userEvent.click(send)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ kurzbericht: 'Keller ausgepumpt, Pumpe bleibt vor Ort.', is_draft: false }),
    )
    // …and the button goes away again once the KP has it.
    expect(await screen.findByText(/Abgeschlossen/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Änderungen senden/ })).not.toBeInTheDocument()
  })
})

/**
 * The phone folds, the KP does not.
 *
 * `/feld` had grown to 4.1 phone screens with every block of the rapport open at
 * once — a crew scrolled past four of them to reach the one they needed. Folded,
 * each block has to keep saying what is inside it, or the scrolling has merely
 * turned into tapping.
 */
describe('the rapport is folded into blocks on /feld', () => {
  it('starts closed, and every block summarises itself', async () => {
    const load = vi.fn().mockResolvedValue(
      rapport({
        exists: true,
        kurzbericht: 'Keller ausgepumpt',
        personnel: [
          { personnel_id: 'p-1', name: 'Meier Andrea', present: true, on_board: true },
          { personnel_id: 'p-2', name: 'Suter Raoul', present: false, on_board: true },
        ],
        vehicles: [{ vehicle_id: 'v-1', name: 'Pio', present: true, on_board: true }],
      }),
    )
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    // Closed: the fields are still mounted (half-typed text survives a fold)
    // but nothing of them is on screen…
    await screen.findByRole('button', { name: /Kurzbericht/ })
    expect(screen.getByPlaceholderText('Lage, Tätigkeit, Material')).not.toBeVisible()
    // …but what it contains is still readable without opening anything.
    expect(screen.getByRole('button', { name: /Kurzbericht/ })).toHaveTextContent('Keller ausgepumpt')
    // Three sections now, each with its own count: «Mannschaft und Fahrzeuge»
    // was one block for a historical reason and made «1 Fahrzeug» something the
    // reader had to pick out of a compound line.
    //
    // The two headings and the two summary lines are NEW message keys. Until
    // the German catalogue carries them, next-intl renders the key path — the
    // patterns match either spelling on purpose, so this spec does not have to
    // be written twice.
    expect(screen.getByRole('button', { name: /Mannschaft/ })).toHaveTextContent(
      /1 Person|summary\.personnel/,
    )
    expect(screen.getByRole('button', { name: /Fahrzeuge/ })).toHaveTextContent(
      /1 Fahrzeug|summary\.vehicles/,
    )
    expect(screen.getByRole('button', { name: /Material/ })).toHaveTextContent('kein Material erfasst')

    await userEvent.click(screen.getByRole('button', { name: /Kurzbericht/ }))
    const box = screen.getByPlaceholderText('Lage, Tätigkeit, Material')
    expect(box).toBeVisible()
    expect(box).toHaveValue('Keller ausgepumpt')
  })

  it('folds the KP mount\'s LISTS but never its Kurzbericht', async () => {
    const load = vi.fn().mockResolvedValue(rapport({ exists: true }))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" mount="kp" transport={{ load, save: vi.fn() }} />)

    // The block somebody dictating over the radio types into first stays open…
    expect(await screen.findByPlaceholderText('Lage, Tätigkeit, Material')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Kurzbericht/ })).toBeNull()

    // …while the lists state what is in them and stay out of the way. In the
    // detail this form is one of four things in a tab, not a page of its own.
    const material = screen.getByRole('button', { name: /Material/ })
    expect(material).toBeInTheDocument()
    await userEvent.click(material)
    expect(await screen.findByText('Kein Material erfasst.')).toBeVisible()
  })
})

/**
 * The shorter list must not quietly lose somebody.
 *
 * Personal only lists who the board aufgeboten here now, and this rapport feeds
 * paid hours: its one failure mode is a name nobody remembered to add back. Two
 * things stand against it — the section's own count in its header, and the line
 * that names the board's number as soon as the two disagree.
 */
describe('the crew count is reconciled against the board', () => {
  const withCrew = (present: boolean, boardCount: number) =>
    rapport({
      exists: true,
      personnel: [{ personnel_id: 'p-1', name: 'Meier Andrea', present, on_board: true }],
      prefill: { ...rapport().prefill, board_personnel_count: boardCount },
    })

  it('names the board\'s number as soon as the crew corrects it', async () => {
    const load = vi.fn().mockResolvedValue(withCrew(false, 1))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await userEvent.click(await screen.findByRole('button', { name: /Mannschaft/ }))
    expect(screen.getByText('vom Board: 1')).toBeVisible()
  })

  it('stays quiet while the two agree — a marker that always shows is not a signal', async () => {
    const load = vi.fn().mockResolvedValue(withCrew(true, 1))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await userEvent.click(await screen.findByRole('button', { name: /Mannschaft/ }))
    expect(screen.queryByText(/vom Board/)).toBeNull()
  })
})

describe('the concurrent-editor banner expires (§P2.8)', () => {
  const editing = (at: string) =>
    rapport({
      exists: true,
      updated_at: at,
      updated_by_name: 'Burri Alessandro',
      concurrent_editor: { name: 'Burri Alessandro', at, in_kp: false },
    })

  it('shows while the other side saved within the window', async () => {
    const load = vi.fn().mockResolvedValue(editing(new Date().toISOString()))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByText(/bearbeitet diesen Rapport gerade/)).toBeInTheDocument()
  })

  it('never shows a banner whose window already lapsed at load', async () => {
    // A stale response (offline queue, dropped tab) must not resurrect a lock.
    const load = vi.fn().mockResolvedValue(editing(new Date(Date.now() - 6 * 60 * 1000).toISOString()))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    await screen.findByPlaceholderText('Lage, Tätigkeit, Material')
    expect(screen.queryByText(/bearbeitet diesen Rapport gerade/)).toBeNull()
  })

  it('clears the banner on its own when the editor stops', async () => {
    // The server scopes the flag to 5 minutes since the last save, but the
    // form loads once — without the client-side clock the banner named an
    // editor who had long stopped, for as long as the detail stayed open.
    // `shouldAdvanceTime` keeps promises and waitFor alive while the 5-minute
    // banner timeout stays under manual control.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const load = vi.fn().mockResolvedValue(editing(new Date().toISOString()))
    renderWithIntl(<FeldRapportForm incidentId="inc-1" transport={{ load, save: vi.fn() }} />)

    expect(await screen.findByText(/bearbeitet diesen Rapport gerade/)).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)
    expect(screen.queryByText(/bearbeitet diesen Rapport gerade/)).toBeNull()
  })
})
