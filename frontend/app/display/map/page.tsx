"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { useIncidents } from "@/lib/contexts/operations-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { apiClient, type ApiIncident } from "@/lib/api-client"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { Loader2 } from "lucide-react"

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

  useEffect(() => {
    refreshIncidents()
  }, [])

  return (
    <div className="w-full h-full">
      <MapView
        selectedIncidentId={selectedIncidentId}
        onMarkerClick={onMarkerClick}
        panTrigger={panTrigger}
        showAssignmentLines={true}
        statusFilters={{ open: true, active: true, completed: false }}
      />
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
