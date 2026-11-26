/** The station's own marks on the Lagekarte – the firestation and the Magazin, drawn by MapView. */

import { useState, type CSSProperties, type ReactNode } from "react"
import { Marker } from "react-map-gl/maplibre"
import { MAP_COLORS } from "@/lib/map-colors"
import { Z, type LatLngPoint } from "@/lib/map-view"
import { PILL_HEIGHT } from "@/lib/map-vehicles"
import { MapTooltip } from "./map-tooltip"

/** Pill chrome for the Magazin marker – the shape of the vehicle pills (components/map/vehicle-marker.tsx). */
function pillStyle(background: string, width: number | string): CSSProperties {
  return {
    width,
    height: PILL_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background,
    color: "white",
    border: "2px solid white",
    borderRadius: 4,
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    whiteSpace: "nowrap",
    padding: "0 8px",
    boxSizing: "border-box",
  }
}

/** A marker carrying a single glyph — the firestation (⌂) and the Magazin/GPS homebase
 *  (lucide `Warehouse`, owner pick 19.11.2026, #17 A). */
export function GlyphMarker({
  coordinates,
  label,
  style,
  gap,
  glyph,
}: {
  coordinates: LatLngPoint
  label: string
  style: CSSProperties
  glyph: ReactNode
  /** Anchor → tooltip edge. Half the glyph's height plus Leaflet's arrow margin. */
  gap: number
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <Marker
      longitude={coordinates[1]}
      latitude={coordinates[0]}
      style={{ zIndex: Z.station }}
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={style}>{glyph}</div>
        {hovered && (
          <MapTooltip side="top" gap={gap}>
            <span>{label}</span>
          </MapTooltip>
        )}
      </div>
    </Marker>
  )
}

export const FIRESTATION_STYLE: CSSProperties = {
  width: 24,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: MAP_COLORS.station,
  color: "white",
  border: "2px solid white",
  borderRadius: "50%",
  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
  fontSize: 14,
}

// Magazin (GPS-Heimatbasis) — a hall with a door (lucide Warehouse, #17 A) on a pill shaped like
// the vehicle pills so it reads as "where the vehicles live", in the station ink rather than their
// blue: blue is the Auftrag's (and a reporting vehicle's), and a blue glyph read as part of a
// route (hill climb r18). Only rendered when gps.station_lat/lng are set (Settings → GPS).
// No side padding: the pill is 24 px wide, and 8 px a side left the 14 px icon 4 px to shrink into.
export const MAGAZIN_STYLE: CSSProperties = { ...pillStyle(MAP_COLORS.station, 24), fontSize: 14, padding: 0 }
