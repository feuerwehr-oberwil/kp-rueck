/**
 * Bridge from the notification sidebar to the board's card highlight.
 *
 * Clicking a notification row should point at the card — scroll it into view,
 * give it the same calm accent ring a `?highlight=` deep link gets — while the
 * sidebar stays open. The sidebar lives in the root layout and the board owns
 * `scrollToCard`, so the two talk through a window event instead of threading a
 * handler through half the provider stack. If no board is mounted, the event
 * simply has no listener.
 */

const HIGHLIGHT_EVENT = 'kp:incident-highlight'

interface IncidentHighlightDetail {
  incidentId: string
}

/** Ask whichever board is mounted to scroll to and briefly ring this card. */
export function requestIncidentHighlight(incidentId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<IncidentHighlightDetail>(HIGHLIGHT_EVENT, { detail: { incidentId } })
  )
}

/** Subscribe to highlight requests. Returns the unsubscribe function. */
export function onIncidentHighlight(handler: (incidentId: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<IncidentHighlightDetail>).detail
    if (detail?.incidentId) handler(detail.incidentId)
  }
  window.addEventListener(HIGHLIGHT_EVENT, listener)
  return () => window.removeEventListener(HIGHLIGHT_EVENT, listener)
}
