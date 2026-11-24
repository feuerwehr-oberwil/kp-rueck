import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { ApiError } from '@/lib/api/types'

/**
 * A dead Reko link (sweep 2026-10-23, UX-PHONE-09): the /alarm card — one
 * message, in the crew's words. Not «Token möglicherweise ungültig» beside an
 * «API Fehler» toast.
 */

const params = vi.hoisted(() => ({ value: new URLSearchParams() }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => params.value,
  useRouter: () => router,
}))
const getRekoForm = vi.hoisted(() => vi.fn())
const saveRekoDraft = vi.hoisted(() => vi.fn())
const submitRekoReport = vi.hoisted(() => vi.fn())
const uploadRekoPhoto = vi.hoisted(() => vi.fn())
const deleteRekoPhoto = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { getRekoForm, saveRekoDraft, submitRekoReport, uploadRekoPhoto, deleteRekoPhoto },
}))
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
const unmutedToast = vi.hoisted(() => vi.fn())
vi.mock('@/lib/toast-lifetime', async (original) => ({
  ...(await original<typeof import('@/lib/toast-lifetime')>()),
  unmutedToast,
}))

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

/** A form link as the server mints it (only its `jti` matters here; the signature is not read). */
function formLink(jti: string): string {
  return `header.${btoa(JSON.stringify({ type: 'reko_form', jti }))}.signature`
}

