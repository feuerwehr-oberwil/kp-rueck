"use client"

import { useEffect, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ResizeGrip } from "@/components/ui/resize-grip"
import type { ResizableWidth } from "@/lib/hooks/use-resizable-width"

/** `--motion-panel` in app/globals.css, for the timers below (slide-rail.test.ts keeps them equal). */
export const PANEL_MOTION_MS = 110

/** The rail's drawn width: the operator's `--rail-w` plus an optional `--rail-extra` a rail sets
 *  for itself (the Material-Leiste's room for the detail's reopen button). */
const RAIL_WIDTH = "calc(var(--rail-w) + var(--rail-extra, 0px))"

type Phase = "open" | "opening" | "closing" | "closed"

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * An in-flow rail that pushes its neighbour: the board's Personen-, Material- and Detail-Leiste
 * and the Benachrichtigungen. Render it where the rail goes and pass the rail's content as
 * `children`, unconditionally – `open` decides.
 *
 * Opening and closing animate the rail's WIDTH (`--motion-panel`, globals.css), so the board
 * beside it moves with it in CSS only; the content keeps its full width and slides out from
 * under the rail's own outer edge. The content stays mounted until a close has run, and is
 * `inert` meanwhile. Only changes after the first frames animate: a rail restored from
 * localStorage on load (open or closed) just stands there. Reduced motion: instant.
 *
 * `resize` (`useResizableWidth`) sizes it; the grip sits on the inner edge. The width is the
 * operator's preference, not a demand: when the rails beside a board want more than the row
 * has, an open rail shrinks (flex) down to its `min` and the neighbour keeps the room it
 * reserves with its own min-width – four rails dragged wide never squeeze the board to nothing.
 * The stored width stays and comes back when there is room. The wrapper is the
 * `z-raised` layer the collapse handles straddling the inner edge need over the board, so the
 * content must not open a stacking context of its own above it (no `backdrop-blur`/`z-*` on
 * the aside) – a handle then draws above the grip.
 */
export function SlideRail({
  open,
  dock,
  resize,
  gripLabel,
  gripHint,
  className,
  children,
}: {
  open: boolean
  /** The screen edge the rail stands on; its grip is on the opposite (inner) edge. */
  dock: "left" | "right"
  resize: ResizableWidth
  gripLabel: string
  gripHint: string
  className?: string
  children: ReactNode
}) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed")
  const [wasOpen, setWasOpen] = useState(open)
  // Armed two frames after mount: by then a remembered open/closed has been read and drawn.
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArmed(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  if (open !== wasOpen) {
    setWasOpen(open)
    setPhase(open ? (armed ? "opening" : "open") : armed ? "closing" : "closed")
  }

  useEffect(() => {
    if (phase !== "opening" && phase !== "closing") return
    const timer = setTimeout(
      () => setPhase(phase === "opening" ? "open" : "closed"),
      prefersReducedMotion() ? 0 : PANEL_MOTION_MS,
    )
    return () => clearTimeout(timer)
  }, [phase])

  const grip = phase === "open" && (
    <ResizeGrip resize={resize} side={dock === "left" ? "right" : "left"} label={gripLabel} hint={gripHint} />
  )

  return (
    <div
      ref={resize.panelRef}
      data-slot="slide-rail"
      data-phase={phase}
      data-motion={armed ? "on" : undefined}
      className={cn(
        "relative z-raised flex",
        // A left rail's content hangs off its LEFT side while it is narrower than the content.
        dock === "left" && "justify-end",
        // Clipped only while it moves: open, the collapse handle hangs over the board.
        phase !== "open" && "overflow-hidden",
        className,
      )}
      style={{
        ...resize.style,
        width: open ? RAIL_WIDTH : 0,
        // Open it may yield to the board, down to its min; moving, it is the width alone.
        flexShrink: phase === "open" ? 1 : 0,
        minWidth: phase === "open" ? `calc(${resize.min}px + var(--rail-extra, 0px))` : undefined,
      }}
    >
      {dock === "right" && grip}
      {phase !== "closed" && (
        // Full width while moving, so the content slides instead of reflowing; open, the
        // rail's own (possibly squeezed) width.
        <div
          className="flex shrink-0"
          style={{ width: phase === "open" ? "100%" : RAIL_WIDTH }}
          inert={phase === "closing"}
        >
          {children}
        </div>
      )}
      {dock === "left" && grip}
    </div>
  )
}
