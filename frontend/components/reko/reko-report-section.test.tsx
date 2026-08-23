import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const getIncidentRekoReports = vi.fn()
const createRekoReportAsEditor = vi.fn()
const updateRekoReport = vi.fn()

vi.mock('@/lib/api-client', () => ({
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
vi.mock('@/lib/websocket-client', () => ({ wsClient: { on: () => () => {} } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
    createRekoReportAsEditor.mockResolvedValue({ id: 'r-1', is_draft: false })
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

  it('files the dictated report through the board door', async () => {
    const user = userEvent.setup()
    renderWithIntl(<RekoReportSection incidentId="i-1" canEdit dense />)

    await waitFor(() => expect(getIncidentRekoReports).toHaveBeenCalled())
    await user.click(screen.getAllByRole('button')[0])
    await user.click(screen.getByRole('button', { name: 'Ja' }))
    await user.click(screen.getByRole('button', { name: /Bericht speichern/ }))

    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalledTimes(1))
    expect(createRekoReportAsEditor.mock.calls[0][0]).toBe('i-1')
    // No token travels: the session is the identity, and the report carries no
    // guessed personnel row (decision 6).
    expect(createRekoReportAsEditor.mock.calls[0][1]).not.toHaveProperty('token')
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
    await user.click(screen.getByRole('button', { name: /Bericht speichern/ }))

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
