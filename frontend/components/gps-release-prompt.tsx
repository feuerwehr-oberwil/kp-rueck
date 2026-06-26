"use client"

import { useEffect, useState } from "react"
import { Truck } from "lucide-react"
import { wsClient } from "@/lib/websocket-client"
import { apiClient } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"

interface ReleasePrompt {
  assignmentId: string
  incidentId: string
  vehicleName: string
  incidentLabel: string
}

/**
 * GPS Rule B (plan 10) — confirm-release. When the backend GPS automation detects an
 * assigned vehicle back at the station geofence, it broadcasts a `gps_release_prompt`
 * WebSocket event. This globally-mounted component shows a one-click confirm dialog:
 * "Fahrzeug zurück — freigeben?". On confirm it releases that vehicle's assignment via
 * the existing unassign endpoint. The incident is never auto-closed; declining leaves
 * everything as it was.
 *
 * Mounted once in the root layout so it covers every page (board, map, settings).
 */
export function GpsReleasePrompt() {
  const [prompt, setPrompt] = useState<ReleasePrompt | null>(null)
  const [releasing, setReleasing] = useState(false)

  useEffect(() => {
    const unsubscribe = wsClient.on("gps_release_prompt", (payload: Record<string, string>) => {
      if (!payload?.assignment_id || !payload?.incident_id) return
      // Last prompt wins; the operator handles one at a time. A re-broadcast for the
      // same assignment simply refreshes the open dialog.
      setPrompt({
        assignmentId: payload.assignment_id,
        incidentId: payload.incident_id,
        vehicleName: payload.vehicle_name || "Fahrzeug",
        incidentLabel: payload.incident_label || "Einsatz",
      })
    })
    return () => unsubscribe()
  }, [])

  if (!prompt) return null

  const handleRelease = async () => {
    setReleasing(true)
    try {
      await apiClient.unassignResource(prompt.incidentId, prompt.assignmentId)
      toast.success(`${prompt.vehicleName} freigegeben`)
      setPrompt(null)
    } catch {
      toast.error("Freigabe fehlgeschlagen")
    } finally {
      setReleasing(false)
    }
  }

  return (
    <AlertDialog open={true} onOpenChange={(open) => { if (!open) setPrompt(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Fahrzeug zurück — freigeben?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{prompt.vehicleName}</span> ist laut GPS
            wieder bei der Station. Soll die Zuweisung zu »{prompt.incidentLabel}« jetzt freigegeben
            werden? Der Einsatz bleibt offen und wird nicht abgeschlossen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => setPrompt(null)} disabled={releasing}>
            Nicht freigeben
          </Button>
          <Button onClick={handleRelease} disabled={releasing}>
            {prompt.vehicleName} freigeben
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
