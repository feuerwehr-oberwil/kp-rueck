"use client"

import {
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import { usePersistedState } from "@/lib/hooks/use-persisted-state"

/** Arrow-key step; Shift+arrow moves four of them. */
const KEY_STEP_PX = 16

const isWidth = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

interface ResizableWidthOptions {
  /** localStorage key – the width belongs to the screen, not to the Einsatz. */
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  /** Which edge of the panel the grip sits on: a right-hand rail is dragged by its LEFT edge. */
  side: "left" | "right"
}

/**
 * A panel width the operator drags, remembered per device.
 *
 * Spread `gripProps` onto the grip element (`components/ui/resize-grip.tsx` does) and put
 * `width` on the panel. Pointer drag with capture, clamped to [min, max]; double-click
 * resets to the default; the grip is a focusable `role="separator"` whose arrow keys
 * (Shift = bigger steps) and Home/End move it, so the width is not mouse-only.
 *
 * While a drag runs the live width stays in local state and only the release is persisted,
 * so a drag writes localStorage once instead of on every pointer move.
 */
export function useResizableWidth({ storageKey, defaultWidth, min, max, side }: ResizableWidthOptions) {
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  const [stored, setStored] = usePersistedState(storageKey, defaultWidth, isWidth)
  const [drag, setDrag] = useState<{ startX: number; startWidth: number; width: number } | null>(null)

  // A stored value from a build with other bounds still lands inside the current ones.
  const width = clamp(drag?.width ?? stored)
  // Moving the pointer towards the panel's outside makes it wider.
  const direction = side === "left" ? -1 : 1

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    // No text selection and no native drag while the edge moves (and no focus
    // ring left behind by a mouse drag – keyboard users Tab to the grip).
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ startX: e.clientX, startWidth: width, width })
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return
    const next = clamp(drag.startWidth + direction * (e.clientX - drag.startX))
    if (next !== drag.width) setDrag({ ...drag, width: next })
  }

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    // A click that did not move the edge keeps the saved width: while the page caps the rail,
    // saving the capped width would leave it narrow once there is room again.
    if (drag.width !== drag.startWidth) setStored(drag.width)
    setDrag(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? KEY_STEP_PX * 4 : KEY_STEP_PX
    let next: number | null = null
    if (e.key === "ArrowLeft") next = width - direction * step
    else if (e.key === "ArrowRight") next = width + direction * step
    else if (e.key === "Home") next = min
    else if (e.key === "End") next = max
    if (next === null) return
    e.preventDefault()
    setStored(clamp(next))
  }

  return {
    width,
    dragging: drag !== null,
    gripProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-valuenow": width,
      "aria-valuemin": min,
      "aria-valuemax": max,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: () => setStored(defaultWidth),
      onKeyDown,
    },
  } as const
}

export type ResizableWidth = ReturnType<typeof useResizableWidth>
