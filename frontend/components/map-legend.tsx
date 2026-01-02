"use client"

import { Truck } from "lucide-react"

export function MapLegend() {
  return (
    <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-4 shadow-lg z-[1000]">
      <h3 className="font-bold mb-3 text-sm">Legende</h3>

      {/* Priority Legend - simple single-color markers */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Einsätze
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-red-500 border-2 border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Hohe Priorität</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-yellow-500 border-2 border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Mittlere Priorität</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-green-500 border-2 border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Niedrige Priorität</span>
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
            <div className="w-6 h-6 rounded bg-blue-500 border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs">Online</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gray-500 border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs">Offline</span>
          </div>
        </div>
      </div>
    </div>
  )
}
