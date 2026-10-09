"use client"

/**
 * The precipitation radar as a MapLibre image overlay (frames from `GET /api/weather/`).
 *
 * The backend already resampled every frame onto Web Mercator, so the four corners are an
 * axis-aligned rectangle and MapLibre only stretches it – no reprojection happens here.
 *
 * Always MOUNTED once the map has it, like every overlay source on this map (plan 28): a source
 * that mounts later is appended on the next `styledata` on top of everything – the radar would
 * then veil the routes and lines instead of lying under them. Before the first frame it holds
 * a transparent pixel; «off» is `visibility: none`.
 *
 * Stale = greyed: `raster-saturation: -1` takes the colour out of a radar picture that is older
 * than the source's limit, so nobody reads an old shower as the current one.
 */

import { useEffect, useMemo } from "react"
import { Layer, Source, type RasterLayerSpecification } from "react-map-gl/maplibre"
import { apiClient } from "@/lib/api-client"
import { vis } from "@/lib/map-view"
import type { WeatherRadar } from "@/lib/weather"

export const WEATHER_RADAR_SOURCE_ID = "weather-radar"
export const WEATHER_RADAR_LAYER_ID = "weather-radar-layer"

const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
// Switzerland, roughly – only where the placeholder pixel sits until the first frame arrives.
const PLACEHOLDER_COORDINATES: [number, number][] = [
  [5.9, 47.9],
  [10.5, 47.9],
  [10.5, 45.8],
  [5.9, 45.8],
]

export function WeatherRadarLayer({
  radar,
  frameIndex,
  visible,
  opacity,
  stale,
}: {
  radar: WeatherRadar | null
  frameIndex: number
  visible: boolean
  /** 0–1 */
  opacity: number
  stale: boolean
}) {
  const frames = radar?.frames ?? []
  const frame = frames[Math.min(Math.max(frameIndex, 0), frames.length - 1)]
  const url = frame ? apiClient.weatherRadarFrameUrl(frame.key) : TRANSPARENT_PIXEL
  const coordinates = (radar?.coordinates ?? PLACEHOLDER_COORDINATES) as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ]

  // Warm the browser cache with the whole hour while the layer is on, so scrubbing and the
  // loop swap images without a fetch (each frame is immutable on the backend).
  const frameKeys = frames.map((f) => f.key).join(",")
  useEffect(() => {
    if (!visible || !frameKeys) return
    for (const key of frameKeys.split(",")) {
      const image = new Image()
      image.src = apiClient.weatherRadarFrameUrl(key)
    }
  }, [visible, frameKeys])

  const paint = useMemo<RasterLayerSpecification["paint"]>(
    () => ({
      "raster-opacity": opacity,
      "raster-fade-duration": 0,
      "raster-resampling": "linear",
      "raster-saturation": stale ? -1 : 0,
    }),
    [opacity, stale],
  )

  return (
    <Source id={WEATHER_RADAR_SOURCE_ID} type="image" url={url} coordinates={coordinates}>
      <Layer
        id={WEATHER_RADAR_LAYER_ID}
        type="raster"
        layout={vis(visible && !!frame)}
        paint={paint}
      />
    </Source>
  )
}
