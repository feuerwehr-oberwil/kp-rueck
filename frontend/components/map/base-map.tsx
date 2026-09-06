'use client'

/**
 * The one MapLibre `<Map>` wrapper every map surface mounts (plan 28).
 *
 * It owns everything that is the same on all of them and was copy-pasted per surface under
 * Leaflet: which basemap the station's `map_mode`/`map_style` settings resolve to, the one-way
 * auto→offline fallback, container resizing inside a dialog, WebGL context recovery, the dark-mode
 * look, and attribution. Surfaces contribute only their own content – markers, sources and layers
 * go in as children, so react-map-gl re-applies them across a `mapStyle` swap.
 */

import 'maplibre-gl/dist/maplibre-gl.css'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { Map as MlMap, RequestTransformFunction } from 'maplibre-gl'
import Map, {
  Layer,
  Source,
  type ErrorEvent,
  type MapEvent,
  type MapLayerMouseEvent,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'

import { DARK_BASE_PAINT, DAY_BASE_PAINT, EMPTY_STYLE, NIGHT_BASE_PAINT } from '@/lib/map-view'
import { offlineBasemapFor, useMapMode } from '@/lib/hooks/use-map-mode'
import { useTileAvailability } from '@/lib/hooks/use-tile-availability'
import { useGlRecovery } from '@/lib/hooks/use-gl-recovery'
import { useNightTheme } from '@/lib/hooks/use-night-theme'
import { reportClientError } from '@/lib/report-error'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MapAttribution } from './map-attribution'

/** Ids of the basemap source/layer pair. Surface layers stay above it by rendering after it. */
export const BASE_SOURCE_ID = 'kp-basemap'
export const BASE_LAYER_ID = 'kp-basemap-tiles'

/**
 * How long a tile failure waits before it flips the whole map to offline.
 *
 * An outage fails every tile in the viewport at once, and the fallback is a style swap now, not a
 * per-tile URL change – so this collapses the burst into exactly one flip.
 */
const TILE_FALLBACK_DEBOUNCE_MS = 750

/** The GL canvas fills the wrapper; the wrapper is what surfaces size. */
const MAP_CANVAS_STYLE: CSSProperties = { width: '100%', height: '100%' }

/**
 * Give root-relative URLs an origin, because the tile worker has none.
 *
 * In a deployment the tileserver sits at `/tiles` on the app's own origin, so the vector style
 * names its tiles root-relative. MapLibre fetches the style, its TileJSON and the glyphs on the
 * main thread – all fine – but the tiles themselves are fetched inside a worker created from a
 * `blob:` URL, which has no base to resolve against: `new Request('/tiles/data/v3/13/…pbf')`
 * throws «Failed to parse URL». The result is a map that looks like it loaded and then draws
 * nothing. Unconditional on purpose: it is a no-op for the absolute online tile URLs.
 */
const transformRequest: RequestTransformFunction = (url) =>
  url.startsWith('/') ? { url: window.location.origin + url } : { url }

/**
 * Muting for the offline VECTOR style, where the basemap is not ours to paint.
 *
 * The vector style brings its own 47 layers, so there is no single layer to hang `raster-*` paint
 * on – the only lever left is a filter over the whole canvas, which also catches the overlay
 * layers drawn into it. That is a real compromise, taken only here: offline vector is the rare
 * path, and plan 28's Phase F replaces it with a proper dark variant of the style itself. Every
 * raster basemap (all online modes, the offline raster fallback) uses per-layer paint instead –
 * see `DAY_BASE_PAINT` / `NIGHT_BASE_PAINT`.
 *
 * The values reproduce the pre-migration Leaflet look: a lightly desaturated day map, a fully
 * desaturated and dimmed night map.
 */
const VECTOR_CANVAS_FILTER =
  '[&_.maplibregl-canvas]:[filter:saturate(0.3)_brightness(1.05)_contrast(0.95)] ' +
  'dark:[&_.maplibregl-canvas]:[filter:saturate(0)_brightness(0.6)_contrast(1.1)]'

