/**
 * Lagekarte: incident pins that overlap on screen merge into ONE count bubble – on the phone
 * (owner pick U4 B, 08.11.2026) and, since round 27 (owner, 08.11.2026: «Joining – Both»), on
 * the desktop too. At the fit zoom a storm evening piles eighteen 32px pins into one heap where no
 * single pin can be pointed at, and their labels cover each other; a bubble says how many are
 * there and carries the most urgent one's mark – its priority glyph and its status frame – so a
 * Hoch is still visible from afar. A click or tap zooms to the group (`components/map-view.tsx`).
 *
 * Only below `CLUSTER_MAX_ZOOM`: from street level the pins stand apart and the labels take over
 * (`lib/map-labels.ts`). Incidents at the SAME address are one pin before this pass even starts
 * (`lib/map-spots.ts`) and take part as one pin of weight `count`.
 *
 * The pins are DOM markers, not a GeoJSON layer, so this is a small screen-space pass run when
 * the map comes to rest, not MapLibre's built-in clustering: pure, so it is unit-tested here.
 */

import type { StatusGroup } from './types/incidents'
import { PHONE_LABEL_MIN_ZOOM } from './map-labels'

/** From this zoom pins are drawn one by one again – where the phone's labels come back. */
export const CLUSTER_MAX_ZOOM = PHONE_LABEL_MIN_ZOOM

/** One incident pin at its screen position (px). */
export interface ClusterPin {
  id: string
  x: number
  y: number
  priority: string | null | undefined
  statusGroup: StatusGroup
  /** How many incidents the pin stands for: more than one for a same-address pin. Default 1. */
  count?: number
}

export interface PinCluster {
  /** Every pin in the bubble, at least two. */
  pins: ClusterPin[]
  /** The one whose mark the bubble wears – see `clusterLead`. */
  lead: ClusterPin
  /** The incidents under the bubble – the number it shows (pins weighted by `count`). */
  count: number
}

/** What decides which of several incidents speaks for them (`byUrgency`). */
export interface Urgency {
  id: string
  priority: string | null | undefined
  statusGroup: StatusGroup
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
// Waiting before being worked on before winding down: the frame of the most pressing state.
const GROUP_RANK: Record<StatusGroup, number> = { open: 0, active: 1, completed: 2 }

/**
 * Most urgent first: the highest priority (Hoch → Mittel → Niedrig → none), then the most pressing
 * status group (Offen → Aktiv → Rückfahrt & Abgeschlossen), then the id so the answer never
 * flickers between polls. A sort comparator – shared by the bubbles and the same-address pins.
 */
export function byUrgency(a: Urgency, b: Urgency): number {
  return (
    (PRIORITY_RANK[a.priority ?? ''] ?? 3) - (PRIORITY_RANK[b.priority ?? ''] ?? 3) ||
    GROUP_RANK[a.statusGroup] - GROUP_RANK[b.statusGroup] ||
    a.id.localeCompare(b.id)
  )
}

/** The pin a bubble speaks for – the most urgent (`byUrgency`). */
export function clusterLead(pins: readonly ClusterPin[]): ClusterPin {
  return [...pins].sort(byUrgency)[0]
}

/**
 * Groups the pins that overlap on screen. Agglomerative: of all nodes (a pin, or a bubble at its
 * members' centre) that touch – centre distance below the two radii plus `gap` – the two that
 * overlap most merge, again and again until nothing touches. So a bubble never lies on a pin or another bubble
 * either, and a pin that merely sits near a heap stays its own pin.
 *
 * Returns the bubbles only; every pin not in one is drawn as itself.
 */
export function clusterPins(
  pins: readonly ClusterPin[],
  { pinSize, bubbleSize, gap = 4 }: { pinSize: number; bubbleSize: number; gap?: number },
): PinCluster[] {
  type Node = { pins: ClusterPin[]; x: number; y: number }
  const radius = (node: Node) => (node.pins.length > 1 ? bubbleSize : pinSize) / 2
  // Sorted by id: the same pins give the same bubbles whatever order the incidents arrive in.
  const nodes: Node[] = [...pins].sort((a, b) => a.id.localeCompare(b.id)).map((pin) => ({ pins: [pin], x: pin.x, y: pin.y }))

  for (;;) {
    let best: { i: number; j: number; overlap: number } | null = null
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
        const overlap = radius(nodes[i]) + radius(nodes[j]) + gap - distance
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { i, j, overlap }
      }
    }
    if (!best) break
    const merged = [...nodes[best.i].pins, ...nodes[best.j].pins]
    nodes[best.i] = {
      pins: merged,
      x: merged.reduce((sum, pin) => sum + pin.x, 0) / merged.length,
      y: merged.reduce((sum, pin) => sum + pin.y, 0) / merged.length,
    }
    nodes.splice(best.j, 1)
  }

  return nodes
    .filter((node) => node.pins.length > 1)
    .map((node) => ({
      pins: node.pins,
      lead: clusterLead(node.pins),
      count: node.pins.reduce((sum, pin) => sum + (pin.count ?? 1), 0),
    }))
}
