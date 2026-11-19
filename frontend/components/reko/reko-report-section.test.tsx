import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const getIncidentRekoReports = vi.fn()
const createRekoReportAsEditor = vi.fn()
const updateRekoReport = vi.fn()

vi.mock('@/lib/api-client', async () => ({
  // The real error classes: the sync line names the failure by them (`classifySaveFailure`).
  ...(await vi.importActual<typeof import('@/lib/api/types/common')>('@/lib/api/types/common')),
  apiClient: {
    get getIncidentRekoReports() {
      return getIncidentRekoReports
    },
    get createRekoReportAsEditor() {
      return createRekoReportAsEditor
    },
    get updateRekoReport() {
      return updateRekoReport
    },
  },
}))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: { on: () => () => {}, getStatus: () => 'connected', onStatusChange: () => () => {} },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }))

import RekoReportSection from '@/components/reko/reko-report-section'

/**
 * The acceptance criterion of plan 26 phase 2: **create from nothing.**
 *
 * The board could display a recon report faithfully and produce none of it. An
 * incident that never had any field contact — nobody opened the link, nobody is
 * on site — is exactly the case a radio message arrives for, and it is the one
 * the old read-only section had no answer to at all.
 */
/** A submitted report, with only the fields a case cares about spelled out. */
function report(overrides: Record<string, unknown>) {
  return {
    incident_id: 'i-1',
    is_draft: false,
    is_relevant: true,
    summary_text: null,
    additional_notes: null,
    dangers_json: null,
    effort_json: null,
    power_supply: null,
    photos_json: [],
    submitted_at: '2026-08-10T18:00:00Z',
    updated_at: '2026-08-10T18:00:00Z',
    submitted_by_personnel_name: 'Muster Hans',
    ...overrides,
  }
}

