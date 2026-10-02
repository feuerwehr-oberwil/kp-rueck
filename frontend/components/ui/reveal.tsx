"use client"

/**
 * Reveal — the one open/close motion for every HAND-BUILT disclosure (a body
 * that appears under its header when a chevron, a row or a switch is clicked).
 *
 * Before this, every one of them was `{open && <div>…</div>}`: the body popped
 * in at full height in a single frame and everything below it jumped by that
 * much, and on close it vanished the same way. Now the body slides: height via
 * `grid-template-rows: 0fr → 1fr` (animates to the content's real height with
 * no measuring), plus opacity, ~200ms on `--ease`. Closing keeps the children
 * mounted until the slide is done, so nothing flashes away mid-motion.
 *
 * Radix `Collapsible` gets the same motion from `components/ui/collapsible.tsx`
 * (keyframes on `--radix-collapsible-content-height`, globals.css) — the two
 * share duration and curve so all disclosures in the app move alike.
 *
 * - Mounting with `open` already true does NOT animate (page load, restored
 *   state): motion answers a click, it is not decoration.
 * - `prefers-reduced-motion: reduce` → instant, in both directions.
 * - Closed (and closing) content is `inert`: no tab stop into a body the
 *   operator just closed.
 * - The inner box clips only WHILE moving; once open it is `overflow-visible`
 *   again, so focus rings and popovers inside are not cut off.
 *
 * Don't use it for lists that change with typing (search results, filters):
 * those must stay instant.
 */

import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Keep in step with `--reveal-duration` in globals.css. */
export const REVEAL_MS = 200

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

type Phase = "closed" | "opening" | "open" | "closing"

export function Reveal({
  open,
  children,
  className,
  innerClassName,
}: {
  open: boolean
  children: ReactNode
  /** On the outer grid box — e.g. cancelling a parent's `space-y` margin. */
  className?: string
  /**
   * On a wrapper INSIDE the clip — padding, borders and spacing that belong to
   * the body and must slide with it. Put the gap to the header here (`pt-2`)
   * rather than as a margin on the Reveal, or the gap snaps instead of sliding.
   */
  innerClassName?: string
}) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frame = useRef<number | null>(null)
  // The last `open` we reacted to — not a "first render" flag, which React's
  // dev double-invoke would trip and animate a body that mounted open.
  const lastOpen = useRef(open)

  useEffect(() => {
    if (lastOpen.current === open) return
    lastOpen.current = open
    if (timer.current) clearTimeout(timer.current)
    if (frame.current) cancelAnimationFrame(frame.current)
    if (prefersReducedMotion()) {
      setPhase(open ? "open" : "closed")
      return
    }
    if (open) {
      // Mount at 0fr first, then go to 1fr on the next frame so the
      // transition has a start value to run from.
      setPhase("opening")
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => {
          setPhase("open")
          frame.current = null
        })
      })
      // Clip until the slide is over; `open` is what lifts it.
      return
    }
    setPhase("closing")
    timer.current = setTimeout(() => setPhase("closed"), REVEAL_MS + 40)
  }, [open])

  // `open` reached by the double frame: keep clipping for the duration.
  const [settled, setSettled] = useState(open)
  useEffect(() => {
    if (phase !== "open") {
      setSettled(false)
      return
    }
    if (prefersReducedMotion()) {
      setSettled(true)
      return
    }
    const id = setTimeout(() => setSettled(true), REVEAL_MS + 20)
    return () => clearTimeout(id)
  }, [phase])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (frame.current) cancelAnimationFrame(frame.current)
    },
    [],
  )

  if (phase === "closed") return null

  const expanded = phase === "open"
  return (
    <div
      data-slot="reveal"
      data-state={expanded ? "open" : "closed"}
      inert={!open || undefined}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[var(--reveal-duration)] ease-[var(--ease)] motion-reduce:transition-none",
        expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      {/* The clip box carries NO padding or border: at `0fr` it has to reach a
          true zero height, and padding on it would keep a sliver showing. */}
      <div className={cn("min-h-0", expanded && settled ? "overflow-visible" : "overflow-hidden")}>
        {innerClassName ? <div className={innerClassName}>{children}</div> : children}
      </div>
    </div>
  )
}
