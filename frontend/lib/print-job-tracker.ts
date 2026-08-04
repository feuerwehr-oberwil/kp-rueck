/**
 * Follow a queued print job and replace its "gesendet" toast with the outcome.
 *
 * The old behaviour confirmed that a slip had been *queued* and stopped there. If
 * the paper was out, the agent marked the job `failed` with an `error_message`
 * that only ever appeared under Einstellungen → Drucker — so the operator read
 * "gesendet", walked to the printer, and found nothing.
 *
 * The backend now broadcasts `print_job_update` on claim and on completion
 * (`websocket_manager.broadcast_print_job_update`). This module keeps the toast
 * for a queued job alive until that answer arrives, and puts a bounded, honest
 * message on screen when it never does. There is deliberately no polling: the
 * socket already carries incident, driver and assignment updates, and a second
 * mechanism for one more entity would be a second thing to keep working.
 */

import { toast } from 'sonner'
import { wsClient, type WebSocketUpdate } from './websocket-client'

export type PrintJobEventStatus = 'pending' | 'printing' | 'completed' | 'failed'

/** The status envelope broadcast on `print_job_update` (see `api/print.py`). */
export interface PrintJobEvent {
  id: string
  job_type: string
  status: PrintJobEventStatus
  incident_id: string | null
  event_id: string | null
  error_message: string | null
  retry_count: number
  /** The reaper will requeue this failure — another attempt is already coming. */
  will_retry: boolean
}

/** Pre-resolved German (or overlay) strings; this module never touches i18n itself. */
export interface PrintJobToastCopy {
  completed: string
  /** Printed, but on a fallback destination — the paper is somewhere else. */
  completedFallback: string
  failed: string
  failedRetry: string
  unknownError: string
  notPickedUp: string
  notPickedUpHint: string
  offline: string
  offlineHint: string
  noResult: string
  noResultHint: string
  checkPrinter: string
}

export interface TrackPrintJobOptions {
  /** Title of the "queued" toast, e.g. "Druckauftrag gesendet". */
  sentTitle: string
  /** Optional second line on the "queued" toast only. */
  sentDescription?: string
  /** Short noun for *what* was printed, shown as the description on the outcome. */
  subject?: string
  /** Opens Einstellungen → Drucker; wired to the router by `usePrintJobToast`. */
  onOpenPrinterSettings?: () => void
}

// A live agent long-polls and is woken by the queue signal, so it claims within
// about a second. 25s is a wide margin over that and still short enough that the
// operator learns "nobody picked this up" while standing at the printer rather
// than after the incident. It is a warning, not a verdict: if the agent turns up
// late, the claim/completion still replaces the toast.
export const PICKUP_TIMEOUT_MS = 25_000
// Claimed but silent. The backend reaper calls a claim lost after 120s; warning a
// bit earlier keeps the operator ahead of it instead of behind.
export const RESULT_TIMEOUT_MS = 90_000
// Hard stop. After this the job is no longer any toast's business — the queue page
// owns it. Without this the map would grow for the lifetime of the tab.
export const GIVE_UP_MS = 150_000

// Sonner keeps a toast addressable by id, so every later message for the same job
// replaces the earlier one instead of stacking a second card next to it.
const toastId = (jobId: string) => `print-job:${jobId}`

interface TrackedJob {
  copy: PrintJobToastCopy
  options: TrackPrintJobOptions
  claimed: boolean
  pickupTimer: ReturnType<typeof setTimeout>
  resultTimer: ReturnType<typeof setTimeout>
  giveUpTimer: ReturnType<typeof setTimeout>
}

const tracked = new Map<string, TrackedJob>()
let unsubscribe: (() => void) | null = null

