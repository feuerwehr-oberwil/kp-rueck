'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import type { SyncState } from '@/components/kanban/field-save-status'
import { toRekoFormData, type RekoFormData } from '@/components/reko/reko-report-form'
import { apiClient, ApiError, type ApiRekoReportResponse } from '@/lib/api-client'
import { classifySaveFailure } from '@/lib/field-save'

/** How long the form waits after the last edit before it saves – one request per pause,
 *  not one per keystroke. */
export const REKO_SAVE_DELAY_MS = 600

/**
 * One operator's auto-save of the Einsatz's Reko report – one report per Einsatz since
 * 23.11.2026, so in practice one session per `user:incident`, found under `#new` until the
 * first save named the row and under its id after (Sol review pass 4, S3). It lives at module level, not in the component: closing the incident
 * detail or switching tabs unmounts the form while a save may still be waiting or in flight,
 * and the next mount must see that save – its row, its newest form – or it opens from a list
 * read that raced the save and writes the old text back with the next field (pass 2, S1).
 */
interface AutosaveSession {
  /** `user:incident` – what the reloads after a save are keyed by. */
  base: string
  /** The row the edits go to; null until the first save created the draft. */
  target: string | null
  /** The newest form: the server's row as last acknowledged, with this operator's edits
   *  that are not acknowledged yet on top. Null until the first edit. */
  latest: RekoFormData | null
  /** The form as the server has it: what it was opened with, then each save's answer. A save
   *  sends only what differs from it (`changedFields`). */
  baseline: RekoFormData
  version: number
  /** The version the server confirmed last, and the `updated_at` it answered with. */
  confirmed: { version: number; updatedAt: string | null }
  inFlight: boolean
  timer: ReturnType<typeof setTimeout> | null
  state: SyncState
  /** Mounted forms: their state subscriptions, and the open forms that take a save's
   *  answer (another board's answers) into what they show. */
  listeners: Set<() => void>
  adopters: Set<(form: RekoFormData) => void>
  mounts: number
}

/** Sessions by `user:incident#report` – a new draft's session is found under `#new` and,
 *  once its first save answered, under the draft's id as well. */
const sessions = new Map<string, AutosaveSession>()
/** The sections' list reloads, per `user:incident`: any of its sessions settling reloads. */
const reloads = new Map<string, Set<() => void>>()

const sessionKey = (base: string, reportId: string | null) => `${base}#${reportId ?? 'new'}`

function sessionFor(base: string, reportId: string | null): AutosaveSession {
  const key = sessionKey(base, reportId)
  let session = sessions.get(key)
  if (!session) {
    session = {
      base, target: reportId, latest: null, baseline: toRekoFormData(null), version: 0,
      confirmed: { version: 0, updatedAt: null },
      inFlight: false, timer: null, state: { status: 'idle' },
      listeners: new Set(), adopters: new Set(), mounts: 0,
    }
    sessions.set(key, session)
  }
  return session
}

/** What the form changed: top-level answers, and within dangers and effort the single keys. */
type RekoFormChanges = Partial<Omit<RekoFormData, 'photos_json' | 'dangers_json' | 'effort_json'>> & {
  dangers_json?: Partial<RekoFormData['dangers_json']>
  effort_json?: Partial<RekoFormData['effort_json']>
}

/**
 * The answers `next` changed against `base` – top-level fields, and within dangers and
 * effort the single keys. Absent means untouched on the server (`update_reko_report`
 * merges), so a form opened blank never sends the blanks it did not touch over somebody
 * else's report (Sol review pass 3, S2). No photo list: upload and delete own it (S5).
 */
