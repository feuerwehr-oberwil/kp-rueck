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
import type { RasterLayerSpecification } from 'react-map-gl/maplibre'

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
 * Where MapLibre's worker is served from: `public/maplibre/`, filled from node_modules by
 * `scripts/copy-maplibre-worker.mjs` before every `dev` and `build`. See `base-map.tsx`.
 */
export const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs'

/**
 * The one z-order for DOM markers on the main map and its overlays.
 *
 * MapLibre appends every marker to the canvas container, so a plain `zIndex` on the marker
 * element settles stacking. An incident's permanent label is its OWN marker (IncidentLabel in
 * `components/map-view.tsx`), so pins and labels can sit in separate bands:
 *
 * - at rest every pin paints above every label (hill climb r14) – a label may run under a
 *   neighbouring dot, but it never hides that dot's priority colour and chevron; inside each
 *   band Hoch over Mittel over Niedrig (`incidentZ`);
 * - an Auftrag's numbered stop pin covers a plain incident dot;
 * - the selected/highlighted incident (label, then its pin) clears every resting pin and stop;
 * - the pointed-at one (label/hover card, then its pin) clears everything – the hovered route
 *   stop included.
 *
 * The map controls (`.maplibregl-ctrl-*`) are pinned above the whole range by `base-map.tsx`'s
 * `z-maplibre-ctrl`, and our own map chrome that has to clear the range uses `z-map-control`
 * (the z-order block in app/globals.css holds both). Numbers, not those rungs, because these go
 * on a MapLibre `<Marker>` as an inline style — and because the page's ladder must stay out of a
 * scale that is only ever read inside the map's `isolate`.
 *
 * `label` and `incident` are the floors of three-step priority bands; read them through
 * `incidentZ`, not directly.
 *
 * The dialog maps (Routen-Editor, Einsatz-Picker) keep their own small local scales – separate
 * maps, no incident markers, no reason to couple them.
 */
export const Z = {
  station: 10,
  vehicle: 40,
  label: 50,
  incident: 60,
  routeStop: 100,
  distancePill: 250,
  labelSelected: 300,
  incidentHighlighted: 310,
  routeStopHighlighted: 310,
  routeStopHovered: 400,
  labelHovered: 600,
  incidentHovered: 610,
} as const

const PRIORITY_RANK: Partial<Record<string, number>> = { high: 2, medium: 1 }

/**
 * The z of an incident's pin or its label (see `Z`). `hovered` = pointed at (a label also counts
 * its pinned, click-selected incident as hovered – it shows the hover card); `highlighted` =
 * selected on the map or highlighted from the list/Reko. Phone and desktop alike: on a phone the
 * kept labels never cover a dot anyway (`lib/map-labels.ts`).
 */
export function incidentZ(
  part: 'pin' | 'label',
  priority: string | null | undefined,
  state: { hovered: boolean; highlighted: boolean },
): number {
  const pin = part === 'pin'
  if (state.hovered) return pin ? Z.incidentHovered : Z.labelHovered
  if (state.highlighted) return pin ? Z.incidentHighlighted : Z.labelSelected
  return (pin ? Z.incident : Z.label) + (PRIORITY_RANK[priority ?? ''] ?? 0)
}

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
export const DAY_BASE_PAINT: RasterLayerSpecification['paint'] = {
  'raster-saturation': -0.7,
  'raster-brightness-min': 0.05,
  'raster-contrast': -0.05,
}

export const NIGHT_BASE_PAINT: RasterLayerSpecification['paint'] = {
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
export const DARK_BASE_PAINT: RasterLayerSpecification['paint'] = {
  'raster-brightness-min': 0.34,
  'raster-contrast': -0.05,
}
