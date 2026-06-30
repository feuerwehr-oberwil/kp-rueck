"use client"

import { useState } from "react"
import { Truck, ChevronDown, Info } from "lucide-react"
import { PRIORITY_MARKER_COLORS } from "@/lib/map-colors"
import { useIsMobile } from "@/components/ui/use-mobile"
import { COLOR_BY_LABELS, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"

// Status border color (matches map-view.tsx)
const STATUS_BORDER_COLOR = "#374151" // gray-700

// SVG marker with status border for legend
function LegendMarker({
  fillColor,
  dasharray,
  opacity = 1,
}: {
  fillColor: string
  dasharray: string
  opacity?: number
}) {
  const size = 24
  const borderRadius = size / 2
  const innerRadius = borderRadius - 3
  const strokeWidth = 2.5
  const borderOffset = strokeWidth / 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity }} className="flex-shrink-0" aria-hidden="true">
      <circle
        cx={borderRadius}
        cy={borderRadius}
        r={innerRadius}
        fill={fillColor}
        stroke="white"
        strokeWidth="3"
      />
      <circle
        cx={borderRadius}
        cy={borderRadius}
        r={borderRadius - borderOffset}
        fill="none"
        stroke={STATUS_BORDER_COLOR}
        strokeWidth={strokeWidth}
        strokeDasharray={dasharray}
      />
    </svg>
  )
}

export function MapLegend({
  colorBy = "priority",
  colorGroups = [],
}: {
  colorBy?: ColorByDimension
  colorGroups?: ColorGroup[]
}) {
  // For priority the markers use the built-in priority colours (static legend
  // below). For reko/vehicle/type the fill encodes that dimension, so swap the
  // Priorität section for the active grouping's colours.
  const coloring = colorBy !== "priority" && colorGroups.length > 0

  // Collapsible: until the user toggles it, default to collapsed on mobile
  // (the panel otherwise covers half the map) and expanded on desktop.
  const isMobile = useIsMobile()
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? !isMobile

  if (!expanded) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-4 right-4 z-30 flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur-sm border border-border px-3 py-1.5 text-xs font-medium shadow-lg hover:bg-card"
        aria-label="Legende anzeigen"
      >
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        Legende
      </button>
    )
  }

  return (
    <div className="absolute bottom-4 right-4 max-h-[calc(100%-2rem)] w-52 overflow-y-auto bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg z-30">
      <button
        onClick={() => setOpen(false)}
        className="flex items-center justify-between w-full mb-3"
        aria-label="Legende ausblenden"
      >
        <h3 className="font-bold text-sm">Legende</h3>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {/* Fill Legend — "Färben nach" groups when active, else priority */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {coloring ? COLOR_BY_LABELS[colorBy] : "Priorität"}
        </p>
        <div className="space-y-1.5">
          {coloring ? (
            colorGroups.map((g) => (
              <div key={g.key} className="flex items-center gap-2">
                <LegendMarker fillColor={g.color} dasharray="none" />
                <span className="text-xs">{g.label}</span>
              </div>
            ))
          ) : (
            <>
              <div className="flex items-center gap-2">
                <LegendMarker fillColor={PRIORITY_MARKER_COLORS.high} dasharray="none" />
                <span className="text-xs">Hohe Priorität</span>
              </div>
              <div className="flex items-center gap-2">
                <LegendMarker fillColor={PRIORITY_MARKER_COLORS.medium} dasharray="none" />
                <span className="text-xs">Mittlere Priorität</span>
              </div>
              <div className="flex items-center gap-2">
                <LegendMarker fillColor={PRIORITY_MARKER_COLORS.low} dasharray="none" />
                <span className="text-xs">Niedrige Priorität</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status Legend */}
      <div className="space-y-2 mt-4 pt-3 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Status (Rahmen)
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#9ca3af" dasharray="4,3" />
            <span className="text-xs">Offen</span>
          </div>
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#9ca3af" dasharray="none" />
            <span className="text-xs">Aktiv</span>
          </div>
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#9ca3af" dasharray="2,2" opacity={0.6} />
            <span className="text-xs">Beendet</span>
          </div>
        </div>
      </div>

      {/* Vehicle Legend */}
      <div className="space-y-2 mt-4 pt-3 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Fahrzeuge (GPS)
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-500 border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center" role="img" aria-label="Fahrzeug online">
              <Truck className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <span className="text-xs">Online</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gray-500 border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center" role="img" aria-label="Fahrzeug offline">
              <Truck className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <span className="text-xs">Offline</span>
          </div>
        </div>
      </div>
      {/* Assignment Lines Legend */}
      <div className="space-y-2 mt-4 pt-3 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Zuweisungen
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <svg width="24" height="6" viewBox="0 0 24 6" className="flex-shrink-0" aria-hidden="true">
              <line
                x1="0" y1="3" x2="24" y2="3"
                stroke="#dc2626"
                strokeWidth="2.5"
                strokeDasharray="4,6"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-xs">Fahrzeug → Einsatz</span>
          </div>
        </div>
      </div>
    </div>
  )
}