function untrack(jobId: string) {
  const entry = tracked.get(jobId)
  if (!entry) return
  clearTimeout(entry.pickupTimer)
  clearTimeout(entry.resultTimer)
  clearTimeout(entry.giveUpTimer)
  tracked.delete(jobId)
  if (tracked.size === 0 && unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}

function printerAction(entry: TrackedJob) {
  return entry.options.onOpenPrinterSettings
    ? { label: entry.copy.checkPrinter, onClick: entry.options.onOpenPrinterSettings }
    : undefined
}

function describe(entry: TrackedJob, detail?: string | null): string | undefined {
  const { subject } = entry.options
  if (subject && detail) return `${subject}: ${detail}`
  return detail || subject || undefined
}

function applyEvent(entry: TrackedJob, job: PrintJobEvent) {
  const id = toastId(job.id)

  if (job.status === 'printing') {
    // Deliberately no new toast: a claim is usually milliseconds ahead of the
    // result, and a card that flickers through an intermediate state is noise in
    // a room where calm is the point. What the claim buys is the knowledge that
    // the agent is alive — which is what the timeouts below branch on.
    entry.claimed = true
    clearTimeout(entry.pickupTimer)
    return
  }

  if (job.status === 'completed' && job.error_message?.trim()) {
    // Completed WITH a message means the chain fell over: the paper exists, but not on the
    // printer anybody is standing at. A success toast would be true and useless — nobody
    // would go and fetch it, and nobody would learn the main printer is dead.
    toast.warning(entry.copy.completedFallback, {
      id,
      description: describe(entry, job.error_message.trim()),
      duration: Infinity,
      action: printerAction(entry),
    })
    untrack(job.id)
    return
  }

  if (job.status === 'completed') {
    // "An Drucker gesendet", not "Gedruckt". For the thermal path this status means the
    // ESC/POS bytes were accepted by the socket — nothing more. A TM-T20III that is out of
    // paper still absorbs a small slip into its buffer and closes the write cleanly, so the
    // single most likely printer failure is the one that reports success. Until the agent
    // queries real paper status (DLE EOT), the UI must not assert paper exists.
    toast.success(entry.copy.completed, { id, description: describe(entry) })
    untrack(job.id)
    return
  }

  if (job.status === 'failed') {
    // The agent's own words — "Papier leer" and "Drucker nicht erreichbar" are
    // different problems with different responses, and the operator has seconds.
    const reason = job.error_message?.trim() || entry.copy.unknownError
    toast.error(job.will_retry ? entry.copy.failedRetry : entry.copy.failed, {
      id,
      description: describe(entry, reason),
      duration: Infinity,
      action: printerAction(entry),
    })
    // A retry keeps the job alive, so keep listening: a successful second attempt
    // replaces this error with the success copy on the same card.
    if (!job.will_retry) untrack(job.id)
  }
}

function ensureSubscribed() {
  if (unsubscribe) return
  unsubscribe = wsClient.on('print_job_update', (update: WebSocketUpdate<PrintJobEvent>) => {
    const job = update?.data
    if (!job?.id) return
    const entry = tracked.get(job.id)
    if (!entry) return // someone else's print job — their client owns that toast
    applyEvent(entry, job)
  })
}

/**
 * Show the "queued" toast for `jobId` and replace it with the printer's answer.
 *
 * Returns a function that stops tracking (used by tests; components do not need it —
 * the tracker cleans up on the outcome or on the hard stop).
 */
export function trackPrintJob(
  jobId: string,
  copy: PrintJobToastCopy,
  options: TrackPrintJobOptions
): () => void {
  untrack(jobId)

  const id = toastId(jobId)
  toast.success(options.sentTitle, { id, description: options.sentDescription })

  const entry: TrackedJob = {
    copy,
    options,
    claimed: false,
    pickupTimer: setTimeout(() => {
      const current = tracked.get(jobId)
      if (!current || current.claimed) return
      // Two different silences, and conflating them would send the operator to the
      // wrong place: a dead socket means we simply cannot see the answer, a live
      // socket with no claim means nothing is draining the queue.
      const offline = !wsClient.isConnected()
      toast.warning(offline ? current.copy.offline : current.copy.notPickedUp, {
        id,
        description: offline ? current.copy.offlineHint : current.copy.notPickedUpHint,
        duration: Infinity,
        action: printerAction(current),
      })
    }, PICKUP_TIMEOUT_MS),
    resultTimer: setTimeout(() => {
      const current = tracked.get(jobId)
      if (!current || !current.claimed) return
      toast.warning(current.copy.noResult, {
        id,
        description: current.copy.noResultHint,
        duration: Infinity,
        action: printerAction(current),
      })
    }, RESULT_TIMEOUT_MS),
    giveUpTimer: setTimeout(() => untrack(jobId), GIVE_UP_MS),
  }

  tracked.set(jobId, entry)
  ensureSubscribed()

  return () => untrack(jobId)
}

/** Test seam: drop all tracking and the socket subscription. */
export function resetPrintJobTracking() {
  for (const jobId of Array.from(tracked.keys())) untrack(jobId)
}
