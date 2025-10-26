"use client"

export function MapLegend() {
  return (
    <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-4 shadow-lg z-[1000]">
      <h3 className="font-bold mb-3 text-sm">Legende</h3>

      {/* Priority Legend - simple single-color markers */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Priorität
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-red-500 border-2 border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Hoch</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-yellow-500 border-2 border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Mittel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-zinc-500 border-2 border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Niedrig</span>
          </div>
        </div>
      </div>
    </div>
  )
}
