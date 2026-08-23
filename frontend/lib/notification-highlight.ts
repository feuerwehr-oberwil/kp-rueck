/**
 * Bridge from the notification sidebar to the board's card highlight.
 *
 * Clicking a notification row should point at the card — scroll it into view,
 * give it the same calm accent ring a `?highlight=` deep link gets — while the
 * sidebar stays open. The sidebar lives in the root layout and the board owns
 * `scrollToCard`, so the two talk through a window event instead of threading a
 * handler through half the provider stack. If no board is mounted, the event
 * simply has no listener.
 *
 * **Pointing at a card always opens it.** A ring alone was half an answer: the
 * operator clicked a thing to look at it, then had to open the detail by hand.
 * So every caller here scrolls, rings AND opens the detail — in the side panel,
 * beside the board, which is where a desktop operator reads.
 *
 * Two things stay optional, and they are different questions:
 *  * `tab` — WHICH part of the detail this click was about (§18.27). A row that
 *    says «Meldung vom Feld» lands on the Feld tab; a device binding in the
 *    material sidebar points at the card and nothing more specific, so it opens
 *    on whatever tab that card was last left on.
 *  * `allowModal` — whether this click may fall back to the full-screen modal on
 *    a narrow viewport. True for notifications, which are read wherever the
 *    operator is. False for a sidebar binding: on a phone that modal would bury
 *    the very list being worked through, and the answer to "where is this
 *    device?" is the ringed card, not a modal over it.
 */

import type { OperationDetailTab } from '@/lib/hooks/use-operation-detail-shortcuts'

const HIGHLIGHT_EVENT = 'kp:incident-highlight'

export interface IncidentHighlightOptions {
  tab?: OperationDetailTab
  /** May this open the modal on a narrow viewport? Notifications: yes. */
  allowModal?: boolean
}

interface IncidentHighlightDetail extends IncidentHighlightOptions {
  incidentId: string
}

/** Ask whichever board is mounted to scroll to this card, ring it, and open its
 *  detail — on `tab` when the caller knows which part it meant. */
export function requestIncidentHighlight(
  incidentId: string,
  options: IncidentHighlightOptions = {},
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<IncidentHighlightDetail>(HIGHLIGHT_EVENT, {
      detail: { incidentId, tab: options.tab, allowModal: options.allowModal ?? false },
    })
  )
}

/** Subscribe to highlight requests. Returns the unsubscribe function. */
export function onIncidentHighlight(
  handler: (incidentId: string, options: IncidentHighlightOptions) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<IncidentHighlightDetail>).detail
    if (detail?.incidentId) handler(detail.incidentId, { tab: detail.tab, allowModal: detail.allowModal })
  }
  window.addEventListener(HIGHLIGHT_EVENT, listener)
  return () => window.removeEventListener(HIGHLIGHT_EVENT, listener)
}
