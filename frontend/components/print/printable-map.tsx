"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { Operation } from "@/lib/contexts/operations-context"
import { MAP_COLORS, PRIORITY_MARKER_COLORS } from "@/lib/map-colors"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import { isLocated, type LocatedOperation } from "@/lib/utils/route-geo"

/**
 * Printed size of the map, in millimetres — deliberately NOT a percentage and
 * NOT pixels.
 *
 * Leaflet lays its tile grid out once, against the container size it sees while
 * the print view sits hidden off-screen. If that size differs from the size the
 * same container has on paper (it did: the off-screen `.print-only` box is
 * 210mm wide with a 16px padding, the printed page is 190mm with a 5mm one),
 * the grid is clipped and the fitted bounds no longer centre what was fitted —
 * which is why the old print showed a region with none of its markers on it.
 * One fixed millimetre size for both media removes the discrepancy entirely.
 *
 * 178mm × 196mm fits inside the printable width (190mm page box less the
 * 5mm `.print-view` padding = 180mm) and leaves room on the page for the
 * heading, the legend and the marker key. Portrait, because the rest of the
 * sheet is portrait and the map now owns a whole page of it — a landscape map
 * would mean a page the operator has to turn sideways on the table.
 */
const MAP_WIDTH = "178mm"
const MAP_HEIGHT = "196mm"

/** Marker: priority colour, plus the number the incident carries in the list. */
function createMarkerIcon(priority: string, label: string): L.DivIcon {
  const color =
    PRIORITY_MARKER_COLORS[priority as keyof typeof PRIORITY_MARKER_COLORS] ?? MAP_COLORS.offline
  const size = 22

  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      background-color: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      color: white;
      font: 700 12px/${size - 4}px system-ui, sans-serif;
      text-align: center;
    ">${label}</div>
  `

  return L.divIcon({
    html,
    className: "print-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// Component to auto-fit map bounds to show all operations
function FitBounds({ operations }: { operations: LocatedOperation[] }) {
  const map = useMap()

  useEffect(() => {
    if (operations.length === 0) return

    const validOps = operations.filter(isLocated)

    if (validOps.length === 0) return

    const bounds = L.latLngBounds(
      validOps.map((op) => [op.coordinates[0], op.coordinates[1]] as [number, number])
    )

    // Function to fit bounds with proper sizing.
    // maxZoom 15 (was 14): on a full page the fit is limited by the spread of
    // the incidents, not by the container — a village-sized Lage may zoom in
    // far enough for street names, which is the whole point of the big map.
    const fitMapBounds = () => {
      map.invalidateSize()
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: false })
    }

    // Try immediately
    fitMapBounds()

    // Also try after a short delay to ensure container is sized
    const timer1 = setTimeout(fitMapBounds, 100)
    const timer2 = setTimeout(fitMapBounds, 300)
    const timer3 = setTimeout(fitMapBounds, 500)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [map, operations])

  return null
}

interface PrintableMapProps {
  operations: Operation[]
  /** incident id → the number it carries in the printed incident list, so a pin
   *  can be looked up in the list and vice versa. */
  numbering: Map<string, number>
}

/**
 * Full-page map of the located incidents for the A4 status print.
 *
 * Colours print exactly (`printColorAdjust`) and the size is fixed in mm –
 * see MAP_WIDTH/MAP_HEIGHT above. The old `print-map-container` class is gone
 * on purpose: its `@media print` rule in globals.css pinned the height to
 * 250px with `!important`, which is what kept the map postage-stamp sized.
 */
export default function PrintableMap({ operations, numbering }: PrintableMapProps) {
  const t = useTranslations("print.map")
  const [isReady, setIsReady] = useState(false)

  // Located operations, in the order the list prints them — so the key below
  // reads 1, 2, 3 rather than in whatever order the board happened to hold.
  const mappableOperations = operations
    .filter(isLocated)
    .sort((a, b) => (numbering.get(a.id) ?? 0) - (numbering.get(b.id) ?? 0))

  // Default center (Basel region)
  const defaultCenter: [number, number] = [47.51637699933488, 7.561800450458299]

  // Calculate center from operations if available
  const center: [number, number] = mappableOperations.length > 0
    ? [
        mappableOperations.reduce((sum, op) => sum + op.coordinates[0], 0) / mappableOperations.length,
        mappableOperations.reduce((sum, op) => sum + op.coordinates[1], 0) / mappableOperations.length,
      ]
    : defaultCenter

  useEffect(() => {
    // Small delay to ensure Leaflet CSS is loaded
    const timer = setTimeout(() => setIsReady(true), 100)
    return () => clearTimeout(timer)
  }, [])

  if (mappableOperations.length === 0) {
    return (
      <div className="h-[250px] bg-gray-100 flex items-center justify-center text-gray-500 text-sm border border-gray-300">
        {t("noCoordinates")}
      </div>
    )
  }

  if (!isReady) {
    return (
      <div style={{ height: MAP_HEIGHT, width: MAP_WIDTH }} className="bg-gray-100 flex items-center justify-center text-gray-500 text-sm">
        {t("loading")}
      </div>
    )
  }

  return (
    // `printColorAdjust` is inherited, so one declaration here keeps the tiles
    // and the coloured markers from being stripped by the print pipeline.
    <div style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      <div className="border border-gray-300" style={{ height: MAP_HEIGHT, width: MAP_WIDTH }}>
        <MapContainer
          center={center}
          zoom={12}
          style={{ height: "100%", width: "100%", background: "white" }}
          zoomControl={false}
          attributionControl={false}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Operation Markers */}
          {mappableOperations.map((operation) => (
            <Marker
              key={operation.id}
              position={[operation.coordinates[0], operation.coordinates[1]]}
              icon={createMarkerIcon(operation.priority, String(numbering.get(operation.id) ?? "•"))}
            />
          ))}

          {/* Auto-fit bounds */}
          <FitBounds operations={mappableOperations} />
        </MapContainer>
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
