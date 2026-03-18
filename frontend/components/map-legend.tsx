"use client"

import { Truck } from "lucide-react"

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

export function MapLegend() {
  return (
    <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-4 shadow-lg z-30">
      <h3 className="font-bold mb-3 text-sm">Legende</h3>

      {/* Priority Legend */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Priorität
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#ef4444" dasharray="none" />
            <span className="text-xs">Hohe Priorität</span>
          </div>
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#eab308" dasharray="none" />
            <span className="text-xs">Mittlere Priorität</span>
          </div>
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#22c55e" dasharray="none" />
            <span className="text-xs">Niedrige Priorität</span>
          </div>
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
            <span className="text-xs">Offen/Neu</span>
          </div>
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#9ca3af" dasharray="none" />
            <span className="text-xs">Aktiv</span>
          </div>
          <div className="flex items-center gap-2">
            <LegendMarker fillColor="#9ca3af" dasharray="2,2" opacity={0.6} />
            <span className="text-xs">Abgeschlossen</span>
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
