"use client"

/**
 * The Lagekarte's count bubble: several overlapping incident pins as one mark
 * (`lib/map-clusters.ts`), phone and desktop. Drawn by the map (`ClusterMarker` in components/map-view.tsx) and by
 * the legend's key, which passes `legend` so the frame takes the card's ink instead of the
 * basemap's gray-700 (as `LegendMarker` does).
 *
 * Built from the pin's own parts, so it reads as «these pins, together»: the lead pin's status
 * frame outside (`incidentPinRings`, in the surface's pin geometry), a white gap, then a dark core ringed in the
 * lead's priority colour that carries its priority glyph (`priorityGlyphPath`) and the count in
 * white. The dark core is what tells a bubble from a pin at a glance – a pin is filled with its
 * priority colour.
 */

import { MAP_COLORS, PRIORITY_MARKER_COLORS, STATUS_RING, incidentPinRings } from "@/lib/map-colors"
import { priorityGlyphPath } from "@/lib/map-priority"
import type { StatusGroup } from "@/lib/types/incidents"

/** The bubble on the map: the 44px phone touch target, a step up from the 32px pin – the same
 *  size on the desktop, where the step up is what says «more than one». */
export const CLUSTER_BUBBLE_SIZE = 44

export function ClusterBubble({
  count,
  priority,
  group,
  size = CLUSTER_BUBBLE_SIZE,
  compact,
  legend = false,
}: {
  count: number
  /** The lead pin's priority – the glyph and the core's ring. */
  priority: string | null | undefined
  /** The lead pin's status group – the frame's dash pattern. */
  group: StatusGroup
  size?: number
  /** Phone geometry (`STATUS_RING.phone`) for the frame, as the pins beside it wear. */
  compact: boolean
  legend?: boolean
}) {
  const rings = incidentPinRings(size, compact, group)
  const r = rings.r
  const accent = PRIORITY_MARKER_COLORS[priority as keyof typeof PRIORITY_MARKER_COLORS] ?? MAP_COLORS.offline
  // The core sits a white hairline inside the frame; its ring is 3px of the priority colour.
  const coreR = r - rings.ringWidth - 3
  const scale = size / CLUSTER_BUBBLE_SIZE
  const fontSize = 13 * scale
  // Glyph (10px wide at full size) + 2px + the digits, centred as one group.
  const glyphW = 10 * scale
  const digitsW = String(count).length * 7.6 * scale
  const start = r - (glyphW + 2 * scale + digitsW) / 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" aria-hidden="true">
      <circle cx={r} cy={r} r={coreR + 3} fill="white" />
      <circle cx={r} cy={r} r={coreR} fill={MAP_COLORS.station} stroke={accent} strokeWidth={3} />
      <path
        d={priorityGlyphPath(priority, start + glyphW / 2, r, 1.25 * scale)}
        fill="none"
        stroke={accent}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x={start + glyphW + 2 * scale}
        y={r}
        dominantBaseline="central"
        fill="white"
        fontSize={fontSize}
        fontWeight={700}
        className="font-sans tabular-nums"
      >
        {count}
      </text>
      <circle
        cx={r}
        cy={r}
        r={rings.ringR}
        fill="none"
        stroke={legend ? undefined : STATUS_RING.color}
        className={legend ? "stroke-muted-foreground" : undefined}
        strokeWidth={rings.ringWidth}
        strokeDasharray={rings.dasharray}
        strokeLinecap={rings.linecap}
      />
    </svg>
  )
}
