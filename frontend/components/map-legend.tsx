"use client"

export function MapLegend() {
  return (
    <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-4 shadow-lg z-[1000] max-w-xs">
      <h3 className="font-bold mb-3 text-sm">Legende</h3>

      {/* Status Legend - matching kanban board colors */}
      <div className="space-y-2 mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Status
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-zinc-800 border border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Eingegangen</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-green-800 border border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Reko</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-900 border border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Disponiert</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-orange-900 border border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Einsatz</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-800 border border-white shadow-sm flex-shrink-0" />
            <span className="text-xs">Einsatz Beendet</span>
          </div>
        </div>
      </div>

      {/* Priority Legend - matching kanban board priority colors */}
      <div className="space-y-2 mb-4 pt-3 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Priorität
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
            <span className="text-xs">Hoch</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 flex-shrink-0" />
            <span className="text-xs">Mittel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-xs">Niedrig</span>
          </div>
        </div>
      </div>

      {/* Marker Design Explanation */}
      <div className="space-y-2 pt-3 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Marker-Design
        </p>
        <div className="flex items-center gap-2">
          <div className="relative w-6 h-6 rounded-full bg-blue-900 border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          </div>
          <span className="text-xs">Äusserer Ring: Status, Innerer Kreis: Priorität</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-full border-2 border-dashed border-blue-500 flex-shrink-0"
            style={{ borderWidth: "2px" }}
          />
          <span className="text-xs">Gestrichelte Linie: Übungsmodus</span>
        </div>
      </div>
    </div>
  )
}