/**
 * Map controls sit at the TOP of the z-order.
 *
 * MapLibre puts DOM markers in the canvas container, which carries no z-index of its own, while
 * the `.maplibregl-ctrl-*` corners sit at `z-index: 2`. A marker with an inline z-index – the
 * surfaces go up to 1000 for labels and hovered pins – therefore paints over the zoom buttons
 * near a corner and swallows their clicks. Leaflet guaranteed the opposite; this restores it.
 *
 * `!` is not decorative: Tailwind's utilities live in `@layer utilities`, `maplibre-gl.css` is
 * imported unlayered, and unlayered CSS wins over ANY layered rule whatever its specificity.
 * Without the important flag these four classes are emitted, matched – and ignored.
 */
const CONTROL_Z_ORDER =
  '[&_.maplibregl-ctrl-top-left]:z-[2000]! [&_.maplibregl-ctrl-top-right]:z-[2000]! ' +
  '[&_.maplibregl-ctrl-bottom-left]:z-[2000]! [&_.maplibregl-ctrl-bottom-right]:z-[2000]!'

/** The view a map opens at. No bearing – the board never rotates. */
export interface BaseMapViewState {
  longitude: number
  latitude: number
  zoom: number
}

export interface BaseMapProps {
  /** Opening view. Consumed once per map instance; a recovery remount resumes the live view. */
  initialViewState: BaseMapViewState
  /** Sizing/rounding for the wrapper. The map itself always fills it. */
  className?: string
  /** `false` for a static instance (print) – no pan, no zoom, no keyboard. */
  interactive?: boolean
  /** CSS cursor over the map, e.g. `crosshair` while placing a pin. */
  cursor?: string
  /** Layer ids whose features `onClick` should report in `event.features`. */
  interactiveLayerIds?: string[]
  /** Keep the GL back-buffer so the canvas can be captured. Print only – it costs memory. */
  preserveDrawingBuffer?: boolean
  /**
   * Pin the raster basemap to its DAY paint, whatever the operator's theme is. Print only:
   * paper is always light, and the night paint puts a near-black rectangle on it. A CSS filter
   * cannot undo this – `NIGHT_BASE_PAINT` is handed to the GL renderer, not to the canvas.
   */
  forceDayPaint?: boolean
  onClick?: (event: MapLayerMouseEvent) => void
  /** The live instance, for surfaces that drive it from outside (`fitBounds`, `flyTo`). */
  onLoad?: (map: MlMap) => void
  /** Markers, sources and layers of the surface. */
  children?: ReactNode
}

/**
 * Did this error come from the basemap's own tiles?
 *
 * MapLibre has no per-tile error event – a failed tile arrives as a map `error` naming the source
 * it belongs to. That field is not in react-map-gl's `ErrorEvent` type, hence the narrowing.
 */
function isBasemapTileError(event: ErrorEvent): boolean {
  return (event as { sourceId?: unknown }).sourceId === BASE_SOURCE_ID
}

/**
 * Did the map fail to come up at all – no WebGL on this machine, or the library itself refusing?
 *
 * There is no event for this. react-map-gl builds the map inside a promise and routes a rejection
 * to `onError` with `target: null`, because there is no map instance to attach it to; every
 * runtime error carries one. That is the reliable signal, and it is version-proof in the right
 * direction: a message check is the second opinion, not the first.
 *
 * It matters because the failure is otherwise mute. No canvas is created, so `webglcontextlost`
 * never fires and `useGlRecovery` sees nothing – the operator gets the full map chrome around an
 * empty rectangle. Measured on a browser started with WebGL disabled; MapLibre's own message is
 * «Failed to initialize WebGL», either bare or wrapped in a JSON diagnostic.
 */
