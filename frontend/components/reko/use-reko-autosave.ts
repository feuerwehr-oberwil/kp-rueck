'use client'

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { SyncState } from '@/components/kanban/field-save-status'
import type { RekoFormData } from '@/components/reko/reko-report-form'
import { apiClient } from '@/lib/api-client'
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
      target: null, latest: null, version: 0, confirmed: { version: 0, updatedAt: null },
      inFlight: false, timer: null, state: { status: 'idle' },
      listeners: new Set(), settled: new Set(), mounts: 0,
    }
    sessions.set(key, session)
  }
  return session
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
 * The newest form outlives closing the form AND the form's mount (`AutosaveSession`):
 * `resume(source)` hands it back while it is not confirmed yet (waiting, in flight, failed),
 * or while the server's copy is not newer than what the last save got back – the list may not
 * have caught up. Otherwise it adopts `source` and returns null: open from the server's row.
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
      // The report's own fields; no token, the session is the identity. No photo list:
      // upload and delete own the membership server-side, and this form's copy may miss a
      // photo another operator just added (Sol review S5).
      const payload = {
        is_relevant: data.is_relevant,
        dangers_json: data.dangers_json,
        effort_json: data.effort_json,
        power_supply: data.power_supply,
        summary_text: data.summary_text,
        additional_notes: data.additional_notes,
      }
      const report = session.target
        ? await apiClient.updateRekoReport(session.target, payload)
        : await apiClient.createRekoReportAsEditor(incidentId, payload, false)
      session.target = report.id
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

  const resume = useCallback((source: { id: string; updated_at: string } | null): RekoFormData | null => {
    const local = session.latest
    if (local) {
      const unconfirmed = session.confirmed.version !== session.version
      const serverNotNewer =
        !source ||
        (source.id === session.target && !!session.confirmed.updatedAt && source.updated_at <= session.confirmed.updatedAt)
      if (unconfirmed || serverNotNewer) return local
    }
    session.target = source?.id ?? null
    session.latest = null
    session.confirmed = { version: session.version, updatedAt: null }
    setState(session, { status: 'idle' })
    return null
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
