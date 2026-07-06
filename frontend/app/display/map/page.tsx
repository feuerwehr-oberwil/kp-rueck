"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { useIncidents, useOperations } from "@/lib/contexts/operations-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { apiClient, type ApiIncident } from "@/lib/api-client"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { Loader2, Palette, Check } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { colorGroupFor, COLOR_BY_LABELS, COLOR_BY_STORAGE_KEY, COLOR_NONE, type ColorByDimension, type ColorGroup } from "@/lib/kanban-utils"

const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
})

/**
 * /display/map — Full-bleed map display for command post monitors.
 *
 * Supports two auth modes:
 * - Editor auth (uses existing contexts)
 * - Viewer token (?token=xxx) (polls independently)
 */
export default function DisplayMapPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const { isAuthenticated } = useAuth()

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [panTrigger, setPanTrigger] = useState(0)

  // Cross-window sync
  const { broadcast } = useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") {
        setSelectedIncidentId(msg.incidentId)
        setPanTrigger((p) => p + 1)
      }
    },
  })

  const handleMarkerClick = (incidentId: string) => {
    if (incidentId === selectedIncidentId) {
      setPanTrigger((p) => p + 1)
    } else {
      setSelectedIncidentId(incidentId)
      broadcast("incident:selected", incidentId)
    }
  }

  // If authenticated (editor mode), use contexts directly
  if (isAuthenticated && !token) {
    return (
      <AuthenticatedDisplayMap
        selectedIncidentId={selectedIncidentId}
        onMarkerClick={handleMarkerClick}
        panTrigger={panTrigger}
      />
    )
  }

  // Token mode — poll viewer data
  if (token) {
    return (
      <TokenDisplayMap
        token={token}
        selectedIncidentId={selectedIncidentId}
        onMarkerClick={handleMarkerClick}
        panTrigger={panTrigger}
      />
    )
  }

  // No auth, no token
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      Bitte melden Sie sich an oder verwenden Sie einen Zugangscode (?token=xxx)
    </div>
  )
}

function AuthenticatedDisplayMap({
  selectedIncidentId,
  onMarkerClick,
  panTrigger,
}: {
  selectedIncidentId: string | null
  onMarkerClick: (id: string) => void
  panTrigger: number
}) {
  const { refreshIncidents } = useIncidents()
  const { operations } = useOperations()

  useEffect(() => {
    refreshIncidents()
  }, [])

  // "Färben nach" — same persisted setting as the board/map. The storage
  // listener keeps the display in sync when the mode is switched from
  // another window (e.g. the main map next to this monitor).
  const [colorBy, setColorBy] = useState<ColorByDimension>('priority')
  useEffect(() => {
    const read = (value: string | null) => {
      if (value === 'reko' || value === 'vehicle' || value === 'type' || value === 'priority') setColorBy(value)
    }
    read(localStorage.getItem(COLOR_BY_STORAGE_KEY))
    const onStorage = (e: StorageEvent) => {
      if (e.key === COLOR_BY_STORAGE_KEY) read(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const setColorByPersisted = (value: ColorByDimension) => {
    setColorBy(value)
    if (typeof window !== 'undefined') localStorage.setItem(COLOR_BY_STORAGE_KEY, value)
  }

  const markerAccents = useMemo(() => {
    // Priority uses the markers' built-in priority fill — no override.
    if (colorBy === 'priority') return undefined
    const m = new Map<string, string>()
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy)
      m.set(op.id, g ? g.color : COLOR_NONE)
    }
    return m
  }, [operations, colorBy])

  const colorLegend = useMemo<ColorGroup[]>(() => {
    if (colorBy === 'priority') return []
    const map = new Map<string, ColorGroup>()
    let hasNone = false
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy)
      if (g) { if (!map.has(g.key)) map.set(g.key, g) }
      else hasNone = true
    }
    const arr = [...map.values()]
    if (hasNone) arr.push({ key: '__none__', label: 'Ohne Zuweisung', color: COLOR_NONE })
    return arr
  }, [operations, colorBy])

  return (
    <div className="relative w-full h-full">
      <MapView
        selectedIncidentId={selectedIncidentId}
        onMarkerClick={onMarkerClick}
        panTrigger={panTrigger}
        showAssignmentLines={true}
        statusFilters={{ open: true, active: true, completed: false }}
        markerAccents={markerAccents}
        colorBy={colorBy}
        colorGroups={colorLegend}
      />

      {/* Färben nach — compact overlay control for the display monitor */}
      <div className="absolute top-4 right-4 z-30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`px-3 py-1.5 text-xs font-medium rounded-full border shadow-md backdrop-blur-sm transition-colors flex items-center gap-1 ${
                colorBy !== 'priority'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background/80 text-muted-foreground border-border hover:bg-muted'
              }`}
              title="Marker einfärben nach"
            >
              <Palette className="h-3 w-3" />
              Färben: {COLOR_BY_LABELS[colorBy]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Färben nach</DropdownMenuLabel>
            {(['priority', 'reko', 'vehicle', 'type'] as ColorByDimension[]).map((dim) => (
              <DropdownMenuItem
                key={dim}
                onSelect={(e) => { e.preventDefault(); setColorByPersisted(dim) }}
                className="cursor-pointer justify-between"
              >
                {COLOR_BY_LABELS[dim]}
                {colorBy === dim && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
            {colorLegend.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 space-y-1 max-h-48 overflow-y-auto">
                  {colorLegend.map((g) => (
                    <div key={g.key} className="flex items-center gap-2 text-xs">
                      <span className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                      <span className="truncate">{g.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function TokenDisplayMap({
  token,
  selectedIncidentId,
  onMarkerClick,
  panTrigger,
}: {
  token: string
  selectedIncidentId: string | null
  onMarkerClick: (id: string) => void
  panTrigger: number
}) {
  // Token mode doesn't have contexts, so MapView won't have data.
  // Show a message pointing to editor auth for full functionality.
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>Kartenanzeige erfordert Editor-Zugang für GPS-Daten.</p>
    </div>
  )
}
