"use client"

/**
 * RekoRouteLine – the Reko-Modus order on the map: a DOTTED line in the Reko person's colour
 * through their open Rekos, in their order (feedback 19.11.2026, #19, mock 2a).
 *
 * The sibling of the Auftrag routes (`group-routes.tsx`), drawn apart on purpose: an Auftrag's
 * line is solid, a Reko person's is dotted, so the two never read as one route. The numbers sit
 * inside the incident pins themselves (`MapView`'s `rekoRoute`), not on extra pins.
 *
 * Always mounted inside `<BaseMap>` (fed no points when nobody is selected), so its source keeps
 * its place in the layer order.
 */

import { useMemo } from "react"
import { Layer, Source, type LineLayerSpecification } from "react-map-gl/maplibre"
import type { FeatureCollectionData } from "@/lib/map-view"

/** The selected Reko person's order, as the map draws it. */
export interface RekoRoute {
  /** The person's map colour («Färben nach Reko»). */
  color: string
  /** Their open Rekos (Einsatz ids), first to do first. */
  incidentIds: string[]
}

export const REKO_ROUTE_SOURCE_ID = "reko-route"

// Round caps on zero-length dashes draw dots; the gap is in line widths.
const REKO_ROUTE_PAINT: LineLayerSpecification["paint"] = {
  "line-color": ["get", "color"],
  "line-opacity": 0.7,
  "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 6],
  "line-dasharray": [0, 2],
}

export function RekoRouteLine({ color, points }: {
  color: string | null
  /** The located Rekos in order, as [lat, lng]. */
  points: [number, number][]
}) {
  const data = useMemo<FeatureCollectionData>(
    () => ({
      type: "FeatureCollection",
      features:
        color && points.length >= 2
          ? [
              {
                type: "Feature",
                properties: { color },
                // GeoJSON is [lng, lat].
                geometry: { type: "LineString", coordinates: points.map(([lat, lng]) => [lng, lat]) },
              },
            ]
          : [],
    }),
    [color, points],
  )

  return (
    <Source id={REKO_ROUTE_SOURCE_ID} type="geojson" data={data}>
      <Layer
        id={`${REKO_ROUTE_SOURCE_ID}-line`}
        type="line"
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={REKO_ROUTE_PAINT}
      />
    </Source>
  )
}
