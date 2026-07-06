"use client"

import { useEffect, useState } from "react"
import { MapPin } from "lucide-react"
import { wsClient } from "@/lib/websocket-client"
import { apiClient } from "@/lib/api-client"
import { useAuth } from "@/lib/contexts/auth-context"
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

interface ArrivalPrompt {
  incidentId: string
  vehicleName: string
  incidentLabel: string
}

/**
 * GPS Rule A (plan 10) — confirm-by-default arrival. When the backend GPS automation
 * detects an assigned vehicle at the incident location AND silent auto-advance is NOT
 * opted in, it broadcasts a `gps_arrival_prompt` WebSocket event. This globally-mounted
 * component shows a one-click confirm dialog: "Auf Einsatz setzen?". On confirm it moves
 * the incident `disponiert → einsatz` via the existing status-transition endpoint the
 * board already uses. Declining leaves everything as it was.
 *
 * Editors only — a viewer would be 403'd on the status change, so they get no prompt.
 * Mounted once in the root layout so it covers every page (board, map, settings).
 */
export function GpsArrivalPrompt() {
  const { isEditor } = useAuth()
  const [prompt, setPrompt] = useState<ArrivalPrompt | null>(null)
  const [advancing, setAdvancing] = useState(false)

  useEffect(() => {
    if (!isEditor) return
    const unsubscribe = wsClient.on("gps_arrival_prompt", async (payload: Record<string, string>) => {
      if (!payload?.incident_id) return
      // If the operator already moved the card past Disponiert, the bell
      // notification is enough — don't interrupt with a stale modal.
      try {
        const incident = await apiClient.getIncident(payload.incident_id)
        if (incident.status !== "disponiert") return
      } catch {
        // Can't verify — show the prompt; the status endpoint re-checks on confirm.
      }
      // Last prompt wins; the operator handles one at a time. A re-broadcast for the
      // same incident simply refreshes the open dialog.
      setPrompt({
        incidentId: payload.incident_id,
        vehicleName: payload.vehicle_name || "Fahrzeug",
        incidentLabel: payload.incident_label || "Einsatz",
      })
    })
    return () => unsubscribe()
  }, [isEditor])

  // Auto-close if the incident leaves Disponiert while the dialog is open
  // (operator moved the card themselves on another screen).
  useEffect(() => {
    if (!prompt) return
    const unsubscribe = wsClient.on(
      "incident_update",
      (msg: { action?: string; data?: { id?: string; status?: string } }) => {
        if (msg?.data?.id !== prompt.incidentId) return
        if (msg.data.status && msg.data.status !== "disponiert") setPrompt(null)
      },
    )
    return () => unsubscribe()
  }, [prompt])

  if (!isEditor || !prompt) return null

  const handleAdvance = async () => {
    setAdvancing(true)
    try {
      // Rule A only fires from status exactly `disponiert`, so that is the from-status.
      await apiClient.updateIncidentStatus(prompt.incidentId, "disponiert", "einsatz")
      toast.success(`${prompt.incidentLabel} auf Einsatz gesetzt`)
      setPrompt(null)
    } catch {
      toast.error("Statusänderung fehlgeschlagen")
    } finally {
      setAdvancing(false)
    }
  }

  return (
    <AlertDialog open={true} onOpenChange={(open) => { if (!open) setPrompt(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Fahrzeug am Einsatzort
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{prompt.vehicleName}</span> ist beim
            Einsatz »{prompt.incidentLabel}« angekommen. Auf Einsatz setzen?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => setPrompt(null)} disabled={advancing}>
            Nicht verschieben
          </Button>
          <Button onClick={handleAdvance} disabled={advancing}>
            Auf Einsatz setzen
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