export function changedFields(base: RekoFormData, next: RekoFormData): RekoFormChanges {
  const changes: RekoFormChanges = {}
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

/** `form` with `changes` laid over it – how edits made during a save survive its answer. */
function withChanges(form: RekoFormData, changes: RekoFormChanges): RekoFormData {
  const { dangers_json: dangers, effort_json: effort, ...answers } = changes
  return {
    ...form,
    ...answers,
    dangers_json: { ...form.dangers_json, ...dangers },
    effort_json: { ...form.effort_json, ...effort },
  }
}

function setState(session: AutosaveSession, state: SyncState) {
  session.state = state
  for (const listener of session.listeners) listener()
}

/** Forget a session nobody shows and nothing is left in: no mount, no waiting or running
 *  save, no failed edit kept for «Erneut synchronisieren». A later mount reads the list after
 *  the last save committed, so it opens from the server's row. */
function releaseIfDone(session: AutosaveSession) {
  const done = session.mounts === 0 && !session.timer && !session.inFlight
    && session.state.status !== 'failed' && session.confirmed.version === session.version
  if (!done) return
  for (const [key, held] of sessions) if (held === session) sessions.delete(key)
}

/**
 * One save of `session`'s newest form – to `session`'s own row, whatever the open form shows
 * meanwhile. One at a time per session, the newest form always last. Its answer becomes the
 * baseline and, with the edits made while it was on its way laid over it, the newest form –
 * so another board's answers reach the open form and the next save (pass 4, S4).
 */
async function sendSession(session: AutosaveSession, incidentId: string): Promise<void> {
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
    if (!session.target) sessions.set(sessionKey(session.base, report.id), session)
    session.target = report.id
    const server = toRekoFormData(report)
    const pending = session.latest ? changedFields(data, session.latest) : {}
    session.baseline = server
    session.latest = withChanges(server, pending)
    session.confirmed = { version: sent, updatedAt: report.updated_at ?? null }
    session.inFlight = false
    for (const adopt of session.adopters) adopt(session.latest)
    if (session.version === sent) {
      setState(session, { status: 'saved', savedAt: new Date() })
      for (const reload of reloads.get(session.base) ?? []) reload()
      releaseIfDone(session)
    } else await sendSession(session, incidentId)
  } catch (error) {
    session.inFlight = false
    setState(session, { status: 'failed', reason: classifySaveFailure(error) })
    // The card was merged away and its report hidden (409 `reko_report_merged`, Sol review G
    // S5): the 409 raises no toast of its own, and «inzwischen geändert» alone would not say where.
    if (error instanceof ApiError && error.code === 'reko_report_merged') toast.error(error.message)
  }
}

/**
 * The board's Reko form saves as it goes (owner pick 19.11.2026, #30) – no save button.
 *
 * `resume(source)` on opening names the row the edits go to: the Einsatz's one report (draft
 * or filed), or null – then the first save creates it (`POST /api/reko/?submit=false`, which
 * finds the report another board or the field created meanwhile) and every later one PATCHes
 * it (`submit=false`). `refresh(source)` takes a newer read of that report into the open form
 * (the field typed, another board saved) while this operator has nothing unsent. The draft
 * is filed on the server, not here: by the save that answers «Einsatz relevant?», like the
 * crew's submit (`api/reko._board_save_files_now`, owner pick #30). A status move files nothing.
 *
 * `schedule(data)` after every change; one request at a time, the newest form always last,
 * so the server sees the edits in order. «Synchronisiert» only once the save carrying the
 * NEWEST form answered; then every mounted section of the Einsatz reloads (`onSettled` – a
 * read issued before that could still return the old row). A failure waits for `retry()` or
 * the next edit – no automatic resend (`lib/field-save`). `flush()` sends a waiting save now.
 * Each save sends only the answers changed since its baseline (`changedFields`), so two
 * boards on one report never undo each other's untouched answers, and `onAdopt` gets the form
 * as the server answered it, with the edits made meanwhile on top.
 *
 * The newest form outlives closing the form AND the form's mount (`AutosaveSession`):
 * `resume(source)` hands it back while it is not confirmed yet (waiting, in flight, failed),
 * or while the list is older than the last save's answer. A row as new as that answer or
 * newer is taken as it is – it is the server's word, other boards' answers included.
 */
