"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import type { Map as MlMap, MapLayerMouseEvent } from "maplibre-gl"
import { Layer, Popup, Source, useMap, type LineLayer } from "react-map-gl/maplibre"

import { apiClient, type ApiVehicleTrail } from "@/lib/api-client"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"
import { MAP_COLORS } from "@/lib/map-colors"
import { vis, type FeatureCollectionData } from "@/lib/map-view"
import { cn } from "@/lib/utils"

/** One GeoJSON source holds every trail; the colour rides along per feature. */
export const TRAIL_SOURCE_ID = "vehicle-trails"
export const TRAIL_LAYER_ID = "vehicle-trails-line"
/** The invisible fat line under the visible one – see `TRAIL_HIT_PAINT`. Hover binds to this. */
export const TRAIL_HIT_LAYER_ID = "vehicle-trails-hit"

const TRAIL_WIDTH_PX = 2

/**
 * The Leaflet look, in MapLibre units.
 *
 * `line-dasharray` counts in LINE WIDTHS, not pixels – so Leaflet's `dashArray: "4, 8"` on a
 * 2px stroke is `[2, 4]` here. Change the reference width and this has to be recomputed. The
 * pattern scales with the interpolated width below, which is the usual cartographic behaviour
 * for a static dash: at every zoom the trail keeps the same 1 : 2 rhythm it always had.
 */
const TRAIL_DASH = [4 / TRAIL_WIDTH_PX, 8 / TRAIL_WIDTH_PX]

/**
 * The visible trail.
 *
 * `line-width` interpolates by zoom – ~60 % of the old fixed 2 px at z11, ~130 % at z16. A fixed
 * pixel width was a Leaflet constraint, and it showed at both ends: a dozen trails over the whole
 * Gemeinde matted together, while a single trail followed down one street stayed hairline-thin
 * next to the vehicle pill it belongs to. Linear between the two stops leaves the board's default
 * zoom 13 at ~90 %, so the familiar look barely moves.
 */
const TRAIL_PAINT: LineLayer["paint"] = {
  "line-color": ["get", "color"],
  "line-width": ["interpolate", ["linear"], ["zoom"], 11, TRAIL_WIDTH_PX * 0.6, 16, TRAIL_WIDTH_PX * 1.3],
  "line-opacity": 0.35,
  "line-dasharray": TRAIL_DASH,
}

/**
 * The hover target. The visible trail is a 2 px dashed line at 35 % opacity – a target the mouse
 * misses far more often than it hits, and the operator concludes the vehicle name simply does not
 * show. So a fully transparent 18 px line rides on the same source, below the visible one, and the
 * mouse listeners bind to *its* id. Same trick as KP Front's `l-draw-hit`. Static width: nothing
 * is drawn, and shrinking the target when zoomed out would defeat the point.
 */
const TRAIL_HIT_PAINT: LineLayer["paint"] = {
  "line-color": ["get", "color"],
  "line-width": 18,
  "line-opacity": 0,
}

interface VehicleTrailsProps {
  /** Whether Traccar is configured and trails should be fetched */
  enabled: boolean
  /** How many minutes of trail history to show */
  minutes?: number
  /** Polling interval in ms */
  pollInterval?: number
}

/** What the cursor is currently over – the sticky tooltip follows it. */
interface TrailHover {
  longitude: number
  latitude: number
  name: string
}

const EMPTY_TRAILS: FeatureCollectionData = { type: "FeatureCollection", features: [] }

/**
 * Renders fading breadcrumb trails behind each GPS-tracked vehicle.
 * Each trail is a line feature showing the vehicle's recent path.
 *
 * Mounts as a child of `<BaseMap>`: one GeoJSON source for all vehicles, one line layer with
 * data-driven colour, so adding a vehicle is a feature – not another source/layer pair.
 */
