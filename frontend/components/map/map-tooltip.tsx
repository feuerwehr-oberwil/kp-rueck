"use client"

/**
 * MapTooltip — the hover bubble a DOM map marker carries under MapLibre.
 *
 * Leaflet drew these itself (`<Tooltip>`, in a pane of its own); MapLibre has no
 * equivalent, so the bubble is an absolutely positioned child of the marker element.
 * Leaflet's geometry (6px arrow, 0.9 opacity, pointer-events off) in the app's own surface:
 * card / card-foreground / border tokens (dark board, dark bubble), Sora 12 – `font-sans`
 * beats the Helvetica MapLibre sets on its container – the small-control radius and a
 * restrained shadow, the same chrome as the Lagekarte's permanent labels (map-view.tsx).
 *
 * It positions from the marker's ANCHOR (its lng/lat), not from the pin's box:
 * `gap` is the distance between that point and the bubble's near edge, which is what
 * Leaflet's `direction` + `offset` + the arrow margin added up to. Render it inside a
 * `position: relative` wrapper whose box is centred on the anchor (i.e. the pin
 * itself), which is what a `<Marker>` with the default `center` anchor gives.
 */

import type { CSSProperties, ReactNode } from "react"

/** Leaflet's `direction`, minus the ones no surface uses. */
export type MapTooltipSide = "top" | "left" | "right"

const BUBBLE: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  opacity: 0.9,
  pointerEvents: "none",
  zIndex: 1,
}

const BUBBLE_LOOK =
  "whitespace-nowrap rounded-sm border border-border bg-card p-1.5 font-sans text-xs " +
  "text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.25)]"

const ARROW: CSSProperties = {
  position: "absolute",
  border: "6px solid transparent",
  pointerEvents: "none",
}

/** Bubble placement relative to the anchor: which edge sits `gap` px away from it. */
function bubbleTransform(side: MapTooltipSide, gap: number): string {
  if (side === "top") return `translate(-50%, calc(-100% - ${gap}px))`
  if (side === "left") return `translate(calc(-100% - ${gap}px), -50%)`
  return `translate(${gap}px, -50%)`
}

/** The 6px triangle, on the bubble edge that faces the marker. */
function arrowStyle(side: MapTooltipSide): CSSProperties {
  if (side === "top") return { ...ARROW, left: "50%", marginLeft: -6, bottom: -12, borderTopColor: "var(--card)" }
  if (side === "left") return { ...ARROW, top: "50%", marginTop: -6, right: -12, borderLeftColor: "var(--card)" }
  return { ...ARROW, top: "50%", marginTop: -6, left: -12, borderRightColor: "var(--card)" }
}

export function MapTooltip({
  side = "top",
  gap = 6,
  children,
}: {
  side?: MapTooltipSide
  /** Anchor → bubble edge, in px. Leaflet's arrow margin (6) plus its `offset`. */
  gap?: number
  children: ReactNode
}) {
  return (
    <div className={BUBBLE_LOOK} style={{ ...BUBBLE, transform: bubbleTransform(side, gap) }}>
      {children}
      <span style={arrowStyle(side)} />
    </div>
  )
}
