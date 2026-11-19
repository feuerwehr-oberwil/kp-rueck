'use client'

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { SyncState } from '@/components/kanban/field-save-status'
import { toRekoFormData, type RekoFormData } from '@/components/reko/reko-report-form'
import { apiClient, type ApiRekoReportResponse, type ApiRekoReportUpdate } from '@/lib/api-client'
import { classifySaveFailure } from '@/lib/field-save'

/** How long the form waits after the last edit before it saves – one request per pause,
 *  not one per keystroke. */
export const REKO_SAVE_DELAY_MS = 600

/**
 * One operator's auto-save of one Einsatz's Reko form. It lives at module level, keyed by
 * user + Einsatz, not in the component: closing the incident detail or switching tabs
 * unmounts the form while a save may still be waiting or in flight, and the next mount must
 * see that save – its row, its newest form – or it opens from a list read that raced the save
 * and writes the old text back with the next field (Sol review pass 2, S1).
 */
interface AutosaveSession {
  /** The row the edits go to; null until the first save created the draft. */
  target: string | null
  /** The newest form this operator gave; null until the first edit. */
  latest: RekoFormData | null
  /** The form as the server last had it from this session's view: what it was opened with,
   *  then what each save sent. A save sends only what differs from it (`changedFields`). */
  baseline: RekoFormData
  version: number
  /** The version the server confirmed last, and the `updated_at` it answered with. */
  confirmed: { version: number; updatedAt: string | null }
  inFlight: boolean
  timer: ReturnType<typeof setTimeout> | null
  state: SyncState
  /** Mounted forms: their state subscriptions and `onSettled` reloads. */
  listeners: Set<() => void>
  settled: Set<() => void>
  mounts: number
}

const sessions = new Map<string, AutosaveSession>()

function sessionFor(key: string): AutosaveSession {
  let session = sessions.get(key)
  if (!session) {
    session = {
      target: null, latest: null, baseline: toRekoFormData(null), version: 0,
      confirmed: { version: 0, updatedAt: null },
      inFlight: false, timer: null, state: { status: 'idle' },
      listeners: new Set(), settled: new Set(), mounts: 0,
    }
    sessions.set(key, session)
  }
  return session
}

/**
 * The answers `next` changed against `base` – top-level fields, and within dangers and
 * effort the single keys. Absent means untouched on the server (`update_reko_report`
 * merges), so a form opened blank never sends the blanks it did not touch over somebody
 * else's report (Sol review pass 3, S2). No photo list: upload and delete own it (S5).
 */
export function changedFields(base: RekoFormData, next: RekoFormData): ApiRekoReportUpdate {
  const changes: ApiRekoReportUpdate = {}
  if (next.is_relevant !== base.is_relevant) changes.is_relevant = next.is_relevant
  if (next.power_supply !== base.power_supply) changes.power_supply = next.power_supply
  if (next.summary_text !== base.summary_text) changes.summary_text = next.summary_text
  if (next.additional_notes !== base.additional_notes) changes.additional_notes = next.additional_notes
  const changedKeys = <T extends object>(from: T, to: T): Partial<T> | null => {
    const keys = (Object.keys(to) as (keyof T)[]).filter(key => JSON.stringify(to[key]) !== JSON.stringify(from[key]))
    return keys.length ? Object.fromEntries(keys.map(key => [key, to[key]])) as Partial<T> : null
  }
  const dangers = changedKeys(base.dangers_json, next.dangers_json)
  if (dangers) changes.dangers_json = dangers
  const effort = changedKeys(base.effort_json, next.effort_json)
  if (effort) changes.effort_json = effort
  return changes
}

function setState(session: AutosaveSession, state: SyncState) {
  session.state = state
  for (const listener of session.listeners) listener()
}

/** Forget a session nobody shows and nothing is left in: no mount, no waiting or running
 *  save, no failed edit kept for «Erneut synchronisieren». A later mount reads the list after
 *  the last save committed, so it opens from the server's row. */
function releaseIfDone(key: string, session: AutosaveSession) {
  const done = session.mounts === 0 && !session.timer && !session.inFlight
    && session.state.status !== 'failed' && session.confirmed.version === session.version
  if (done && sessions.get(key) === session) sessions.delete(key)
}

