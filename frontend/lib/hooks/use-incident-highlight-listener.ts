'use client'

import { useEffect, useRef } from 'react'
import { onIncidentHighlight, type IncidentHighlightOptions } from '@/lib/notification-highlight'

/**
 * Mounts a listener for `requestIncidentHighlight` calls (notification rows
 * pointing at a board card). The handler is kept in a ref so a re-created
 * callback — `scrollToCard` closes over board state — never re-subscribes.
 *
 * `tab` is present when the caller pointed at something more specific than the
 * card: the notification's own subject, which the board opens the detail on.
 * `allowModal` says whether this click may use the full-screen modal on a narrow
 * viewport — see `notification-highlight.ts` for why only notifications may.
 */
export function useIncidentHighlightListener(
  handler: (incidentId: string, options: IncidentHighlightOptions) => void
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(
    () => onIncidentHighlight((incidentId, options) => handlerRef.current(incidentId, options)),
    []
  )
}