export function VehicleTrails({
  enabled,
  minutes = 30,
  pollInterval = 30000,
}: VehicleTrailsProps) {
  const [trails, setTrails] = useState<ApiVehicleTrail[]>([])
  const [hover, setHover] = useState<TrailHover | null>(null)
  const { current: map } = useMap()

  const fetchTrails = useCallback(async () => {
    try {
      const data = await apiClient.getVehicleTrails(minutes)
      setTrails(data)
    } catch {
      // Silent — trails are optional
    }
  }, [minutes])

  useEffect(() => {
    if (!enabled) return

    fetchTrails()

    // Listen for WebSocket trail updates
    const unsubscribeTrails = wsClient.on('vehicle_trails_update', (data: { data: ApiVehicleTrail[] }) => {
      setTrails(data.data)
    })

    // Fallback polling when WebSocket is disconnected
    let interval: NodeJS.Timeout | undefined

    const startPolling = () => {
      if (!interval) {
        interval = setInterval(fetchTrails, pollInterval)
      }
    }

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval)
        interval = undefined
      }
    }

    const unsubscribeStatus = wsClient.onStatusChange((status: WebSocketStatus) => {
      if (status === 'disconnected' || status === 'error') {
        startPolling()
      } else if (status === 'connected') {
        stopPolling()
      }
    })

    return () => {
      unsubscribeTrails()
      unsubscribeStatus()
      stopPolling()
    }
  }, [enabled, fetchTrails, pollInterval])

  const data = useMemo<FeatureCollectionData>(() => {
    if (!enabled) return EMPTY_TRAILS
    return {
      type: "FeatureCollection",
      features: trails
        // A single fix is a dot, not a path – Leaflet drew nothing for it either.
        .filter((trail) => trail.points.length >= 2)
        .map((trail) => ({
          type: "Feature",
          id: trail.device_id,
          properties: { name: trail.device_name, color: MAP_COLORS.info },
          geometry: {
            type: "LineString",
            coordinates: trail.points.map((p) => [p.longitude, p.latitude]),
          },
        })),
    }
  }, [enabled, trails])

  // Leaflet's `<Tooltip sticky>`: name the vehicle while the pointer rides the trail. Registered
  // on the raw map because a layer-scoped listener is not part of react-map-gl's `<Map>` props –
  // MapLibre ignores the id until the layer exists, so mount order does not matter. Bound to the
  // invisible hit layer, not the visible one: same source, same `name` property, eighteen pixels
  // of aim instead of two.
  useEffect(() => {
    const instance: MlMap | undefined = map?.getMap()
    if (!instance) return

    const handleMove = (event: MapLayerMouseEvent) => {
      const name = event.features?.[0]?.properties?.name
      setHover(
        typeof name === "string"
          ? { longitude: event.lngLat.lng, latitude: event.lngLat.lat, name }
          : null,
      )
    }
    const handleLeave = () => setHover(null)

    instance.on("mousemove", TRAIL_HIT_LAYER_ID, handleMove)
    instance.on("mouseleave", TRAIL_HIT_LAYER_ID, handleLeave)

    return () => {
      instance.off("mousemove", TRAIL_HIT_LAYER_ID, handleMove)
      instance.off("mouseleave", TRAIL_HIT_LAYER_ID, handleLeave)
    }
  }, [map])

  // The source stays mounted even with nothing to show: remounting it would re-append the layer
  // on the next `styledata` and land it on top of everything drawn after it (plan 28).
  return (
    <>
      <Source id={TRAIL_SOURCE_ID} type="geojson" data={data}>
        {/* First child = drawn first = underneath. Invisible either way, but it keeps the visible
            trail the one that paints. Toggled with `vis()` like its sibling: a layer set to
            `visibility: none` is not hit-tested, which is what we want when trails are off. */}
        <Layer
          id={TRAIL_HIT_LAYER_ID}
          type="line"
          layout={{ ...vis(enabled), "line-cap": "round", "line-join": "round" }}
          paint={TRAIL_HIT_PAINT}
        />
        <Layer
          id={TRAIL_LAYER_ID}
          type="line"
          layout={{ ...vis(enabled), "line-cap": "round", "line-join": "round" }}
          paint={TRAIL_PAINT}
        />
      </Source>

      {enabled && hover && (
        <Popup
          longitude={hover.longitude}
          latitude={hover.latitude}
          offset={12}
          closeButton={false}
          closeOnClick={false}
          // Never steal the focus from the board while the pointer merely passes over a trail.
          focusAfterOpen={false}
          className={cn(
            "pointer-events-none",
            "[&_.maplibregl-popup-tip]:hidden",
            "[&_.maplibregl-popup-content]:rounded-md [&_.maplibregl-popup-content]:border",
            "[&_.maplibregl-popup-content]:bg-popover [&_.maplibregl-popup-content]:text-popover-foreground",
            "[&_.maplibregl-popup-content]:px-2 [&_.maplibregl-popup-content]:py-1",
            "[&_.maplibregl-popup-content]:shadow-md",
          )}
        >
          <span className="text-xs">{hover.name} – letzte {minutes} Min.</span>
        </Popup>
      )}
    </>
  )
}
