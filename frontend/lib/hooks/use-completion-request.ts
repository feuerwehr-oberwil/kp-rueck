import { useEffect, useSyncExternalStore } from 'react'

/**
 * «Einsatz abschliessen» asked from outside a page's dialog layer – the GPS release prompt,
 * which is mounted once in the root layout. The board and the Lagekarte each offer their
 * close flow through `useIncidentDialogs` (the material question included), exactly as a
 * drag onto «Abgeschlossen» runs it (owner feedback 23.11.2026 #13).
 *
 * Nothing is held across an Ereignis switch (Sol review B round 2): the prompt reads
 * whether the board on screen can run the close flow for its Einsatz now, and offers
 * «Ereignis öffnen» until it can.
 *
 *   useCompletionBoard(isEditor ? board : null)                    // the page's dialog layer
 *   const readiness = useCompletionReadiness(incidentId, eventId)  // the prompt
 *   if (requestCompletion(incidentId)) close()                     // the prompt, when 'ready'
 */

/** What a page's dialog layer offers: the board on screen and its close flow. */
export interface CompletionBoard {
  /** The Ereignis on screen. */
  eventId: string | null
  /** Its board (Einsätze and Aufträge) finished loading. */
  loaded: boolean
  /** The close flow has all it reads: the Einsatz, and for a stop its Auftrag with the assignments. */
  has: (incidentId: string) => boolean
  run: (incidentId: string) => void
}

/**
 * Where the prompt's Einsatz stands against the board on screen:
 * 'ready' – the close flow can run · 'otherEvent' – it belongs to another Ereignis ·
 * 'loading' – the board is still loading · 'missing' – the board is loaded and has it not.
 */
export type CompletionReadiness = 'ready' | 'otherEvent' | 'loading' | 'missing'

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

/** `eventId` is the Einsatz's Ereignis, undefined when the prompt could not look it up. */
export function completionReadiness(
  board: CompletionBoard | null,
  incidentId: string,
  eventId: string | undefined,
): CompletionReadiness {
  if (!board) return 'missing'
  if (board.has(incidentId)) return 'ready'
  if (eventId && eventId !== board.eventId) return 'otherEvent'
  return board.loaded ? 'missing' : 'loading'
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
