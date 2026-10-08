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
 * One full read on open, then only what is new (`since_seq`) — on every board update the
 * socket announces and every 10 s regardless. Closed, it costs nothing; reopened, it reads
 * again from the cursor it had, so a drawer opened twice in a minute moves almost nothing.
 */
export function useJournal(eventId: string | null, open: boolean): JournalState {
  const [entries, setEntries] = useState<ApiJournalEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const cursor = useRef(0)
  const inflight = useRef(false)
  const loadedFor = useRef<string | null>(null)

  // Another Ereignis never shows the previous one's log for a frame.
  useEffect(() => {
    setEntries([])
    setFailed(false)
    cursor.current = 0
    loadedFor.current = null
  }, [eventId])

  const fetchNew = useCallback(async () => {
    if (!eventId || inflight.current) return
    inflight.current = true
    const first = loadedFor.current !== eventId
    if (first) setIsLoading(true)
    try {
      const page = await apiClient.getJournal(eventId, cursor.current)
      cursor.current = Math.max(cursor.current, page.latest_seq)
      loadedFor.current = eventId
      setEntries((held) => mergeJournal(held, page.entries))
      setFailed(false)
    } catch (error) {
      console.error("Failed to load journal:", error)
      setFailed(true)
    } finally {
      inflight.current = false
      if (first) setIsLoading(false)
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
