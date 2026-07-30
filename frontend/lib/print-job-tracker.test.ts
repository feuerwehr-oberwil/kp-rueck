import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}))

type WsHandler = (update: { action: string; data: unknown }) => void
let wsHandlers: WsHandler[] = []
const wsConnected = { value: true }

vi.mock('./websocket-client', () => ({
  wsClient: {
    on: (event: string, cb: WsHandler) => {
      if (event !== 'print_job_update') throw new Error(`unexpected event ${event}`)
      wsHandlers.push(cb)
      return () => {
        wsHandlers = wsHandlers.filter((h) => h !== cb)
      }
    },
    isConnected: () => wsConnected.value,
  },
}))

import {
  trackPrintJob,
  resetPrintJobTracking,
  PICKUP_TIMEOUT_MS,
  RESULT_TIMEOUT_MS,
  type PrintJobEvent,
  type PrintJobToastCopy,
} from './print-job-tracker'

const copy: PrintJobToastCopy = {
  completed: 'Gedruckt',
  failed: 'Druck fehlgeschlagen',
  failedRetry: 'Druck fehlgeschlagen – neuer Versuch läuft',
  unknownError: 'Grund unbekannt',
  notPickedUp: 'Druckdienst antwortet nicht',
  notPickedUpHint: 'wartet in der Warteschlange',
  offline: 'Druckergebnis unbekannt',
  offlineHint: 'keine Echtzeitverbindung',
  noResult: 'Keine Rückmeldung vom Drucker',
  noResultHint: 'abgeholt, aber nicht bestätigt',
  checkPrinter: 'Drucker prüfen',
}

const JOB_ID = 'job-1'
const TOAST_ID = `print-job:${JOB_ID}`

function emit(job: Partial<PrintJobEvent> & { status: PrintJobEvent['status'] }) {
  const full: PrintJobEvent = {
    id: JOB_ID,
    job_type: 'assignment',
    incident_id: null,
    event_id: null,
    error_message: null,
    retry_count: 0,
    will_retry: false,
    ...job,
  }
  wsHandlers.forEach((h) => h({ action: 'update', data: full }))
}

function track(overrides: Partial<Parameters<typeof trackPrintJob>[2]> = {}) {
  return trackPrintJob(JOB_ID, copy, {
    sentTitle: 'Druckauftrag gesendet',
    subject: 'Einsatzzettel',
    ...overrides,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  wsHandlers = []
  wsConnected.value = true
  toastSuccess.mockReset()
  toastError.mockReset()
  toastWarning.mockReset()
})

afterEach(() => {
  resetPrintJobTracking()
  vi.useRealTimers()
})

describe('trackPrintJob', () => {
  it('shows the "sent" toast under a stable id so later messages replace it', () => {
    track()
    expect(toastSuccess).toHaveBeenCalledWith('Druckauftrag gesendet', {
      id: TOAST_ID,
      description: undefined,
    })
  })

  it('queued → completed replaces the toast with the printed confirmation', () => {
    track()
    toastSuccess.mockClear()

    emit({ status: 'printing' })
    // A claim is not worth a card of its own — it only proves the agent is alive.
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()

    emit({ status: 'completed' })
    expect(toastSuccess).toHaveBeenCalledWith('Gedruckt', {
      id: TOAST_ID,
      description: 'Einsatzzettel',
    })
  })

  it('queued → failed surfaces the agent\'s own error message', () => {
    track()
    emit({ status: 'printing' })
    emit({ status: 'failed', error_message: 'Papier leer', retry_count: 3, will_retry: false })

    expect(toastError).toHaveBeenCalledTimes(1)
    const [title, options] = toastError.mock.calls[0] as [string, Record<string, unknown>]
    expect(title).toBe('Druck fehlgeschlagen')
    expect(options.id).toBe(TOAST_ID)
    expect(options.description).toBe('Einsatzzettel: Papier leer')
    expect(options.duration).toBe(Infinity)
  })

  it('says a retry is coming when the reaper will requeue', () => {
    track()
    emit({ status: 'failed', error_message: 'Drucker nicht erreichbar', retry_count: 1, will_retry: true })

    expect(toastError.mock.calls[0][0]).toBe('Druck fehlgeschlagen – neuer Versuch läuft')

    // Still tracked: a successful second attempt has to be able to replace the error.
    toastSuccess.mockClear()
    emit({ status: 'completed' })
    expect(toastSuccess).toHaveBeenCalledWith('Gedruckt', { id: TOAST_ID, description: 'Einsatzzettel' })
  })

  it('falls back to a readable reason when the agent sends none', () => {
    track()
    emit({ status: 'failed', error_message: '   ', will_retry: false })
    expect((toastError.mock.calls[0][1] as Record<string, unknown>).description).toBe(
      'Einsatzzettel: Grund unbekannt'
    )
  })

  it('agent absent: warns that nothing picked the job up, and offers the printer page', () => {
    const onOpenPrinterSettings = vi.fn()
    track({ onOpenPrinterSettings })

    vi.advanceTimersByTime(PICKUP_TIMEOUT_MS)

    expect(toastWarning).toHaveBeenCalledTimes(1)
    const [title, options] = toastWarning.mock.calls[0] as [string, Record<string, unknown>]
    expect(title).toBe('Druckdienst antwortet nicht')
    expect(options.description).toBe('wartet in der Warteschlange')
    expect(options.duration).toBe(Infinity)
    ;(options.action as { onClick: () => void }).onClick()
    expect(onOpenPrinterSettings).toHaveBeenCalled()
  })

  it('a late agent still overwrites the "not picked up" warning', () => {
    track()
    vi.advanceTimersByTime(PICKUP_TIMEOUT_MS)
    toastSuccess.mockClear()

    emit({ status: 'printing' })
    emit({ status: 'completed' })
    expect(toastSuccess).toHaveBeenCalledWith('Gedruckt', { id: TOAST_ID, description: 'Einsatzzettel' })
  })

  it('a dead socket is reported as an unknown result, not as a dead print service', () => {
    wsConnected.value = false
    track()
    vi.advanceTimersByTime(PICKUP_TIMEOUT_MS)
    expect(toastWarning.mock.calls[0][0]).toBe('Druckergebnis unbekannt')
  })

  it('claimed but silent: warns instead of spinning forever', () => {
    track()
    emit({ status: 'printing' })

    vi.advanceTimersByTime(PICKUP_TIMEOUT_MS)
    expect(toastWarning).not.toHaveBeenCalled() // the claim cancelled the pickup warning

    vi.advanceTimersByTime(RESULT_TIMEOUT_MS)
    expect(toastWarning).toHaveBeenCalledWith(
      'Keine Rückmeldung vom Drucker',
      expect.objectContaining({ id: TOAST_ID, description: 'abgeholt, aber nicht bestätigt' })
    )
  })

  it('ignores print jobs this client did not queue', () => {
    track()
    toastSuccess.mockClear()
    wsHandlers.forEach((h) =>
      h({ action: 'update', data: { id: 'someone-elses', status: 'failed', error_message: 'Papier leer' } })
    )
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('stops listening once the outcome is in', () => {
    track()
    emit({ status: 'completed' })
    expect(wsHandlers).toHaveLength(0)
  })
})
