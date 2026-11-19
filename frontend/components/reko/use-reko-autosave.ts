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
 * NEWEST form answered. A failure waits for `retry()` or the next edit – no automatic resend
 * (`lib/field-save`). `flush()` sends a waiting save now (closing the form).
 */
export function useRekoAutosave(incidentId: string) {
  const [state, setState] = useState<SyncState>({ status: 'idle' })
  const target = useRef<string | null>(null)
  const latest = useRef<RekoFormData | null>(null)
  const version = useRef(0)
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
      if (version.current === sent) setState({ status: 'saved', savedAt: new Date() })
      else await send()
    } catch (error) {
      inFlight.current = false
      setState({ status: 'failed', reason: classifySaveFailure(error) })
    }
  }, [incidentId])

  const start = useCallback((reportId: string | null) => {
    target.current = reportId
    latest.current = null
    setState({ status: 'idle' })
  }, [])

  const schedule = useCallback((data: RekoFormData) => {
    latest.current = data
    version.current += 1
    setState({ status: 'saving' })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void send(), REKO_SAVE_DELAY_MS)
  }, [send])

  const flush = useCallback(() => {
    if (timer.current) void send()
  }, [send])

  // A form unmounted with a save still waiting sends it rather than dropping it.
  useEffect(() => () => {
    if (timer.current) void send()
  }, [send])

  return {
    state,
    start,
    schedule,
    flush,
    retry: send,
    /** The row the edits go to – the photo door attaches to it. */
    reportId: () => target.current,
  }
}
