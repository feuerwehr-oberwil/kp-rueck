"use client"

import { useEffect, useRef } from "react"
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"

/**
 * useDialogDragGuard — keep a Radix layer (Dialog / Sheet) open while a
 * pragmatic-drag-and-drop drag happens inside it.
 *
 * A native drag that re-orders rows churns focus + pointer state; Radix's
 * DismissableLayer reads that churn as an outside interaction and closes the
 * layer mid-drag. We track a global "is dragging" flag via `monitorForElements`
 * and expose guard handlers that `preventDefault()` the dismissal while a drag
 * is in flight.
 *
 * Spread `dragGuardProps` onto the `<DialogContent>` / `<SheetContent>`. The
 * flag is cleared on the next tick after `onDrop` so the drop's trailing
 * focus/pointer events are still guarded.
 */
export function useDialogDragGuard(enabled: boolean) {
  const isDraggingRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    return monitorForElements({
      onDragStart: () => {
        isDraggingRef.current = true
      },
      onDrop: () => {
        // Defer the reset so the outside-interaction events fired as the drag
        // settles (focus returning, pointer up) are still suppressed.
        setTimeout(() => {
          isDraggingRef.current = false
        }, 0)
      },
    })
  }, [enabled])

  const guard = (e: { preventDefault: () => void }) => {
    if (isDraggingRef.current) e.preventDefault()
  }

  const dragGuardProps = {
    onPointerDownOutside: guard,
    onInteractOutside: guard,
    onFocusOutside: guard,
    onEscapeKeyDown: guard,
  }

  return { isDraggingRef, dragGuardProps }
}
