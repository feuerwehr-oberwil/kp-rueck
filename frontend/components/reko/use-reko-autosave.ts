'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyncState } from '@/components/kanban/field-save-status'
import type { RekoFormData } from '@/components/reko/reko-report-form'
import { apiClient } from '@/lib/api-client'
import { classifySaveFailure } from '@/lib/field-save'

/** How long the form waits after the last edit before it saves – one request per pause,
 *  not one per keystroke. */
export const REKO_SAVE_DELAY_MS = 600

/**
 * The board's Reko form saves as it goes (owner pick 19.11.2026, #30) – no save button.
 *
 * `start(reportId)` names the row the edits go to: the filed report being amended, the
 * operator's own KP draft, or null – then the first save creates the draft
 * (`POST /api/reko/?submit=false`) and every later one PATCHes it (`submit=false`). The draft
 * is filed on the server, not here: by the card's move to «Reko abgeschlossen»
 * (`crud.reko.submit_kp_reko_drafts`), or – on a card already there – by the save that
 * answers «Einsatz relevant?» (`api/reko._kp_draft_files_now`).
 *
 * `schedule(data)` after every change; one request at a time, the newest form always last,
 * so the server sees the edits in order. «Synchronisiert» only once the save carrying the
 * NEWEST form answered; then `onSettled` runs (the section reloads – a read issued before
 * that could still return the old row). A failure waits for `retry()` or the next edit – no
 * automatic resend (`lib/field-save`). `flush()` sends a waiting save now (closing the form).
 *
 * The newest form outlives closing the form (Sol review S1): `resume(source)` on reopen hands
 * it back while it is not confirmed yet (waiting, in flight, failed), or while the server's
 * copy is not newer than what this hook's last save got back – the list may not have caught
 * up. Otherwise it adopts `source` and returns null: open from the server's row.
 */
export function useRekoAutosave(incidentId: string, onSettled?: () => void) {
  const [state, setState] = useState<SyncState>({ status: 'idle' })
  const target = useRef<string | null>(null)
  const latest = useRef<RekoFormData | null>(null)
  const version = useRef(0)
  /** The version the server confirmed last, and the `updated_at` it answered with. */
  const confirmed = useRef<{ version: number; updatedAt: string | null }>({ version: 0, updatedAt: null })
  const inFlight = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const data = latest.current
    if (inFlight.current || !data) return
    const sent = version.current
    inFlight.current = true
    setState({ status: 'saving' })
    try {
      // The report's own fields; no token, the session is the identity. Photos travel
      // too: an upload attached them server-side, and the list keeps a removal removed.
      const payload = {
        is_relevant: data.is_relevant,
        dangers_json: data.dangers_json,
        effort_json: data.effort_json,
        power_supply: data.power_supply,
        photos_json: data.photos_json,
        summary_text: data.summary_text,
        additional_notes: data.additional_notes,
      }
      const report = target.current
        ? await apiClient.updateRekoReport(target.current, payload)
        : await apiClient.createRekoReportAsEditor(incidentId, payload, false)
      target.current = report.id
      inFlight.current = false
      confirmed.current = { version: sent, updatedAt: report.updated_at ?? null }
      if (version.current === sent) {
        setState({ status: 'saved', savedAt: new Date() })
        onSettled?.()
      } else await send()
    } catch (error) {
      inFlight.current = false
      setState({ status: 'failed', reason: classifySaveFailure(error) })
    }
  }, [incidentId, onSettled])

  const resume = useCallback((source: { id: string; updated_at: string } | null): RekoFormData | null => {
    const local = latest.current
    if (local) {
      const unconfirmed = confirmed.current.version !== version.current
      const serverNotNewer =
        !source ||
        (source.id === target.current && !!confirmed.current.updatedAt && source.updated_at <= confirmed.current.updatedAt)
      if (unconfirmed || serverNotNewer) return local
    }
    target.current = source?.id ?? null
    latest.current = null
    confirmed.current = { version: version.current, updatedAt: null }
    setState({ status: 'idle' })
    return null
  }, [])

  const schedule = useCallback((data: RekoFormData) => {
    latest.current = data
    version.current += 1
    setState({ status: 'saving' })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void send(), REKO_SAVE_DELAY_MS)
  }, [send])

  /** Send a waiting save now. Whether a save is still on its way (it settles later). */
  const flush = useCallback((): boolean => {
    if (timer.current) void send()
    return inFlight.current
  }, [send])

  // A form unmounted with a save still waiting sends it rather than dropping it.
  useEffect(() => () => {
    if (timer.current) void send()
  }, [send])

  return {
    state,
    resume,
    schedule,
    flush,
    retry: send,
    /** The row the edits go to – the photo door attaches to it. */
    reportId: () => target.current,
  }
}
