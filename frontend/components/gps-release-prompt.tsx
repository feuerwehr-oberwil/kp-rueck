"use client"

import { useEffect, useState } from "react"
import { Truck } from "lucide-react"
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

interface ReleasePrompt {
  assignmentId: string
  incidentId: string
  vehicleName: string
  incidentLabel: string
}

/**
 * GPS Rule B (plan 10) — confirm-release. When the backend GPS automation detects an
 * assigned vehicle back at the magazin geofence, it broadcasts a `gps_release_prompt`
 * WebSocket event. This globally-mounted component shows a one-click confirm dialog:
 * "Fahrzeug zurück im Magazin — freigeben?". On confirm it releases that vehicle's
 * assignment via the existing unassign endpoint. The incident is never auto-closed;
 * declining leaves everything as it was.
 *
 * Editors only — a viewer would be 403'd on the unassign, so they get no prompt.
 * Mounted once in the root layout so it covers every page (board, map, settings).
 */
export function GpsReleasePrompt() {
  const { isEditor } = useAuth()
  const [prompt, setPrompt] = useState<ReleasePrompt | null>(null)
  const [releasing, setReleasing] = useState(false)

  useEffect(() => {
    if (!isEditor) return
    const unsubscribe = wsClient.on("gps_release_prompt", async (payload: Record<string, string>) => {
      if (!payload?.assignment_id || !payload?.incident_id) return
      // If the incident is already closed out, the operator has handled it —
      // no modal, the bell notification is enough.
      try {
        const incident = await apiClient.getIncident(payload.incident_id)
        if (incident.status === "abschluss") return
      } catch {
        // Can't verify — show the prompt; the unassign endpoint is the backstop.
      }
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
  }, [isEditor])

  // Auto-close if the incident gets completed while the dialog is open.
  useEffect(() => {
    if (!prompt) return
    const unsubscribe = wsClient.on(
      "incident_update",
      (msg: { action?: string; data?: { id?: string; status?: string } }) => {
        if (msg?.data?.id !== prompt.incidentId) return
        if (msg.data.status === "abschluss" || msg.action === "delete") setPrompt(null)
      },
    )
    return () => unsubscribe()
  }, [prompt])

  if (!isEditor || !prompt) return null

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

  // Archive the incident — the status change to abschluss auto-releases
  // personnel and vehicles server-side (materials stay, like on the board).
  const handleReleaseAndComplete = async () => {
    setReleasing(true)
    try {
      const incident = await apiClient.getIncident(prompt.incidentId)
      if (incident.status !== "abschluss") {
        await apiClient.updateIncidentStatus(prompt.incidentId, incident.status, "abschluss")
      }
      toast.success(`${prompt.incidentLabel} abgeschlossen`)
      setPrompt(null)
    } catch {
      toast.error("Abschliessen fehlgeschlagen")
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
            Fahrzeug zurück im Magazin — freigeben?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{prompt.vehicleName}</span> ist laut GPS
            wieder im Magazin. Nur die Zuweisung zu »{prompt.incidentLabel}« freigeben — oder den
            Einsatz gleich ganz abschliessen (gibt alle Ressourcen frei)?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setPrompt(null)} disabled={releasing}>
            Nicht freigeben
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={handleRelease} disabled={releasing}>
              Nur {prompt.vehicleName} freigeben
            </Button>
            <Button onClick={handleReleaseAndComplete} disabled={releasing}>
              Einsatz abschliessen
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