/**
 * The board's Reko form saves as it goes (owner pick 19.11.2026, #30) – no save button.
 *
 * `resume(source)` on opening names the row the edits go to: the filed report being amended,
 * the operator's own KP draft, or null – then the first save creates the draft
 * (`POST /api/reko/?submit=false`) and every later one PATCHes it (`submit=false`). The draft
 * is filed on the server, not here: by the card's move to «Reko abgeschlossen»
 * (`crud.reko.submit_kp_reko_drafts`), or – on a card already there – by the save that
 * answers «Einsatz relevant?» (`api/reko._kp_draft_files_now`).
 *
 * `schedule(data)` after every change; one request at a time, the newest form always last,
 * so the server sees the edits in order. «Synchronisiert» only once the save carrying the
 * NEWEST form answered; then every mounted form's `onSettled` runs (the section reloads – a
 * read issued before that could still return the old row). A failure waits for `retry()` or
 * the next edit – no automatic resend (`lib/field-save`). `flush()` sends a waiting save now.
 *
 * Each save sends only the answers changed since the form was opened or last saved
 * (`changedFields`), so two boards on one report never undo each other's untouched answers.
 *
 * The newest form outlives closing the form AND the form's mount (`AutosaveSession`):
 * `resume(source)` hands it back while it is not confirmed yet (waiting, in flight, failed),
 * or while the server's copy is not newer than what the last save got back – the list may not
 * have caught up. Otherwise it adopts `source` and returns the form opened from it.
 */
export function useRekoAutosave(incidentId: string, userId: string | null, onSettled?: () => void) {
  const key = `${userId ?? ''}:${incidentId}`
  const session = useMemo(() => sessionFor(key), [key])

  const subscribe = useCallback((listener: () => void) => {
    session.listeners.add(listener)
    return () => {
      session.listeners.delete(listener)
    }
  }, [session])
  const state = useSyncExternalStore(subscribe, () => session.state, () => session.state)

  const send = useCallback(async (): Promise<void> => {
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    const data = session.latest
    if (session.inFlight || !data) return
    const sent = session.version
    session.inFlight = true
    setState(session, { status: 'saving' })
    try {
      // Only what this form changed; no token, the session is the identity.
      const payload = changedFields(session.baseline, data)
      const report = session.target
        ? await apiClient.updateRekoReport(session.target, payload)
        : await apiClient.createRekoReportAsEditor(incidentId, payload, false)
      session.target = report.id
      session.baseline = data
      session.inFlight = false
      session.confirmed = { version: sent, updatedAt: report.updated_at ?? null }
      if (session.version === sent) {
        setState(session, { status: 'saved', savedAt: new Date() })
        for (const reload of session.settled) reload()
        releaseIfDone(key, session)
      } else await send()
    } catch (error) {
      session.inFlight = false
      setState(session, { status: 'failed', reason: classifySaveFailure(error) })
    }
  }, [incidentId, key, session])

  // This mount counts, and its reload runs when a save settles – also one a previous mount
  // started.
  useEffect(() => {
    session.mounts += 1
    return () => {
      session.mounts -= 1
      // A form unmounted with a save still waiting sends it now rather than in 600 ms.
      if (session.timer) void send()
      releaseIfDone(key, session)
    }
  }, [key, session, send])
  useEffect(() => {
    if (!onSettled) return
    session.settled.add(onSettled)
    return () => {
      session.settled.delete(onSettled)
    }
  }, [session, onSettled])

  const resume = useCallback((source: ApiRekoReportResponse | null): RekoFormData => {
    const local = session.latest
    if (local) {
      const unconfirmed = session.confirmed.version !== session.version
      const serverNotNewer =
        !source ||
        (source.id === session.target && !!session.confirmed.updatedAt && source.updated_at <= session.confirmed.updatedAt)
      if (unconfirmed || serverNotNewer) return local
    }
    const opened = toRekoFormData(source)
    session.target = source?.id ?? null
    session.latest = null
    session.baseline = opened
    session.confirmed = { version: session.version, updatedAt: null }
    setState(session, { status: 'idle' })
    return opened
  }, [session])

  const schedule = useCallback((data: RekoFormData) => {
    session.latest = data
    session.version += 1
    setState(session, { status: 'saving' })
    if (session.timer) clearTimeout(session.timer)
    session.timer = setTimeout(() => void send(), REKO_SAVE_DELAY_MS)
  }, [session, send])

  /** Send a waiting save now. Whether a save is still on its way (it settles later). */
  const flush = useCallback((): boolean => {
    if (session.timer) void send()
    return session.inFlight
  }, [session, send])

  return {
    state,
    resume,
    schedule,
    flush,
    retry: send,
    /** The row the edits go to – the photo door attaches to it. */
    reportId: useCallback(() => session.target, [session]),
  }
}
