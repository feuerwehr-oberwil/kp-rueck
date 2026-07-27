"use client"

import { useCallback, useState } from "react"
import type { Operation } from "@/lib/contexts/operations-context"

/**
 * Confirmation gate for attaching an ALREADY CLOSED incident to an Auftrag.
 *
 * It used to happen silently: a finished incident could be dragged onto a route
 * or ticked in the stop picker and would join it without a word, so a route
 * showed a stop nobody was going to drive to.
 *
 * Warn, don't forbid. There are real cases — a Wiederaufnahme, a second visit to
 * the same address — and blocking them would mean creating a duplicate incident
 * just to get past the rule. So the confirmation names what is closed and then
 * gets out of the way.
 *
 * Covers every route in: the stop picker, «An Auftrag verteilen» and dragging a
 * card onto an Auftrag, because the guard wraps the action rather than the UI.
 */
export interface ClosedStopPrompt {
  /** The closed incidents among the ones being attached. */
  closed: Operation[]
  /** How many incidents were being attached in total. */
  total: number
}

export function useClosedStopGuard(operations: Operation[]) {
  const [prompt, setPrompt] = useState<ClosedStopPrompt | null>(null)
  // The deferred action, kept in a state box so React doesn't call the function.
  const [pendingAction, setPendingAction] = useState<{ run: () => void } | null>(null)

  const guard = useCallback(
    (incidentIds: string[], run: () => void) => {
      const closed = incidentIds
        .map((id) => operations.find((operation) => operation.id === id))
        .filter((operation): operation is Operation => operation?.status === "complete")
      if (closed.length === 0) {
        run()
        return
      }
      setPrompt({ closed, total: incidentIds.length })
      setPendingAction({ run })
    },
    [operations],
  )

  const dismiss = useCallback(() => {
    setPrompt(null)
    setPendingAction(null)
  }, [])

  const proceed = useCallback(() => {
    const action = pendingAction
    setPrompt(null)
    setPendingAction(null)
    action?.run()
  }, [pendingAction])

  return { guard, prompt, proceed, dismiss }
}
