import { useCallback, useEffect, useRef } from 'react'

/**
 * «Einsatz abschliessen» asked from outside a page's dialog layer – the GPS release prompt,
 * which is mounted once in the root layout. The board and the Lagekarte each listen through
 * `useIncidentDialogs`, which runs the usual close flow (the material question included),
 * exactly as a drag onto «Abgeschlossen» does (owner feedback 23.11.2026 #13).
 *
 * The asker learns whether a dialog layer took the request, so it never closes on a request
 * nobody runs. `eventId` is the Einsatz's Ereignis: a layer that has not loaded the Einsatz
 * yet (the prompt just switched to that Ereignis) keeps the request until it has.
 *
 *   if (requestCompletion({ incidentId, eventId })) close()                       // the prompt
 *   useCompletionRequests(isEditor ? run : null, { eventId, operations })         // the page's dialog layer
 */

const EVENT = 'kp:request-completion'

export interface CompletionRequest {
  incidentId: string
  eventId?: string
}

/** Ask; true when a page's dialog layer took the request. */
export function requestCompletion(request: CompletionRequest): boolean {
  return !window.dispatchEvent(new CustomEvent(EVENT, { detail: request, cancelable: true }))
}

function isCompletionRequest(value: unknown): value is CompletionRequest {
  return typeof value === 'object' && value !== null && 'incidentId' in value && typeof value.incidentId === 'string'
}

/** Subscribe; `handler` returns whether it took the request. Returns the unsubscribe. */
export function onCompletionRequest(handler: (request: CompletionRequest) => boolean): () => void {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && isCompletionRequest(event.detail) && handler(event.detail)) event.preventDefault()
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

/**
 * The page's dialog layer: `run` the close flow for every request whose Einsatz is on this
 * board (`operations`). One of the selected Ereignis (`eventId`) that is not loaded yet waits
 * until it is – the prompt switches the Ereignis first – and is dropped once another Ereignis
 * is selected. A request without an Ereignis and not on the board is not taken. `run` null
 * (a viewer) listens to nothing.
 */
export function useCompletionRequests(
  run: ((incidentId: string) => void) | null,
  { eventId, operations }: { eventId: string | undefined; operations: readonly { id: string }[] },
): void {
  const pending = useRef<CompletionRequest | null>(null)
  const take = useCallback(
    (request: CompletionRequest) => {
      if (!run) return false
      if (operations.some((operation) => operation.id === request.incidentId)) {
        run(request.incidentId)
        return true
      }
      if (!request.eventId) return false
      pending.current = request
      return true
    },
    [operations, run],
  )
  useEffect(() => (run ? onCompletionRequest(take) : undefined), [run, take])
  useEffect(() => {
    const waiting = pending.current
    if (!waiting) return
    if (!run || waiting.eventId !== eventId) {
      pending.current = null
    } else if (operations.some((operation) => operation.id === waiting.incidentId)) {
      pending.current = null
      run(waiting.incidentId)
    }
  }, [eventId, operations, run])
}
