import type { Map as MlMap } from "maplibre-gl"
import { Marker } from "react-map-gl/maplibre"
import { useTranslations } from "next-intl"
import { STATUS_TO_GROUP } from "@/lib/types/incidents"
import { boundsOfLatLng, incidentZ, type LatLngPoint } from "@/lib/map-view"
import { ClusterBubble } from "./cluster-bubble"
import { priorityName } from "./spot-list"
import { MAX_FOCUS_ZOOM, type FitPadding } from "./use-map-camera"
import type { IncidentCluster } from "./use-pin-clusters"

/**
 * One count bubble. A click or tap zooms to its incidents – at least one step, so a group that
 * still overlaps at its own fit opens up a little more with every click – and never past the
 * focus band.
 */
export function ClusterMarker({
  cluster,
  map,
  compact,
  padding,
}: {
  cluster: IncidentCluster
  map: MlMap | null
  compact: boolean
  padding: FitPadding
}) {
  const t = useTranslations("map")
  const priority = cluster.lead.priority
  const name = t("view.clusterAria", { count: cluster.incidents.length, priority: priorityName(t, priority) })
  const zoomIn = () => {
    if (!map) return
    const bounds = boundsOfLatLng(cluster.incidents.map((inc) => [inc.location_lat!, inc.location_lng!] as LatLngPoint))
    if (!bounds) return
    const camera = map.cameraForBounds(bounds, { padding: padding(60) })
    const zoom = Math.min(Math.max(camera?.zoom ?? 0, map.getZoom() + 1), MAX_FOCUS_ZOOM)
    map.flyTo({ center: camera?.center ?? [cluster.longitude, cluster.latitude], zoom, duration: 600 })
  }
  return (
    <Marker
      longitude={cluster.longitude}
      latitude={cluster.latitude}
      style={{ zIndex: incidentZ("pin", priority, { hovered: false, highlighted: false }) }}
      // Like every marker: the click must not reach the map canvas underneath.
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      <button type="button" className="block rounded-full" aria-label={name} title={name} onClick={zoomIn}>
        <ClusterBubble
          count={cluster.incidents.length}
          priority={priority}
          group={STATUS_TO_GROUP[cluster.lead.status] || "open"}
          compact={compact}
        />
      </button>
    </Marker>
  )
}
