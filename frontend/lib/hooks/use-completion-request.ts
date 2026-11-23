import { useEffect } from 'react'

/**
 * «Einsatz abschliessen» asked from outside a page's dialog layer – the GPS release prompt,
 * which is mounted once in the root layout. The board and the Lagekarte each listen through
 * `useIncidentDialogs`, which runs the usual close flow (the material question included),
 * exactly as a drag onto «Abgeschlossen» does (owner feedback 23.11.2026 #13).
 *
 *   requestCompletion(incidentId)                  // the prompt
 *   useCompletionRequests(isEditor ? run : null)   // the page's dialog layer
 */

const EVENT = 'kp:request-completion'

export function requestCompletion(incidentId: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: incidentId }))
}

/** Subscribe; returns the unsubscribe. */
export function onCompletionRequest(handler: (incidentId: string) => void): () => void {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'string') handler(event.detail)
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

/** Run `handler` for every `requestCompletion` while mounted; `null` listens to nothing. */
export function useCompletionRequests(handler: ((incidentId: string) => void) | null): void {
  useEffect(() => (handler ? onCompletionRequest(handler) : undefined), [handler])
}
