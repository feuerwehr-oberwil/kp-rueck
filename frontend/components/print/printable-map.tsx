"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useTranslations } from "next-intl"
import type { Map as MlMap } from "maplibre-gl"
import { Marker } from "react-map-gl/maplibre"
import { BaseMap } from "@/components/map/base-map"
import type { Operation } from "@/lib/contexts/operations-context"
import { MAP_COLORS, PRIORITY_MARKER_COLORS } from "@/lib/map-colors"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import { isLocated } from "@/lib/utils/route-geo"
import { fitTo, type LatLngPoint } from "@/lib/map-view"

/**
 * Printed size of the map, in millimetres — deliberately NOT a percentage and
 * NOT pixels.
 *
 * The tile grid is laid out against the container size the map sees while the
 * print view sits hidden off-screen. If that size differs from the size the
 * same container has on paper (it did: the off-screen `.print-only` box is
 * 210mm wide with a 16px padding, the printed page is 190mm with a 5mm one),
 * the fitted bounds no longer centre what was fitted — which is why the old
 * print showed a region with none of its markers on it. One fixed millimetre
 * size for both media removes the discrepancy entirely.
 *
 * 178mm × 196mm fits inside the printable width (190mm page box less the
 * 5mm `.print-view` padding = 180mm) and leaves room on the page for the
 * heading, the legend and the marker key. Portrait, because the rest of the
 * sheet is portrait and the map now owns a whole page of it — a landscape map
 * would mean a page the operator has to turn sideways on the table.
 */
const MAP_WIDTH = "178mm"
const MAP_HEIGHT = "196mm"

/** Screen pixels kept clear around the fitted incidents, so no pin sits on the frame. */
const FIT_PADDING = 40

/**
 * Deepest zoom the fit is allowed to reach.
 *
 * On a full page the fit is limited by the spread of the incidents, not by the
 * container — a village-sized Lage may zoom in far enough for street names,
 * which is the whole point of the big map.
 */
const FIT_MAX_ZOOM = 15

/** Opening zoom before the first `fitBounds`, which lands on `load`; never actually seen. */
const INITIAL_ZOOM = 12

const MARKER_SIZE = 22

/**
 * Paper is always light, and the chrome of a live map is not part of a printout.
 *
 * The canvas filter covers the ONE surface where dark mode is still a CSS filter: the
 * offline VECTOR style, whose 47 layers leave no single layer to paint (see
 * `VECTOR_CANVAS_FILTER` in `base-map.tsx`). Every raster basemap is dimmed by GL paint
 * instead, which no CSS rule can undo — that one is pinned to day by `forceDayPaint`
 * below. Without both halves a dark-themed operator prints a black rectangle.
 *
 * The attribution control is a ⓘ button that opens on click: on paper it is a dot in the
 * corner that says nothing, so it is hidden here.
 *
 * Scoped to `.print-map` and kept in this component on purpose – `globals.css` no
 * longer carries any print rules for the map.
 */
const PRINT_MAP_CSS = `
.print-map .maplibregl-canvas {
  filter: saturate(0.3) brightness(1.05) contrast(0.95) !important;
}
.print-map .maplibregl-ctrl-bottom-right {
  display: none !important;
}
`

/** Marker: priority colour, plus the number the incident carries in the list. */
function markerStyle(priority: string): CSSProperties {
  const color =
    PRIORITY_MARKER_COLORS[priority as keyof typeof PRIORITY_MARKER_COLORS] ?? MAP_COLORS.offline

  return {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    backgroundColor: color,
    border: "2px solid white",
    borderRadius: "50%",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.35)",
    color: "white",
    font: `700 12px/${MARKER_SIZE - 4}px system-ui, sans-serif`,
    textAlign: "center",
  }
}

interface PrintableMapProps {
  operations: Operation[]
  /** incident id → the number it carries in the printed incident list, so a pin
   *  can be looked up in the list and vice versa. */
  numbering: Map<string, number>
  /** Fired once the map has gone idle — tiles drawn, nothing left to fetch. The
   *  print button waits for it, because a canvas is printed as it stands. */
  onReady?: () => void
}

/**
 * Full-page map of the located incidents for the A4 status print.
 *
 * A dedicated, non-interactive `<BaseMap>` instance with `preserveDrawingBuffer`
 * — the only surface that sets it. Without it the WebGL back buffer is discarded
 * after every frame and the browser's print snapshot of the canvas comes out
 * blank; with it the canvas prints exactly what is on screen, and the numbered
 * pins stay real DOM elements so they print as crisp vector text rather than as
 * part of a rasterised capture.
 *
 * Colours print exactly (`printColorAdjust`) and the size is fixed in mm – see
 * MAP_WIDTH/MAP_HEIGHT above. The old `print-map-container` class is gone on
 * purpose (and so is its rule in globals.css): its `@media print` block pinned
 * the height to 250px with `!important`, which kept the map postage-stamp sized.
 *
 * The basemap comes from `<BaseMap>`, which means from the station's `map_mode`
 * setting — this used to hardcode online OSM tiles and printed an empty frame on
 * an offline station.
 */
