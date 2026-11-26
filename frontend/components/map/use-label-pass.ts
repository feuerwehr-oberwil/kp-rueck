import { useEffect, useState } from "react"
import type { Map as MlMap } from "maplibre-gl"
import { incidentPinSize } from "@/lib/map-colors"
import { estimateLabelWidth, type LabelCandidate, type pickVisibleLabels } from "@/lib/map-labels"
import { CLUSTER_BUBBLE_SIZE } from "./cluster-bubble"
import { LABEL_HEIGHT, LABEL_OFFSET_X } from "./incident-label"
import type { IncidentCluster } from "./use-pin-clusters"
import { pillBoxes, type PlacedPill } from "./use-vehicle-placement"

const NO_LABELS: ReadonlySet<string> = new Set()
// The incident dot at rest (IncidentPin), which no kept label may cover – 32px on either surface.
export const INCIDENT_DOT_SIZE = incidentPinSize(false, false)

/** A label pass over the screen: the phone's `pickVisibleLabels` (who may draw) or the desktop's
 *  `placeLabelSides` (who flips left). Both answer with a set of ids. */
type LabelPass = typeof pickVisibleLabels

/** One pin's label as the passes need it: where the pin is and what the bubble says. */
export interface LabelSource {
  /** The spot key (`lib/map-spots.ts`). */
  id: string
  latitude: number
  longitude: number
  text: string
  crewCounters: number
  priority: string | null | undefined
}

/**
 * Runs a label pass (`lib/map-labels.ts`) at the current view – the phone's collision-checked
 * labels (mode `fit`) or the desktop's flipped sides (mode `all`). Recomputed when the map comes
 * to rest – the DOM labels ride along with their markers while it moves, so nothing jumps
 * mid-gesture. The count bubbles (`bubbles`) and the vehicle pills where they stand (`pills`,
 * after stepping aside) are marks no label may cover.
 */
export function useLabelPass(
  map: MlMap | null,
  active: boolean,
  pass: LabelPass,
  sources: LabelSource[],
  bubbles: IncidentCluster[],
  pills: PlacedPill[],
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(NO_LABELS)
  useEffect(() => {
    if (!map || !active) return
    const compute = () => {
      const container = map.getContainer()
      const candidates = sources.map((source): LabelCandidate => {
        const point = map.project([source.longitude, source.latitude])
        return {
          id: source.id,
          x: point.x,
          y: point.y,
          width: estimateLabelWidth(source.text, source.crewCounters),
          priority: source.priority,
        }
      })
      const next = pass(candidates, {
        labelOffsetX: LABEL_OFFSET_X,
        labelHeight: LABEL_HEIGHT,
        dotSize: INCIDENT_DOT_SIZE,
        viewport: { width: container.clientWidth, height: container.clientHeight },
        obstacles: [
          ...bubbles.map((bubble) => ({
            ...map.project([bubble.longitude, bubble.latitude]),
            width: CLUSTER_BUBBLE_SIZE,
            height: CLUSTER_BUBBLE_SIZE,
          })),
          ...pillBoxes(map, pills),
        ],
      })
      // Same answer, same object: the incident list is a new array on every poll (and every
      // render of the context), so a fresh Set each time would re-render forever.
      setIds((previous) =>
        previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next,
      )
    }
    compute()
    map.on("moveend", compute)
    return () => { map.off("moveend", compute) }
  }, [map, active, pass, sources, bubbles, pills])
  return active ? ids : NO_LABELS
}
