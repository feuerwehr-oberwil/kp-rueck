"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { apiClient, type ApiJournalEntry } from "@/lib/api-client"
import { mergeJournal } from "@/lib/journal"
import { wsClient } from "@/lib/websocket-client"

/** Fallback poll while the drawer is open and the socket says nothing. */
const POLL_MS = 10_000
/** A burst of board updates (a completion releases eight resources) is one fetch. */
const NUDGE_DEBOUNCE_MS = 400

/** Board events after which the log has new automatic rows. */
const NUDGES = [
  "journal_update",
  "incident_update",
  "assignment_update",
  "notification_update",
  "kp_message_update",
  "reko_update",
] as const

export interface JournalState {
  entries: ApiJournalEntry[]
  /** first load still running */
  isLoading: boolean
  failed: boolean
  reload: () => void
  /** Merge a row the server just confirmed (the answer to our own POST). */
  accept: (entry: ApiJournalEntry) => void
}

/**
 * The Ereignis' Einsatztagebuch while the drawer is open.
 *
 * One full read on open, then what is new (`since_seq` — the server adds the last two
 * minutes again, so a row a long transaction committed late is not lost behind the
 * cursor; `mergeJournal` drops what is already held) — on every board update the
 * socket announces and every 10 s regardless. Closed, it costs nothing; reopened, it reads
 * again from the cursor it had, so a drawer opened twice in a minute moves almost nothing.
 */
export function useJournal(eventId: string | null, open: boolean): JournalState {
  const [entries, setEntries] = useState<ApiJournalEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const cursor = useRef(0)
  // Which Ereignis the held rows, the cursor and a running request belong to. Switching
  // Ereignis bumps it; an answer that comes back for an older generation is dropped —
  // otherwise a slow page of Ereignis A lands in B's log and moves B's cursor.
  const generation = useRef(0)
  const inflight = useRef<number | null>(null)
  const loadedFor = useRef<number | null>(null)

  // Another Ereignis never shows the previous one's log for a frame.
  useEffect(() => {
    generation.current += 1
    setEntries([])
    setFailed(false)
    setIsLoading(false)
    cursor.current = 0
    loadedFor.current = null
  }, [eventId])

  const fetchNew = useCallback(async () => {
    const gen = generation.current
    if (!eventId || inflight.current === gen) return
    inflight.current = gen
    const first = loadedFor.current !== gen
    if (first) setIsLoading(true)
    try {
      const page = await apiClient.getJournal(eventId, cursor.current)
      if (gen !== generation.current) return
      cursor.current = Math.max(cursor.current, page.latest_seq)
      loadedFor.current = gen
      setEntries((held) => mergeJournal(held, page.entries))
      setFailed(false)
    } catch (error) {
      if (gen !== generation.current) return
      console.error("Failed to load journal:", error)
      setFailed(true)
    } finally {
      if (inflight.current === gen) inflight.current = null
      if (first && gen === generation.current) setIsLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    if (!open || !eventId) return
    void fetchNew()
    const poll = window.setInterval(() => void fetchNew(), POLL_MS)
    let timer: number | undefined
    const nudge = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void fetchNew(), NUDGE_DEBOUNCE_MS)
    }
    const offs = NUDGES.map((name) => wsClient.on(name, nudge))
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }, [open, eventId, fetchNew])

  const accept = useCallback((entry: ApiJournalEntry) => {
    setEntries((held) => mergeJournal(held, [entry]))
  }, [])

  return { entries, isLoading, failed, reload: () => void fetchNew(), accept }
}
