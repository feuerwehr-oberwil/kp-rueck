import { useEffect, useState } from "react"
import type { Map as MlMap } from "maplibre-gl"
import type { MapIncident } from "@/lib/map-incident"
import { STATUS_TO_GROUP } from "@/lib/types/incidents"
import { incidentPinSize } from "@/lib/map-colors"
import { CLUSTER_MAX_ZOOM, clusterPins, type PinCluster } from "@/lib/map-clusters"
import { clusterableSpots, type MapSpot } from "@/lib/map-spots"
import { CLUSTER_BUBBLE_SIZE } from "./cluster-bubble"
import { pinBadgeCircle } from "./pin-count-badge"

/** One address's pin on the Lagekarte: its incidents, their lead and its point (`lib/map-spots.ts`). */
export type IncidentSpot = MapSpot<MapIncident>

/** A bubble on the map: its pins' incidents, drawn at their geographic centre. */
export interface IncidentCluster {
  key: string
  /** The spot keys merged into it – their pins and labels are left out. */
  spotKeys: string[]
  incidents: MapIncident[]
  lead: MapIncident
  latitude: number
  longitude: number
}

const NO_CLUSTERS: IncidentCluster[] = []

/**
 * The count bubbles (`lib/map-clusters.ts`), phone and desktop: which pins merge at the current
 * view, below `CLUSTER_MAX_ZOOM`. A same-address pin takes part as one pin of weight n. Recomputed
 * when the map comes to rest, like the labels. `keepApart` (the selected and the Reko-highlighted
 * incidents) keeps their spots pins of their own (`clusterableSpots`).
 */
export function usePinClusters(
  map: MlMap | null,
  spots: IncidentSpot[],
  keepApart: ReadonlySet<string>,
  compact: boolean,
): IncidentCluster[] {
  const [clusters, setClusters] = useState<IncidentCluster[]>(NO_CLUSTERS)
  useEffect(() => {
    if (!map) return
    const byKey = new Map(spots.map((spot) => [spot.key, spot]))
    const compute = () => {
      if (map.getZoom() >= CLUSTER_MAX_ZOOM) {
        setClusters(NO_CLUSTERS)
        return
      }
      const pins = clusterableSpots(spots, keepApart).map((spot) => {
        const point = map.project([spot.longitude, spot.latitude])
        return {
          id: spot.key,
          x: point.x,
          y: point.y,
          priority: spot.lead.priority,
          statusGroup: STATUS_TO_GROUP[spot.lead.status] || "open",
          count: spot.incidents.length,
        }
      })
      const pinSize = incidentPinSize(false, compact)
      const next = clusterPins(pins, {
        pinSize,
        bubbleSize: CLUSTER_BUBBLE_SIZE,
        badge: pinBadgeCircle(pinSize),
      }).map((cluster: PinCluster): IncidentCluster => {
        const joined = cluster.pins.map((pin) => byKey.get(pin.id)!)
        return {
          key: cluster.pins.map((pin) => pin.id).join(","),
          spotKeys: cluster.pins.map((pin) => pin.id),
          incidents: joined.flatMap((spot) => spot.incidents),
          lead: byKey.get(cluster.lead.id)!.lead,
          // The plain mean of the joined PINS – where `clusterPins` tested the bubble for
          // overlap. Weighted by incidents, a 3-incident pin would pull it onto a neighbour.
          latitude: joined.reduce((sum, spot) => sum + spot.latitude, 0) / joined.length,
          longitude: joined.reduce((sum, spot) => sum + spot.longitude, 0) / joined.length,
        }
      })
      // Same grouping, same array: the incident list is a new array on every poll. The members
      // count too – a status filter can hide one of a joined spot's incidents, keeping key + lead.
      setClusters((previous) => {
        const same =
          previous.length === next.length &&
          previous.every(
            (cluster, i) =>
              cluster.key === next[i].key &&
              cluster.lead === next[i].lead &&
              cluster.incidents.length === next[i].incidents.length &&
              cluster.incidents.every((incident, j) => incident.id === next[i].incidents[j].id),
          )
        return same ? previous : next.length === 0 ? NO_CLUSTERS : next
      })
    }
    compute()
    map.on("moveend", compute)
    return () => { map.off("moveend", compute) }
  }, [map, spots, keepApart, compact])
  return clusters
}