export default function PrintableMap({ operations, numbering, onReady }: PrintableMapProps) {
  const t = useTranslations("print.map")
  const [ready, setReady] = useState(false)
  const mapRef = useRef<MlMap | null>(null)

  // Located operations, in the order the list prints them — so the key below
  // reads 1, 2, 3 rather than in whatever order the board happened to hold.
  const mappableOperations = useMemo(
    () =>
      operations
        .filter(isLocated)
        .sort((a, b) => (numbering.get(a.id) ?? 0) - (numbering.get(b.id) ?? 0)),
    [operations, numbering],
  )

  const points = useMemo<LatLngPoint[]>(
    () => mappableOperations.map((operation) => operation.coordinates),
    [mappableOperations],
  )

  const fit = useCallback(
    (map: MlMap) => {
      try {
        fitTo(map, points, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate: false })
      } catch {
        /* the instance is already torn down – a GL recovery remount brings a new one */
      }
    },
    [points],
  )

  // The resize handler must always run the CURRENT fit, and `onReady` must not
  // re-arm the load handler — both live behind refs so `handleLoad` can stay
  // subscribed for the lifetime of the map instance.
  const fitRef = useRef(fit)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    fitRef.current = fit
    if (mapRef.current) fit(mapRef.current)
  }, [fit])

  // Nothing to map means nothing to wait for: without this the print button, which
  // holds until the map reports in, would stay disabled forever on a board whose
  // incidents carry no coordinates.
  const hasMap = mappableOperations.length > 0
  useEffect(() => {
    if (!hasMap) onReadyRef.current?.()
  }, [hasMap])

  const handleLoad = useCallback((map: MlMap) => {
    mapRef.current = map
    fitRef.current(map)
    // `<BaseMap>`'s ResizeObserver calls `map.resize()`, which keeps the centre but not the
    // fit — so re-frame on every resize. This is what replaces the old dance of calling
    // `invalidateSize()` four times on a 0/100/300/500ms guess at when the box would settle.
    map.on("resize", () => fitRef.current(map))
    map.once("idle", () => {
      setReady(true)
      onReadyRef.current?.()
    })
  }, [])

  if (!hasMap) {
    return (
      <div className="h-[250px] bg-gray-100 flex items-center justify-center text-gray-500 text-sm border border-gray-300">
        {t("noCoordinates")}
      </div>
    )
  }

  const center = {
    longitude:
      mappableOperations.reduce((sum, op) => sum + op.coordinates[1], 0) / mappableOperations.length,
    latitude:
      mappableOperations.reduce((sum, op) => sum + op.coordinates[0], 0) / mappableOperations.length,
  }

  return (
    // `printColorAdjust` is inherited, so one declaration here keeps the tiles
    // and the coloured markers from being stripped by the print pipeline.
    <div style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      <style>{PRINT_MAP_CSS}</style>
      <div
        className="print-map border border-gray-300"
        style={{ height: MAP_HEIGHT, width: MAP_WIDTH }}
        data-testid="printable-map"
        data-map-ready={ready ? "true" : "false"}
      >
        <BaseMap
          initialViewState={{ ...center, zoom: INITIAL_ZOOM }}
          interactive={false}
          // Print only: the back buffer has to survive the frame for the browser to
          // be able to put the canvas on paper. It costs memory, hence nowhere else.
          preserveDrawingBuffer
          // Paper is light in every theme – see PRINT_MAP_CSS.
          forceDayPaint
          onLoad={handleLoad}
        >
          {mappableOperations.map((operation) => (
            <Marker
              key={operation.id}
              longitude={operation.coordinates[1]}
              latitude={operation.coordinates[0]}
            >
              <div style={markerStyle(operation.priority)}>
                {numbering.get(operation.id) ?? "•"}
              </div>
            </Marker>
          ))}
        </BaseMap>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-1 text-[10px]" style={{ width: MAP_WIDTH }}>
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full border border-white" style={{ backgroundColor: PRIORITY_MARKER_COLORS.high }}></span>
          <span>{t("legendHigh")}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full border border-white" style={{ backgroundColor: PRIORITY_MARKER_COLORS.medium }}></span>
          <span>{t("legendMedium")}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full border border-white" style={{ backgroundColor: PRIORITY_MARKER_COLORS.low }}></span>
          <span>{t("legendLow")}</span>
        </div>
      </div>

      {/* Marker key – a pin is only useful if it can be named without turning
          the page. Three columns so a dozen incidents cost four lines. */}
      <div
        className="mt-1 text-[9px] leading-tight"
        style={{ width: MAP_WIDTH, columnCount: 3, columnGap: "6mm" }}
      >
        {mappableOperations.map((operation) => (
          <div key={operation.id} className="break-inside-avoid">
            <span className="font-semibold">{numbering.get(operation.id) ?? "•"}.</span>{" "}
            {getIncidentLocationLabel(operation)}
          </div>
        ))}
      </div>
    </div>
  )
}