function isMapInitFailure(event: ErrorEvent): boolean {
  if ((event as { target?: unknown }).target == null) return true
  const message = event.error instanceof Error ? event.error.message : ''
  return message.includes('Failed to initialize WebGL') || message.includes('not supported by this browser')
}

/**
 * How many DISTINCT map errors get reported to the station's server log per session.
 *
 * An uplink outage fails every tile in the viewport, and each failure is its own map `error` – so
 * the point is one report of the problem, not one per tile. Distinct messages, because the second
 * kind of failure is the interesting one. Past the cap the console still gets everything.
 */
const MAX_REPORTED_MAP_ERRORS = 3
const reportedMapErrors = new Set<string>()

/** Log every map error; report the first few distinct ones. Exported for tests only. */
export function reportMapError(
  error: unknown,
  seen: Set<string> = reportedMapErrors,
  max: number = MAX_REPORTED_MAP_ERRORS,
): boolean {
  console.error('[base-map]', error)
  const message = error instanceof Error ? error.message : String(error ?? 'unknown')
  if (seen.has(message) || seen.size >= max) return false
  seen.add(message)
  reportClientError(error, { kind: 'error' })
  return true
}

/** One layer as the order guard sees it. */
export interface OrderedLayer {
  id: string
  /** The app's own raster basemap, or a layer the arriving style brought with it. */
  isBase: boolean
}

/** A `moveLayer(id, beforeId)` the guard wants performed. */
export interface LayerMove {
  id: string
  beforeId: string
}

/**
 * Which basemap layers have drifted ABOVE the surface's overlays, and where they belong.
 *
 * The auto→offline fallback swaps `mapStyle`, and a style swap is exactly when react-map-gl
 * re-appends the children's sources and layers – KP Front's nastiest recorded bug: a basemap that
 * (re)loads after the overlays stacks on top and paints over them. On Rück that would bury the
 * assignment lines under the map on a station whose uplink just died, i.e. at the worst possible
 * moment. Everything from the first overlay onwards must be overlay; anything base that sits
 * behind it moves in front of that first overlay, keeping the base layers' own relative order.
 *
 * Returning an empty list when nothing has drifted is not an optimisation but the loop guard: the
 * caller runs on `styledata`, and a `moveLayer` fires `styledata` again.
 */
export function baseLayerMoves(layers: OrderedLayer[]): LayerMove[] {
  const firstOverlay = layers.findIndex((layer) => !layer.isBase)
  if (firstOverlay < 0) return []
  const beforeId = layers[firstOverlay].id
  return layers
    .slice(firstOverlay + 1)
    .filter((layer) => layer.isBase)
    .map((layer) => ({ id: layer.id, beforeId }))
}

/**
 * The live layer order, classified.
 *
 * The surfaces draw their overlays from GeoJSON sources they hand in as children; everything else
 * in the style – our raster basemap, and the offline vector style's own ~47 layers with their
 * `background` and vector sources – is basemap. Classifying by source type rather than by layer id
 * keeps this true for overlays that do not exist yet, and needs no import of the overlay
 * components (which would be a cycle, and a list to keep in sync).
 */
function orderedLayers(map: MlMap): OrderedLayer[] {
  const style = map.getStyle()
  const sources = style.sources ?? {}
  return (style.layers ?? []).map((layer) => {
    const id = 'source' in layer && typeof layer.source === 'string' ? layer.source : null
    const source = id ? sources[id] : undefined
    return { id: layer.id, isBase: layer.id === BASE_LAYER_ID || source?.type !== 'geojson' }
  })
}