export function useRekoAutosave({ incidentId, userId, onSettled, onAdopt }: {
  incidentId: string
  userId: string | null
  /** Runs once a save of this Einsatz settled – the section reloads its list. */
  onSettled?: () => void
  /** The open form takes a save's answer (another board's answers, own edits on top). */
  onAdopt?: (form: RekoFormData) => void
}) {
  const base = `${userId ?? ''}:${incidentId}`
  const [reportId, setReportId] = useState<string | null>(null)
  const session = useMemo(() => sessionFor(base, reportId), [base, reportId])

  const subscribe = useCallback((listener: () => void) => {
    session.listeners.add(listener)
    return () => {
      session.listeners.delete(listener)
    }
  }, [session])
  const state = useSyncExternalStore(subscribe, () => session.state, () => session.state)

  const send = useCallback(() => sendSession(session, incidentId), [session, incidentId])

  // This mount counts for the session it shows.
  useEffect(() => {
    session.mounts += 1
    return () => {
      session.mounts -= 1
      // A form unmounted (or switched to another report) with a save still waiting sends it
      // now rather than in 600 ms – to its own row.
      if (session.timer) void sendSession(session, incidentId)
      // After the current commit: Strict Mode runs setup – cleanup – setup, and the second
      // setup must find the session still there, not an evicted one (Sol pass 3, S1).
      queueMicrotask(() => releaseIfDone(session))
    }
  }, [session, incidentId])
  useEffect(() => {
    if (!onSettled) return
    const set = reloads.get(base) ?? new Set<() => void>()
    reloads.set(base, set)
    set.add(onSettled)
    return () => {
      set.delete(onSettled)
      if (set.size === 0) reloads.delete(base)
    }
  }, [base, onSettled])
  useEffect(() => {
    if (!onAdopt) return
    session.adopters.add(onAdopt)
    return () => {
      session.adopters.delete(onAdopt)
    }
  }, [session, onAdopt])

  const resume = useCallback((source: ApiRekoReportResponse | null): RekoFormData => {
    // The list can show the row a first save created before that save's answer arrived. A
    // board first save resolves to the own draft or the newest board-filed report, so opening
    // such a row while a first save of this operator is still pending opens THAT session –
    // one writer per row, its queued edits in order (Sol review pass 5, S3).
    const pendingFirst = sessions.get(sessionKey(base, null))
    const boardRow = !!source?.created_by_user_id && !source.submitted_by_personnel_id
    if (source && boardRow && pendingFirst && !pendingFirst.target && !sessions.has(sessionKey(base, source.id))
      && (pendingFirst.inFlight || !!pendingFirst.timer || pendingFirst.confirmed.version !== pendingFirst.version)) {
      sessions.set(sessionKey(base, source.id), pendingFirst)
    }
    const opening = sessionFor(base, source?.id ?? null)
    setReportId(source?.id ?? null)
    const local = opening.latest
    if (local) {
      const unconfirmed = opening.confirmed.version !== opening.version
      const ackAt = opening.confirmed.updatedAt ? Date.parse(opening.confirmed.updatedAt) : null
      // The list read raced the last save: older than its answer, or without the new draft.
      const listBehind = !source || (ackAt !== null && Date.parse(source.updated_at) < ackAt)
      if (unconfirmed || listBehind) return local
    }
    const opened = toRekoFormData(source)
    opening.target = source?.id ?? null
    opening.latest = null
    opening.baseline = opened
    opening.confirmed = { version: opening.version, updatedAt: null }
    setState(opening, { status: 'idle' })
    return opened
  }, [base])

  /**
   * A newer read of the report, for the open form: the server's word becomes the baseline and
   * the form, unless this operator has an edit waiting, on its way or failed – then it waits
   * for the save's own answer (`onAdopt`). Keeps the sync line as it is. Null: not taken.
   */
  const refresh = useCallback((source: ApiRekoReportResponse | null): RekoFormData | null => {
    if (!source || session.timer || session.inFlight || session.state.status === 'failed'
      || session.confirmed.version !== session.version) return null
    if (session.target && session.target !== source.id) return null
    if (!session.target) {
      session.target = source.id
      sessions.set(sessionKey(session.base, source.id), session)
    }
    const fresh = toRekoFormData(source)
    session.baseline = fresh
    session.latest = null
    return fresh
  }, [session])

  const schedule = useCallback((data: RekoFormData) => {
    session.latest = data
    session.version += 1
    setState(session, { status: 'saving' })
    if (session.timer) clearTimeout(session.timer)
    session.timer = setTimeout(() => void sendSession(session, incidentId), REKO_SAVE_DELAY_MS)
  }, [session, incidentId])

  /** Send a waiting save now. Whether a save is still on its way (it settles later). */
  const flush = useCallback((): boolean => {
    if (session.timer) void send()
    return session.inFlight
  }, [session, send])

  return {
    state,
    resume,
    refresh,
    schedule,
    flush,
    retry: send,
  }
}
