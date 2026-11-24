import { useEffect, useSyncExternalStore } from 'react'

/**
 * «Einsatz abschliessen» asked from outside a page's dialog layer – the GPS release prompt,
 * which is mounted once in the root layout. The board and the Lagekarte each offer their
 * close flow through `useIncidentDialogs` (the material question included), exactly as a
 * drag onto «Abgeschlossen» runs it (owner feedback 23.11.2026 #13).
 *
 * Nothing is held across an Ereignis switch (Sol review B round 2): the prompt reads
 * whether the board on screen can run the close flow for its Einsatz now, and offers
 * «Ereignis öffnen» until it can. A board whose load failed says so and offers a retry
 * (Sol review B round 3) – not «Einsatz nicht gefunden».
 *
 *   useCompletionBoard(isEditor ? board : null)                    // the page's dialog layer
 *   const readiness = useCompletionReadiness(incidentId, eventId)  // the prompt
 *   if (requestCompletion(incidentId)) close()                     // the prompt, when 'ready'
 */

/** What a page's dialog layer offers: the board on screen and its close flow. */
export interface CompletionBoard {
  /** The Ereignis on screen. */
  eventId: string | null
  /** Its board (Einsätze and Aufträge) finished loading – successfully or not. */
  loaded: boolean
  /** A part of it never arrived (its loads failed): lacking the Einsatz says nothing. */
  failed: boolean
  /** Fetch the board again. */
  retry: () => Promise<void>
  /** The close flow has all it reads: the Einsatz, and for a stop its Auftrag with the assignments. */
  has: (incidentId: string) => boolean
  run: (incidentId: string) => void
}

/**
 * Where the prompt's Einsatz stands against the board on screen:
 * 'ready' – the close flow can run · 'otherEvent' – it belongs to another Ereignis ·
 * 'loading' – the board is still loading · 'failed' – the board's load failed ·
 * 'missing' – the board is loaded and has it not.
 */
export type CompletionReadiness = 'ready' | 'otherEvent' | 'loading' | 'failed' | 'missing'

let current: CompletionBoard | null = null
const listeners = new Set<() => void>()

function publish(board: CompletionBoard | null) {
  current = board
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Run the board's close flow for `incidentId`; true when the board on screen took it. */
export function requestCompletion(incidentId: string): boolean {
  if (!current?.has(incidentId)) return false
  current.run(incidentId)
  return true
}

/** Fetch the board on screen again (the prompt's retry after a failed load). */
export function retryCompletionBoard(): Promise<void> {
  return current?.retry() ?? Promise.resolve()
}

/** `eventId` is the Einsatz's Ereignis, undefined when the prompt could not look it up. */
export function completionReadiness(
  board: CompletionBoard | null,
  incidentId: string,
  eventId: string | undefined,
): CompletionReadiness {
  if (!board) return 'missing'
  if (board.has(incidentId)) return 'ready'
  if (eventId && eventId !== board.eventId) return 'otherEvent'
  if (!board.loaded) return 'loading'
  return board.failed ? 'failed' : 'missing'
}

/** The prompt's side: re-renders whenever the board on screen changes. */
export function useCompletionReadiness(incidentId: string, eventId: string | undefined): CompletionReadiness {
  const board = useSyncExternalStore(subscribe, () => current, () => null)
  return completionReadiness(board, incidentId, eventId)
}

/** The page's dialog layer: offer `board` while mounted. Null (a viewer) offers nothing. */
export function useCompletionBoard(board: CompletionBoard | null): void {
  useEffect(() => {
    if (!board) return
    publish(board)
    return () => {
      if (current === board) publish(null)
    }
  }, [board])
}
