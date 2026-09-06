/**
 * Pure MapLibre helpers, copied from KP Front (`src/lib/mapView.ts`).
 *
 * The two apps deliberately do NOT share a package (recorded decision in Front's
 * `docs/planning/running-both.md`) – they share patterns instead, so the same names mean the
 * same thing on both boards. No React in here, so everything is unit-testable on its own.
 */

import type {
  FitBoundsOptions,
  GeoJSONSourceSpecification,
  Map as MlMap,
  StyleSpecification,
} from 'maplibre-gl'
import type { RasterLayer } from 'react-map-gl/maplibre'

/**
 * A GeoJSON FeatureCollection as MapLibre's own types spell it.
 *
 * `@types/geojson` is a transitive dep pnpm keeps off the app's resolution path, so
 * `import from 'geojson'` does not resolve – the shape is derived from the source spec instead.
 */
export type FeatureCollectionData = Extract<
  GeoJSONSourceSpecification['data'],
  { type: 'FeatureCollection' }
>

/** Fallback map centre – the Feuerwehrmagazin Oberwil, as `[lat, lng]`. */
export const DEFAULT_CENTER_LATLNG: readonly [number, number] = [
  47.51637699933488, 7.561800450458299,
]

/**
 * The one z-order for DOM markers on the main map and its overlays.
 *
 * MapLibre appends every marker to the canvas container, so a plain `zIndex` on the marker
 * element settles stacking. The values keep Leaflet's relative order: an Auftrag's numbered stop
 * pin covers a plain incident dot but yields to a highlighted or hovered one, an assignment's
 * distance pill sits above both, and the three label tiers mirror Leaflet's tooltip pane sitting
 * above the marker pane – a label is text to be read and always wins. The map controls
 * (`.maplibregl-ctrl-*`) are pinned above the whole range at 2000 by `base-map.tsx`.
 *
 * The dialog maps (Routen-Editor, Einsatz-Picker) keep their own small local scales – separate
 * maps, no incident markers, no reason to couple them.
 */
export const Z = {
  station: 10,
  vehicle: 40,
  incident: 50,
  routeStop: 100,
  distancePill: 250,
  incidentHighlighted: 300,
  routeStopHighlighted: 300,
  routeStopHovered: 400,
  incidentHovered: 600,
  label: 700,
  labelSelected: 900,
  labelHovered: 1000,
} as const

/**
 * A style with nothing in it.
 *
 * The online modes are raster XYZ sources that the app declares as react-map-gl
 * `<Source>`/`<Layer>` children, not as a hosted style document – so the `mapStyle` a map is
 * handed has to be a valid, empty style rather than a URL.
 */
export const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] }

/**
 * Layer visibility as a `layout` fragment.
 *
 * Toggling `visibility` is how a layer is turned off; unmounting the `<Source>`/`<Layer>` pair
 * instead makes react-map-gl re-append it on the next `styledata`, which lands it back ON TOP
 * of everything drawn after it.
 */
export const vis = (on: boolean) => ({ visibility: (on ? 'visible' : 'none') as 'visible' | 'none' })

/** Screen pixels per metre at a latitude and zoom – the scale factor of Web Mercator. */
export const pxPerM = (lat: number, z: number) =>
  Math.pow(2, z) / (156543.03392 * Math.cos((lat * Math.PI) / 180))

/** Web-Mercator northing – the y half of the projection, without a map instance. */
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/**
 * Web-Mercator world pixel at a zoom. On a north-up map these are screen pixels up to a pan, so
 * a distance measured here is a distance on screen – which is what label stacking needs, without
 * asking the map to project every point on every render.
 */
export function worldPx(lngLat: [number, number], z: number): [number, number] {
  const s = 256 * Math.pow(2, z)
  return [((lngLat[0] + 180) / 360) * s, (0.5 - mercY(lngLat[1]) / (2 * Math.PI)) * s]
}

/** A point in the order the app speaks it – `[lat, lng]`, which is MapLibre's reversed. */
export type LatLngPoint = readonly [number, number]