describe('field report autosave', () => {
  /** The report as the server has it: what the last form load returned, each save on top. */
  let row: Record<string, unknown> = {}
  /** The server's answer to a save: the whole report, the saved fields merged in. */
  function serverAnswer(_incident: string, _token: string, changes: Record<string, unknown>) {
    row = { ...row, ...changes }
    return row
  }
  beforeEach(() => {
    saveRekoDraft.mockImplementation(async (...args: Parameters<typeof serverAnswer>) => serverAnswer(...args))
    submitRekoReport.mockImplementation(async (...args: Parameters<typeof serverAnswer>) => serverAnswer(...args))
  })
  afterEach(() => {
    saveRekoDraft.mockReset()
    submitRekoReport.mockReset()
    localStorage.clear()
    vi.useRealTimers()
  })

  async function openReport(token: string, reportId: string | null, summary = 'Vom KP erfasst', personnelId?: string) {
    params.value = new URLSearchParams({ incident_id: 'same-incident', token, ...(personnelId && { personnel_id: personnelId }) })
    if (reportId) {
      row = { id: reportId, summary_text: summary, is_relevant: true, updated_at: '2025-01-01T00:00:00Z' }
      getRekoForm.mockResolvedValueOnce(row)
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

  it('a delayed acknowledgement in one tab preserves the other tab’s later draft across reopening', async () => {
    vi.useFakeTimers()
    const first = await openReport('link-a', 'report-a')
    const second = await openReport('link-a', 'report-a')
    let acknowledge!: () => void
    saveRekoDraft.mockImplementationOnce((...args: Parameters<typeof serverAnswer>) =>
      new Promise(resolve => { acknowledge = () => resolve(serverAnswer(...args)) }))
    fireEvent.change(within(first.container).getByDisplayValue('Vom KP erfasst'), { target: { value: 'Erster Stand' } })
    await tick()
    fireEvent.change(within(second.container).getByDisplayValue('Vom KP erfasst'), { target: { value: 'Notiz im zweiten Tab' } })
    await act(async () => { acknowledge() })
    first.unmount()
    second.unmount()
    await openReport('link-a', 'report-a', 'Erster Stand')
    fireEvent.click(screen.getByRole('button', { name: 'Entwurf vom Gerät verwenden' }))
    expect(screen.getByDisplayValue('Notiz im zweiten Tab')).toBeInTheDocument()
  })

  it.each(['autosave', 'submit', 'reopen'])('retries a reverted field after a response is lost (%s)', async path => {
    vi.useFakeTimers()
    const first = await openReport('link-a', 'report-a', 'A')
    saveRekoDraft.mockRejectedValueOnce(new TypeError('Server saved B, response lost'))
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
    await tick()
    expect(saveRekoDraft).toHaveBeenCalledWith('same-incident', 'link-a', { summary_text: 'B' })
    fireEvent.change(screen.getByDisplayValue('B'), { target: { value: 'A' } })
    if (path === 'reopen') {
      first.unmount()
      await openReport('link-a', 'report-a', 'B')
      expect(screen.getByDisplayValue('A')).toBeInTheDocument()
    }
    if (path === 'submit') {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reko-Bericht übermitteln' })) })
      expect(submitRekoReport).toHaveBeenCalledWith('same-incident', 'link-a', { summary_text: 'A' })
    } else {
        await tick()
      expect(saveRekoDraft).toHaveBeenLastCalledWith('same-incident', 'link-a', { summary_text: 'A' })
    }
  })

  it('reopens a reverted edit when both the first response and the correction were lost', async () => {
    vi.useFakeTimers()
    const first = await openReport('link-a', 'report-a', 'A')
    saveRekoDraft.mockRejectedValueOnce(new TypeError('B landed but the response was lost'))
      .mockRejectedValueOnce(new TypeError('A never reached the server'))
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
    await tick()
    fireEvent.change(screen.getByDisplayValue('B'), { target: { value: 'A' } })
    await tick()
    first.unmount()
    await openReport('link-a', 'report-a', 'B')
    expect(screen.getByDisplayValue('A')).toBeInTheDocument()
    await tick()
    expect(saveRekoDraft).toHaveBeenLastCalledWith('same-incident', 'link-a', { summary_text: 'A' })
  })

  it('lets the crew recover each unsent version without erasing the other one', async () => {
    vi.useFakeTimers()
    const first = await openReport('link-a', 'report-a')
    const second = await openReport('link-a', 'report-a')
    fireEvent.change(within(first.container).getByDisplayValue('Vom KP erfasst'), { target: { value: 'Westseite' } })
    fireEvent.change(within(second.container).getByDisplayValue('Vom KP erfasst'), { target: { value: 'Ostseite' } })
    first.unmount()
    second.unmount()
    const chooser = await openReport('link-a', 'report-a')
    expect(screen.getByRole('button', { name: /Ostseite/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Westseite/ }))
    await tick()
    expect(saveRekoDraft).toHaveBeenLastCalledWith('same-incident', 'link-a', { summary_text: 'Westseite' })
    chooser.unmount()
    await openReport('link-a', 'report-a', 'Westseite')
    fireEvent.click(screen.getByRole('button', { name: 'Entwurf vom Gerät verwenden' }))
    await tick()
    expect(saveRekoDraft).toHaveBeenLastCalledWith('same-incident', 'link-a', { summary_text: 'Ostseite' })
  })

  it('retires an acknowledged draft even if the editor unmounted while its save was in flight', async () => {
    vi.useFakeTimers()
    const view = await openReport('link-a', 'report-a', 'A')
    let acknowledge!: () => void
    saveRekoDraft.mockImplementationOnce((...args: Parameters<typeof serverAnswer>) =>
      new Promise(resolve => { acknowledge = () => resolve(serverAnswer(...args)) }))
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
    await tick()
    view.unmount()
    await act(async () => { acknowledge() })
    await openReport('link-a', 'report-a', 'Spätere Meldung vom KP')
    expect(screen.getByDisplayValue('Spätere Meldung vom KP')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entwurf vom Gerät verwenden' })).toBeNull()
  })

  it('retries a restored hazard without sending any untouched hazard', async () => {
    vi.useFakeTimers()
    await openReport('link-a', 'report-a')
    const hazard = screen.getByRole('checkbox', { name: 'Brandgefahr' })
    saveRekoDraft.mockRejectedValueOnce(new TypeError('First acknowledgement lost'))
    fireEvent.click(hazard)
    await tick()
    expect(saveRekoDraft).toHaveBeenCalledWith('same-incident', 'link-a', { dangers_json: { fire_danger: true } })
    fireEvent.click(hazard)
    await tick()
    expect(saveRekoDraft).toHaveBeenLastCalledWith('same-incident', 'link-a', { dangers_json: { fire_danger: false } })
  })

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
    const link = formLink('jti-a')
    localStorage.setItem('reko-report-draft-report-a@link-jti-a/offline', JSON.stringify({
      previous: { summary_text: 'Alter Stand' }, changes: { summary_text: 'Notizen vom Gerät' },
    }))
    await openReport(link, 'report-a')
    await tick()
    expect(saveRekoDraft).not.toHaveBeenCalled()
    expect(localStorage.getItem('reko-report-draft-report-a@link-jti-a/offline')).toContain('Notizen vom Gerät')
    fireEvent.click(screen.getByRole('button', { name: 'Entwurf vom Gerät verwenden' }))
    expect(screen.getByDisplayValue('Notizen vom Gerät')).toBeInTheDocument()
    await tick()
    expect(saveRekoDraft).toHaveBeenCalledWith('same-incident', link, { summary_text: 'Notizen vom Gerät' })
    expect(localStorage.getItem('reko-report-draft-report-a@link-jti-a/offline')).toBeNull()
  })

  it('recovers only this report’s edits and sends only changed fields once', async () => {
    vi.useFakeTimers()
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

  // Sol review G round 2, S1: one report per incident, but a phone handed on is a new author.
  it('does not restore what another person left unsent on this phone', async () => {
    vi.useFakeTimers()
    const first = await openReport('link-a', 'report-a', 'Vom KP erfasst', 'person-a')
    fireEvent.change(screen.getByDisplayValue('Vom KP erfasst'), { target: { value: 'Notiz von A' } })
    first.unmount()
    const next = await openReport('link-b', 'report-a', 'Vom KP erfasst', 'person-b')
    expect(screen.getByDisplayValue('Vom KP erfasst')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entwurf vom Gerät verwenden' })).toBeNull()
    await tick()
    expect(saveRekoDraft).not.toHaveBeenCalled()
    next.unmount()
    await openReport('link-a', 'report-a', 'Vom KP erfasst', 'person-a')
    expect(screen.getByDisplayValue('Notiz von A')).toBeInTheDocument()
  })

  // Round 3, S3: two links that name nobody, issued apart, are two people – keyed by the link's
  // `jti`, never by the token itself.
  it('does not restore what another unnamed link left unsent on this phone', async () => {
    vi.useFakeTimers()
    const first = await openReport(formLink('jti-a'), 'report-a')
    fireEvent.change(screen.getByDisplayValue('Vom KP erfasst'), { target: { value: 'Notiz über Link A' } })
    first.unmount()
    expect(Object.keys(localStorage).every(key => !key.includes(formLink('jti-a')))).toBe(true)
    const next = await openReport(formLink('jti-b'), 'report-a')
    expect(screen.getByDisplayValue('Vom KP erfasst')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entwurf vom Gerät verwenden' })).toBeNull()
    next.unmount()
    await openReport(formLink('jti-a'), 'report-a')
    expect(screen.getByDisplayValue('Notiz über Link A')).toBeInTheDocument()
  })

  // S2: the KP edits the same report – a save's answer brings that in, unsent typing stays.
  it('takes the KP’s edits from a save’s answer and keeps what is typed meanwhile', async () => {
    vi.useFakeTimers()
    await openReport('link-a', 'report-a', 'A')
    let acknowledge!: () => void
    saveRekoDraft.mockImplementationOnce((...args: Parameters<typeof serverAnswer>) =>
      new Promise(resolve => { acknowledge = () => resolve(serverAnswer(...args)) }))
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
    await tick()
    fireEvent.change(screen.getByDisplayValue('B'), { target: { value: 'C' } })
    row = { ...row, additional_notes: 'Zufahrt über Hof (KP)' }
    await act(async () => { acknowledge() })
    expect(screen.getByDisplayValue('Zufahrt über Hof (KP)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('C')).toBeInTheDocument()
    await tick()
    expect(saveRekoDraft).toHaveBeenLastCalledWith('same-incident', 'link-a', { summary_text: 'C' })
  })

  // Round 3, S4: the KP's photo changes arrive with a save's answer; what this phone uploaded
  // or deleted while that save was out stays.
  it('takes the photo list from a save’s answer and keeps photo changes made meanwhile', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close() {} })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['x'])))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:neu')
    try {
      const view = await openReport('link-a', 'report-a', 'A')
      row = { ...row, photos_json: ['eigen.jpg', 'weg-kp.jpg'] }
      view.unmount()
      getRekoForm.mockResolvedValueOnce(row)
      const { container } = renderWithIntl(<RekoForm />)
      await act(async () => {})
      let acknowledge!: () => void
      saveRekoDraft.mockImplementationOnce((...args: Parameters<typeof serverAnswer>) =>
        new Promise(resolve => { acknowledge = () => resolve(serverAnswer(...args)) }))
      fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
      await tick()
      // While the save is out: this phone deletes one photo and uploads another; the KP deletes
      // one and adds one – the answer was read before this phone's two landed.
      deleteRekoPhoto.mockResolvedValueOnce(undefined)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Foto 1 verwerfen' })) })
      uploadRekoPhoto.mockResolvedValueOnce({ filename: 'neu.jpg' })
      const input = container.querySelector('input[type="file"]:not([capture])') as HTMLInputElement
      await act(async () => {
        fireEvent.change(input, { target: { files: [new File(['x'], 'neu.png', { type: 'image/png' })] } })
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      row = { ...row, photos_json: ['eigen.jpg', 'kp.jpg'] }
      await act(async () => { acknowledge() })
      // A server photo by its name in the link's URL; this phone's upload by its local preview.
      const shown = screen.getAllByRole('img', { name: /^Foto \d+$/ }).map(img => {
        const src = decodeURIComponent(img.getAttribute('src') ?? '')
        return src.match(/photos\/same-incident\/([^?]+)/)?.[1] ?? src
      })
      expect(shown).toEqual(['kp.jpg', 'blob:neu'])
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  // S3: the /reko page has no incident surface around it – the form brings its own viewer.
  it('opens a photo in the viewer through the link’s own door, logged as a full view', async () => {
    params.value = new URLSearchParams({ incident_id: 'same-incident', token: 'link-a' })
    getRekoForm.mockResolvedValueOnce({ id: 'report-a', photos_json: ['keller.jpg'], updated_at: '2025-01-01T00:00:00Z' })
    renderWithIntl(<RekoForm />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Foto 1 öffnen' }))
    const viewer = screen.getByTestId('photo-viewer')
    const src = decodeURIComponent(within(viewer).getAllByRole('img')[0].getAttribute('src') ?? '')
    expect(src).toContain('/api/photos/same-incident/keller.jpg?reko_token=link-a&view=full')
  })
})

describe('after the report is sent', () => {
  afterEach(() => {
    submitRekoReport.mockReset()
    router.push.mockReset()
    router.replace.mockReset()
    unmutedToast.mockReset()
    localStorage.clear()
    vi.useRealTimers()
  })

  async function submitFrom(returnTo: string | null) {
    params.value = new URLSearchParams({ incident_id: 'inc-1', token: 'link-a', ...(returnTo ? { return_to: returnTo } : {}) })
    getRekoForm.mockResolvedValueOnce({
      id: 'report-a', summary_text: 'Keller unter Wasser', is_relevant: true,
      incident_location: 'Bahnhofstrasse 22', updated_at: '2025-01-01T00:00:00Z',
    })
    submitRekoReport.mockResolvedValue({})
    renderWithIntl(<RekoForm />)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reko-Bericht übermitteln' })) })
  }

  // Owner, 19.11.2026: from /feld straight back to the list, the receipt as a toast.
  it('goes straight back to /feld with a receipt toast when opened from there', async () => {
    await submitFrom('/feld?token=door')
    expect(unmutedToast).toHaveBeenCalledWith('Reko-Bericht übermittelt', expect.objectContaining({ description: 'Bahnhofstrasse 22' }))
    expect(router.replace).toHaveBeenCalledWith('/feld?token=door')
    expect(router.push).not.toHaveBeenCalled()
  })

  it.each([null, 'https://example.com', '//example.com'])('keeps the success page for a link without a way home (%s)', async (returnTo) => {
    vi.useFakeTimers()
    await submitFrom(returnTo)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(router.push).toHaveBeenCalledWith('/reko/success?ort=Bahnhofstrasse+22')
    expect(router.replace).not.toHaveBeenCalled()
    expect(unmutedToast).not.toHaveBeenCalled()
  })
})

// 9C (phone sweep 24.11.2026): what the KP has and the send ride in one fixed footer.
describe('the fixed footer', () => {
  afterEach(() => {
    saveRekoDraft.mockReset()
    localStorage.clear()
    vi.useRealTimers()
  })

  it('says what the KP has beside «übermitteln», and offers «Jetzt senden» when a save fails', async () => {
    vi.useFakeTimers()
    params.value = new URLSearchParams({ incident_id: 'footer-incident', token: 'link-f' })
    getRekoForm.mockResolvedValueOnce({ id: 'report-f', summary_text: 'A', is_relevant: true, updated_at: '2025-01-01T00:00:00Z' })
    renderWithIntl(<RekoForm />)
    await act(async () => {})
    const footer = () => document.querySelector('[data-slot="link-page-footer"]') as HTMLElement
    expect(within(footer()).getByRole('button', { name: 'Reko-Bericht übermitteln' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ich bin vor Ort/ })).not.toHaveClass('bg-action')

    // The server answers with the saved row (the form takes its answer as the new base).
    saveRekoDraft.mockImplementationOnce(async (_incident: string, _token: string, changes: Record<string, unknown>) => ({
      id: 'report-f', summary_text: 'A', is_relevant: true, updated_at: '2025-01-01T00:00:00Z', ...changes,
    }))
    fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(footer()).toHaveTextContent(/Beim KP – Stand \d\d:\d\d/)

    saveRekoDraft.mockRejectedValueOnce(new TypeError('lost'))
    fireEvent.change(screen.getByDisplayValue('B'), { target: { value: 'C' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(footer()).toHaveTextContent('Der KP sieht das noch nicht')
    expect(within(footer()).getByRole('button', { name: 'Jetzt senden' })).toBeEnabled()
  })

  it('says «Kein Netz» as soon as there is something unsent offline, not at the next save', async () => {
    params.value = new URLSearchParams({ incident_id: 'footer-offline', token: 'link-o' })
    getRekoForm.mockResolvedValueOnce({ id: 'report-o', summary_text: 'A', is_relevant: true, updated_at: '2025-01-01T00:00:00Z' })
    renderWithIntl(<RekoForm />)
    await act(async () => {})
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await act(async () => { window.dispatchEvent(new Event('offline')) })
      fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'B' } })
      expect(document.querySelector('[data-slot="link-page-footer"]')).toHaveTextContent('Kein Netz')
      expect(saveRekoDraft).not.toHaveBeenCalled()
    } finally {
      onLine.mockRestore()
    }
  })
})
