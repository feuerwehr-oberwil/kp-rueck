import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
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
const wsHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>())
vi.mock('@/lib/websocket-client', () => ({
  wsClient: {
    on: (event: string, handler: (payload: unknown) => void) => {
      wsHandlers.set(event, handler)
      return () => wsHandlers.delete(event)
    },
    getStatus: () => 'connected',
    onStatusChange: () => () => {},
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }))

import RekoReportSection from '@/components/reko/reko-report-section'
import { PhotoViewerProvider } from '@/components/photos/photo-viewer'

/**
 * One live Reko report per Einsatz (owner pick 23.11.2026, #6): on the board the form is
 * always open and saves as it goes – create from nothing, edit in place, take in what the
 * field and other boards save. Read-only mounts show the filed report.
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

describe('the Reko tab on the board: one live report, always editable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getIncidentRekoReports.mockResolvedValue([])
    createRekoReportAsEditor.mockResolvedValue({ id: 'r-1', is_draft: true })
    updateRekoReport.mockResolvedValue({ id: 'r-1', is_draft: true })
  })

  it('shows the form at once on an incident with no report – in place, no step, no dialog', async () => {
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    expect(await screen.findByText('Einsatz relevant?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /erfassen|ergänzen/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('saves every answer through the board door – no save button (#30)', async () => {
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: 'Ja' }))
    expect(screen.queryByRole('button', { name: /speichern/i })).not.toBeInTheDocument()

    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalledTimes(1))
    expect(createRekoReportAsEditor.mock.calls[0]).toEqual(['i-1', expect.objectContaining({ is_relevant: true }), false])
    // No token travels: the session is the identity (decision 6). Nor the photo list:
    // upload and delete own it, a stale copy would undo another's photo.
    expect(createRekoReportAsEditor.mock.calls[0][1]).not.toHaveProperty('token')
    expect(createRekoReportAsEditor.mock.calls[0][1]).not.toHaveProperty('photos_json')
    expect(await screen.findByText(/^Synchronisiert – /)).toBeInTheDocument()

    // The next answer goes to the same report, not a second one.
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledWith('r-1', expect.objectContaining({ is_relevant: false })))
    expect(createRekoReportAsEditor).toHaveBeenCalledTimes(1)
  })

  it('says «Nicht synchronisiert» and resends only on «Erneut synchronisieren»', async () => {
    createRekoReportAsEditor.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    await user.click(await screen.findByRole('button', { name: 'Ja' }))

    expect(await screen.findByText('Nicht synchronisiert.')).toBeInTheDocument()
    expect(createRekoReportAsEditor).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Erneut synchronisieren' }))
    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalledTimes(2))
  })

  it("edits the Einsatz's report in place, a crew's draft included", async () => {
    getIncidentRekoReports.mockResolvedValue([
      report({ id: 'r-crew', is_draft: true, is_relevant: null, summary_text: 'Keller halb voll', submitted_by_personnel_id: 'p-1' }),
    ])
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    expect(await screen.findByDisplayValue('Keller halb voll')).toBeInTheDocument()
    expect(screen.getByText('Entwurf – noch nicht eingereicht')).toBeInTheDocument()
    expect(screen.getByText(/sobald «Einsatz relevant\?» beantwortet ist/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nein' }))

    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledWith('r-crew', { is_relevant: false }))
    expect(createRekoReportAsEditor).not.toHaveBeenCalled()
  })

  it('names who filed it and offers «Einsatz abschliessen» for a «Nein»', async () => {
    getIncidentRekoReports.mockResolvedValue([report({ id: 'r-no', is_relevant: false })])
    renderWithIntl(<RekoReportSection incidentId="i-no" canEdit dense onRequestComplete={() => {}} />)

    expect(await screen.findByText('Muster Hans')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Einsatz abschliessen/ })).toBeInTheDocument()
    expect(screen.queryByText(/sobald «Einsatz relevant/)).not.toBeInTheDocument()
  })

  it('takes in what the field saved meanwhile while nothing of its own is unsent', async () => {
    getIncidentRekoReports.mockResolvedValueOnce([report({ id: 'r-1', summary_text: 'Keller' })])
    renderWithIntl(<RekoReportSection incidentId="i-live" canEdit dense />)
    expect(await screen.findByDisplayValue('Keller')).toBeInTheDocument()

    getIncidentRekoReports.mockResolvedValueOnce([report({ id: 'r-1', summary_text: 'Keller 20 cm', updated_at: '2026-08-10T18:03:00Z' })])
    await act(async () => { wsHandlers.get('reko_update')?.({ data: { incident_id: 'i-live' } }) })

    expect(await screen.findByDisplayValue('Keller 20 cm')).toBeInTheDocument()
    // Taken in, not typed: nothing goes back out.
    expect(updateRekoReport).not.toHaveBeenCalled()
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

    const summary = await screen.findByDisplayValue('Keller halb voll')
    await user.clear(summary)
    await user.type(summary, 'Keller voll')
    // Off the Reko tab: the form unmounts, its save goes out and has not answered yet.
    first.unmount()
    expect(updateRekoReport).toHaveBeenCalledWith('r-draft', expect.objectContaining({ summary_text: 'Keller voll' }))

    // Back on the tab: a new mount, and the list still reads the old row.
    renderWithIntl(<RekoReportSection incidentId="i-tab" canEdit dense />)
    expect(await screen.findByDisplayValue('Keller voll')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    answer({ ...oldDraft, summary_text: 'Keller voll', updated_at: '2026-08-10T18:05:00Z' })

    // Only the new answer goes out – never the old text (pass 3, S2: changed fields only).
    await waitFor(() => expect(updateRekoReport).toHaveBeenLastCalledWith('r-draft', { is_relevant: false }))
    expect(await screen.findByText(/^Synchronisiert – /)).toBeInTheDocument()
  })

  it('sends only what this form changed, so a blank form never blanks the report it lands on (pass 3, S2)', async () => {
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-blank" canEdit dense />)

    await screen.findByText('Einsatz relevant?')
    await user.type(document.querySelector<HTMLTextAreaElement>('#notes')!, 'Zufahrt über Hof')

    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalled())
    expect(createRekoReportAsEditor).toHaveBeenLastCalledWith('i-blank', { additional_notes: 'Zufahrt über Hof' }, false)
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

    await user.type(await screen.findByDisplayValue('Keller'), ' 20 cm')
    await waitFor(() => expect(updateRekoReport).toHaveBeenCalledWith('r-own', { summary_text: 'Keller 20 cm' }))
    // While it is on its way: «Nein» here, and another board wrote a note meanwhile.
    await user.click(screen.getByRole('button', { name: 'Nein' }))
    answer({ ...draft, summary_text: 'Keller 20 cm', additional_notes: 'Zufahrt über Hof', updated_at: '2026-08-10T18:01:00Z' })

    expect(await screen.findByDisplayValue('Zufahrt über Hof')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Keller 20 cm')).toBeInTheDocument()
    // The next save carries only the edit made meanwhile – the note stays the other board's.
    await waitFor(() => expect(updateRekoReport).toHaveBeenLastCalledWith('r-own', { is_relevant: false }))
  })

  it('drops an older read that answers after a newer one (pass 5, S6)', async () => {
    getIncidentRekoReports.mockResolvedValueOnce([report({ id: 'r-1', summary_text: 'Keller' })])
    renderWithIntl(<RekoReportSection incidentId="i-reads" canEdit dense />)
    expect(await screen.findByDisplayValue('Keller')).toBeInTheDocument()

    let answerOld: (value: unknown) => void = () => {}
    getIncidentRekoReports.mockReturnValueOnce(new Promise(resolve => { answerOld = resolve }))
    getIncidentRekoReports.mockResolvedValueOnce([report({ id: 'r-1', summary_text: 'Keller 20 cm' })])
    await act(async () => {
      wsHandlers.get('reko_update')?.({ data: { incident_id: 'i-reads' } })
      wsHandlers.get('reko_update')?.({ data: { incident_id: 'i-reads' } })
    })
    expect(await screen.findByDisplayValue('Keller 20 cm')).toBeInTheDocument()
    await act(async () => { answerOld([report({ id: 'r-1', summary_text: 'Keller' })]) })

    expect(screen.getByDisplayValue('Keller 20 cm')).toBeInTheDocument()
  })

  it('keeps its own typing while the first save is on its way, whatever a read shows (pass 5, S3)', async () => {
    let answerPost: (value: unknown) => void = () => {}
    createRekoReportAsEditor.mockReturnValueOnce(new Promise(resolve => { answerPost = resolve }))
    const created = report({ id: 'r-new', is_draft: true, created_by_user_id: 'u-1', summary_text: 'Keller' })
    updateRekoReport.mockImplementation((id: string, payload: object) => Promise.resolve({ ...created, ...payload, id }))
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-first" canEdit dense />)

    await screen.findByText('Einsatz relevant?')
    const summary = document.querySelector<HTMLTextAreaElement>('#summary')!
    await user.type(summary, 'Keller')
    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalled())
    // Typed while the first save is on its way: queued behind it.
    await user.type(summary, ' 20')
    // The POST committed; a read shows its row before the POST's answer is here.
    getIncidentRekoReports.mockResolvedValue([created])
    await act(async () => { wsHandlers.get('reko_update')?.({ data: { incident_id: 'i-first' } }) })
    expect(document.querySelector<HTMLTextAreaElement>('#summary')!.value).toBe('Keller 20')
    await user.type(summary, ' cm')
    answerPost(created)

    // One writer for the row: the edits go out after the first save, in order, ending on the newest.
    await waitFor(() => expect(screen.getByText(/^Synchronisiert – /)).toBeInTheDocument())
    expect(updateRekoReport).toHaveBeenLastCalledWith('r-new', { summary_text: 'Keller 20 cm' })
  })

  it('never shows "vor Ort" here — it belongs to the Feldmeldungen row alone', async () => {
    // Decision 15: a fact shown in two places is a fact that will disagree with itself.
    getIncidentRekoReports.mockResolvedValue([
      { id: 'draft', is_draft: true, arrived_at: '2026-08-10T19:22:00Z', photos_json: [] },
    ])
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit />)

    expect(await screen.findByText('Einsatz relevant?')).toBeInTheDocument()
    expect(screen.queryByText(/vor Ort/)).not.toBeInTheDocument()
  })
})

describe('the Reko block where it may not write (phone sheet, wall)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows no form and nothing for a report still in the draft', async () => {
    getIncidentRekoReports.mockResolvedValue([report({ id: 'r-d', is_draft: true, summary_text: 'Entwurf' })])
    renderWithIntl(<RekoReportSection incidentId="i-1" />)

    expect(await screen.findByText('Noch kein Reko-Bericht')).toBeInTheDocument()
    expect(screen.queryByText('Einsatz relevant?')).not.toBeInTheDocument()
    expect(screen.queryByText('Entwurf')).not.toBeInTheDocument()
  })

  it.each([[true], [false]])('says an unanswered «Einsatz relevant?» as open and offers no completion (pass 4, S2) – dense %s', async (dense) => {
    getIncidentRekoReports.mockResolvedValue([report({ id: 'r-open', is_relevant: null, summary_text: 'Keller' })])
    renderWithIntl(<RekoReportSection incidentId="i-open" dense={dense} onRequestComplete={() => {}} />)

    expect(await screen.findByText('Relevanz nicht beantwortet')).toBeInTheDocument()
    expect(screen.queryByText('Kein Einsatz nötig')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Einsatz abschliessen/ })).not.toBeInTheDocument()
  })

  it('opens a photo in the viewer, not in a new tab (#5)', async () => {
    getIncidentRekoReports.mockResolvedValue([report({ id: 'r-p', photos_json: ['a.jpg', 'b.jpg'] })])
    const user = userEvent.setup()
    renderWithIntl(
      <PhotoViewerProvider incidentLabel="10 · Rebbergstrasse 5">
        <RekoReportSection incidentId="i-1" />
      </PhotoViewerProvider>,
    )

    const thumbs = await screen.findAllByTitle(/\.jpg$/)
    expect(document.querySelector('a[target="_blank"]')).toBeNull()
    await user.click(thumbs[1])
    const viewer = await screen.findByTestId('photo-viewer')
    expect(viewer).toHaveTextContent('2 / 2')
    expect(viewer).toHaveTextContent('Muster Hans')
  })
})