/**
 * `[[west, south], [east, north]]` around the points – MapLibre's corner pair – or null when
 * there is nothing to frame.
 *
 * The pure half of `fitTo`: no map instance, so a caller that only wants to know whether there
 * is a box at all (an «alles einpassen» button, say) can ask without touching the map.
 */
export function boundsOfLatLng(
  points: readonly LatLngPoint[],
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lat, lng] of points) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [
    [west, south],
    [east, north],
  ]
}

export type FitToOptions = FitBoundsOptions & {
  /**
   * Zoom to use when there is exactly ONE point.
   *
   * A zero-size box makes `fitBounds` land on `maxZoom`, which is usually too far out for a
   * single pin – so the dialogs pick their own scale instead. Omit it to let `fitBounds` handle
   * the single point like any other box.
   */
  singleZoom?: number
}

/**
 * Frame `points` on `map` – the one fit every surface uses.
 *
 * Padding, `maxZoom` and duration stay with the caller: a print page, a dialog and the Lagekarte
 * disagree about all three, and those numbers are part of how each surface looks. What is shared
 * is the bookkeeping around them – no points means no move, and one point means a centre rather
 * than a degenerate box.
 */
export function fitTo(map: MlMap, points: readonly LatLngPoint[], options: FitToOptions): void {
  const { singleZoom, ...fitOptions } = options
  const bounds = boundsOfLatLng(points)
  if (!bounds) return

  if (points.length === 1 && singleZoom !== undefined) {
    const center: [number, number] = [points[0][1], points[0][0]]
    // An animation is only worth having when the caller asked for one; every current caller of
    // the single-point path fits instantly.
    if (fitOptions.animate === false || !fitOptions.duration) {
      map.jumpTo({ center, zoom: singleZoom })
    } else {
      map.flyTo({ center, zoom: singleZoom, duration: fitOptions.duration })
    }
    return
  }

  map.fitBounds(bounds, fitOptions)
}

/**
 * Basemap paint, per theme – the raster equivalent of a CSS filter over the tiles.
 *
 * The basemap is muted so incident markers, assignment lines and routes carry the colour. Under
 * Leaflet a CSS filter on the tile pane did that, and the SVG overlay pane stayed untouched. A GL
 * canvas has no such split: EVERY layer is drawn into it, so filtering the canvas greys out the
 * red assignment lines along with the map. `raster-*` paint applies to one layer, which is where
 * the muting belongs.
 *
 * The values reproduce the pre-migration Leaflet look. Day was `saturate(0.3) brightness(1.05)
 * contrast(0.95)`: `raster-saturation` runs −1…0 for desaturation, and there is no multiplicative
 * brightness, so the 1.05 lift becomes a slightly raised black floor. Night was `saturate(0)
 * brightness(0.6) contrast(1.1)` – the same shape as KP Front's empirically tuned night paint,
 * but fully desaturated, because Rück's dark map drops colour entirely rather than merely dimming.
 */
export const DAY_BASE_PAINT: RasterLayer['paint'] = {
  'raster-saturation': -0.7,
  'raster-brightness-min': 0.05,
  'raster-contrast': -0.05,
}

export const NIGHT_BASE_PAINT: RasterLayer['paint'] = {
  'raster-saturation': -1,
  'raster-brightness-max': 0.6,
  'raster-contrast': 0.1,
}

/**
 * Raster paint for a basemap that is ALREADY dark (the `carto-dark` style option).
 *
 * Such a raster renders buildings near-black on black, and `NIGHT_BASE_PAINT` on top of it only
 * makes that worse. `raster-brightness-min` is the lever: it lifts the black floor so the dark
 * structure rises into a legible charcoal. Positive `raster-contrast` would do the opposite here,
 * so it stays flat/slightly negative.
 *
 * `base-map.tsx` selects it whenever the chosen online style is the already-dark raster, in
 * either theme – `DAY_BASE_PAINT` would desaturate it to mud and `NIGHT_BASE_PAINT`'s brightness
 * cap would crush it to black.
 */
export const DARK_BASE_PAINT: RasterLayer['paint'] = {
  'raster-brightness-min': 0.34,
  'raster-contrast': -0.05,
}
