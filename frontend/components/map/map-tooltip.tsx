"use client"

/**
 * MapTooltip — the hover bubble a DOM map marker carries under MapLibre.
 *
 * Leaflet drew these itself (`<Tooltip>`, in a pane of its own); MapLibre has no
 * equivalent, so the bubble is an absolutely positioned child of the marker element.
 * The look is Leaflet's default tooltip 1:1 — white bubble, 6px arrow, 0.9 opacity,
 * pointer-events off — so the ported surfaces read exactly as they did.
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
  padding: 6,
  background: "#fff",
  border: "1px solid #fff",
  borderRadius: 3,
  color: "#222",
  whiteSpace: "nowrap",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.4)",
  opacity: 0.9,
  pointerEvents: "none",
  zIndex: 1,
}

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
  if (side === "top") return { ...ARROW, left: "50%", marginLeft: -6, bottom: -12, borderTopColor: "#fff" }
  if (side === "left") return { ...ARROW, top: "50%", marginTop: -6, right: -12, borderLeftColor: "#fff" }
  return { ...ARROW, top: "50%", marginTop: -6, left: -12, borderRightColor: "#fff" }
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
    <div style={{ ...BUBBLE, transform: bubbleTransform(side, gap) }}>
      {children}
      <span style={arrowStyle(side)} />
    </div>
  )
}