export function BaseMap({
  initialViewState,
  className,
  interactive = true,
  cursor,
  interactiveLayerIds,
  preserveDrawingBuffer,
  forceDayPaint,
  onClick,
  onLoad,
  children,
}: BaseMapProps) {
  const t = useTranslations('map')
  const { isOnline, getOnlineRasterBasemap, handleTileError } = useMapMode()
  const { availability } = useTileAvailability()
  // A paint spec is data handed to the renderer, so unlike a CSS class it has to be recomputed
  // when the operator flips the theme.
  const night = useNightTheme() && !forceDayPaint

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  // The map never came up (no WebGL). Tracked separately from `gl.lost`, which watches a canvas
  // that in this case was never created – but it ends in the same panel, because from the
  // operator's side it is the same situation: chrome, no map, and something to click.
  const [initFailed, setInitFailed] = useState(false)

  // The view as it stands right now, kept in a ref rather than state: a recovery remount has to
  // resume the operator's framing, and putting the live view in state would re-render the map on
  // every pan.
  const viewRef = useRef<BaseMapViewState | null>(null)

  const gl = useGlRecovery(
    () => mapRef.current,
    ready,
    useCallback(() => {
      mapRef.current = null
      setReady(false)
    }, []),
  )

  // What the offline mode can actually render on THIS station: the vector style (the normal case
  // after `just tiles-download`), a plain raster tileset, or – on an empty bootstrap volume, an
  // unreachable tileserver, or before the check has answered – nothing at all.
  const offline = useMemo(
    () => (isOnline ? null : offlineBasemapFor(availability)),
    [isOnline, availability],
  )

  // Offline with nothing installed keeps the ONLINE source up rather than pointing at endpoints
  // that 404: the bootstrap stub has no style and no raster tiles, so "offline" against it is a
  // blank rectangle with no error. Settings already refuses to select offline in that state; this
  // is what happens if it becomes effective anyway.
  const onlineRaster = useMemo(() => getOnlineRasterBasemap(), [getOnlineRasterBasemap])
  const raster = offline?.kind === 'raster' ? offline.source : offline ? null : onlineRaster

  const fallbackScheduled = useRef(false)
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current)
    },
    [],
  )

  const handleError = useCallback(
    (event: ErrorEvent) => {
      // react-map-gl's default handler only console.error's and then the app carries on, which is
      // how a station whose tiles quietly stopped loading has nothing to report. This puts it in
      // the station's own server log instead – capped, because an outage arrives per tile.
      reportMapError(event.error)
      if (isMapInitFailure(event)) {
        setInitFailed(true)
        return
      }
      if (!isOnline || !isBasemapTileError(event) || fallbackScheduled.current) return
      fallbackScheduled.current = true
      fallbackTimer.current = setTimeout(handleTileError, TILE_FALLBACK_DEBOUNCE_MS)
    },
    [isOnline, handleTileError],
  )

  const handleRetry = useCallback(() => {
    setInitFailed(false)
    gl.recover()
  }, [gl])

  // Radix animates a dialog's size in, and MapLibre only hears about a resize from the window
  // event – so a map mounted inside one comes up sized for the pre-animation box and stays there.
  // Replaces the copy-pasted `invalidateSize()` double-timeout dance in both dialogs.
  useEffect(() => {
    const element = containerRef.current
    if (!element || !ready) return
    const observer = new ResizeObserver(() => {
      try {
        mapRef.current?.resize()
      } catch {
        /* the map is already torn down */
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ready])

  // Keep the basemap under the overlays across a style swap – see `baseLayerMoves()`. Re-armed on
  // every new map instance (a GL recovery builds one), because the listener sits on the instance.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const keepBaseBelowOverlays = () => {
      try {
        if (!map.isStyleLoaded()) return
        for (const move of baseLayerMoves(orderedLayers(map))) {
          map.moveLayer(move.id, move.beforeId)
        }
      } catch {
        /* the style is mid-swap or the map is gone – the next styledata settles it */
      }
    }

    map.on('styledata', keepBaseBelowOverlays)
    keepBaseBelowOverlays()
    return () => {
      map.off('styledata', keepBaseBelowOverlays)
    }
  }, [ready, gl.generation])

  const handleLoad = useCallback(
    (event: MapEvent) => {
      mapRef.current = event.target
      setReady(true)
      onLoad?.(event.target)
    },
    [onLoad],
  )

  const handleMoveEnd = useCallback((event: ViewStateChangeEvent) => {
    const { longitude, latitude, zoom } = event.viewState
    viewRef.current = { longitude, latitude, zoom }
  }, [])

  return (
    <div
      ref={containerRef}
      data-testid="base-map"
      className={cn(
        'relative h-full w-full',
        CONTROL_Z_ORDER,
        offline?.kind === 'vector' && VECTOR_CANVAS_FILTER,
        className,
      )}
    >
      <Map
        // A changed key rebuilds the whole map – the only way back from a lost WebGL context.
        key={gl.generation}
        // Consumed once per instance, so on a recovery remount it must see the view as it stood a
        // moment ago: healing must not throw the operator back to the opening framing.
        initialViewState={viewRef.current ?? initialViewState}
        mapStyle={offline?.kind === 'vector' ? offline.styleUrl : EMPTY_STYLE}
        style={MAP_CANVAS_STYLE}
        transformRequest={transformRequest}
        interactive={interactive}
        cursor={cursor}
        interactiveLayerIds={interactiveLayerIds}
        preserveDrawingBuffer={preserveDrawingBuffer}
        onClick={onClick}
        onLoad={handleLoad}
        onMoveEnd={handleMoveEnd}
        onError={handleError}
        // The board is a north-up desktop surface: nothing rotates, nothing tilts.
        maxPitch={0}
        dragRotate={false}
        // Zoom and gesture handling stay at MapLibre's defaults – continuous zoom is the point of
        // the migration, so nothing here re-imposes Leaflet's stepping.
        attributionControl={false}
      >
        <MapAttribution />

        {/* The basemap. Rendered first so every surface layer added as a child sits above it.
            Absent when the offline vector style is in charge – it brings its own.
            The muting lives on THIS layer, not on the canvas, so the overlay layers the surfaces
            draw above it keep their full colour. */}
        {raster && (
          <Source
            // A different basemap is a NEW source, not an edited one.
            //
            // react-map-gl can only patch a raster source when `tiles` is the ONLY prop that
            // changed; every style switch changes `maxzoom` and `attribution` along with it, so it
            // gives up with «Unable to update <Source> prop» and the map silently keeps the first
            // basemap it was ever given. That is always the `osm` default, because the station's
            // `map_style` arrives one fetch after the first render – i.e. choosing a style in
            // Einstellungen did nothing until the page was reloaded twice. Keying on the tile URL
            // rebuilds source and layer instead. The re-added layer lands ON TOP of the overlays;
            // the `styledata` guard above (`baseLayerMoves`) puts it back underneath.
            key={raster.tiles[0]}
            id={BASE_SOURCE_ID}
            type="raster"
            tiles={raster.tiles}
            tileSize={raster.tileSize}
            maxzoom={raster.maxzoom}
            attribution={raster.attribution}
          >
            {/* An already-dark raster («Dunkel (CARTO)») is lifted in BOTH themes, print included:
                the day paint desaturates it to mud and the night paint's brightness cap crushes
                it to black. Light theme included on purpose – the operator picked a dark map. */}
            <Layer
              id={BASE_LAYER_ID}
              type="raster"
              paint={raster.dark ? DARK_BASE_PAINT : night ? NIGHT_BASE_PAINT : DAY_BASE_PAINT}
            />
          </Source>
        )}

        {children}
      </Map>

      {/* No map, working chrome. Either auto-healing gave up (the GPU keeps dropping the context)
          or it never started at all (no WebGL on this machine – the wall-display case). Both are
          a blank rectangle the operator cannot otherwise explain, so both say so and offer the
          way out; the retry rebuilds the map, which is the cure for the first and the test for
          the second. */}
      {(gl.lost || initFailed) && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90 p-4 text-center">
          <p className="text-sm text-muted-foreground">{t('view.glLost')}</p>
          <Button size="sm" onClick={handleRetry}>
            {t('view.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}
