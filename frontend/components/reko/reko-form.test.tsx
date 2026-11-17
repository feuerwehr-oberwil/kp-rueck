import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { ApiError } from '@/lib/api/types'

/**
 * A dead Reko link (sweep 2026-10-23, UX-PHONE-09): the /alarm card — one
 * message, in the crew's words. Not «Token möglicherweise ungültig» beside an
 * «API Fehler» toast.
 */

const params = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => params.value,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))
const getRekoForm = vi.hoisted(() => vi.fn())
const saveRekoDraft = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { getRekoForm, saveRekoDraft } }))
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import RekoForm from '@/components/reko/reko-form'

describe('RekoForm — a dead link', () => {
  it('a link the server refuses gets the one card, no jargon, no toast', async () => {
    params.value = new URLSearchParams({ incident_id: 'inc-1', token: 'old' })
    getRekoForm.mockRejectedValueOnce(new ApiError('Dieser Reko-Link ist ungültig oder abgelaufen.', 403))
    renderWithIntl(<RekoForm />)

    expect(await screen.findByRole('heading', { name: 'Link ungültig oder abgelaufen' })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/Token/)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a link without a token gets the same card', async () => {
    params.value = new URLSearchParams({ incident_id: 'inc-1' })
    renderWithIntl(<RekoForm />)
    expect(await screen.findByRole('heading', { name: 'Link ungültig oder abgelaufen' })).toBeInTheDocument()
    expect(getRekoForm).not.toHaveBeenCalled()
  })

  it('a connection failure is not called a dead link', async () => {
    params.value = new URLSearchParams({ incident_id: 'inc-1', token: 'ok' })
    getRekoForm.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderWithIntl(<RekoForm />)
    expect(await screen.findByText(/konnte nicht geladen werden/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Link ungültig oder abgelaufen' })).toBeNull()
  })
})

describe('field report autosave', () => {
  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  async function openReport(token: string, reportId: string | null) {
    params.value = new URLSearchParams({ incident_id: 'same-incident', token })
    if (reportId) {
      getRekoForm.mockResolvedValueOnce({
        id: reportId, summary_text: 'Vom KP erfasst', is_relevant: true,
        updated_at: '2025-01-01T00:00:00Z',
      })
    } else {
      getRekoForm.mockRejectedValueOnce(new TypeError('Offline'))
    }
    const view = renderWithIntl(<RekoForm />)
    await act(async () => {})
    return view
  }

  async function tick() {
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
  }

  it('writes nothing from the load-error screen or an untouched report', async () => {
    vi.useFakeTimers()
    const failed = await openReport('link', null)
    expect(screen.getByText(/konnte nicht geladen werden/)).toBeInTheDocument()
    await tick()
    failed.unmount()
    await openReport('link', 'report-1')
    expect(screen.getByDisplayValue('Vom KP erfasst')).toBeInTheDocument()
    await tick()
    expect(saveRekoDraft).not.toHaveBeenCalled()
  })

  it('keeps an offline draft when the server also edited that field, until the crew chooses', async () => {
    vi.useFakeTimers()
    localStorage.setItem('reko-report-draft-report-a', JSON.stringify({
      previous: { summary_text: 'Alter Stand' }, changes: { summary_text: 'Notizen vom Gerät' },
    }))
    await openReport('link-a', 'report-a')
    await tick()
    expect(saveRekoDraft).not.toHaveBeenCalled()
    expect(localStorage.getItem('reko-report-draft-report-a')).toContain('Notizen vom Gerät')
    fireEvent.click(screen.getByRole('button', { name: 'Entwurf vom Gerät verwenden' }))
    expect(screen.getByDisplayValue('Notizen vom Gerät')).toBeInTheDocument()
    saveRekoDraft.mockResolvedValue({})
    await tick()
    expect(saveRekoDraft).toHaveBeenCalledWith('same-incident', 'link-a', { summary_text: 'Notizen vom Gerät' })
    expect(localStorage.getItem('reko-report-draft-report-a')).toBeNull()
  })

  it('recovers only this report’s edits and sends only changed fields once', async () => {
    vi.useFakeTimers()
    saveRekoDraft.mockResolvedValue({})
    const first = await openReport('link-a', 'report-a')
    fireEvent.change(screen.getByDisplayValue('Vom KP erfasst'), { target: { value: 'Erster Trupp' } })
    first.unmount()
    const second = await openReport('link-b', 'report-b')
    expect(screen.getByDisplayValue('Vom KP erfasst')).toBeInTheDocument()
    await tick()
    expect(saveRekoDraft).not.toHaveBeenCalled()
    second.unmount()
    await openReport('link-a', 'report-a')
    expect(screen.getByDisplayValue('Erster Trupp')).toBeInTheDocument()
    await tick()
    expect(saveRekoDraft).toHaveBeenCalledWith('same-incident', 'link-a', { summary_text: 'Erster Trupp' })
    await tick()
    expect(saveRekoDraft).toHaveBeenCalledTimes(1)
  })
})
