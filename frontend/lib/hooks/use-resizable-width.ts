"use client"

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import { readJson, writeJson } from "@/lib/utils/safe-storage"

/** Arrow-key step; Shift+arrow moves four of them. */
const KEY_STEP_PX = 16

/** The custom property a resizable panel is sized by – set on the panel element itself. */
export const RAIL_WIDTH_VAR = "--rail-w"

const isWidth = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

interface ResizableWidthOptions {
  /** localStorage key – the width belongs to the screen, not to the Einsatz. */
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  /** Which edge of the panel the grip sits on: a right-hand rail is dragged by its LEFT edge. */
  side: "left" | "right"
  /** Called with the live width on every drag step – for a value that lives outside the panel
   *  (the notification sidebar's root `--notification-sidebar-width`). Not React state. */
  onLiveWidth?: (width: number) => void
}

/**
 * A panel width the operator drags, remembered per device.
 *
 * Put `panelRef` and `style` on the panel and size it with `var(--rail-w)` (`RAIL_WIDTH_VAR`);
 * spread `gripProps` onto the grip (`components/ui/resize-grip.tsx` does). Pointer drag with
 * capture, clamped to [min, max]; double-click resets to the default; the grip is a focusable
 * `role="separator"` whose arrow keys (Shift = bigger steps) and Home/End move it.
 *
 * A drag never re-renders React: each pointer move writes `--rail-w` on the panel (and
 * `aria-valuenow` on the grip) straight into the DOM, so a board or a map beside the panel
 * reflows in CSS only. The release commits the width to state and to localStorage, once. A
 * click that did not move the edge commits nothing. While a drag runs the panel carries
 * `data-resizing` (no width transition) and the grip `data-dragging` (the seam line).
 *
 * The stored width is read in a layout effect, i.e. before the first paint of a panel that
 * mounts on the client – no frame at the default width followed by a jump.
 */
export function useResizableWidth({ storageKey, defaultWidth, min, max, side, onLiveWidth }: ResizableWidthOptions) {
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  const [stored, setStored] = useState(defaultWidth)
  const panel = useRef<HTMLElement | null>(null)
  // A callback ref, so any element type (aside, div, a Radix content) takes it.
  const panelRef = useCallback((element: HTMLElement | null) => {
    panel.current = element
  }, [])
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const value = readJson(storageKey, isWidth, null)
    if (value !== null) setStored(value)
  }, [storageKey])

  // A stored value from a build with other bounds still lands inside the current ones.
  const width = clamp(stored)
  // Moving the pointer towards the panel's outside makes it wider.
  const direction = side === "left" ? -1 : 1

  const commit = (next: number) => {
    setStored(next)
    writeJson(storageKey, next)
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    // No text selection and no native drag while the edge moves (and no focus
    // ring left behind by a mouse drag – keyboard users Tab to the grip).
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    // A panel the page has squeezed (SlideRail yields to the board) is drawn narrower than its
    // width: the drag starts from what is drawn, so the edge follows the pointer at once.
    const drawn = panel.current?.getBoundingClientRect().width
    const start = drawn && drawn < width ? clamp(drawn) : width
    drag.current = { startX: e.clientX, startWidth: start, width: start }
    e.currentTarget.dataset.dragging = ""
    if (panel.current) panel.current.dataset.resizing = ""
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) return
    const next = clamp(current.startWidth + direction * (e.clientX - current.startX))
    if (next === current.width) return
    current.width = next
    panel.current?.style.setProperty(RAIL_WIDTH_VAR, `${next}px`)
    e.currentTarget.setAttribute("aria-valuenow", String(next))
    onLiveWidth?.(next)
  }

  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    delete e.currentTarget.dataset.dragging
    if (panel.current) delete panel.current.dataset.resizing
    // A click that did not move the edge keeps the saved width: while the page caps the rail,
    // saving the capped width would leave it narrow once there is room again.
    if (current.width !== current.startWidth) commit(current.width)
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
    commit(clamp(next))
  }

  return {
    width,
    min,
    panelRef,
    /** The committed width as `--rail-w`; spread into the panel's `style`. */
    style: { [RAIL_WIDTH_VAR]: `${width}px` } as CSSProperties,
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
      onDoubleClick: () => commit(clamp(defaultWidth)),
      onKeyDown,
    },
  } as const
}

export type ResizableWidth = ReturnType<typeof useResizableWidth>
