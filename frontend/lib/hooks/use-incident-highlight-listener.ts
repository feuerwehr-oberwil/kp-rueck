'use client'

import { useEffect, useRef } from 'react'
import { onIncidentHighlight } from '@/lib/notification-highlight'

/**
 * Mounts a listener for `requestIncidentHighlight` calls (notification rows
 * pointing at a board card). The handler is kept in a ref so a re-created
 * callback — `scrollToCard` closes over board state — never re-subscribes.
 */
export function useIncidentHighlightListener(handler: (incidentId: string) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => onIncidentHighlight((incidentId) => handlerRef.current(incidentId)), [])
}