describe('the Reko block as an editing surface (plan 26 §5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getIncidentRekoReports.mockResolvedValue([])
    createRekoReportAsEditor.mockResolvedValue({ id: 'r-1', is_draft: true })
    updateRekoReport.mockResolvedValue({ id: 'r-1', is_draft: true })
  })

  it('offers "Reko-Bericht erfassen" on an incident with no report and no field contact', async () => {
    // The card mount (phone sheet, wall display), where the placeholder is a
    // box and the button stands beside it.
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit />)

    expect(await screen.findByText('Noch kein Reko-Bericht')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reko-Bericht erfassen/ })).toBeInTheDocument()
  })

  it('carries the create action ON the empty row at the board (Variante A)', async () => {
    // No dashed box and no second control: the row that would hold the report
    // says it has none and offers the way to fix that. So there is exactly one
    // thing to click on an incident with nothing filed.
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    await waitFor(() => expect(getIncidentRekoReports).toHaveBeenCalled())
    expect(screen.queryByText('Noch kein Reko-Bericht')).not.toBeInTheDocument()

    const actions = screen.getAllByRole('button')
    expect(actions).toHaveLength(1)
    await user.click(actions[0])
    expect(screen.getByText('Einsatz relevant?')).toBeInTheDocument()
  })

  it('expands the form in place rather than opening a dialog', async () => {
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit />)

    await user.click(await screen.findByRole('button', { name: /Reko-Bericht erfassen/ }))

    // The same field set the crew sees, inline — a modal over the incident
    // detail would hide the Feldmeldungen the operator is dictating from.
    expect(screen.getByText('Einsatz relevant?')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('saves every answer as a KP draft through the board door – no save button (#30)', async () => {
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    await waitFor(() => expect(getIncidentRekoReports).toHaveBeenCalled())
    await user.click(screen.getAllByRole('button')[0])
    expect(screen.queryByRole('button', { name: /speichern/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ja' }))

    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalledTimes(1))
    // A draft: the card's move to «Reko abgeschlossen» files it, on the server.
    expect(createRekoReportAsEditor.mock.calls[0]).toEqual(['i-1', expect.objectContaining({ is_relevant: true }), false])
    // No token travels: the session is the identity, and the report carries no
    // guessed personnel row (decision 6).
    expect(createRekoReportAsEditor.mock.calls[0][1]).not.toHaveProperty('token')
    // Nor the photo list: upload and delete own it, a stale copy would undo another's photo.
    expect(createRekoReportAsEditor.mock.calls[0][1]).not.toHaveProperty('photos_json')
    expect(await screen.findByText(/^Synchronisiert – /)).toBeInTheDocument()

    // The next answer goes to the same draft, not a second one.
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledWith('r-1', expect.objectContaining({ is_relevant: false })))
    expect(createRekoReportAsEditor).toHaveBeenCalledTimes(1)
  })

  it('says «Nicht synchronisiert» and resends only on «Erneut synchronisieren»', async () => {
    createRekoReportAsEditor.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    await waitFor(() => expect(getIncidentRekoReports).toHaveBeenCalled())
    await user.click(screen.getAllByRole('button')[0])
    await user.click(screen.getByRole('button', { name: 'Ja' }))

    expect(await screen.findByText('Nicht synchronisiert.')).toBeInTheDocument()
    expect(createRekoReportAsEditor).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Erneut synchronisieren' }))
    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalledTimes(2))
  })

  it("picks the operator's own draft up again instead of starting a second one", async () => {
    getIncidentRekoReports.mockResolvedValue([
      report({ id: 'r-draft', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Keller halb voll' }),
    ])
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    expect(await screen.findByText('Entwurf – noch nicht eingereicht')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'weiter erfassen' }))
    expect(screen.getByDisplayValue('Keller halb voll')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nein' }))

    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledWith('r-draft', expect.objectContaining({ is_relevant: false })))
    expect(createRekoReportAsEditor).not.toHaveBeenCalled()
  })

  it('keeps the newest edits through close and reopen while the list still has the old draft (S1)', async () => {
    const oldDraft = report({
      id: 'r-draft', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Keller halb voll',
      updated_at: '2026-08-10T18:00:00Z',
    })
    // Every read returns the draft as it was before this edit – a read that raced the save.
    getIncidentRekoReports.mockResolvedValue([oldDraft])
    let answer: (value: unknown) => void = () => {}
    updateRekoReport.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: 'weiter erfassen' }))
    const summary = screen.getByDisplayValue('Keller halb voll')
    await user.clear(summary)
    await user.type(summary, 'Keller voll')
    await user.click(screen.getByRole('button', { name: /Schliessen/ }))
    expect(updateRekoReport).toHaveBeenCalledWith('r-draft', expect.objectContaining({ summary_text: 'Keller voll' }))

    // Reopened while the save is still on its way: the edit, not the old row.
    await user.click(screen.getByRole('button', { name: 'weiter erfassen' }))
    expect(screen.getByDisplayValue('Keller voll')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Schliessen/ }))

    answer({ ...oldDraft, summary_text: 'Keller voll', updated_at: '2026-08-10T18:05:00Z' })
    const loadsBefore = getIncidentRekoReports.mock.calls.length
    await waitFor(() => expect(getIncidentRekoReports.mock.calls.length).toBeGreaterThan(loadsBefore))

    // Settled, and the reload still answered the old row: the server's copy is not newer
    // than what the save got back, so another field does not write the old text again.
    await user.click(screen.getByRole('button', { name: 'weiter erfassen' }))
    expect(screen.getByDisplayValue('Keller voll')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    // Only the new answer goes out – never the old text (pass 3, S2: changed fields only).
    await waitFor(() => expect(updateRekoReport).toHaveBeenLastCalledWith('r-draft', { is_relevant: false }))
  })

  it('keeps a save in flight across a tab switch: the new mount opens the edit, not the old row (pass 2, S1)', async () => {
    const oldDraft = report({
      id: 'r-draft', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Keller halb voll',
      updated_at: '2026-08-10T18:00:00Z',
    })
    getIncidentRekoReports.mockResolvedValue([oldDraft])
    let answer: (value: unknown) => void = () => {}
    updateRekoReport.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    const user = userEvent.setup()
    const first = renderWithIntl(<RekoReportSection incidentId="i-tab" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: 'weiter erfassen' }))
    const summary = screen.getByDisplayValue('Keller halb voll')
    await user.clear(summary)
    await user.type(summary, 'Keller voll')
    // Off the Reko tab: the form unmounts, its save goes out and has not answered yet.
    first.unmount()
    expect(updateRekoReport).toHaveBeenCalledWith('r-draft', expect.objectContaining({ summary_text: 'Keller voll' }))

    // Back on the tab: a new mount, and the list still reads the old row.
    renderWithIntl(<RekoReportSection incidentId="i-tab" canEdit dense />)
    await user.click(await screen.findByRole('button', { name: 'weiter erfassen' }))
    expect(screen.getByDisplayValue('Keller voll')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    answer({ ...oldDraft, summary_text: 'Keller voll', updated_at: '2026-08-10T18:05:00Z' })

    // Only the new answer goes out – never the old text (pass 3, S2: changed fields only).
    await waitFor(() => expect(updateRekoReport).toHaveBeenLastCalledWith('r-draft', { is_relevant: false }))
    expect(await screen.findByText(/^Synchronisiert – /)).toBeInTheDocument()
  })

  it('sends only what this form changed, so a blank form never blanks the report it lands on (pass 3, S2)', async () => {
    // Opened blank (nothing filed yet as far as this board knows); the server resolves the
    // first save onto the report another board filed meanwhile – it must keep its answers.
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-blank" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: /erfassen/ }))
    await user.type(document.querySelector<HTMLTextAreaElement>('#notes')!, 'Zufahrt über Hof')

    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalled())
    expect(createRekoReportAsEditor).toHaveBeenLastCalledWith('i-blank', { additional_notes: 'Zufahrt über Hof' }, false)
  })

  it("offers the operator's own draft beside a report the crew filed meanwhile (pass 3, S16)", async () => {
    getIncidentRekoReports.mockResolvedValue([
      report({ id: 'r-crew', summary_text: 'Wasser im Keller', submitted_by_personnel_id: 'p-1' }),
      report({ id: 'r-own', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Zufahrt über Hof' }),
    ])
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-crew" canEdit dense />)

    expect(await screen.findByText('Eigener Entwurf')).toBeInTheDocument()
    expect(screen.getByText(/sobald «Einsatz relevant\?» beantwortet ist/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'weiter erfassen' }))

    expect(screen.getByDisplayValue('Zufahrt über Hof')).toBeInTheDocument()
    expect(screen.getByText('Reko-Bericht erfassen')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    await waitFor(() => expect(updateRekoReport).toHaveBeenLastCalledWith('r-own', { is_relevant: false }))
  })

  it.each([[true], [false]])('says an unanswered «Einsatz relevant?» as open and offers no completion (pass 4, S2) – dense %s', async (dense) => {
    getIncidentRekoReports.mockResolvedValue([report({ id: 'r-open', is_relevant: null, summary_text: 'Keller' })])
    renderWithIntl(<RekoReportSection incidentId="i-open" canEdit dense={dense} onRequestComplete={() => {}} />)

    expect(await screen.findByText('Relevanz nicht beantwortet')).toBeInTheDocument()
    expect(screen.queryByText('Kein Einsatz nötig')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Einsatz abschliessen/ })).not.toBeInTheDocument()
  })

  it('offers «Einsatz abschliessen» for a «Nein»', async () => {
    getIncidentRekoReports.mockResolvedValue([report({ id: 'r-no', is_relevant: false })])
    renderWithIntl(<RekoReportSection incidentId="i-no" canEdit dense onRequestComplete={() => {}} />)

    expect(await screen.findByText('Kein Einsatz nötig')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Einsatz abschliessen/ })).toBeInTheDocument()
  })

  it('keeps the own draft and an amendment apart while a save is in flight (pass 4, S3)', async () => {
    getIncidentRekoReports.mockResolvedValue([
      report({ id: 'r-crew', summary_text: 'Wasser im Keller', submitted_by_personnel_id: 'p-1' }),
      report({ id: 'r-own', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Zufahrt' }),
    ])
    let answerOwn: (value: unknown) => void = () => {}
    updateRekoReport.mockImplementation((id: string, payload: object) =>
      id === 'r-own'
        ? new Promise(resolve => { answerOwn = () => resolve(report({ id, is_draft: true, created_by_user_id: 'u-1', ...payload })) })
        : Promise.resolve(report({ id, submitted_by_personnel_id: 'p-1', ...payload })))
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-two" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: 'weiter erfassen' }))
    await user.type(screen.getByDisplayValue('Zufahrt'), ' über Hof')
    await user.click(screen.getByRole('button', { name: /Schliessen/ }))
    // The draft's save is on its way; the operator switches to amending the crew report.
    await user.click(screen.getByRole('button', { name: /Reko-Bericht ergänzen/ }))
    expect(screen.getByDisplayValue('Wasser im Keller')).toBeInTheDocument()
    await user.type(document.querySelector<HTMLTextAreaElement>('#notes')!, 'Pumpe läuft')
    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledWith('r-crew', { additional_notes: 'Pumpe läuft' }))
    answerOwn(undefined)

    await waitFor(() => expect(screen.getByText(/^Synchronisiert – /)).toBeInTheDocument())
    const calls = updateRekoReport.mock.calls as [string, object][]
    expect(calls.filter(([id]) => id === 'r-own').map(([, body]) => body)).toEqual([{ summary_text: 'Zufahrt über Hof' }])
    expect(calls.filter(([id]) => id === 'r-crew').map(([, body]) => body)).toEqual([{ additional_notes: 'Pumpe läuft' }])
  })

  it("takes a save's answer into the form – another board's answers, own edits on top (pass 4, S4)", async () => {
    const draft = report({ id: 'r-own', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Keller', updated_at: '2026-08-10T18:00:00Z' })
    getIncidentRekoReports.mockResolvedValue([draft])
    let answer: (value: unknown) => void = () => {}
    updateRekoReport.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    updateRekoReport.mockResolvedValue({
      ...draft, summary_text: 'Keller 20 cm', additional_notes: 'Zufahrt über Hof', is_relevant: false,
      updated_at: '2026-08-10T18:02:00Z',
    })
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-adopt" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: 'weiter erfassen' }))
    await user.type(screen.getByDisplayValue('Keller'), ' 20 cm')
    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledWith('r-own', { summary_text: 'Keller 20 cm' }))
    // While it is on its way: «Nein» here, and another board wrote a note meanwhile.
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    answer({ ...draft, summary_text: 'Keller 20 cm', additional_notes: 'Zufahrt über Hof', updated_at: '2026-08-10T18:01:00Z' })

    expect(await screen.findByDisplayValue('Zufahrt über Hof')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Keller 20 cm')).toBeInTheDocument()
    // The next save carries only the edit made meanwhile – the note stays the other board's.
    await waitFor(() => expect(updateRekoReport).toHaveBeenLastCalledWith('r-own', { is_relevant: false }))
  })

  it('opens a list row as new as the last save answer as it is (pass 4, S4)', async () => {
    const draft = report({ id: 'r-own', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Keller', updated_at: '2026-08-10T18:00:00Z' })
    const acked = { ...draft, summary_text: 'Keller 20 cm', updated_at: '2026-08-10T18:01:00Z' }
    getIncidentRekoReports.mockResolvedValue([draft])
    updateRekoReport.mockResolvedValueOnce(acked)
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-same" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: 'weiter erfassen' }))
    await user.type(screen.getByDisplayValue('Keller'), ' 20 cm')
    // The reload after the save reads the same row at the same instant (another spelling of
    // it), with a note the server holds that this save did not send.
    getIncidentRekoReports.mockResolvedValue([{ ...acked, additional_notes: 'Zufahrt über Hof', updated_at: '2026-08-10T18:01:00.000000+00:00' }])
    const loads = getIncidentRekoReports.mock.calls.length
    await user.click(screen.getByRole('button', { name: /Schliessen/ }))
    await waitFor(() => expect(getIncidentRekoReports.mock.calls.length).toBeGreaterThan(loads))

    await user.click(screen.getByRole('button', { name: 'weiter erfassen' }))
    expect(screen.getByDisplayValue('Zufahrt über Hof')).toBeInTheDocument()
  })

  it('counts a draft whose only answer is the power supply as a draft', async () => {
    getIncidentRekoReports.mockResolvedValue([
      report({ id: 'r-draft', is_draft: true, created_by_user_id: 'u-1', is_relevant: null, power_supply: 'unavailable' }),
    ])
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    expect(await screen.findByText('Entwurf – noch nicht eingereicht')).toBeInTheDocument()
  })

  it('amends an existing report instead of filing a second one', async () => {
    getIncidentRekoReports.mockResolvedValue([
      {
        id: 'r-existing',
        incident_id: 'i-1',
        is_draft: false,
        is_relevant: true,
        summary_text: 'Keller unter Wasser',
        additional_notes: null,
        dangers_json: null,
        effort_json: null,
        power_supply: null,
        photos_json: [],
        submitted_at: '2026-08-10T18:00:00Z',
        updated_at: '2026-08-10T18:00:00Z',
        submitted_by_personnel_name: 'Muster Hans',
      },
    ])
    updateRekoReport.mockResolvedValue({ id: 'r-existing' })
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit />)

    await user.click(await screen.findByRole('button', { name: /Reko-Bericht ergänzen/ }))
    await user.click(screen.getByRole('button', { name: 'Nein' }))

    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledTimes(1))
    expect(updateRekoReport.mock.calls[0][0]).toBe('r-existing')
    expect(createRekoReportAsEditor).not.toHaveBeenCalled()
  })

  it('never shows "vor Ort" here — it belongs to the Feldmeldungen row alone', async () => {
    // Decision 15. A draft carrying an arrival used to render "vor Ort seit …"
    // in this block; a fact shown in two places is a fact that will disagree
    // with itself.
    getIncidentRekoReports.mockResolvedValue([
      { id: 'draft', is_draft: true, arrived_at: '2026-08-10T19:22:00Z', photos_json: [] },
    ])
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit />)

    expect(await screen.findByText('Noch kein Reko-Bericht')).toBeInTheDocument()
    expect(screen.queryByText(/vor Ort/)).not.toBeInTheDocument()
  })

  it('shows the whole history as rows at the board, not behind a collapsible', async () => {
    // The board's question is «was hat sich seit der letzten Meldung geändert»,
    // and it used to cost two clicks: one on «2 frühere Reko-Berichte», one per
    // dashed card. Every report is a row now, and unfolding one gives the same
    // field rows as the current report — there is no second card design for
    // "older".
    getIncidentRekoReports.mockResolvedValue([
      report({ id: 'r-now', summary_text: 'Wasser 15 cm', submitted_at: '2026-08-10T19:34:00Z' }),
      report({
        id: 'r-before',
        summary_text: 'Zulauf noch nicht gestoppt',
        submitted_at: '2026-08-10T19:02:00Z',
        effort_json: { personnel_count: 4, vehicles_needed: [], equipment_needed: [], estimated_duration_hours: null },
      }),
    ])
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    expect(await screen.findByText(/Zulauf noch nicht gestoppt/)).toBeInTheDocument()
    expect(screen.queryByText(/frühere Reko-Berichte/)).not.toBeInTheDocument()
    // Folded, the earlier report is a one-line digest and nothing more.
    expect(screen.queryByText('4 Personen')).not.toBeInTheDocument()

    const amend = screen.getByRole('button', { name: /Reko-Bericht ergänzen/ })
    const rowAction = screen.getAllByRole('button').find(button => button !== amend)
    await user.click(rowAction!)

    expect(screen.getByText('4 Personen')).toBeInTheDocument()
  })

  it('offers nothing to a mount that may not write', async () => {
    renderWithIntl(<RekoReportSection incidentId="i-1" />)

    expect(await screen.findByText('Noch kein Reko-Bericht')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reko-Bericht/ })).not.toBeInTheDocument()
  })
})
